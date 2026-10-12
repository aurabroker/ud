import { test, expect } from '@playwright/test';
import { RYZYKA, GRANICE_CIALA, doWysylki, sprawdzKrok, KROKI } from '@ud/wniosek';
import { kodFunkcji, AsyncFunction } from './pomocnicy-funkcji.js';

/**
 * Granice wniosku — decyzja właściciela z 12.10.2026.
 *
 * 11.10.2026 przeszedł wniosek z wagą 1000 kg, świadczeniem 500 000 000 zł
 * miesięcznie i sumą śmierci 99 999 999 zł. Kreator nie sprawdzał żadnej
 * z tych liczb od góry, a `form-submit` zapisywał wszystko, co przyszło.
 *
 * Liczby stoją w dwóch miejscach: w schemacie kreatora (`RYZYKA[].max`,
 * `GRANICE_CIALA`) i w funkcji brzegowej (`GRANICE_SUM`, `GRANICE_CIALA`).
 * Funkcja jest tą, która decyduje — kreator da się obejść. Ten test ładuje
 * PRAWDZIWE źródło funkcji i sprawdza ZACHOWANIEM, że każda granica ze schematu
 * jest po tamtej stronie ta sama: kwota na granicy przechodzi, o złotówkę
 * wyżej — 400. Parsowanie liczb z kodu źródłowego sprawdzałoby zapis, nie
 * działanie.
 */

const TOKEN = 'dobry-token';

/** Ładuje form-submit z repozytorium; zwraca handler i to, co poszło do bazy. */
async function zaladuj() {
  const zapisane = [];
  const logi = [];
  let handler = null;
  const zmienne = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'klucz',
    TURNSTILE_SECRET_KEY: 'sekret-turnstile',
  };
  const Deno = { env: { get: (k) => zmienne[k] } };
  const fetchAtrapa = async (url, opcje) => {
    if (!String(url).includes('challenges.cloudflare.com')) throw new Error(`nieoczekiwany fetch: ${url}`);
    const token = new URLSearchParams(String(opcje?.body ?? '')).get('response');
    return { json: async () => ({ success: token === TOKEN }) };
  };
  const createClient = () => ({
    from(tabela) {
      if (tabela !== 'ud_clients') throw new Error(`nieoczekiwana tabela: ${tabela}`);
      return { insert: async (wiersze) => { zapisane.push(...wiersze); return { error: null }; } };
    },
  });

  await new AsyncFunction('serve', 'createClient', 'logError', 'Deno', 'fetch', kodFunkcji('functions/form-submit/index.ts'))(
    (h) => { handler = h; },
    createClient,
    async (zrodlo, wiadomosc, kontekst, ip) => { logi.push({ zrodlo, wiadomosc, kontekst, ip }); },
    Deno,
    fetchAtrapa,
  );

  const wyslij = async (cialo) => {
    const res = await handler(new Request('https://x.supabase.co/functions/v1/form-submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({ ...cialo, 'cf-turnstile-response': TOKEN }),
    }));
    return { status: res.status, cialo: await res.json().catch(() => null) };
  };
  return { wyslij, zapisane, logi };
}

/** Poprawny wniosek prosto z kreatora — ten sam `doWysylki`, którym wysyła portal. */
function wniosek(zmiany = {}) {
  return doWysylki({
    fullName: 'Jan Kowalski', email: 'jan.kowalski@example.com', phone: '504 400 901',
    pesel: '90010112349', profession: 'Lekarz', employmentType: 'b2b', taxForm: 'liniowy',
    weight: 80, height: 180,
    riskTempIncapacity: true, tempIncapacitySum: 10_000,
    riskPermIncapacity: false, permIncapacitySum: '',
    riskDeathInvalidity: false, nwDeathSum: '',
    exclusions_accepted: true, informedAccepted: true,
    ...zmiany,
  });
}

const KOLUMNA = { tempIncapacitySum: 'temp_incapacity_sum', permIncapacitySum: 'perm_incapacity_sum', nwDeathSum: 'nw_death_sum' };

