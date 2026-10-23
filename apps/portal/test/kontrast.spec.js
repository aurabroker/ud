import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Kontrast tokenów kolorów z global.css (WCAG 2.1: 4,5:1 dla zwykłego tekstu,
 * 3:1 dla krawędzi pól). Serwis jest jasny i tła to biel oraz cztery odcienie
 * cyjanu — tekst stoi na każdym z nich.
 *
 * --color-alarm do 22.10.2026 miał 4,40:1 na bieli: błędy w kreatorze wniosku
 * (13 px) i kwoty zasiłku ZUS w tabelach były poniżej progu.
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

for (const [tekst, prog] of [['tekst', 4.5], ['tekst-drugi', 4.5], ['akcent-tekst', 4.5], ['alarm', 4.5]]) {
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
