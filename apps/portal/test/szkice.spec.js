import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { ZGODA_KONTAKT } from '@ud/wniosek';
import {
  KATALOG, czytaj, kodFunkcji, AsyncFunction, SZKIC_PODPIS, SEKRET, ID_NIEISTNIEJACE, atrapaBazy,
} from './pomocnicy-funkcji.js';

const { podpiszWycofanie, skrotIp } = SZKIC_PODPIS;

/**
 * Szkice wniosków (`wniosek-szkic`) — lejek bez danych osobowych i kontakt
 * wyłącznie za zgodą. Plan: PLAN-NIEDOKONCZONE-WNIOSKI.md.
 *
 * Test ładuje PRAWDZIWE źródło funkcji brzegowej i uruchamia je w Node'ie
 * z atrapami Supabase i Turnstile — nie przepisaną kopię. Przepisana kopia
 * rozjechałaby się przy pierwszej zmianie po tamtej stronie i test pilnowałby
 * własnego wyobrażenia o funkcji, a nie jej samej.
 *
 * Atrapa bazy odtwarza ograniczenia tabeli ud_wnioski_szkice (kontakt tylko za
 * zgodą, zgoda udokumentowana, ukończony = ostatni krok). Funkcja, która
 * spróbuje zapisać e-mail bez zgody, dostaje błąd tak samo jak w produkcji.
 */

/**
 * Ładuje funkcję brzegową z repozytorium i zwraca jej handler.
 * `env` — zmienne środowiska funkcji; `turnstileOk` — tokeny uznawane przez „Cloudflare".
 */
async function zaladuj({ env = {}, turnstileOk = ['dobry-token'] } = {}) {
  const baza = atrapaBazy();
  const logi = [];
  const zapytaniaTurnstile = [];
  let handler = null;

  const zmienne = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'klucz',
    TURNSTILE_SECRET_KEY: 'sekret-turnstile', SZKIC_HMAC_SECRET: SEKRET, ...env,
  };
  const Deno = { env: { get: (k) => zmienne[k] } };
  const fetchAtrapa = async (url, opcje) => {
    zapytaniaTurnstile.push({ url: String(url), body: String(opcje?.body ?? '') });
    const token = new URLSearchParams(String(opcje?.body ?? '')).get('response');
    return { json: async () => ({ success: turnstileOk.includes(token) }) };
  };

  const kod = kodFunkcji('functions/wniosek-szkic/index.ts');
  await new AsyncFunction('serve', 'createClient', 'logError', 'skrotIp', 'sprawdzWycofanie', 'Deno', 'fetch', kod)(
    (h) => { handler = h; },
    () => baza.klient,
    async (zrodlo, wiadomosc, kontekst, ip) => { logi.push({ zrodlo, wiadomosc, kontekst, ip }); },
    SZKIC_PODPIS.skrotIp,
    SZKIC_PODPIS.sprawdzWycofanie,
    Deno,
    fetchAtrapa,
  );

  const wywolaj = async (cialo, { metoda = 'POST', ip = '203.0.113.7', adres = 'https://x.supabase.co/functions/v1/wniosek-szkic', naglowki = {} } = {}) => {
    const res = await handler(new Request(adres, {
      method: metoda,
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...naglowki },
      body: metoda === 'GET' ? undefined : (typeof cialo === 'string' ? cialo : JSON.stringify(cialo)),
    }));
    return { status: res.status, cialo: await res.json().catch(() => null) };
  };
  return { ...baza, logi, wywolaj, zapytaniaTurnstile };
}

const KONTAKT = { imie: 'Jan Kowalski', email: 'Jan.Kowalski@Example.com', phone: '504 400 901' };
const ZGODA = { zgoda: true, zgoda_wersja: ZGODA_KONTAKT.wersja };
const TOKEN = { 'cf-turnstile-response': 'dobry-token' };

