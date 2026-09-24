import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Bramki funkcji brzegowych — czy kod w repozytorium nadal się broni.
 *
 * Audyt z 24.09.2026 znalazł wśród funkcji z verify_jwt = false trzy
 * całkiem otwarte (raport leadów, synchronizacja CRM, powiadomienie
 * o wyborze oferty) i trzy formularze, w których brak sekretu Turnstile
 * po cichu wyłączał CAPTCHĘ — sekretu rzeczywiście nie było. Nic z tego
 * nie było widać w działaniu: wszystko odpowiadało 200.
 *
 * Te testy nie wołają funkcji — sprawdzają ich źródła. Chodzi o jedną
 * pomyłkę: ktoś wdraża z repozytorium wersję, z której bramka wypadła
 * przy edycji. Kolejność ma tu znaczenie, więc sprawdzamy nie tylko
 * obecność bramki, ale to, że stoi PRZED pierwszym odczytem albo wysyłką.
 */

const funkcja = (nazwa) =>
  readFileSync(
    fileURLToPath(new URL(`../../../supabase/functions/${nazwa}/index.ts`, import.meta.url)),
    'utf8',
  );

/** Pozycja pierwszego wystąpienia; -1 psuje porównania, więc wymagamy trafienia. */
function gdzie(zrodlo, fraza, opis) {
  const i = zrodlo.indexOf(fraza);
  expect(i, `nie znaleziono: ${opis ?? fraza}`).toBeGreaterThan(-1);
  return i;
}

test.describe('funkcje wołane przez cron wpuszczają tylko cron', () => {
  for (const [nazwa, pierwszyOdczyt] of [
    ['send-digest-email', '.from("udochodu_contacts")'],
    ['sync-beauty-companies', 'if (!BEAUTY_KEY)'],
  ]) {
    test(`${nazwa}: token x-cron-token sprawdzany przed pierwszym odczytem`, () => {
      const zrodlo = funkcja(nazwa);
      const naglowek = gdzie(zrodlo, 'x-cron-token');
      const sprawdzenie = gdzie(zrodlo, 'edge_cron_token_matches');
      const odczyt = gdzie(zrodlo, pierwszyOdczyt, 'pierwszy odczyt danych');
      expect(naglowek, 'nagłówek czytany za późno').toBeLessThan(odczyt);
      expect(sprawdzenie, 'token sprawdzany za późno').toBeLessThan(odczyt);
    });
  }

  test('digest escape’uje pola wpisane przez odwiedzającego', () => {
    const zrodlo = funkcja('send-digest-email');
    const surowe = [...zrodlo.matchAll(/\$\{(c\.[a-z_]+)[^}]*\}/g)]
      .map((m) => m[1])
      .filter((pole) => pole !== 'c.created_at');
    expect(surowe, 'pola leadów wstawione do HTML-a bez esc()').toEqual([]);
  });

  test('migracja: cron woła funkcje SQL-owe, a tokenu nie ma w pliku', () => {
    const katalog = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
    const plik = readdirSync(katalog).find((p) => p.endsWith('_edge_cron_token.sql'));
    expect(plik, 'brak migracji edge_cron_token').toBeTruthy();
    const sql = readFileSync(katalog + plik, 'utf8');

    expect(sql).toContain("command := 'select public.ud_send_digest_email()'");
    expect(sql).toContain("command := 'select public.aura_sync_beauty_companies()'");
    // Wartość sekretu powstaje w bazie. W pliku nie ma prawa stać ani ona,
    // ani żaden JWT — to jest dokładnie ten błąd, przed którym chroni Vault.
    expect(sql).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(sql).not.toContain('eyJ');
    expect(sql).toMatch(/revoke all on function public\.edge_cron_token_matches\(text\) from public, anon, authenticated/);
  });
});

test.describe('send-offer-email nie rozsyła treści z żądania', () => {
  const zrodlo = funkcja('send-offer-email');

  test('pole choice z ciała żądania nie jest czytane', () => {
    expect(zrodlo).not.toMatch(/\{\s*offer_id\s*,\s*choice\s*\}\s*=\s*await req\.json/);
    expect(zrodlo).not.toMatch(/choice\?\./);
    expect(zrodlo).toContain('client_choice');
  });

  test('wysyłka tylko tuż po wyborze', () => {
    expect(zrodlo).toMatch(/OKNO_MINUT\s*=\s*\d+/);
    expect(zrodlo).toContain('409');
  });

  test('każda wstawka w HTML-u listu jest escape’owana', () => {
    for (const nazwa of ['brokerHtml', 'clientHtml']) {
      const szablon = zrodlo.match(new RegExp(`const ${nazwa} = \`([^\`]*)\``));
      expect(szablon, `brak szablonu ${nazwa}`).toBeTruthy();
      const surowe = [...szablon[1].matchAll(/\$\{([^}]*)\}/g)]
        .map((m) => m[1].trim())
        .filter((w) => !w.startsWith('esc(') && !w.includes('? "Tak" : "Nie"'));
      expect(surowe, `${nazwa}: wstawki bez esc()`).toEqual([]);
    }
  });
});

test.describe('formularze: brak sekretu Turnstile to odmowa, nie przepustka', () => {
  for (const nazwa of ['form-submit', 'contact-submit', 'review-submit']) {
    test(nazwa, () => {
      const zrodlo = funkcja(nazwa);
      expect(zrodlo, 'wróciło `if (!secret) return true`').not.toMatch(/if \(!secret\) return true/);
      expect(zrodlo).toMatch(/if \(!secret\) return false;/);

      // Handler zgłasza brak sekretu wcześniej, z 503 i wpisem w ud_errors,
      // zanim w ogóle dojdzie do weryfikacji tokenu.
      const brak = gdzie(zrodlo, "if (!Deno.env.get('TURNSTILE_SECRET_KEY'))", 'bramka braku sekretu w handlerze');
      const weryfikacja = gdzie(zrodlo, 'await verifyTurnstile(', 'wywołanie verifyTurnstile');
      expect(brak).toBeLessThan(weryfikacja);
      const blok = zrodlo.slice(brak, weryfikacja);
      expect(blok).toContain('503');
      expect(blok).toContain('logError(');
    });
  }
});
