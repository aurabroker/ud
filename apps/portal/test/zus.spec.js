import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import {
  ROK, PLACA_MINIMALNA, PRZECIETNE_PROGNOZA, PODSTAWA, ZASILEK_JDG, zasilek,
} from '../src/lib/zus.ts';

/**
 * Zasiłek ZUS, z którym porównujemy polisę — kwoty i zdania w buildzie.
 *
 * Do 21.10.2026 serwis podawał „2 240 zł" na prawie dwustu stronach: płacę
 * minimalną z 2021 roku pomnożoną przez 0,8. Do tego trzy zdania niezgodne
 * z OWU: „świadczenie od pierwszego dnia" (LW044: za okres wyczekiwania
 * świadczenie nie przysługuje), „minimum przez 24 miesiące" (okres
 * odszkodowawczy to czas NAJDŁUŻSZY) i słowo „karencja" zamiast okresu
 * wyczekiwania. Ten test czyta gotowe pliki — HTML, Markdown i llms.txt —
 * bo z nich cytują wyszukiwarki i modele językowe.
 */

const DIST = 'dist';

test('kwoty ZUS są z bieżącego roku', () => {
  // Czerwony w styczniu: płaca minimalna i prognoza przeciętnego wynagrodzenia
  // zmieniają się co roku, a z nimi zasiłek. Popraw stałe w src/lib/zus.ts.
  expect(ROK, 'zus.ts ma kwoty z poprzedniego roku').toBeGreaterThanOrEqual(new Date().getFullYear());
});

test('podstawy i zasiłki liczą się ze stałych', () => {
  const grosze = (x) => Math.round(x * 100) / 100;
  expect(PODSTAWA.standardowa).toBe(grosze(0.6 * PRZECIETNE_PROGNOZA));
  expect(PODSTAWA.preferencyjna).toBe(grosze(0.3 * PLACA_MINIMALNA));
  // Policzone ręcznie dla 2026: 5 652 × 0,8629 × 0,8 = 3 901,69; 1 441,80 × 0,8629 × 0,8 = 995,30.
  expect(zasilek(5652)).toBe(3902);
  expect(zasilek(1441.8)).toBe(995);
  expect(ZASILEK_JDG).toEqual({
    duzy: zasilek(PODSTAWA.standardowa),
    preferencyjny: zasilek(PODSTAWA.preferencyjna),
    bezChorobowego: 0,
  });
});

/**
 * Wpisy na blogu są poza zakresem: to treść redakcyjna, poprawiana zdanie po
 * zdaniu z OWU (CLAUDE.md, „Nowy artykuł w portalu"), a nie generowana
 * z szablonu. Lista bloga — w zakresie.
 */
function plikiZBuildu() {
  return readdirSync(DIST, { recursive: true })
    .map(String)
    .filter((p) => /(?:^|[\\/])(?:index\.html|index\.md|llms\.txt)$/.test(p))
    .filter((p) => !p.split(sep).join('/').match(/^blog\/[^/]+\//))
    .map((p) => join(DIST, p));
}

const SPACJA = '[\\s\\u00a0\\u202f]?';
const ZAKAZANE = [
  ['stary zasiłek 2 240 zł', new RegExp(`\\b2${SPACJA}240${SPACJA}zł`)],
  ['stara podstawa 2 800 zł', new RegExp(`\\b2${SPACJA}800${SPACJA}zł`)],
  ['„od pierwszego dnia niezdolności"', /od pierwszego dnia niezdolności/i],
  ['„karencja" zamiast okresu wyczekiwania', /karencj/i],
  ['„minimum przez N miesięcy"', /minimum przez \d+ miesi/i],
  ['kolumna etatu w tabeli kalkulatora', /Z polisą — etat/],
];

test('żadna strona nie podaje starych kwot ZUS ani zdań niezgodnych z OWU', () => {
  const pliki = plikiZBuildu();
  expect(pliki.length, 'brak plików — czy build się wykonał?').toBeGreaterThan(400);

  const naruszenia = [];
  for (const plik of pliki) {
    const tekst = readFileSync(plik, 'utf8');
    for (const [opis, wzor] of ZAKAZANE) {
      const m = tekst.match(wzor);
      if (m) {
        const i = m.index ?? 0;
        naruszenia.push(`${plik}: ${opis} — …${tekst.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ')}…`);
      }
    }
  }
  expect(naruszenia).toEqual([]);
});

test('kalkulator, strona zawodu i llms.txt podają zasiłek 3 902 zł z dopiskami', () => {
  const zl = (n) => new RegExp(`${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, SPACJA)}${SPACJA}zł`);
  for (const plik of ['kalkulator/index.md', 'lekarz/index.md', 'lekarz/llms.txt', 'llms.txt']) {
    const tekst = readFileSync(join(DIST, plik), 'utf8');
    expect(tekst, plik).toMatch(zl(ZASILEK_JDG.duzy));
    expect(tekst, plik).toMatch(zl(ZASILEK_JDG.preferencyjny));
    expect(tekst, plik).toContain('bez chorobowego 0');
    expect(tekst, plik).toContain('po odliczeniu 13,71%');
  }
});