test.describe('wniosek-szkic: bramki', () => {
  test('GET nie robi nic — skaner linków nie wycofa zgody za klienta', async () => {
    const f = await zaladuj();
    const id = (await f.wywolaj({ akcja: 'start', ...TOKEN })).cialo.id;
    const podpis = await podpiszWycofanie(id, SEKRET);
    const r = await f.wywolaj(undefined, {
      metoda: 'GET',
      adres: `https://x.supabase.co/functions/v1/wniosek-szkic?akcja=wycofaj&id=${id}&sig=${podpis}`,
    });
    expect(r.status).toBe(405);
  });

  test('bez sekretu Turnstile: 503, wpis w ud_errors, nic nie zapisane', async () => {
    const f = await zaladuj({ env: { TURNSTILE_SECRET_KEY: '' } });
    const r = await f.wywolaj({ akcja: 'start', ...TOKEN });
    expect(r.status).toBe(503);
    expect(f.logi.map((l) => l.wiadomosc).join()).toContain('TURNSTILE_SECRET_KEY');
    expect(f.wiersze).toHaveLength(0);
  });

  test('zły albo brakujący token: 400, nic nie zapisane', async () => {
    const f = await zaladuj();
    expect((await f.wywolaj({ akcja: 'start', 'cf-turnstile-response': 'podrobiony' })).status).toBe(400);
    expect((await f.wywolaj({ akcja: 'start' })).status).toBe(400);
    expect(f.wiersze).toHaveLength(0);
  });

  test('bez sekretu podpisu: 503 — nie zbieramy zgód, których nie da się cofnąć', async () => {
    const f = await zaladuj({ env: { SZKIC_HMAC_SECRET: '' } });
    const r = await f.wywolaj({ akcja: 'start', ...ZGODA, ...KONTAKT, ...TOKEN });
    expect(r.status).toBe(503);
    expect(f.logi.map((l) => l.wiadomosc).join()).toContain('SZKIC_HMAC_SECRET');
    expect(f.wiersze).toHaveLength(0);
  });

  test('limit: dziesiąty szkic z jednego IP w godzinę przechodzi, jedenasty nie', async () => {
    const f = await zaladuj();
    for (let i = 0; i < 10; i += 1) {
      expect((await f.wywolaj({ akcja: 'start', ...TOKEN })).status).toBe(200);
    }
    expect((await f.wywolaj({ akcja: 'start', ...TOKEN })).status).toBe(429);
    // Inny adres IP ma własny kubełek.
    expect((await f.wywolaj({ akcja: 'start', ...TOKEN }, { ip: '198.51.100.4' })).status).toBe(200);
    expect(f.wiersze).toHaveLength(11);
  });

  test('IP jest zapisywany wyłącznie jako skrót, nie jawnie', async () => {
    const f = await zaladuj();
    await f.wywolaj({ akcja: 'start', ...TOKEN }, { ip: '203.0.113.7' });
    const w = f.wiersze[0];
    expect(w.ip_hash).toBe(await skrotIp('203.0.113.7', SEKRET));
    expect(JSON.stringify(w)).not.toContain('203.0.113.7');
  });

  test('nieznana akcja i zły identyfikator: 400', async () => {
    const f = await zaladuj();
    expect((await f.wywolaj({ akcja: 'usun-wszystko' })).status).toBe(400);
    expect((await f.wywolaj({ akcja: 'krok', id: "1' or '1'='1", krok: 'dane' })).status).toBe(400);
    expect((await f.wywolaj('to nie jest json')).status).toBe(400);
  });
});

