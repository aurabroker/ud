import { test, expect } from '@playwright/test';

/**
 * Kwoty poniżej są wyliczone ręcznie ze wzoru — jeśli test padnie, znaczy to,
 * że symulacja rozjechała się ze stawkami z kalibracja.json.
 *
 *   suma    = dochód × limit          (0,8 na B2B, 0,65 na umowie o pracę)
 *   stawka  = 0,0202 (najtańsza oferta) … 0,0244 (najdroższa), ×1,2 z HIV/WZW
 *   składka = round(suma × stawka)
 *
 * Składka jest przedziałem, nie liczbą. Stawka 1,5% ze starego Calculator.js
 * leżała poniżej najtańszej oferty, jaką realnie wystawiliśmy — przy sumie
 * 14 400 zł dawała 216 zł przy faktycznych 291–351 zł.
 */

const wynik = (page, etykieta) =>
  page.locator('dt', { hasText: etykieta }).locator('xpath=following-sibling::dd[1]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Symulacja składki/ })).toBeVisible();
});

test('wartości domyślne: 18 000 zł na B2B', async ({ page }) => {
  // 18 000 × 0,8 = 14 400;  × 0,0202 = 290,88 → 291;  × 0,0244 = 351,36 → 351
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('14 400 zł');
  await expect(wynik(page, 'Szacowana składka')).toHaveText('291–351 zł');
  // 2800 × 0,8 = 2240 — zasiłek nie zależy od dochodu, tylko od podstawy.
  await expect(wynik(page, 'Zasiłek ZUS')).toHaveText('2 240 zł');
});

test('umowa o pracę obniża limit z 80% do 65%', async ({ page }) => {
  await page.getByText('Umowa o pracę').click();
  // 18 000 × 0,65 = 11 700;  × 0,0202 = 236,34 → 236;  × 0,0244 = 285,48 → 285
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('11 700 zł');
  await expect(wynik(page, 'Szacowana składka')).toHaveText('236–285 zł');
  await expect(page.getByText('do 65% udokumentowanego dochodu')).toBeVisible();
});

test('klauzula HIV/WZW podnosi stawkę o 20%', async ({ page }) => {
  await page.getByLabel('Klauzula HIV / WZW').check();
  // 14 400 × 0,0202 × 1,2 = 349,06 → 349;  14 400 × 0,0244 × 1,2 = 421,63 → 422
  await expect(wynik(page, 'Szacowana składka')).toHaveText('349–422 zł');

  await page.getByLabel('Klauzula HIV / WZW').uncheck();
  await expect(wynik(page, 'Szacowana składka')).toHaveText('291–351 zł');
});

/**
 * Skąd te liczby — to musi stać przy kwocie, nie w dokumentacji.
 *
 * Poprzednia stawka (1,5%) nie była niczym poparta i nikt tego po stronie nie
 * poznawał. Jeśli przedział znowu zacznie brać się znikąd, ten test padnie.
 */
test('przy składce stoi, że przedział pochodzi z wystawionych ofert', async ({ page }) => {
  const kwoty = page.locator('dl').filter({ hasText: 'Szacowana składka' }).first();
  await expect(kwoty).toContainText('przedział z 15 wystawionych ofert');
  await expect(page.getByText(/policzyliśmy z 48 wariantów w 15 ofertach/)).toBeVisible();
  await expect(page.getByText(/o które ten kalkulator nie pyta/)).toBeVisible();
});

/**
 * Okres wypłaty jest w kalkulatorze informacją, nie przełącznikiem.
 *
 * Warianty są cztery — 24, 36, 48 i 60 miesięcy — ale współczynników stawki
 * dla dłuższych nie mamy z tabeli ubezpieczyciela. Przełącznik pokazywałby
 * wtedy cenę wariantu 24-miesięcznego pod etykietą 60-miesięcznego, czyli
 * dokładnie ten błąd, który miał tu wcześniej przełącznik „24 zamiast 12":
 * okres, którego nie da się kupić, w pozycji domyślnej.
 *
 * Test pilnuje więc trzech rzeczy naraz: że okresy są wymienione w komplecie,
 * że napisane jest, którego z nich dotyczy składka, i że wariant 12-miesięczny
 * nie wrócił.
 */
test('kalkulator wymienia cztery okresy i mówi, którego dotyczy składka', async ({ page }) => {
  const kwoty = page.locator('dl').filter({ hasText: 'Świadczenie z polisy' }).first();
  await expect(kwoty).toContainText('minimum przez 24 miesiące');
  await expect(page.getByText(/wypłacane jest przez 24, 36, 48 albo 60 miesięcy/)).toBeVisible();
  await expect(page.getByText(/składka dotyczy wariantu najkrótszego, 24-miesięcznego/)).toBeVisible();
  await expect(page.getByText(/zamiast 12/)).toHaveCount(0);
});

test('strona kalkulatora tłumaczy okresy wypłaty w pytaniach', async ({ page }) => {
  await page.goto('/kalkulator/');
  // Pytanie jest trzecie z kolei, a otwarte z marszu są dwa pierwsze.
  await page.locator('summary', { hasText: 'Jak długo wypłacane jest świadczenie' }).click();
  await expect(page.getByText(/Do wyboru są cztery okresy: 24, 36, 48, 60 miesięcy/)).toBeVisible();
});

test('suwak zmienia świadczenie', async ({ page }) => {
  const suwak = page.getByLabel('Miesięczny dochód netto w złotych');
  await suwak.fill('30000');
  // 30 000 × 0,8 = 24 000;  × 0,0202 = 484,8 → 485;  × 0,0244 = 585,6 → 586
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('24 000 zł');
  await expect(wynik(page, 'Szacowana składka')).toHaveText('485–586 zł');
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