test.describe('form-submit: granice z 12.10.2026', () => {
  test('poprawny wniosek z kreatora przechodzi (granice nie odcinają klientów)', async () => {
    const f = await zaladuj();
    const r = await f.wyslij(wniosek());
    expect(r.status, JSON.stringify(r.cialo)).toBe(200);
    expect(f.zapisane).toHaveLength(1);
  });

  test('wniosek Janusza z 11.10 nie trafia do bazy', async () => {
    const f = await zaladuj();
    const r = await f.wyslij(wniosek({
      weight: '1000', height: '131',
      tempIncapacitySum: '500000000',
      riskPermIncapacity: true, permIncapacitySum: '123123',
      riskDeathInvalidity: true, nwDeathSum: '99999999',
    }));
    expect(r.status).toBe(400);
    expect(r.cialo.message).toMatch(/200 kg/);
    expect(f.zapisane).toHaveLength(0);
    // Próba obejścia kreatora zostawia ślad z adresem IP.
    expect(f.logi).toEqual([expect.objectContaining({ wiadomosc: 'Wniosek poza granicami: weight', ip: '203.0.113.9' })]);
  });

  for (const r of RYZYKA) {
    test(`suma „${r.etykieta}": ${r.max} przechodzi, ${r.max + 1} nie`, async () => {
      const f = await zaladuj();
      const naGranicy = await f.wyslij(wniosek({ [r.klucz]: true, [r.poleSumy]: r.max }));
      expect(naGranicy.status, JSON.stringify(naGranicy.cialo)).toBe(200);
      expect(f.zapisane[0][KOLUMNA[r.poleSumy]]).toBe(r.max);

      const ponad = await f.wyslij(wniosek({ [r.klucz]: true, [r.poleSumy]: r.max + 1 }));
      expect(ponad.status).toBe(400);
      expect(f.zapisane).toHaveLength(1);

      // Kreator mówi to samo, zanim cokolwiek wyjdzie z przeglądarki.
      expect(sprawdzKrok('zakres', { riskTempIncapacity: true, tempIncapacitySum: 1000, [r.klucz]: true, [r.poleSumy]: r.max })).toEqual({});
      expect(sprawdzKrok('zakres', { riskTempIncapacity: true, tempIncapacitySum: 1000, [r.klucz]: true, [r.poleSumy]: r.max + 1 })[r.poleSumy]).toBeTruthy();
    });
  }

  for (const [pole, g] of Object.entries(GRANICE_CIALA)) {
    test(`${pole}: ${g.min}–${g.max} ${g.jednostka} przechodzi, poza tym nie`, async () => {
      const f = await zaladuj();
      for (const ok of [g.min, g.max, '']) {
        const r = await f.wyslij(wniosek({ [pole]: ok }));
        expect(r.status, `${pole}=${ok}: ${JSON.stringify(r.cialo)}`).toBe(200);
        expect(sprawdzKrok('dane', { profession: 'Lekarz', pesel: '90010112349', [pole]: ok })).toEqual({});
      }
      for (const zle of [g.min - 1, g.max + 1, 'abc', '-80', '1e9']) {
        const r = await f.wyslij(wniosek({ [pole]: zle }));
        expect(r.status, `${pole}=${zle}`).toBe(400);
        expect(sprawdzKrok('dane', { profession: 'Lekarz', pesel: '90010112349', [pole]: zle })[pole], `kreator: ${pole}=${zle}`).toBeTruthy();
      }
      expect(f.zapisane).toHaveLength(3);
    });
  }

  test('liczba ukryta w napisie nie przechodzi („5e8", „50000abc")', async () => {
    // parseAmount bierze PIERWSZĄ liczbę z napisu: „5e8" to dla niego 5,
    // „50000abc" — 50 000. Bez ścisłego odczytu oba trafiłyby do bazy.
    const f = await zaladuj();
    for (const kwota of ['5e8', '50000abc', '0x1F', '1.000.000']) {
      const r = await f.wyslij(wniosek({ tempIncapacitySum: kwota }));
      expect(r.status, kwota).toBe(400);
    }
    expect(f.zapisane).toHaveLength(0);
  });

  test('zapis z odstępami i „zł" przechodzi, a do kolumny idzie liczba', async () => {
    const f = await zaladuj();
    const przypadki = [['10 000', 10000], ['10\u00A0000 zł', 10000], ['10000,50', 10000.5], ['50 000 PLN', 50000],
      ['\uFEFF20000', 20000], ['50000.0000000000000000001', 50000]];
    for (const [kwota, zapis] of przypadki) {
      const r = await f.wyslij(wniosek({ tempIncapacitySum: kwota }));
      expect(r.status, `${kwota}: ${JSON.stringify(r.cialo)}`).toBe(200);
      expect(f.zapisane.at(-1).temp_incapacity_sum, kwota).toBe(zapis);
    }
  });

  test('tablica, obiekt i wartość logiczna zamiast liczby — 400', async () => {
    // [1, 500000000] po String() to „1,500000000", czyli 1,5 — bez sprawdzenia
    // typu przeszłoby granicę, a do kolumny poszłaby cała tablica.
    const f = await zaladuj();
    for (const zle of [[1, 500_000_000], { a: 1 }, true]) {
      expect((await f.wyslij(wniosek({ tempIncapacitySum: zle }))).status, JSON.stringify(zle)).toBe(400);
      expect((await f.wyslij(wniosek({ weight: zle }))).status, `weight ${JSON.stringify(zle)}`).toBe(400);
    }
    expect(f.zapisane).toHaveLength(0);
  });

  test('pole z samymi odstępami nie trafia do kolumny', async () => {
    const f = await zaladuj();
    const r = await f.wyslij(wniosek({ weight: '   ', height: '\u00A0' }));
    expect(r.status, JSON.stringify(r.cialo)).toBe(200);
    expect(f.zapisane[0].weight).toBeUndefined();
    expect(f.zapisane[0].height).toBeUndefined();
  });

  test('kwota przy NIEWYBRANYM ryzyku nie blokuje wniosku i nie idzie do kolumny', async () => {
    // Klient wpisał sumę, potem odznaczył ryzyko — pole w kreatorze zostaje.
    const f = await zaladuj();
    const r = await f.wyslij(wniosek({ riskDeathInvalidity: false, nwDeathSum: 99_999_999 }));
    expect(r.status, JSON.stringify(r.cialo)).toBe(200);
    expect(f.zapisane[0].nw_death_sum).toBeUndefined();
    expect(f.zapisane[0].form_data.nwDeathSum).toBe(99_999_999);
  });

  test('bramka granic stoi przed zapisem do bazy', async () => {
    const { readFileSync } = await import('node:fs');
    const zrodlo = readFileSync(new URL('../../../supabase/functions/form-submit/index.ts', import.meta.url), 'utf8');
    expect(zrodlo.indexOf('pozaGranicami(record)')).toBeGreaterThan(0);
    expect(zrodlo.indexOf('pozaGranicami(record)')).toBeLessThan(zrodlo.indexOf(".from('ud_clients').insert"));
    expect(KROKI.map((k) => k.id)).toContain('dane');
  });
});
