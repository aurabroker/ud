import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { onRequest, ZRODLO, NAZWA_PLIKU, BUFOR } from '../functions/media/[plik].js';
import { onRequest as middleware } from '../functions/_middleware.js';

/**
 * Zdjęcia bazy wiedzy spod /media/<plik> na naszej domenie.
 *
 * Czego pilnuje: Storage Supabase dokleja do każdego pliku
 * `x-robots-tag: none`, więc zdjęcia podawane prosto z kubełka nie mogły trafić
 * do indeksu grafiki. Funkcja `functions/media/[plik].js` podaje je z naszej
 * domeny bez tego nagłówka, a build przepisuje adresy w HTML-u.
 *
 * Funkcja nie może przy tym stać się otwartym proxy do kubełka — z oryginałami
 * z aparatu po 16 MB — stąd testy białej listy nazw.
 *
 * Testy nie ruszają sieci: `fetch` jest podstawiony i odpowiada tak, jak
 * odpowiada Storage (sprawdzone curlem 21.10.2026: 200 z `x-robots-tag: none`
 * i ciasteczkiem `__cf_bm`, a dla brakującego pliku 400 z „404" w treści).
 */

const DIST = 'dist';
const PLIK = 'zawal-udar-utrata-dochodu-cover-1600.webp';

/** Odpowiedź Storage dla istniejącego pliku — z nagłówkami, które trzeba odciąć. */
const zKubelka = () => new Response('RIFF....WEBPVP8 ', {
  status: 200,
  headers: {
    'content-type': 'image/webp',
    'content-length': '16',
    'cache-control': 'private, no-cache',
    'x-robots-tag': 'none',
    'set-cookie': '__cf_bm=abc; HttpOnly; Secure; Path=/; Domain=supabase.co',
    'sb-project-ref': 'kukvgsjrmrqtzhkszzum',
    'access-control-allow-origin': '*',
    etag: '"74a5bba093a9aaf23ca96cbacdacf1a9"',
    'last-modified': 'Fri, 09 Oct 2026 14:23:22 GMT',
  },
});

/** Brak obiektu: Storage odpowiada 400, a „404" jest dopiero w treści. */
const brakWKubelku = () => new Response(
  '{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}',
  { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } },
);

/**
 * Woła funkcję jak Pages: `params.plik` to ostatni człon ścieżki.
 * `siec` to podstawiony fetch; zwracamy też listę adresów, o które pytał.
 */
async function zadanie(sciezka, { metoda = 'GET', siec = zKubelka, host = 'utratadochodu.pl', bufor, naglowki = {} } = {}) {
  const wolane = [];
  const prawdziwy = globalThis.fetch;
  const prawdziweCaches = globalThis.caches;
  globalThis.fetch = async (adres) => {
    wolane.push(String(adres));
    return siec(String(adres));
  };
  if (bufor) globalThis.caches = { default: bufor };
  else delete globalThis.caches;
  const czekaj = [];
  try {
    const url = new URL(`https://${host}${sciezka}`);
    const odp = await onRequest({
      request: new Request(url, { method: metoda, headers: naglowki }),
      params: { plik: decodeURIComponent(url.pathname.slice('/media/'.length)) },
      env: {},
      waitUntil: (p) => czekaj.push(p),
    });
    await Promise.all(czekaj);
    return { odp, wolane };
  } finally {
    globalThis.fetch = prawdziwy;
    if (prawdziweCaches === undefined) delete globalThis.caches;
    else globalThis.caches = prawdziweCaches;
  }
}

/** Atrapa `caches.default` — Map po adresie żądania, jak Cache API Workers. */
function atrapaBufora() {
  const wpisy = new Map();
  return {
    wpisy,
    async match(zadanie) {
      const odp = wpisy.get(zadanie.url);
      return odp ? odp.clone() : undefined;
    },
    async put(zadanie, odp) {
      expect(zadanie.method, 'klucz bufora musi być GET-em').toBe('GET');
      wpisy.set(zadanie.url, new Response(await odp.arrayBuffer(), { status: odp.status, headers: odp.headers }));
    },
  };
}

