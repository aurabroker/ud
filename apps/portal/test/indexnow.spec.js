import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  KLUCZ, PUNKT, GALAZ_PRODUKCYJNA, PLIK, adresyZMapy, doZgloszenia, przebieg, indexNow,
} from '../integracje/indexnow.mjs';

/**
 * IndexNow (integracje/indexnow.mjs): build zapisuje manifest skrótów treści,
 * a build produkcyjny zgłasza różnicę względem manifestu z żywej strony.
 *
 * Czego pilnuje: plik klucza musi leżeć pod `/<klucz>.txt` z samym kluczem
 * (inaczej wyszukiwarka odrzuci każde zgłoszenie — 403), build podglądu nie
 * może zgłaszać niczego, a awaria sieci nie może ani przerwać builda, ani
 * skończyć się zgłoszeniem całego serwisu. Sieć jest podstawiona.
 */

const SERWIS = 'https://utratadochodu.pl';
const PRODUKCJA = { CF_PAGES: '1', CF_PAGES_BRANCH: GALAZ_PRODUKCYJNA, CF_PAGES_COMMIT_SHA: 'abc123' };

test('plik klucza: /<klucz>.txt z samym kluczem, jeden, poza funkcjami', () => {
  // Protokół: 8–128 znaków [a-zA-Z0-9-]; nasz to 32 znaki szesnastkowe.
  expect(KLUCZ).toMatch(/^[a-f0-9]{32}$/);
  expect(readFileSync(`public/${KLUCZ}.txt`, 'utf8'), 'treść pliku to dokładnie klucz, bez nowej linii').toBe(KLUCZ);
  expect(readFileSync(`dist/${KLUCZ}.txt`, 'utf8')).toBe(KLUCZ);
  // Stary klucz po wymianie musi zniknąć — dwa klucze to dwa źródła prawdy.
  const klucze = readdirSync('public').filter((p) => /^[a-zA-Z0-9-]{8,128}\.txt$/.test(p) && p !== 'robots.txt');
  expect(klucze).toEqual([`${KLUCZ}.txt`]);

  const trasy = JSON.parse(readFileSync('public/_routes.json', 'utf8'));
  expect(trasy.exclude).toContain(`/${KLUCZ}.txt`);
  expect(trasy.exclude).toContain(`/${PLIK}`);
});

test('manifest z builda: każdy adres z mapy strony, skrót z pliku .md', () => {
  const dane = JSON.parse(readFileSync(`dist/${PLIK}`, 'utf8'));
  const zMapy = adresyZMapy('dist').map((a) => a.slice(SERWIS.length));
  expect(zMapy.length).toBeGreaterThan(200);
  expect(Object.keys(dane.strony).sort()).toEqual(zMapy);
  for (const [sciezka, hash] of Object.entries(dane.strony)) {
    expect(hash, sciezka).toMatch(/^[a-f0-9]{64}$/);
    // Skrót z HTML-a zmieniałby się przy każdej zmianie CSS-u (nazwy plików
    // w /_astro/) — i każde wdrożenie zgłaszałoby cały serwis.
    expect(existsSync(join('dist', sciezka, 'index.md')), `${sciezka} bez index.md`).toBe(true);
  }
  for (const techniczna of ['/podziekowanie/', '/wycofaj-zgode/']) {
    expect(dane.strony[techniczna], techniczna).toBeUndefined();
  }
  // Test buduje się lokalnie, poza Pages — nic nie mogło pójść do IndexNow.
  expect(dane.zgloszenie.stan).toBe('pominiete');
});

test('różnica: nowe, zmienione i usunięte; reszta nie', () => {
  expect(doZgloszenia({ '/a/': '1', '/b/': '2', '/c/': '3' }, { '/a/': '1', '/b/': 'x', '/d/': '4' }))
    .toEqual(['/b/', '/c/', '/d/']);
  expect(doZgloszenia({ '/a/': '1' }, { '/a/': '1' })).toEqual([]);
  expect(doZgloszenia({}, { '/a/': '1', '/b/': '2' })).toEqual(['/a/', '/b/']);
});

/* ── Przebieg na atrapie katalogu wyjściowego i sieci ─────────────────────── */

