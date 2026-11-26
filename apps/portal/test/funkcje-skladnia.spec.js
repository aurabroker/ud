import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Funkcje Pages kompiluje wrangler z obrazu budowania Cloudflare'a — 21.10.2026
 * był to wrangler 3 z esbuildem 0.17, który nie zna atrybutów importu.
 * `import dane from '….json' with { type: 'json' }` w functions/media/[plik].js
 * przeszło lokalnie (Astro, Node 22, nawet wrangler 4), a build Pages padł
 * na „Expected ";" but found "with"" i produkcja została na starej wersji.
 * Lokalnie tego nie widać, bo w repozytorium nie ma wranglera — stąd ten skan.
 */
test('functions/ bez atrybutów importu (with/assert) — wrangler 3 ich nie skompiluje', () => {
  const pliki = readdirSync('functions', { recursive: true }).map(String).filter((p) => /\.(m?js|ts)$/.test(p));
  expect(pliki.length).toBeGreaterThan(3);
  const zle = [];
  for (const p of pliki) {
    // Bez komentarzy: przykład złej składni w komentarzu nie jest kodem.
    const kod = readFileSync(join('functions', p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    if (/\bimport\b[^;]*?\b(?:with|assert)\s*\{\s*type\s*:/s.test(kod)) zle.push(p);
    if (/\bimport\s*\([^)]*\{\s*(?:with|assert)\s*:/s.test(kod)) zle.push(`${p} (import())`);
  }
  expect(zle).toEqual([]);
});

test('skan łapie obie formy atrybutu (test nie jest pozorny)', () => {
  const skan = (kod) => /\bimport\b[^;]*?\b(?:with|assert)\s*\{\s*type\s*:/s.test(kod)
    || /\bimport\s*\([^)]*\{\s*(?:with|assert)\s*:/s.test(kod);
  expect(skan("import d from '../a.json' with { type: 'json' };")).toBe(true);
  expect(skan("import d from '../a.json' assert { type: 'json' };")).toBe(true);
  expect(skan("const d = await import('../a.json', { with: { type: 'json' } });")).toBe(true);
  expect(skan("import { onRequest } from './x.js';")).toBe(false);
});