test('If-None-Match z ETagiem pliku: 304 bez treści, z ETagiem i buforem', async () => {
  // Bez tego każda rewalidacja po dobie (także Googlebota-Image) ściągała cały plik.
  const etag = '"74a5bba093a9aaf23ca96cbacdacf1a9"';
  for (const inm of [etag, `W/${etag}`, `"inny", ${etag}`]) {
    const { odp } = await zadanie(`/media/${PLIK}`, { naglowki: { 'If-None-Match': inm } });
    expect(odp.status, inm).toBe(304);
    expect(await odp.text(), inm).toBe('');
    expect(odp.headers.get('etag')).toBe(etag);
    expect(odp.headers.get('cache-control')).toBe(BUFOR);
    expect(odp.headers.get('x-robots-tag')).toBeNull();
  }
  // Inny ETag — pełna odpowiedź.
  const { odp } = await zadanie(`/media/${PLIK}`, { naglowki: { 'If-None-Match': '"inny"' } });
  expect(odp.status).toBe(200);
});

test('bufor dostaje nagłówki warunkowe żądania (Cache API sam odpowie 304/206), zapis bez nich', async () => {
  const bufor = atrapaBufora();
  const widziane = [];
  const match = bufor.match.bind(bufor);
  bufor.match = async (z) => { widziane.push(z.headers.get('if-none-match')); return match(z); };
  const put = bufor.put.bind(bufor);
  const klucze = [];
  bufor.put = async (z, o) => { klucze.push(z.headers.get('if-none-match')); return put(z, o); };

  const { odp } = await zadanie(`/media/${PLIK}`, { bufor, naglowki: { 'If-None-Match': '"74a5bba093a9aaf23ca96cbacdacf1a9"' } });
  expect(odp.status).toBe(304);
  expect(widziane).toEqual(['"74a5bba093a9aaf23ca96cbacdacf1a9"']);
  // Pierwszy klient z ETagiem napełnia bufor pełną odpowiedzią, kluczem bez warunków.
  expect(klucze).toEqual([null]);
  expect(bufor.wpisy.size).toBe(1);
});

test('wariant z normalizacji wychodzi z naszej domeny jako WebP', async () => {
  const { odp, wolane } = await zadanie(`/media/${PLIK}`);

  expect(odp.status).toBe(200);
  expect(odp.headers.get('content-type')).toBe('image/webp');
  expect(await odp.text()).toContain('WEBP');
  expect(wolane, 'funkcja pyta o plik spod innego adresu niż publiczny katalog wariantów')
    .toEqual([`${ZRODLO}${PLIK}`]);
});

test('x-robots-tag i reszta nagłówków Storage zostają po tamtej stronie', async () => {
  const { odp } = await zadanie(`/media/${PLIK}`);

  // Sedno całej funkcji: z tym nagłówkiem zdjęcie nie trafi do indeksu grafiki.
  expect(odp.headers.get('x-robots-tag'), 'x-robots-tag z Supabase przeszedł na naszą domenę').toBeNull();
  expect(odp.headers.get('set-cookie'), 'ciasteczko supabase.co w odpowiedzi z naszej domeny').toBeNull();
  expect(odp.headers.get('sb-project-ref')).toBeNull();
  expect(odp.headers.get('access-control-allow-origin')).toBeNull();
  // To, co przydaje się przeglądarce, przechodzi.
  expect(odp.headers.get('content-length')).toBe('16');
  expect(odp.headers.get('etag')).toBe('"74a5bba093a9aaf23ca96cbacdacf1a9"');
  expect(odp.headers.get('last-modified')).toBe('Fri, 09 Oct 2026 14:23:22 GMT');
  expect(odp.headers.get('x-content-type-options')).toBe('nosniff');
});