function katalog(strony) {
  const dist = mkdtempSync(join(tmpdir(), 'indexnow-'));
  const locs = [];
  for (const [sciezka, tresc] of Object.entries(strony)) {
    const k = join(dist, ...sciezka.split('/').filter(Boolean));
    mkdirSync(k, { recursive: true });
    writeFileSync(join(k, 'index.html'), `<html>${tresc}</html>`);
    writeFileSync(join(k, 'index.md'), tresc);
    locs.push(`<url><loc>${SERWIS}${sciezka}</loc></url>`);
  }
  writeFileSync(join(dist, 'sitemap-0.xml'), `<urlset>${locs.join('')}</urlset>`);
  return dist;
}

/** Podstawiony fetch: `zywy` odpowiada na manifest, `indexnow` na zgłoszenie. */
function siec({ zywy, indexnow = () => new Response(null, { status: 200 }) }) {
  const wolane = [];
  const fetch = async (adres, init = {}) => {
    wolane.push({ adres: String(adres), metoda: init.method ?? 'GET', cialo: init.body ? JSON.parse(init.body) : null });
    return String(adres) === PUNKT ? indexnow() : zywy();
  };
  return { fetch, wolane };
}

const json = (dane, status = 200) => new Response(JSON.stringify(dane), { status, headers: { 'content-type': 'application/json' } });

