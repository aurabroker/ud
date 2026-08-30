import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { kategorie, ZAWODY } from '@ud/zawody';

/**
 * Wykrywanie martwych linków wewnętrznych w zbudowanym serwisie.
 *
 * Ten test istnieje, bo martwy link wewnętrzny jest jedną z niewielu wad,
 * których nie widać ani w buildzie, ani przy klikaniu po stronie głównej —
 * ujawnia się dopiero u użytkownika albo w raporcie z indeksowania.
 */

const DIST = 'dist';
/** Katalog aplikacji — Playwright startuje z apps/portal. */
const KORZEN = '.';

/** Wszystkie pliki HTML w buildzie. */
function stronyHtml(katalog = DIST, zebrane = []) {
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const p = join(katalog, wpis.name);
    if (wpis.isDirectory()) stronyHtml(p, zebrane);
    else if (wpis.name.endsWith('.html')) zebrane.push(p);
  }
  return zebrane;
}

/**
 * Trasy obsługiwane przez funkcje Cloudflare Pages. Nie ma ich w `dist`,
 * bo powstają dopiero na krawędzi — a mimo to są żywymi adresami.
 * Segment „[id]" zamieniamy na dopasowanie dowolnego członu ścieżki,
 * „[[sciezka]]" na dopasowanie reszty adresu.
 */
function trasyFunkcji(katalog = 'functions', prefiks = '', zebrane = []) {
  if (!existsSync(katalog)) return zebrane;
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    if (wpis.isDirectory()) {
      trasyFunkcji(join(katalog, wpis.name), `${prefiks}/${wpis.name}`, zebrane);
      continue;
    }
    if (!/\.(js|ts)$/.test(wpis.name)) continue;
    const nazwa = wpis.name.replace(/\.(js|ts)$/, '');
    const sciezka = nazwa === 'index' ? prefiks || '/' : `${prefiks}/${nazwa}`;
    const wzorzec = sciezka
      .replace(/[.*+?^${}()|\\]/g, '\\$&')
      .replace(/\[\[[^\]]+\]\]/g, '.+')
      .replace(/\[[^\]]+\]/g, '[^/]+');
    zebrane.push(new RegExp(`^${wzorzec}/?$`));
  }
  return zebrane;
}

const TRASY_FUNKCJI = trasyFunkcji();

/** Czy ścieżka jest obsłużona przez build, funkcję brzegową albo przekierowanie. */
function istnieje(sciezka, przekierowania) {
  if (przekierowania.has(sciezka)) return true;
  if (TRASY_FUNKCJI.some((t) => t.test(sciezka))) return true;
  const bez = sciezka.replace(/^\//, '').replace(/\/$/, '');
  for (const kandydat of [join(DIST, bez, 'index.html'), join(DIST, bez), join(DIST, bez + '.html')]) {
    if (existsSync(kandydat) && statSync(kandydat).isFile()) return true;
  }
  return false;
}

test('żaden link wewnętrzny nie prowadzi w pustkę', () => {
  const przekierowania = new Set();
  if (existsSync(join(DIST, '_redirects'))) {
    for (const linia of readFileSync(join(DIST, '_redirects'), 'utf8').split('\n')) {
      const [z] = linia.trim().split(/\s+/);
      if (z?.startsWith('/')) przekierowania.add(z);
    }
  }

  const martwe = new Map();
  for (const plik of stronyHtml()) {
    const html = readFileSync(plik, 'utf8');
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      if (href.startsWith('/_astro/') || href.startsWith('/fonts/')) continue;
      if (istnieje(href, przekierowania)) continue;
      if (!martwe.has(href)) martwe.set(href, new Set());
      martwe.get(href).add(relative(DIST, plik).replace(/\/index\.html$/, '/'));
    }
  }

  const opis = [...martwe.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([href, skad]) => `  ${href}  ← ${skad.size} ${skad.size === 1 ? 'strona' : 'stron'} (np. ${[...skad][0]})`)
    .join('\n');

  expect(martwe.size, `martwe linki wewnętrzne:\n${opis}`).toBe(0);
});

/**
 * Kategorie, dla których nie ma jeszcze pliku zdjęcia. Lista jest tymczasowa
 * i ma sama po sobie posprzątać: gdy plik się pojawi, test poniżej wywali się
 * na nieaktualnym wpisie i zmusi do jego usunięcia.
 */
const BEZ_ZDJECIA = new Set(['budownictwo']);

