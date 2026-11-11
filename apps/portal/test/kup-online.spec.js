import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { onRequest, CEL, zrodlo } from '../functions/kup-online/[[reszta]].js';
import { onRequest as middleware } from '../functions/_middleware.js';

/**
 * /kup-online — przekierowanie na stronę sprzedaży Leadenhall z naszym kodem
 * pośrednika i licznik kliknięć (functions/kup-online/[[reszta]].js).
 *
 * Czego pilnuje: link Leadenhall wychodzi BEZ ZMIAN (inaczej przepada
 * przypisanie polisy), przekierowanie nie czeka na bazę i nie trafia do
 * bufora, liczą się tylko kliknięcia ludzi, a do bazy idą wyłącznie czas,
 * cel i źródło z białej listy. Sieć jest podstawiona.
 */

const PRZEGLADARKA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const FACEBOOK_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/485.0.0.40.94;]';
const KLUCZ = 'klucz-serwisowy-testowy';
const TABELA = 'https://kukvgsjrmrqtzhkszzum.supabase.co/rest/v1/ud_klikniecia';
const BLEDY = 'https://kukvgsjrmrqtzhkszzum.supabase.co/rest/v1/ud_errors';

async function wejscie(sciezka, {
  metoda = 'GET', naglowki = { 'user-agent': PRZEGLADARKA }, env = { SUPABASE_SERVICE_ROLE_KEY: KLUCZ },
  siec = () => new Response(null, { status: 201 }), host = 'utratadochodu.pl', reszta,
} = {}) {
  const wolane = [];
  const prawdziwy = globalThis.fetch;
  globalThis.fetch = async (adres, init = {}) => {
    wolane.push({ adres: String(adres), naglowki: new Headers(init.headers), cialo: init.body ? JSON.parse(init.body) : null });
    return siec(String(adres));
  };
  const czekaj = [];
  try {
    const url = new URL(`https://${host}${sciezka}`);
    const odp = await onRequest({
      request: new Request(url, { method: metoda, headers: naglowki }),
      params: { reszta: reszta ?? url.pathname.replace(/^\/kup-online\/?/, '').split('/').filter(Boolean) },
      env,
      waitUntil: (p) => czekaj.push(p),
    });
    await Promise.all(czekaj);
    return { odp, wolane };
  } finally {
    globalThis.fetch = prawdziwy;
  }
}

test('przekierowanie na link Leadenhall bez żadnej zmiany, bez bufora i bez indeksu', async () => {
  expect(CEL).toBe('https://utratadochodu.leadenhall.com/?employeeCode=CVRZSKkHi7');
  for (const sciezka of ['/kup-online', '/kup-online/', '/kup-online?z=kalkulator', '/kup-online/?z=blog&utm_source=x']) {
    const { odp } = await wejscie(sciezka);
    expect(odp.status, sciezka).toBe(302);
    // Ani `?z=`, ani UTM-y nie mogą dokleić się do adresu Leadenhall.
    expect(odp.headers.get('location'), sciezka).toBe(CEL);
    expect(odp.headers.get('cache-control')).toBe('no-store');
    expect(odp.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  }
});

test('kliknięcie człowieka idzie do ud_klikniecia: tylko cel i źródło, klucz w nagłówkach', async () => {
  const { wolane } = await wejscie('/kup-online?z=Kalkulator');
  expect(wolane).toHaveLength(1);
  expect(wolane[0].adres).toBe(TABELA);
  expect(wolane[0].cialo).toEqual({ cel: 'leadenhall', zrodlo: 'kalkulator' });
  expect(wolane[0].naglowki.get('apikey')).toBe(KLUCZ);
  expect(wolane[0].naglowki.get('authorization')).toBe(`Bearer ${KLUCZ}`);
  expect(wolane[0].adres).not.toContain(KLUCZ);
});

test('stuknięcie w aplikacji Facebooka (bez X-Purpose) liczy się jak kliknięcie', async () => {
  const { wolane } = await wejscie('/kup-online?z=facebook', {
    naglowki: { 'user-agent': FACEBOOK_ANDROID, 'x-fb-http-engine': 'Liger' },
  });
  expect(wolane.map((w) => w.cialo)).toEqual([{ cel: 'leadenhall', zrodlo: 'facebook' }]);
});

test('źródło: biała lista znaków, reszta to „inne", brak to „bezposrednio"', () => {
  expect(zrodlo(null)).toBe('bezposrednio');
  expect(zrodlo('')).toBe('bezposrednio');
  expect(zrodlo('mail-2026-11')).toBe('mail-2026-11');
  expect(zrodlo(' BLOG ')).toBe('blog');
  for (const zle of ['<script>', 'a b', 'ź', 'x'.repeat(33), "kalkulator';drop table"]) {
    expect(zrodlo(zle), zle).toBe('inne');
  }
  // Ta sama reguła stoi w CHECK tabeli.
  const migracja = readFileSync('../../supabase/migrations/20261111101126_klikniecia.sql', 'utf8');
  expect(migracja).toContain("check (zrodlo ~ '^[a-z0-9-]{1,32}$')");
});

test('nie liczą się: HEAD, prefetch, roboty, podglądy linków, pusty User-Agent, podgląd pages.dev', async () => {
  const przypadki = {
    HEAD: { metoda: 'HEAD' },
    'prefetch Chrome': { naglowki: { 'user-agent': PRZEGLADARKA, 'sec-purpose': 'prefetch;prerender' } },
    'prefetch Safari': { naglowki: { 'user-agent': PRZEGLADARKA, purpose: 'prefetch' } },
    'podgląd w aplikacji Facebooka (post na ekranie)': {
      naglowki: { 'user-agent': FACEBOOK_ANDROID, 'x-purpose': 'preview', 'x-fb-http-engine': 'Liger' },
    },
    Googlebot: { naglowki: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } },
    bingbot: { naglowki: { 'user-agent': 'Mozilla/5.0 (compatible; bingbot/2.0)' } },
    WhatsApp: { naglowki: { 'user-agent': 'WhatsApp/2.23.20.0' } },
    Messenger: { naglowki: { 'user-agent': 'facebookexternalhit/1.1' } },
    Slack: { naglowki: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } },
    curl: { naglowki: { 'user-agent': 'curl/8.5.0' } },
    'bez User-Agenta': { naglowki: {} },
    'pages.dev': { host: 'abc123.utratadochodu.pages.dev' },
  };
  for (const [nazwa, opcje] of Object.entries(przypadki)) {
    const { odp, wolane } = await wejscie('/kup-online?z=blog', opcje);
    expect(odp.status, nazwa).toBe(302);
    expect(odp.headers.get('location'), nazwa).toBe(CEL);
    expect(wolane, `${nazwa} — liczy się jak kliknięcie`).toEqual([]);
  }
});

