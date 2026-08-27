import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Wykrywanie martwych linków wewnętrznych w zbudowanym serwisie.
 *
 * Ten test istnieje, bo martwy link wewnętrzny jest jedną z niewielu wad,
 * których nie widać ani w buildzie, ani przy klikaniu po stronie głównej —
 * ujawnia się dopiero u użytkownika albo w raporcie z indeksowania.
 */

const DIST = 'dist';

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
