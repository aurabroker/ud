import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * security.txt — RFC 9116, z naciskiem na pole Expires.
 *
 * Skaner bezpieczeństwa zgłosił „security.txt bez pola Expires". W RFC 9116
 * to pole jest OBOWIĄZKOWE, a plik po tej dacie jest formalnie nieważny.
 *
 * Sedno tych testów nie leży w samej obecności pola, tylko w tym, że
 * **data mija po cichu**. Plik z przeterminowanym Expires jest gorszy niż jego
 * brak: deklaruje kanał kontaktu, którego może już nie być, a nikt się o tym
 * nie dowie, bo strona dalej się buduje i wygląda tak samo. Dlatego build ma
 * paść NA TRZYDZIEŚCI DNI PRZED terminem — wtedy jest kiedy odnowić, zamiast
 * dowiadywać się z kolejnego raportu skanera.
 */

const PLIK = fileURLToPath(new URL('../dist/.well-known/security.txt', import.meta.url));
const ZAPAS_DNI = 30;

const tresc = () => readFileSync(PLIK, 'utf8');

/** Wartości pola — nagłówki RFC 9116 są niewrażliwe na wielkość liter. */
function pole(nazwa) {
  return tresc()
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .map((l) => l.match(new RegExp(`^${nazwa}\\s*:\\s*(.+)$`, 'i')))
    .filter(Boolean)
    .map((m) => m[1].trim());
}

test('plik stoi pod adresem wymaganym przez RFC 9116', () => {
  expect(existsSync(PLIK), 'brak dist/.well-known/security.txt').toBe(true);
});

test('ma co najmniej jeden Contact', () => {
  const kontakty = pole('Contact');
  expect(kontakty.length, 'security.txt bez Contact nie ma sensu').toBeGreaterThan(0);
  expect(kontakty.some((k) => /^(mailto|https|tel):/.test(k)),
    'Contact musi być URI — mailto:, https: albo tel:').toBe(true);
});

test('ma Expires i jest to poprawna data', () => {
  const wartosci = pole('Expires');
  expect(wartosci.length, 'to jest dokładnie to, co zgłosił skaner').toBe(1);
  expect(Number.isNaN(Date.parse(wartosci[0])),
    `„${wartosci[0]}" nie parsuje się jako data ISO 8601`).toBe(false);
});

test('Expires jeszcze nie minął', () => {
  const kiedy = new Date(pole('Expires')[0]);
  expect(kiedy.getTime(), `security.txt wygasł ${kiedy.toISOString().slice(0, 10)} — `
    + 'deklaruje kanał kontaktu, którego nikt nie potwierdził').toBeGreaterThan(Date.now());
});

test(`do Expires zostało więcej niż ${ZAPAS_DNI} dni`, () => {
  const kiedy = new Date(pole('Expires')[0]);
  const dni = Math.floor((kiedy.getTime() - Date.now()) / 86_400_000);
  expect(dni, `security.txt wygasa za ${dni} dni (${kiedy.toISOString().slice(0, 10)}). `
    + 'Podnieś Expires w apps/portal/public/.well-known/security.txt. '
    + 'Ten test pada z wyprzedzeniem celowo — data ma nie minąć niezauważona.')
    .toBeGreaterThan(ZAPAS_DNI);
});

test('Canonical wskazuje na ten plik pod właściwą domeną', () => {
  expect(pole('Canonical')).toContain('https://utratadochodu.pl/.well-known/security.txt');
});

test('nie deklaruje dokumentów, których nie prowadzimy', () => {
  // Ta sama zasada co przy nagłówku Link i relacjach api-catalog / service-desc:
  // odnośnik do nieistniejącego dokumentu kosztuje zgłaszającego jedno żądanie
  // i kończy się błędem zamiast odpowiedzią.
  for (const nazwa of ['Policy', 'Encryption', 'Acknowledgments', 'Hiring']) {
    expect(pole(nazwa), `${nazwa} wskazuje na dokument, którego serwis nie ma — `
      + 'albo dopisz ten dokument, albo usuń pole').toHaveLength(0);
  }
});