test.describe('wniosek-szkic: co trafia do bazy', () => {
  test('bez zgody: lejek i nic więcej, nawet gdy przeglądarka dośle dane', async () => {
    const f = await zaladuj();
    const r = await f.wywolaj({
      akcja: 'start', ...TOKEN, zgoda: false, ...KONTAKT,
      // To, czego szkic nigdy nie przyjmuje — przeglądarka nie powinna tego
      // słać, ale funkcja ma być odporna także na pomyłkę po tamtej stronie.
      pesel: '90010112349', med_heart: 'yes', med_heart_notes: 'nadciśnienie',
      hs_smoker: 'tak', hsd_smoker: 'paczka dziennie',
    });
    expect(r.status).toBe(200);
    expect(r.cialo.id).toMatch(/^[0-9a-f-]{36}$/);

    const w = f.wiersze[0];
    expect(w).toMatchObject({ ostatni_krok: 'kontakt', zgoda_kontakt: false });
    expect([w.imie, w.email, w.phone]).toEqual([null, null, null]);
    expect(JSON.stringify(w)).not.toMatch(/90010112349|nadciśnienie|paczka|med_|hs_|hsd_|pesel/i);
  });

  test('ze zgodą: kontakt zapisany, treść zgody pochodzi z serwera, nie z żądania', async () => {
    const f = await zaladuj();
    const r = await f.wywolaj({
      akcja: 'start', ...TOKEN, ...ZGODA, ...KONTAKT,
      zgoda_tresc: 'treść podstawiona przez klienta',
    });
    expect(r.status).toBe(200);

    const w = f.wiersze[0];
    expect(w.zgoda_kontakt).toBe(true);
    expect(w.email).toBe('jan.kowalski@example.com');
    expect(w.imie).toBe('Jan Kowalski');
    expect(w.zgoda_wersja).toBe(ZGODA_KONTAKT.wersja);
    // Tekst zgody w kreatorze i w funkcji muszą być identyczne — inaczej baza
    // „dowodzi" zgody na coś, czego klient nie widział.
    expect(w.zgoda_tresc).toBe(ZGODA_KONTAKT.tresc);
    expect(w.zgoda_tresc).not.toContain('podstawiona');
    expect(w.zgoda_at).toBeTruthy();
    expect(JSON.stringify(w)).not.toMatch(/pesel|med_|hs_|hsd_/i);
  });

  test('zgoda z nieznaną wersją albo z błędnym kontaktem: 400, nic nie zapisane', async () => {
    const f = await zaladuj();
    expect((await f.wywolaj({ akcja: 'start', ...TOKEN, ...KONTAKT, zgoda: true, zgoda_wersja: 'v0-wymyslona' })).status).toBe(400);
    expect((await f.wywolaj({ akcja: 'start', ...TOKEN, ...ZGODA, ...KONTAKT, email: 'to-nie-email' })).status).toBe(400);
    expect((await f.wywolaj({ akcja: 'start', ...TOKEN, ...ZGODA, ...KONTAKT, phone: '123' })).status).toBe(400);
    expect((await f.wywolaj({ akcja: 'start', ...TOKEN, ...ZGODA, ...KONTAKT, imie: '  ' })).status).toBe(400);
    expect(f.wiersze).toHaveLength(0);
  });

  test('błąd bazy nie wycieka kontaktu do ud_errors', async () => {
    const f = await zaladuj();
    f.klient.from = () => { throw new Error('baza nie działa'); };
    const r = await f.wywolaj({ akcja: 'start', ...TOKEN, ...ZGODA, ...KONTAKT });
    expect(r.status).toBe(500);
    expect(JSON.stringify(f.logi)).not.toMatch(/kowalski|504 400 901|@example/i);
  });
});

test.describe('wniosek-szkic: kroki, kontakt, zakończenie', () => {
  const start = async (f, dodatki = {}) =>
    (await f.wywolaj({ akcja: 'start', ...TOKEN, ...dodatki })).cialo.id;

  test('krok idzie tylko do przodu', async () => {
    const f = await zaladuj();
    const id = await start(f);

    await f.wywolaj({ akcja: 'krok', id, krok: 'zakres' });
    expect(f.wiersze[0].ostatni_krok).toBe('zakres');
    // Powtórka i cofnięcie nie zmieniają niczego.
    await f.wywolaj({ akcja: 'krok', id, krok: 'dane' });
    await f.wywolaj({ akcja: 'krok', id, krok: 'zakres' });
    expect(f.wiersze[0].ostatni_krok).toBe('zakres');
    await f.wywolaj({ akcja: 'krok', id, krok: 'zdrowie' });
    expect(f.wiersze[0].ostatni_krok).toBe('zdrowie');
  });

  test('„krok" nie zamyka szkicu ani nie przyjmuje kroków spoza kreatora', async () => {
    const f = await zaladuj();
    const id = await start(f);
    for (const krok of ['zgody', 'kontakt', 'pesel', '']) {
      expect((await f.wywolaj({ akcja: 'krok', id, krok })).status, krok).toBe(400);
    }
    expect(f.wiersze[0].ostatni_krok).toBe('kontakt');
    expect(f.wiersze[0].ukonczony_at).toBeNull();
  });

  test('krok na nieistniejącym szkicu nic nie tworzy', async () => {
    const f = await zaladuj();
    await f.wywolaj({ akcja: 'krok', id: ID_NIEISTNIEJACE, krok: 'dane' });
    expect(f.wiersze).toHaveLength(0);
  });

  test('Wstecz → odznaczona zgoda czyści kontakt bez tokenu', async () => {
    const f = await zaladuj();
    const id = await start(f, { ...ZGODA, ...KONTAKT });
    expect(f.wiersze[0].email).toBeTruthy();

    const r = await f.wywolaj({ akcja: 'kontakt', id, zgoda: false });
    expect(r.status).toBe(200);
    expect(f.wiersze[0]).toMatchObject({ zgoda_kontakt: false, imie: null, email: null, phone: null });
  });

  test('zaznaczenie zgody na istniejącym szkicu wymaga tokenu', async () => {
    const f = await zaladuj();
    const id = await start(f);

    const bez = await f.wywolaj({ akcja: 'kontakt', id, ...ZGODA, ...KONTAKT });
    expect(bez.status).toBe(400);
    expect(f.wiersze[0].zgoda_kontakt).toBe(false);

    const z = await f.wywolaj({ akcja: 'kontakt', id, ...ZGODA, ...KONTAKT, ...TOKEN });
    expect(z.status).toBe(200);
    expect(f.wiersze[0]).toMatchObject({ zgoda_kontakt: true, email: 'jan.kowalski@example.com', zgoda_tresc: ZGODA_KONTAKT.tresc });
  });

  test('„ukoncz" woła funkcję SQL, a ukończony szkic nie przyjmuje już zmian', async () => {
    const f = await zaladuj();
    const id = await start(f, { ...ZGODA, ...KONTAKT });

    expect((await f.wywolaj({ akcja: 'ukoncz', id })).status).toBe(200);
    expect(f.rpc).toEqual([{ nazwa: 'ud_wnioski_szkic_ukoncz', argumenty: { p_id: id } }]);
    // Po zakończeniu: kontakt wyczyszczony, a dalsze wywołania nic nie zmieniają.
    expect(f.wiersze[0]).toMatchObject({ ostatni_krok: 'zgody', email: null, phone: null, imie: null });
    await f.wywolaj({ akcja: 'kontakt', id, ...ZGODA, ...KONTAKT, ...TOKEN });
    expect(f.wiersze[0].email).toBeNull();
  });
});

