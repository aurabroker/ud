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
  // Kotwicą kroku drugiego jest lista ryzyk, a nie klauzule — te są warunkowe.
  await expect(page.locator('input[name="riskTempIncapacity"]')).toBeVisible();
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

test('klauzule dodatkowe otwierają się dopiero powyżej 300 000 zł', async ({ page }) => {
  await page.fill('input[name="fullName"]', 'Jan Kowalski');
  await page.fill('input[name="profession"]', 'Elektryk');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.check('input[name="riskDeathInvalidity"]');
  await expect(page.getByText(/otwierają się przy sumie/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Klauzule dodatkowe' })).toHaveCount(0);

  // Na progu jeszcze zamknięte.
  await page.fill('input[name="nwDeathSum"]', '300000');
  await expect(page.getByRole('heading', { name: 'Klauzule dodatkowe' })).toHaveCount(0);

  await page.fill('input[name="nwDeathSum"]', '400000');
  await expect(page.getByRole('heading', { name: 'Klauzule dodatkowe' })).toBeVisible();
  await expect(page.locator('select[name="nwFuneral"]')).toBeVisible();

  // Zejście poniżej progu chowa je z powrotem.
  await page.fill('input[name="nwDeathSum"]', '100000');
  await expect(page.getByRole('heading', { name: 'Klauzule dodatkowe' })).toHaveCount(0);
});

test('kreator pokazuje wszystkie aktywności podwyższonego ryzyka', async ({ page }) => {
  await page.fill('input[name="fullName"]', 'Jan Kowalski');
  await page.fill('input[name="profession"]', 'Lekarz');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.check('input[name="riskTempIncapacity"]');
  await page.fill('input[name="tempIncapacitySum"]', '12000');
  await page.getByRole('button', { name: 'Dalej' }).click();

  /**
   * Liczba pól ma odpowiadać liczbie kolumn risk_* w tabeli ud_clients.
   * Stary formularz pokazywał osiem z piętnastu, więc underwriter dostawał
   * puste pole tam, gdzie klient mógł mieć „tak".
   */
  const pola = page.locator('input[type="checkbox"][name^="risk_"]');
  await expect(pola).toHaveCount(15);
  await expect(page.getByText('Spadochroniarstwo')).toBeVisible();
  await expect(page.getByText('Lotnictwo — pilot lub członek załogi')).toBeVisible();
});

test('pola formularza mają czytelne obramowanie i ten sam krój co strona', async ({ page }) => {
  const pole = page.locator('input[name="fullName"]');
  await pole.waitFor({ state: 'visible' });

  const styl = await pole.evaluate((el) => {
    const s = getComputedStyle(el);
    return { obramowanie: s.borderTopColor, kroj: s.fontFamily };
  });
  const krojStrony = await page.evaluate(() => getComputedStyle(document.body).fontFamily);

  // #5E9AB9 — token --color-linia-pole, 3,09:1 na bieli. Poprzedni dawał 1,26:1.
  expect(styl.obramowanie).toBe('rgb(94, 154, 185)');
  expect(styl.kroj, 'pole używa innego kroju niż reszta strony').toBe(krojStrony);
});
