import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { kategorie, wKategorii } from '@ud/zawody';

/**
 * Strony kategorii zawodów — poprawki po audycie z 21.10.2026.
 *
 * Audyt znalazł tam „43 zawodów", „z branży it / tech", H1 z samą nazwą
 * grupy, kafelki „świadczenie do 500 zł / dzień" (liczba bez pokrycia
 * w ofercie) i nazwę zawodu sklejoną z resztą odnośnika: czytnik ekranu
 * i robot czytały „Alergologświadczenie do 500 zł / dzień".
 */

const DIST = 'dist';
const html = (sciezka) => readFileSync(join(DIST, sciezka, 'index.html'), 'utf8');

/** Liczba + „zawodów" przy liczbie, która wymaga „zawody" (2–4, bez 12–14). */
const ZLA_FORMA = /\b(\d+)(?:\s|&nbsp;| )+zawodów\b/g;
const wymagaZawody = (n) => n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14);

test('H1 kategorii mówi, o czym jest strona, a nie samą nazwę grupy', () => {
  for (const k of kategorie()) {
    const h1 = html(`zawody/${k.slug}`).match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1].replace(/\s+/g, ' ').trim();
    expect(h1, k.slug).toBe(`Ubezpieczenie utraty dochodu — ${k.nazwa}`);
  }
});

test('opis kategorii trzyma pisownię nazwy grupy', () => {
  const opis = html('zawody/it-tech').match(/<meta name="description" content="([^"]*)"/)?.[1];
  expect(opis).toContain('IT / Tech: 24 zawody');
  expect(opis).not.toMatch(/it \/ tech|podnosi/);
});

test('liczba zawodów stoi w poprawnej formie na każdej stronie', () => {
  const naruszenia = [];
  const pliki = readdirSync(DIST, { recursive: true }).map(String)
    .filter((p) => p.endsWith('index.html') || p.endsWith('index.md') || p.endsWith('llms.txt'));
  for (const p of pliki) {
    for (const m of readFileSync(join(DIST, p), 'utf8').matchAll(ZLA_FORMA)) {
      if (wymagaZawody(Number(m[1]))) naruszenia.push(`${p}: ${m[0]}`);
    }
  }
  expect(naruszenia).toEqual([]);
});

test('kafelek zawodu: nazwa oddzielona od opisu, bez limitu dziennego', () => {
  const k = kategorie().find((x) => x.slug === 'medycyna');
  const md = readFileSync(join(DIST, 'zawody', k.slug, 'index.md'), 'utf8');
  for (const z of wKategorii(k.nazwa)) {
    const linia = md.split('\n').find((l) => l.includes(`](https://utratadochodu.pl/${z.slug}/)`));
    expect(linia, z.slug).toBeTruthy();
    const tekst = linia.match(/\[([^\]]*)\]/)[1];
    // Nazwa, potem odstęp (albo koniec) — nigdy litera od razu po nazwie.
    expect(tekst.startsWith(z.nazwa), `${z.slug}: ${tekst}`).toBe(true);
    expect(tekst.slice(z.nazwa.length), `${z.slug}: ${tekst}`).toMatch(/^(?:$|\s)/);
    expect(tekst, z.slug).not.toMatch(/dzień/);
  }
});

test('reguły przekierowań zawodów działają też bez ukośnika na końcu', () => {
  const zrodla = new Set(readFileSync(join(DIST, '_redirects'), 'utf8').split('\n')
    .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
    .map((l) => l.trim().split(/\s+/)[0]));
  const zUkosnikiem = [...zrodla].filter((z) => z.length > 1 && z.endsWith('/'));
  expect(zUkosnikiem.length).toBeGreaterThan(20);
  const bez = zUkosnikiem.filter((z) => !zrodla.has(z.slice(0, -1)));
  expect(bez).toEqual([]);
});