test.describe('wniosek-szkic: wycofanie zgody', () => {
  test('zły podpis: 403 i dane stoją', async () => {
    const f = await zaladuj();
    const id = (await f.wywolaj({ akcja: 'start', ...TOKEN, ...ZGODA, ...KONTAKT })).cialo.id;

    for (const sig of ['', 'abc', '0'.repeat(64), (await podpiszWycofanie(ID_NIEISTNIEJACE, SEKRET))]) {
      expect((await f.wywolaj({ akcja: 'wycofaj', id, sig })).status, sig).toBe(403);
    }
    expect(f.wiersze[0]).toMatchObject({ zgoda_kontakt: true, email: 'jan.kowalski@example.com' });
  });

  test('dobry podpis: zgoda cofnięta, kontakt usunięty', async () => {
    const f = await zaladuj();
    const id = (await f.wywolaj({ akcja: 'start', ...TOKEN, ...ZGODA, ...KONTAKT })).cialo.id;

    const r = await f.wywolaj({ akcja: 'wycofaj', id, sig: await podpiszWycofanie(id, SEKRET) });
    expect(r.status).toBe(200);
    expect(f.wiersze[0]).toMatchObject({ zgoda_kontakt: false, imie: null, email: null, phone: null });
    expect(f.wiersze[0].zgoda_wycofana_at).toBeTruthy();
  });

  test('one-click z nagłówka List-Unsubscribe-Post (RFC 8058): id i podpis w adresie', async () => {
    const f = await zaladuj();
    const id = (await f.wywolaj({ akcja: 'start', ...TOKEN, ...ZGODA, ...KONTAKT })).cialo.id;
    const sig = await podpiszWycofanie(id, SEKRET);

    const r = await f.wywolaj('List-Unsubscribe=One-Click', {
      adres: `https://x.supabase.co/functions/v1/wniosek-szkic?akcja=wycofaj&id=${id}&sig=${sig}`,
      naglowki: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(r.status).toBe(200);
    expect(f.wiersze[0].email).toBeNull();
  });

  test('poprawny podpis pod szkicem, którego już nie ma, też kończy się sukcesem', async () => {
    const f = await zaladuj();
    const r = await f.wywolaj({ akcja: 'wycofaj', id: ID_NIEISTNIEJACE, sig: await podpiszWycofanie(ID_NIEISTNIEJACE, SEKRET) });
    expect(r.status).toBe(200);
  });

  test('podpis wycofania nie jest skrótem IP i odwrotnie', async () => {
    const id = ID_NIEISTNIEJACE;
    expect(await podpiszWycofanie(id, SEKRET)).not.toBe(await skrotIp(id, SEKRET));
  });
});

test.describe('wniosek-szkic: źródło', () => {
  const zrodlo = czytaj('functions/wniosek-szkic/index.ts');

  test('Turnstile i sekret stoją przed pierwszym zapisem', () => {
    const brak = zrodlo.indexOf("if (!Deno.env.get('TURNSTILE_SECRET_KEY'))");
    const weryfikacja = zrodlo.indexOf('await verifyTurnstile(');
    const zapis = zrodlo.indexOf(".from('ud_wnioski_szkice')\n        .insert(");
    expect(brak, 'bramka braku sekretu').toBeGreaterThan(-1);
    expect(zapis, 'zapis szkicu').toBeGreaterThan(-1);
    expect(brak).toBeLessThan(weryfikacja);
    expect(weryfikacja).toBeLessThan(zapis);
    expect(zrodlo).toMatch(/if \(!secret\) return false;/);
    expect(zrodlo).not.toMatch(/if \(!secret\) return true/);
    expect(zrodlo.slice(brak, weryfikacja)).toContain('503');
    expect(zrodlo.slice(brak, weryfikacja)).toContain('logError(');
  });

  test('metoda sprawdzana przed jakimkolwiek odczytem ciała', () => {
    expect(zrodlo.indexOf("req.method !== 'POST'")).toBeGreaterThan(-1);
    expect(zrodlo.indexOf("req.method !== 'POST'")).toBeLessThan(zrodlo.indexOf('await req.text()'));
  });

  test('funkcja nie czyta PESEL-u ani pól ankiety z żądania', () => {
    // Czytamy z żądania wyłącznie to, co wymienione w nagłówku funkcji. Gdyby
    // ktoś dopisał odczyt `pesel` albo `med_*`, szkic przestałby być lejkiem.
    const odczyty = [...zrodlo.matchAll(/\b(?:wejscie|w)(?:\.|\[')([A-Za-z_-]+)/g)].map((m) => m[1]);
    expect(odczyty.length).toBeGreaterThan(5);
    for (const pole of odczyty) {
      expect(pole, `odczyt pola ${pole} z żądania`).not.toMatch(/pesel|^med_|^hs_|^hsd_|health|survey/i);
    }
  });

  test('log błędów nie dostaje ciała żądania', () => {
    expect(zrodlo).not.toMatch(/logError\([^)]*raw/);
  });
});

test.describe('migracja szkiców', () => {
  const katalog = KATALOG + 'migrations/';
  const plik = readdirSync(katalog).find((p) => p.endsWith('_wnioski_szkice.sql'));
  const sql = plik ? readFileSync(katalog + plik, 'utf8') : '';

  test('RLS włączone i zero polityk — dostęp tylko kluczem serwisowym', () => {
    expect(plik, 'brak migracji wnioski_szkice').toBeTruthy();
    expect(sql).toMatch(/alter table public\.ud_wnioski_szkice enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on table public\.ud_wnioski_szkice from public, anon, authenticated/);
  });

  test('tabela nie ma kolumn na PESEL ani na ankietę medyczną', () => {
    const tabela = sql.slice(sql.indexOf('create table if not exists public.ud_wnioski_szkice'), sql.indexOf('comment on table'));
    expect(tabela).toContain('create table');
    expect(tabela).not.toMatch(/pesel|\bmed_|\bhs_|\bhsd_|form_data|health|survey/i);
  });

  test('kontakt tylko za zgodą — ograniczenie jest w bazie, nie tylko w kodzie', () => {
    expect(sql).toMatch(/check \(zgoda_kontakt or \(imie is null and email is null and phone is null\)\)/);
  });

  test('widok lejka nie ma danych osobowych i działa z uprawnieniami wywołującego', () => {
    const widok = sql.slice(sql.indexOf('create or replace view public.ud_lejek_wniosku'), sql.indexOf('revoke all on public.ud_lejek_wniosku'));
    expect(widok).toContain('security_invoker = true');
    expect(widok).not.toMatch(/\b(imie|email|phone|ip_hash|zgoda_tresc)\b/);
  });

  test('przypomnienia: cron woła funkcję SQL z tokenem z Vaulta i startuje WYŁĄCZONY', () => {
    expect(sql).toMatch(/'x-cron-token', \(select decrypted_secret from vault\.decrypted_secrets\s+where name = 'edge_cron_token'\)/);
    expect(sql).toContain("'select public.ud_wnioski_przypomnienia()'");
    expect(sql).toMatch(/perform cron\.alter_job\(nr, active := false\)/);
    // Wartość sekretu powstaje w bazie. W pliku nie ma prawa stać ani ona, ani JWT.
    expect(sql).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(sql).not.toContain('eyJ');
  });

  test('retencja: 30 dni i codzienne zadanie', () => {
    expect(sql).toContain("interval '30 days'");
    expect(sql).toContain("'wnioski-szkice-retencja'");
  });
});