test('bufor: doba w przeglądarce, tydzień na krawędzi, bez immutable', async () => {
  const { odp } = await zadanie(`/media/${PLIK}`);
  const naglowek = odp.headers.get('cache-control');

  expect(naglowek).toBe('public, max-age=86400, s-maxage=604800');
  expect(naglowek).toBe(BUFOR);
  // Normalizacja zapisuje poprawione zdjęcie pod tą samą nazwą — z immutable
  // stara okładka zostałaby w przeglądarkach na zawsze.
  expect(naglowek).not.toContain('immutable');
  expect(naglowek, 'private/no-cache z Supabase przeszedł dalej').not.toMatch(/private|no-cache/);
});

test('typ zawsze image/webp, nawet gdy Storage poda inny', async () => {
  const { odp } = await zadanie(`/media/${PLIK}`, {
    siec: () => new Response('x', { headers: { 'content-type': 'application/octet-stream' } }),
  });
  expect(odp.headers.get('content-type')).toBe('image/webp');
});

test('biała lista: tylko nazwy wariantów, bez pytania Supabase o resztę', async () => {
  const dozwolone = [
    'zawal-udar-utrata-dochodu-cover-800.webp',
    'zawal-udar-utrata-dochodu-cover-1600.webp',
    'zawal-udar-utrata-dochodu-content1-1600.webp',
    '290000000-dni-na-zwolnieniu-l4-content12-800.webp',
  ];
  for (const nazwa of dozwolone) {
    const { odp, wolane } = await zadanie(`/media/${nazwa}`);
    expect(odp.status, nazwa).toBe(200);
    expect(wolane).toEqual([`${ZRODLO}${nazwa}`]);
  }

  const odrzucone = [
    // oryginały z aparatu i wszystko spoza normalized/
    '1696340000-zdjecie.jpg',
    'okladka.webp',
    'zawal-udar-utrata-dochodu-cover-1200.webp',
    'zawal-udar-utrata-dochodu-content-800.webp',
    'zawal-udar-utrata-dochodu-cover-800.png',
    'zawal-udar-utrata-dochodu-cover-800.webp.png',
    'Zawal-udar-cover-800.webp',
    'zawal_udar-cover-800.webp',
    // wyjście z katalogu i adresy zakodowane
    '../zdjecie-cover-800.webp',
    '..%2Fzdjecie-cover-800.webp',
    'a/b-cover-800.webp',
    'zawal-cover-800.webp%00.jpg',
    '-cover-800.webp',
    '',
  ];
  for (const nazwa of odrzucone) {
    const { odp, wolane } = await zadanie(`/media/${encodeURIComponent(nazwa)}`);
    expect(odp.status, `„${nazwa}" przeszło przez białą listę`).toBe(404);
    expect(wolane, `„${nazwa}" — zapytanie do Supabase mimo odrzuconej nazwy`).toEqual([]);
  }
});

test('brak pliku w kubełku to 404, a awaria Storage — 502', async () => {
  // Storage zgłasza brak obiektu jako 400 z „404" w treści.
  expect((await zadanie(`/media/${PLIK}`, { siec: brakWKubelku })).odp.status).toBe(404);
  expect((await zadanie(`/media/${PLIK}`, { siec: () => new Response('', { status: 404 }) })).odp.status).toBe(404);

  const awaria = await zadanie(`/media/${PLIK}`, { siec: () => new Response('', { status: 500 }) });
  expect(awaria.odp.status).toBe(502);
  expect(awaria.odp.headers.get('cache-control'), 'błąd nie może zostać w buforze').toBe('no-store');

  const zerwane = await zadanie(`/media/${PLIK}`, { siec: () => { throw new TypeError('fetch failed'); } });
  expect(zerwane.odp.status).toBe(502);
});

