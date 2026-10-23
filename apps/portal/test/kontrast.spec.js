import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Kontrast tokenów kolorów z global.css (WCAG 2.1: 4,5:1 dla zwykłego tekstu,
 * 3:1 dla krawędzi pól). Serwis jest jasny i tła to biel oraz cztery odcienie
 * cyjanu — tekst stoi na każdym z nich.
 *
 * --color-alarm do 22.10.2026 miał 4,40:1 na bieli: błędy w kreatorze wniosku
 * (13 px) i kwoty zasiłku ZUS w tabelach były poniżej progu. Do 23.10.2026
 * --color-akcent-ciemny miał 3,34:1 (linki, kwoty świadczenia, biały napis na
 * każdym przycisku „Policz składkę"), a --color-akcent-hover 4,65:1.
 * --color-tekst-trzeci świadomie nie jest tu sprawdzany — to kolor ozdobników
 * (2,65:1), nie tekstu do czytania (CLAUDE.md, „Serwis jest jasny").
 */

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const token = (nazwa) => {
  const m = css.match(new RegExp(`--color-${nazwa}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`brak tokenu --color-${nazwa} w global.css`);
  return m[1];
};

const luminancja = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kontrast = (a, b) => {
  const [jasny, ciemny] = [luminancja(a), luminancja(b)].sort((x, y) => y - x);
  return (jasny + 0.05) / (ciemny + 0.05);
};

test('sam rachunek: czerń na bieli 21:1, stary alarm 4,40:1', () => {
  expect(kontrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(kontrast('#D6453D', '#FFFFFF')).toBeCloseTo(4.40, 2);
});

const TLA = ['tlo', 'tlo-jasne', 'tlo-cyjan', 'tlo-mocne'];

const TEKSTY = ['tekst', 'tekst-drugi', 'akcent-ciemny', 'akcent-hover', 'akcent-tekst', 'alarm'];

for (const [tekst, prog] of TEKSTY.map((t) => [t, 4.5])) {
  test(`--color-${tekst} ma co najmniej ${prog}:1 na każdym tle`, () => {
    for (const tlo of TLA) {
      const k = kontrast(token(tekst), token(tlo));
      expect(k, `--color-${tekst} na --color-${tlo}: ${k.toFixed(2)}:1`).toBeGreaterThanOrEqual(prog);
    }
  });
}

test('--color-linia-pole (krawędź pola) ma co najmniej 3:1 na bieli', () => {
  expect(kontrast(token('linia-pole'), token('tlo'))).toBeGreaterThanOrEqual(3);
});

test('biały napis na przyciskach (--color-akcent-ciemny i hover) ma co najmniej 4,5:1', () => {
  for (const tlo of ['akcent-ciemny', 'akcent-hover']) {
    const k = kontrast('#FFFFFF', token(tlo));
    expect(k, `biały na --color-${tlo}: ${k.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});

/**
 * Baner zgód i okienko awarii mają własny CSS (bez Tailwinda, celowo — patrz
 * CLAUDE.md), więc tokeny z global.css ich nie obejmują. Do 23.10.2026 przycisk
 * „Odrzucam wszystkie" miał niebieski napis 3,34:1 na bieli, na każdej stronie.
 */
const skrypt = (plik) => readFileSync(new URL(`../public/${plik}`, import.meta.url), 'utf8');
const kolor = (zrodlo, wzor, opis) => {
  const m = zrodlo.match(wzor);
  if (!m) throw new Error(`nie znalazłem reguły: ${opis}`);
  return m[1];
};

test('baner zgód: przyciski i link czytelne', () => {
  const z = skrypt('zgody.js');
  const pary = [
    ['„Akceptuję" — biały na tle', kolor(z, /\.ud-z-tak\{background:(#[0-9A-Fa-f]{6});color:#fff/, 'ud-z-tak'), '#FFFFFF'],
    ['„Akceptuję" po najechaniu', kolor(z, /\.ud-z-tak:hover\{background:(#[0-9A-Fa-f]{6})/, 'ud-z-tak:hover'), '#FFFFFF'],
    ['„Odrzucam" — napis na bieli', kolor(z, /\.ud-z-nie\{background:#fff;color:(#[0-9A-Fa-f]{6})/, 'ud-z-nie'), '#FFFFFF'],
    ['link w treści banera', kolor(z, /' a\{color:(#[0-9A-Fa-f]{6})/, 'a'), '#FFFFFF'],
  ];
  for (const [opis, a, b] of pary) {
    expect(kontrast(a, b), `${opis}: ${kontrast(a, b).toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});

test('okienko awarii: przycisk telefonu i „kopiuj" czytelne', () => {
  const a = skrypt('awaria.js');
  const tel = kolor(a, /background:(#[0-9A-Fa-f]{6});color:#fff;text-decoration:none;font-weight:800/, 'ud-aw-tel');
  const kopiuj = kolor(a, /\.ud-aw-kopiuj\{[^}]*?color:(#[0-9A-Fa-f]{6})/, 'ud-aw-kopiuj');
  expect(kontrast('#FFFFFF', tel)).toBeGreaterThanOrEqual(4.5);
  expect(kontrast(kopiuj, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
});