test('awaria bazy nie zatrzymuje klienta, a zostawia ślad w ud_errors', async () => {
  const awarie = {
    '500': () => new Response('awaria', { status: 500 }),
    'brak tabeli (404)': () => new Response('{}', { status: 404 }),
    'zerwane połączenie': () => { throw new TypeError('fetch failed'); },
  };
  for (const [nazwa, awaria] of Object.entries(awarie)) {
    const siec = (adres) => (adres === TABELA ? awaria() : new Response(null, { status: 201 }));
    const { odp, wolane } = await wejscie('/kup-online', { siec });
    expect(odp.status, nazwa).toBe(302);
    expect(odp.headers.get('location'), nazwa).toBe(CEL);
    expect(wolane.map((w) => w.adres), nazwa).toEqual([TABELA, BLEDY]);
    expect(wolane[1].cialo.source).toBe('kup-online');
    expect(wolane[1].cialo.message).toMatch(/^Kliknięcie nie zapisane: /);
  }
  // Także gdy i dziennik błędów nie odpowiada — nic nie wybucha.
  const { odp } = await wejscie('/kup-online', { siec: () => { throw new TypeError('fetch failed'); } });
  expect(odp.status).toBe(302);
});

test('przekierowanie nie czeka na zapis w bazie', async () => {
  // Baza, która nie odpowiada nigdy: odpowiedź musi wyjść mimo to.
  const prawdziwy = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  try {
    const odp = await Promise.race([
      onRequest({
        request: new Request('https://utratadochodu.pl/kup-online', { headers: { 'user-agent': PRZEGLADARKA } }),
        params: {}, env: { SUPABASE_SERVICE_ROLE_KEY: KLUCZ }, waitUntil: () => {},
      }),
      new Promise((_, nie) => setTimeout(() => nie(new Error('przekierowanie czeka na bazę')), 1000)),
    ]);
    expect(odp.status).toBe(302);
  } finally {
    globalThis.fetch = prawdziwy;
  }
});

test('bez klucza serwisowego: przekierowanie działa, nic nie idzie do bazy', async () => {
  const { odp, wolane } = await wejscie('/kup-online', { env: {} });
  expect(odp.status).toBe(302);
  expect(wolane).toEqual([]);
});

test('inne metody i dalsze człony adresu', async () => {
  for (const metoda of ['POST', 'PUT', 'DELETE']) {
    const { odp, wolane } = await wejscie('/kup-online', { metoda });
    expect(odp.status, metoda).toBe(405);
    expect(odp.headers.get('allow')).toBe('GET, HEAD');
    expect(wolane).toEqual([]);
  }
  const { odp, wolane } = await wejscie('/kup-online/cokolwiek');
  expect(odp.status).toBe(404);
  expect(wolane).toEqual([]);
});

test('middleware przepuszcza przekierowanie bez zmian', async () => {
  const { odp } = await wejscie('/kup-online');
  const wynik = await middleware({
    request: new Request('https://utratadochodu.pl/kup-online', { headers: { Accept: 'text/html' } }),
    next: async () => odp,
  });
  expect(wynik.status).toBe(302);
  expect(wynik.headers.get('location')).toBe(CEL);
  expect(wynik.headers.get('link')).toBeNull();
});