test('tylko GET i HEAD', async () => {
  for (const metoda of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const { odp, wolane } = await zadanie(`/media/${PLIK}`, { metoda });
    expect(odp.status, metoda).toBe(405);
    expect(odp.headers.get('allow')).toBe('GET, HEAD');
    expect(wolane).toEqual([]);
  }

  const { odp } = await zadanie(`/media/${PLIK}`, { metoda: 'HEAD' });
  expect(odp.status).toBe(200);
  expect(odp.headers.get('content-type')).toBe('image/webp');
  expect(odp.headers.get('x-robots-tag')).toBeNull();
  expect(odp.body, 'HEAD z treścią').toBeNull();
});

test('caches.default: drugie żądanie nie woła Supabase, zapytanie nie omija bufora', async () => {
  const bufor = atrapaBufora();

  const pierwsze = await zadanie(`/media/${PLIK}`, { bufor });
  expect(pierwsze.wolane).toHaveLength(1);
  expect([...bufor.wpisy.keys()], 'klucz bufora z zapytaniem albo spoza /media/')
    .toEqual([`https://utratadochodu.pl/media/${PLIK}`]);

  const drugie = await zadanie(`/media/${PLIK}?v=2`, { bufor });
  expect(drugie.wolane, 'trafienie w bufor, a funkcja i tak pyta Supabase').toEqual([]);
  expect(drugie.odp.status).toBe(200);
  expect(drugie.odp.headers.get('content-type')).toBe('image/webp');
  expect(drugie.odp.headers.get('x-robots-tag')).toBeNull();

  const glowa = await zadanie(`/media/${PLIK}`, { bufor, metoda: 'HEAD' });
  expect(glowa.wolane).toEqual([]);
  expect(glowa.odp.body).toBeNull();

  // Błąd nie trafia do bufora.
  const bufor2 = atrapaBufora();
  await zadanie(`/media/${PLIK}`, { bufor: bufor2, siec: brakWKubelku });
  expect(bufor2.wpisy.size).toBe(0);
});

test('podgląd na pages.dev nie konkuruje z domeną o zdjęcia', async () => {
  const { odp } = await zadanie(`/media/${PLIK}`, { host: 'abc123.utratadochodu.pages.dev' });
  expect(odp.headers.get('x-robots-tag')).toBe('noindex, nofollow');
});

test('middleware przepuszcza zdjęcie bez zmian (bez Vary, Link i noindex)', async () => {
  const { odp } = await zadanie(`/media/${PLIK}`);
  const request = new Request(`https://utratadochodu.pl/media/${PLIK}`, {
    headers: { Accept: 'image/avif,image/webp,*/*' },
  });
  const wynik = await middleware({ request, next: async () => odp });

  expect(wynik.headers.get('content-type')).toBe('image/webp');
  expect(wynik.headers.get('link')).toBeNull();
  expect(wynik.headers.get('x-robots-tag')).toBeNull();
});