test('podgląd i build lokalny nie dotykają sieci', async () => {
  const dist = katalog({ '/': 'start', '/blog/': 'blog' });
  try {
    for (const env of [{}, { CF_PAGES: '1', CF_PAGES_BRANCH: 'kalibrator/propozycja' }, { CF_PAGES_BRANCH: GALAZ_PRODUKCYJNA }]) {
      const { fetch, wolane } = siec({ zywy: () => json({ strony: {} }) });
      const wynik = await przebieg({ dist, serwis: SERWIS, env, fetch });
      expect(wolane, JSON.stringify(env)).toEqual([]);
      expect(wynik.zgloszenie.stan).toBe('pominiete');
      // Manifest powstaje i tak — następny build produkcyjny porówna się z nim.
      expect(Object.keys(JSON.parse(readFileSync(join(dist, PLIK), 'utf8')).strony)).toEqual(['/', '/blog/']);
    }
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('pierwsze wdrożenie (404 na manifeście): zgłoszenie całego serwisu, w formacie protokołu', async () => {
  const dist = katalog({ '/': 'start', '/blog/': 'blog', '/blog/wpis/': 'wpis' });
  try {
    const { fetch, wolane } = siec({ zywy: () => new Response('nie ma', { status: 404 }), indexnow: () => new Response(null, { status: 202 }) });
    const wynik = await przebieg({ dist, serwis: SERWIS, env: PRODUKCJA, fetch });

    expect(wolane.map((w) => `${w.metoda} ${w.adres}`)).toEqual([`GET ${SERWIS}/${PLIK}`, `POST ${PUNKT}`]);
    expect(wolane[1].cialo).toEqual({
      host: 'utratadochodu.pl',
      key: KLUCZ,
      keyLocation: `${SERWIS}/${KLUCZ}.txt`,
      urlList: [`${SERWIS}/`, `${SERWIS}/blog/`, `${SERWIS}/blog/wpis/`],
    });
    expect(wynik.zgloszenie).toMatchObject({ stan: 'zgloszono', status: 202, adresow: 3, pierwsze: true });
    const zapisany = JSON.parse(readFileSync(join(dist, PLIK), 'utf8'));
    expect(zapisany.commit).toBe('abc123');
    expect(zapisany.zgloszenie.stan).toBe('zgloszono');
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('kolejne wdrożenie: tylko nowe, zmienione i usunięte adresy; bez zmian — bez zgłoszenia', async () => {
  const dist = katalog({ '/': 'start', '/blog/': 'blog NOWY wpis', '/blog/nowy/': 'nowy' });
  try {
    const { strony } = await przebieg({ dist, serwis: SERWIS, env: {} });
    const zywe = { ...strony, '/blog/': 'stary-skrot', '/blog/usuniety/': 'cokolwiek' };
    delete zywe['/blog/nowy/'];

    const { fetch, wolane } = siec({ zywy: () => json({ wersja: 1, strony: zywe }) });
    const wynik = await przebieg({ dist, serwis: SERWIS, env: PRODUKCJA, fetch });
    expect(wolane[1].cialo.urlList).toEqual([`${SERWIS}/blog/`, `${SERWIS}/blog/nowy/`, `${SERWIS}/blog/usuniety/`]);
    expect(wynik.zgloszenie).toMatchObject({ stan: 'zgloszono', adresow: 3, sciezki: ['/blog/', '/blog/nowy/', '/blog/usuniety/'] });

    const takieSame = siec({ zywy: () => json({ strony }) });
    const bez = await przebieg({ dist, serwis: SERWIS, env: PRODUKCJA, fetch: takieSame.fetch });
    expect(takieSame.wolane.map((w) => w.metoda)).toEqual(['GET']);
    expect(bez.zgloszenie.stan).toBe('bez-zmian');
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('niepewny manifest z żywej strony: nic nie zgłaszamy (zamiast całego serwisu)', async () => {
  const dist = katalog({ '/': 'start' });
  try {
    const awarie = {
      '500': () => new Response('awaria', { status: 500 }),
      'zepsuty JSON': () => new Response('<html>', { status: 200 }),
      'bez pola strony': () => json({ wersja: 1 }),
      'strony jako lista': () => json({ strony: ['/'] }),
      'zerwane połączenie': () => { throw new TypeError('fetch failed'); },
      'brak odpowiedzi': () => { throw new DOMException('timeout', 'TimeoutError'); },
    };
    for (const [nazwa, zywy] of Object.entries(awarie)) {
      const { fetch, wolane } = siec({ zywy });
      const wynik = await przebieg({ dist, serwis: SERWIS, env: PRODUKCJA, fetch });
      expect(wolane.map((w) => w.metoda), nazwa).toEqual(['GET']);
      expect(wynik.zgloszenie.stan, nazwa).toBe('pominiete');
      expect(wynik.zgloszenie.powod, nazwa).toMatch(/manifest z żywej strony/);
    }
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('odmowa albo awaria IndexNow: zapisany ślad, build idzie dalej', async () => {
  const dist = katalog({ '/': 'start' });
  try {
    const przypadki = [
      [() => new Response('klucz', { status: 403 }), { stan: 'odmowa', status: 403 }],
      [() => new Response('za dużo', { status: 429 }), { stan: 'odmowa', status: 429 }],
      [() => { throw new TypeError('fetch failed'); }, { stan: 'odmowa', powod: 'fetch failed' }],
    ];
    for (const [indexnow, oczekiwane] of przypadki) {
      const { fetch } = siec({ zywy: () => new Response('', { status: 404 }), indexnow });
      const wynik = await przebieg({ dist, serwis: SERWIS, env: PRODUKCJA, fetch });
      expect(wynik.zgloszenie).toMatchObject(oczekiwane);
      expect(JSON.parse(readFileSync(join(dist, PLIK), 'utf8')).zgloszenie.stan).toBe('odmowa');
    }
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('pusta mapa strony to awaria builda, nie „wszystko usunięte"', async () => {
  const dist = katalog({});
  try {
    const { fetch, wolane } = siec({ zywy: () => json({ strony: { '/': 'x', '/blog/': 'y' } }) });
    const wynik = await przebieg({ dist, serwis: SERWIS, env: PRODUKCJA, fetch });
    expect(wolane).toEqual([]);
    expect(wynik.zgloszenie).toMatchObject({ stan: 'pominiete', powod: 'brak adresów w mapie strony' });
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('hook nie przerywa builda nawet przy zepsutym katalogu', async () => {
  const ostrzezenia = [];
  const logger = { info: () => {}, warn: (t) => ostrzezenia.push(t) };
  await expect(indexNow({ serwis: SERWIS }).hooks['astro:build:done']({
    dir: new URL('file:///nie/ma/takiego/katalogu/'), logger,
  })).resolves.toBeUndefined();
  expect(ostrzezenia.join('\n')).toMatch(/IndexNow pominięty/);
});
