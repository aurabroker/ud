import { test, expect } from '@playwright/test';

/**
 * Testy kreatora wniosku w przeglądarce.
 *
 * Sprawdzają to, czego nie widać w buildzie: czy wyspa się hydratuje, czy
 * walidacja zatrzymuje na kroku, czy próg miliona złotych faktycznie odsłania
 * rozszerzoną ankietę. Kompilacja tego nie gwarantuje.
 */

const PESEL = '90010112349'; // wyliczony, z poprawną cyfrą kontrolną

test.beforeEach(async ({ page }) => {
  await page.goto('/wniosek/');
  // Wyspa ładuje się przy wejściu w pole widzenia — czekamy na jej pierwsze pole.
  await expect(page.locator('input[name="fullName"]')).toBeVisible();
});

test('walidacja zatrzymuje na kroku i tłumaczy, czego brakuje', async ({ page }) => {
  await page.getByRole('button', { name: 'Dalej' }).click();

  await expect(page.getByText('Podaj imię i nazwisko.')).toBeVisible();
  await expect(page.getByText(/PESEL ma 11 cyfr/)).toBeVisible();
  // Nadal krok pierwszy.
  await expect(page.locator('input[name="fullName"]')).toBeVisible();
});

test('błędny PESEL nie przepuszcza, poprawny przepuszcza', async ({ page }) => {
  await page.fill('input[name="fullName"]', 'Jan Kowalski');
  await page.fill('input[name="profession"]', 'Lekarz');

  await page.fill('input[name="pesel"]', '90010112345');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByText(/cyfrą kontrolną/)).toBeVisible();

  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByRole('heading', { name: 'Klauzule dodatkowe' })).toBeVisible();
});

test('forma zatrudnienia zmienia limit świadczenia', async ({ page }) => {
  await expect(page.getByText('Świadczenie obejmie do 80% udokumentowanego dochodu.')).toBeVisible();
  await page.selectOption('select[name="employmentType"]', 'uop');
  await expect(page.getByText('Świadczenie obejmie do 65% udokumentowanego dochodu.')).toBeVisible();
});

test('suma powyżej miliona odsłania rozszerzoną ankietę', async ({ page }) => {
  await page.fill('input[name="fullName"]', 'Jan Kowalski');
  await page.fill('input[name="profession"]', 'Lekarz');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.check('input[name="riskPermIncapacity"]');

  // Na progu jeszcze nie, dopiero powyżej.
  await page.fill('input[name="permIncapacitySum"]', '1000000');
  await expect(page.getByText(/rozszerzonej ankiety zdrowotnej/)).toHaveCount(0);

  await page.fill('input[name="permIncapacitySum"]', '1500000');
  await expect(page.getByText(/rozszerzonej ankiety zdrowotnej/)).toBeVisible();

  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByRole('heading', { name: 'Ankieta rozszerzona' })).toBeVisible();
  await expect(page.getByText('Choroby i układy')).toBeVisible();
});

test('odpowiedź TAK wymusza opis', async ({ page }) => {
  await page.fill('input[name="fullName"]', 'Jan Kowalski');
  await page.fill('input[name="profession"]', 'Lekarz');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.check('input[name="riskTempIncapacity"]');
  await page.fill('input[name="tempIncapacitySum"]', '12000');
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.check('input[name="med_heart"][value="yes"]');
  await expect(page.locator('textarea[name="med_heart_notes"]')).toBeVisible();

  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByText(/opisz krótko, czego dotyczy/i).first()).toBeVisible();

  await page.fill('textarea[name="med_heart_notes"]', 'Nadciśnienie, leczone od 2020.');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.locator('input[name="email"]')).toBeVisible();
});

test('zgody są obowiązkowe, a wstecz nie gubi danych', async ({ page }) => {
  await page.fill('input[name="fullName"]', 'Anna Nowak');
  await page.fill('input[name="profession"]', 'Stomatolog');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.check('input[name="riskTempIncapacity"]');
  await page.fill('input[name="tempIncapacitySum"]', '9000');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.fill('input[name="email"]', 'anna@example.com');
  await page.fill('input[name="phone"]', '504400901');
  await page.getByRole('button', { name: 'Wyślij wniosek' }).click();
  await expect(page.getByText(/głównymi wyłączeniami/i).first()).toBeVisible();

  // Cofnięcie o trzy kroki musi zachować to, co wpisano na pierwszym.
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Wstecz' }).click();
  await expect(page.locator('input[name="fullName"]')).toHaveValue('Anna Nowak');
  await expect(page.locator('input[name="pesel"]')).toHaveValue(PESEL);
});