test('każde zdjęcie w src/obrazy/kategorie nosi nazwę istniejącej kategorii', () => {
  /**
   * Wcześniej zdjęcie wisiało przy zawodzie, a kategoria brała je od pierwszego
   * zawodu alfabetycznie — stąd biurowiec na Budownictwie i mężczyzna
   * z niemowlęciem („bezpieczenstwo.jpg") u dwóch prawników. Nazwa pliku równa
   * slugowi kategorii sprawia, że takie rozjechanie jest niewyrażalne.
   */
  const slugi = new Set(kategorie().map((k) => k.slug));
  const pliki = readdirSync(join(KORZEN, 'src/obrazy/kategorie'))
    .filter((f) => f.endsWith('.jpg'))
    .map((f) => f.replace(/\.jpg$/, ''));

  const osierocone = pliki.filter((f) => !slugi.has(f));
  expect(osierocone, `pliki bez kategorii: ${osierocone.join(', ')}`).toEqual([]);

  const nieaktualne = [...BEZ_ZDJECIA].filter((s) => pliki.includes(s));
  expect(nieaktualne, `zdjęcie już jest — usuń z BEZ_ZDJECIA: ${nieaktualne.join(', ')}`).toEqual([]);

  const brakujace = [...slugi].filter((s) => !pliki.includes(s) && !BEZ_ZDJECIA.has(s));
  expect(brakujace, `kategorie bez zdjęcia: ${brakujace.join(', ')}`).toEqual([]);
});

test('zdjęcia zawodów: nazwa pliku to slug zawodu i strona go pokazuje', () => {
  /**
   * Warstwa nad zdjęciami kategorii: zawód, który ma własne zdjęcie, bierze
   * własne, reszta dziedziczy po branży. Zestaw rośnie zawód po zawodzie,
   * więc jedyne, czego trzeba pilnować, to że nazwa pliku wskazuje na
   * istniejący zawód i że plik faktycznie trafia na jego podstronę.
   */
  const katalog = join(KORZEN, 'src/obrazy/zawody');
  const pliki = existsSync(katalog)
    ? readdirSync(katalog).filter((f) => f.endsWith('.jpg')).map((f) => f.replace(/\.jpg$/, ''))
    : [];

  const slugi = new Set(ZAWODY.map((z) => z.slug));
  const osierocone = pliki.filter((f) => !slugi.has(f));
  expect(osierocone, `pliki bez zawodu: ${osierocone.join(', ')}`).toEqual([]);

  // Sprawdzamy po opisie alternatywnym, a nie po nazwie assetu: Vite scala
  // pliki o identycznej zawartości pod jedną nazwą, więc nazwa assetu nie
  // rozstrzyga, którą gałęzią poszedł szablon. Opis rozstrzyga.
  for (const slug of pliki) {
    const zawod = ZAWODY.find((z) => z.slug === slug);
    const html = readFileSync(join(DIST, `${slug}/index.html`), 'utf8');
    const alt = html.match(/<img[^>]*\balt="([^"]*)"/)?.[1];
    expect(alt, `/${slug}/ dziedziczy zdjęcie kategorii mimo własnego pliku`)
      .toBe(`Zdjęcie ilustracyjne — ${zawod.odmiana.mianownik.toLowerCase()}`);
  }
});

test('zdjęcia kategorii faktycznie się renderują', () => {
  /**
   * Czternaście zdjęć branż leżało w public/ i było używanych wyłącznie jako
   * obrazek Open Graph — na żadnej stronie serwisu nie renderował się ani
   * jeden <img>. Ten test pilnuje, żeby nie wróciły do roli metadanych.
   */
  const zeZdjeciem = kategorie().filter((k) => !BEZ_ZDJECIA.has(k.slug));

  const glowna = readFileSync(join(DIST, 'index.html'), 'utf8');
  const kafelki = (glowna.match(/<img\b/g) ?? []).length;
  expect(kafelki, `strona główna: ${kafelki} kafelków ze zdjęciem zamiast ${zeZdjeciem.length}`)
    .toBe(zeZdjeciem.length);

  for (const k of zeZdjeciem) {
    const html = readFileSync(join(DIST, `zawody/${k.slug}/index.html`), 'utf8');
    expect((html.match(/<img\b/g) ?? []).length, `/zawody/${k.slug}/ bez zdjęcia`).toBe(1);
  }

  // Podstrona zawodu dziedziczy zdjęcie po swojej kategorii.
  for (const plik of ['stomatolog', 'kierowca-zawodowy', 'copywriter']) {
    const html = readFileSync(join(DIST, `${plik}/index.html`), 'utf8');
    expect((html.match(/<img\b/g) ?? []).length, `/${plik}/ bez zdjęcia`).toBe(1);
  }
});

test('zdjęcia przechodzą przez optymalizację i mają wymiary', () => {
  const html = readFileSync(join(DIST, 'stomatolog/index.html'), 'utf8');
  const img = html.match(/<img[^>]*>/)?.[0] ?? '';

  // Nieprzetworzone zdjęcie zostawiłoby ścieżkę /img/*.jpg zamiast /_astro/*.webp.
  expect(img, 'zdjęcie nie przeszło przez sharpa').toMatch(/\/_astro\/[^"']+\.webp/);
  // Brak wymiarów to skok układu w trakcie wczytywania.
  expect(img, 'brak width').toMatch(/width="\d+"/);
  expect(img, 'brak height').toMatch(/height="\d+"/);
  expect(img, 'brak opisu alternatywnego').toMatch(/alt="[^"]+"/);
});
