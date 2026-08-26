import { test, expect } from '@playwright/test';

/**
 * Kalkulator liczy wzorem przeniesionym z Calculator.js starego serwisu.
 * Kwoty poniżej są wyliczone ręcznie z tego wzoru — jeśli test padnie,
 * znaczy to, że symulacja rozjechała się z tym, co serwis pokazywał dotąd.
 *
 *   suma    = dochód × limit          (0,8 na B2B, 0,65 na umowie o pracę)
 *   stawka  = 0,015  albo 0,018 z klauzulą HIV/WZW,  ×1,1 przy 24 miesiącach
 *   składka = round(suma × stawka)
 */

const wynik = (page, etykieta) =>
  page.locator('dt', { hasText: etykieta }).locator('xpath=following-sibling::dd[1]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Symulacja składki/ })).toBeVisible();
});

test('wartości domyślne: 18 000 zł na B2B', async ({ page }) => {
  // 18 000 × 0,8 = 14 400;  14 400 × 0,015 = 216
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('14 400 zł');
  await expect(wynik(page, 'Szacowana składka')).toHaveText('216 zł');
  // 2800 × 0,8 = 2240 — zasiłek nie zależy od dochodu, tylko od podstawy.
  await expect(wynik(page, 'Zasiłek ZUS')).toHaveText('2 240 zł');
});

test('umowa o pracę obniża limit z 80% do 65%', async ({ page }) => {
  await page.getByText('Umowa o pracę').click();
  // 18 000 × 0,65 = 11 700;  11 700 × 0,015 = 175,5 → 176
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('11 700 zł');
  await expect(wynik(page, 'Szacowana składka')).toHaveText('176 zł');
  await expect(page.getByText('do 65% udokumentowanego dochodu')).toBeVisible();
});

test('klauzula HIV/WZW i wariant 24-miesięczny podnoszą stawkę', async ({ page }) => {
  await page.getByLabel('Klauzula HIV / WZW').check();
  // 14 400 × 0,018 = 259,2 → 259
  await expect(wynik(page, 'Szacowana składka')).toHaveText('259 zł');

  await page.getByLabel('Wypłata przez 24 miesiące zamiast 12').check();
  // 14 400 × 0,018 × 1,1 = 285,12 → 285
  await expect(wynik(page, 'Szacowana składka')).toHaveText('285 zł');

  await page.getByLabel('Klauzula HIV / WZW').uncheck();
  // 14 400 × 0,015 × 1,1 = 237,6 → 238
  await expect(wynik(page, 'Szacowana składka')).toHaveText('238 zł');
});

test('suwak zmienia świadczenie', async ({ page }) => {
  const suwak = page.getByLabel('Miesięczny dochód netto w złotych');
  await suwak.fill('30000');
  // 30 000 × 0,8 = 24 000;  24 000 × 0,015 = 360
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('24 000 zł');
  await expect(wynik(page, 'Szacowana składka')).toHaveText('360 zł');
});

test('przy każdej kwocie stoi zastrzeżenie, że to nie jest oferta', async ({ page }) => {
  await expect(page.getByText(/To jest symulacja, nie oferta/)).toBeVisible();
});

test('strona zawodu ma kalkulator z dochodem dobranym do zawodu', async ({ page }) => {
  await page.goto('/lekarz/');
  const naglowek = page.getByRole('heading', { name: /Symulacja składki dla lekarza/ });
  await naglowek.scrollIntoViewIfNeeded();
  await expect(naglowek).toBeVisible();
  // Lekarz: świadczenie 500 zł/dzień → dochód przykładowy 19 000 zł, suma 15 200 zł.
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('15 200 zł');
});