test('/media/* idzie przez funkcje, nie przez warstwę zasobów', () => {
  // `_routes.json` wyłącza statyki spod funkcji. Gdyby /media/ trafiło na
  // listę wyłączeń, Pages szukałoby pliku w dist i każde zdjęcie dawało 404.
  const trasy = JSON.parse(readFileSync('public/_routes.json', 'utf8'));
  const pasuje = (wzorzec, sciezka) =>
    new RegExp(`^${wzorzec.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(sciezka);
  const adres = `/media/${PLIK}`;

  expect(trasy.include.some((w) => pasuje(w, adres)), '/media/ poza include').toBe(true);
  expect(trasy.exclude.filter((w) => pasuje(w, adres)), '/media/ wyłączone spod funkcji').toEqual([]);
});

/* ── Build: adresy w HTML-u ───────────────────────────────────────────── */

function plikiHtml(katalog = DIST) {
  const wynik = [];
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const sciezka = join(katalog, wpis.name);
    if (wpis.isDirectory()) wynik.push(...plikiHtml(sciezka));
    else if (wpis.name.endsWith('.html')) wynik.push(sciezka);
  }
  return wynik;
}

/** Nazwy wariantów, które są w danych artykułów — czyli leżą w kubełku. */
function nazwyZDanych() {
  const nazwy = new Set();
  const dodaj = (tekst) => {
    for (const m of tekst.matchAll(/article-images\/normalized\/([^"'\s,)]+)/g)) nazwy.add(m[1]);
  };
  dodaj(readFileSync('src/dane/artykuly.json', 'utf8'));
  for (const plik of readdirSync('src/dane/artykuly')) {
    if (plik.endsWith('.html')) dodaj(readFileSync(join('src/dane/artykuly', plik), 'utf8'));
  }
  return nazwy;
}

test('zbudowany HTML nie wskazuje zdjęć w Storage Supabase', () => {
  const winne = [];
  for (const plik of plikiHtml()) {
    const html = readFileSync(plik, 'utf8');
    for (const m of html.matchAll(/https:\/\/[a-z0-9]+\.supabase\.co\/storage\/[^"'\s,)]+/g)) {
      winne.push(`${plik}: ${m[0]}`);
    }
  }
  expect(winne, `zdjęcia nadal z kubełka (x-robots-tag: none):\n${winne.slice(0, 10).join('\n')}`).toEqual([]);
});

test('każdy adres /media/ w HTML-u to wariant z danych, który funkcja poda', () => {
  const zDanych = nazwyZDanych();
  expect(zDanych.size, 'dane artykułów bez ani jednego zdjęcia — test niczego nie sprawdza').toBeGreaterThan(0);

  const uzyte = new Set();
  for (const plik of plikiHtml()) {
    const html = readFileSync(plik, 'utf8');
    // Tylko nasze adresy: względne albo z naszą domeną. Ścieżka /media/ na
    // cudzym hoście (źródło w artykule, np. architekci.pl/media/…pdf) to nie
    // jest wywołanie naszej funkcji — przed 28.10.2026 test brał ją za nasze.
    for (const m of html.matchAll(/(?:https:\/\/utratadochodu\.pl|(?<![\w.\-]))\/media\/([^"'\s,)?#]+)/g)) {
      expect(m[1], `${plik}: /media/${m[1]} — funkcja odpowie na to 404`).toMatch(NAZWA_PLIKU);
      expect(zDanych.has(m[1]), `${plik}: /media/${m[1]} — takiej nazwy nie ma w danych artykułów`).toBe(true);
      uzyte.add(m[1]);
    }
  }
  // Wszystkie zdjęcia z danych dalej są na stronach — przepisanie niczego nie zgubiło.
  const zgubione = [...zDanych].filter((n) => !uzyte.has(n));
  expect(zgubione, `zdjęcia z danych, których nie ma w HTML-u: ${zgubione.join(', ')}`).toEqual([]);
});

test('lista bloga: oba warianty w srcset idą przez /media/', () => {
  const lista = readFileSync(join(DIST, 'blog', 'index.html'), 'utf8');
  const { artykuly } = JSON.parse(readFileSync('src/dane/artykuly.json', 'utf8'));
  const nazwa = (adres) => adres.split('/').at(-1);
  const zeZdjeciem = artykuly.filter((a) => a.obraz && a.obrazDuzy);
  expect(zeZdjeciem.length).toBeGreaterThan(0);
  for (const a of zeZdjeciem) {
    expect(lista, `„${a.slug}" — srcset kafelka`)
      .toContain(`/media/${nazwa(a.obraz)} 800w, /media/${nazwa(a.obrazDuzy)} 1600w`);
  }
});

test('dane artykułów zostają identyczne z bazą — przepisuje tylko build', () => {
  // artykuly.json i pliki treści porównujemy z bazą (md5 treści po
  // normalizacji). Adres /media/ w nich oznaczałby rozjazd z aura_articles.
  const json = readFileSync('src/dane/artykuly.json', 'utf8');
  expect(json).not.toContain('/media/');
  for (const plik of readdirSync('src/dane/artykuly')) {
    if (!plik.endsWith('.html')) continue;
    expect(readFileSync(join('src/dane/artykuly', plik), 'utf8'), plik).not.toContain('"/media/');
  }
});
