import { test, expect } from '@playwright/test';
import { RYZYKA, sprawdzKrok } from '@ud/wniosek';

/**
 * Reguła zakresu: „Okresowa niezdolność do pracy" jest ryzykiem podstawowym.
 *
 * Polisa utraty dochodu to właśnie ona; śmierć / inwalidztwo i trwała
 * niezdolność tylko ją rozszerzają. 28.09.2026 kreator przepuścił wniosek
 * z samą śmiercią / inwalidztwem, bo wymagał „dowolnego jednego ryzyka".
 * Funkcja brzegowa blokuje dziś wyłącznie samą trwałą, więc bramka musi stać
 * w kreatorze.
 */

const zakres = (dane) => sprawdzKrok('zakres', dane);

test('ryzykiem podstawowym jest dokładnie okresowa niezdolność', () => {
  const podstawowe = RYZYKA.filter((r) => r.podstawowe).map((r) => r.klucz);
  expect(podstawowe).toEqual(['riskTempIncapacity']);
});

test('sama śmierć / inwalidztwo nie przechodzi', () => {
  const bledy = zakres({ riskDeathInvalidity: true, nwDeathSum: '1000000' });
  expect(bledy.ryzyka).toMatch(/ryzyko podstawowe/);
});

test('sama trwała niezdolność nie przechodzi', () => {
  const bledy = zakres({ riskPermIncapacity: true, permIncapacitySum: '500000' });
  expect(bledy.ryzyka).toMatch(/ryzyko podstawowe/);
});

test('okresowa z dodatkami przechodzi', () => {
  expect(zakres({
    riskTempIncapacity: true, tempIncapacitySum: '8000',
    riskDeathInvalidity: true, nwDeathSum: '1000000',
    riskPermIncapacity: true, permIncapacitySum: '500000',
  })).toEqual({});
});

test('sama okresowa przechodzi, ale bez kwoty nie', () => {
  expect(zakres({ riskTempIncapacity: true, tempIncapacitySum: '8000' })).toEqual({});
  expect(zakres({ riskTempIncapacity: true, tempIncapacitySum: '' })).toHaveProperty('tempIncapacitySum');
});
