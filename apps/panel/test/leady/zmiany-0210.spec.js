/**
 * Zmiany z 02.10.2026 (decyzje właściciela po pierwszym dniu pracy na tablicy):
 * wiek karty w kolorze, administrator niewidoczny jako opiekun na karcie,
 * zwinięte karty w „Przegrany", dane sprzedaży przy „Wygrany" (z wariantu
 * oferty albo wpisane ręcznie) i suma składek zamiast sumy świadczeń.
 */
import { test, expect } from '@playwright/test';
import {
  etapLeada, karta, kolumna, otworz, przeciagnij, przeciagnijZPrzewijaniem, reset, sql, toast, wywolania,
} from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

const szczegoly = (page) => page.locator('[data-szczegoly]');

test('wiek karty: pierwsza kolumna od zieleni do czerwieni, inne czerwone po 5 dniach, zamknięte bez koloru; liczba dni napisem', async ({ page }) => {
  await otworz(page);
  // Nowy: Ewa 1 dzień, Anna 2, Filip 3, Grażyna 4, Bartek 20.
  await expect(karta(page, 'Ewa Mazur')).toHaveAttribute('data-wiek', '1');
  await expect(karta(page, 'Anna Kowalska')).toHaveAttribute('data-wiek', '2');
  await expect(karta(page, 'Grażyna Pawlak')).toHaveAttribute('data-wiek', '4');
  await expect(karta(page, 'Bartek Nowak')).toHaveAttribute('data-wiek', 'czerwony');
  await expect(karta(page, 'Bartek Nowak').locator('[data-wiek-tekst]')).toContainText('20 dni w etapie');
  await expect(karta(page, 'Ewa Mazur').locator('[data-wiek-tekst]')).toContainText('1 dzień w etapie');

  // Kolor naprawdę inny: zielonkawy pasek u Ewy, czerwony u Bartka.
  const pasek = (nazwa) => karta(page, nazwa).evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(await pasek('Ewa Mazur')).toBe('rgb(101, 163, 13)');
  expect(await pasek('Bartek Nowak')).toBe('rgb(220, 38, 38)');

  // Oferta: Henryk 6 dni i Irena 8 — czerwone; bez stopniowania (to tylko pierwsza kolumna).
  await expect(karta(page, 'Henryk Sikora')).toHaveAttribute('data-wiek', 'czerwony');
  await expect(karta(page, 'Irena Kubiak')).toHaveAttribute('data-wiek', 'czerwony');
  // Wygrany i Przegrany nie świecą.
  await expect(karta(page, 'Jerzy Duda')).not.toHaveAttribute('data-wiek', /.+/);
  await expect(karta(page, 'Karolina Mróz')).not.toHaveAttribute('data-wiek', /.+/);
});

test('licznik dni zeruje tylko przeniesienie — notatka go nie rusza', async ({ page, request }) => {
  await otworz(page);
  await karta(page, 'Bartek Nowak').locator('.kontekst').click();
  await szczegoly(page).getByLabel('Nowa notatka').fill('Dzwoniłam, nie odebrał');
  await szczegoly(page).getByRole('button', { name: 'Dodaj notatkę' }).click();
  await expect(szczegoly(page).locator('[data-notatki]')).toContainText('Dzwoniłam');
  await page.getByRole('button', { name: 'Zamknij szczegóły' }).click();
  await expect(karta(page, 'Bartek Nowak')).toHaveAttribute('data-wiek', 'czerwony');

  await przeciagnij(page, karta(page, 'Bartek Nowak'), kolumna(page, 'oferta'));
  await expect(toast(page)).toContainText('Bartek Nowak: Nowy → Oferta');
  await expect(karta(page, 'Bartek Nowak')).toHaveAttribute('data-wiek', 'neutralny');
  await expect(karta(page, 'Bartek Nowak').locator('[data-wiek-tekst]')).toContainText('Dziś w etapie');
  expect(await etapLeada(request, 'Bartek Nowak')).toBe('oferta');
});

test('administrator jako opiekun: karta go nie pokazuje, szczegóły tak', async ({ page, request }) => {
  await sql(request, `update public.ud_leady set opiekun_id = tt.id_adm() where id = tt.lead('Celina Zielińska')`);
  await otworz(page);
  const k = karta(page, 'Celina Zielińska');
  await expect(k).toBeVisible();
  await expect(k.locator('.opiekun')).toHaveCount(0);
  await expect(k).not.toContainText('Ada Admin');
  await expect(k).not.toContainText('Bez opiekuna');
  await expect(karta(page, 'Anna Kowalska').locator('.opiekun')).toHaveText('Ula Agent');   // zwykły agent — widoczny

  await k.locator('.kontekst').click();
  await expect(szczegoly(page).locator('[data-opiekun]')).toHaveText('Ada Admin (administrator)');
});

test('Przegrany: karta zwinięta do nazwy, kliknięcie ją rozwija, „Zwiń" wraca', async ({ page }) => {
  await otworz(page);
  const k = karta(page, 'Karolina Mróz');
  await k.scrollIntoViewIfNeeded();
  await expect(k).toHaveAttribute('data-zwinieta', '');
  await expect(k).toHaveText('Karolina Mróz');
  await expect(k.getByRole('button', { name: 'Karolina Mróz' })).toHaveAttribute('aria-expanded', 'false');

  await k.getByRole('button', { name: 'Karolina Mróz' }).click();
  await expect(k).not.toHaveAttribute('data-zwinieta', '');
  await expect(k).toContainText('Powód utraty: Wybrała konkurencję');
  await expect(szczegoly(page)).toHaveCount(0);                               // rozwinięcie, nie szczegóły

  await k.getByRole('button', { name: 'Zwiń kartę Karolina Mróz' }).click();
  await expect(k).toHaveAttribute('data-zwinieta', '');
  await expect(k).not.toContainText('Powód utraty');
});

test('Wygrany: nagłówek liczy składki, uzupełnienie danych z wariantu oferty klienta', async ({ page, request }) => {
  await otworz(page);
  const wygrany = kolumna(page, 'wygrany');
  await wygrany.scrollIntoViewIfNeeded();
  await expect(wygrany.locator('[data-suma-skladek]')).toContainText('Σ składek: 0 zł / rok');
  await expect(wygrany).not.toContainText('Σ świadczeń');
  await expect(karta(page, 'Jerzy Duda')).toContainText('Brak danych sprzedaży');

  await page.getByRole('button', { name: 'Akcje leada Jerzy Duda' }).click();
  await page.getByRole('menuitem', { name: 'Uzupełnij dane sprzedaży…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dane sprzedaży' });
  const wariant = dialog.getByRole('radio', { name: /Leadenhall Utrata Dochodu · LHQ7\/1/ });
  await expect(wariant).toBeVisible();
  await wariant.check();
  await expect(dialog.getByLabel('Składka roczna *')).toHaveValue('3600');
  await expect(dialog.getByLabel('Składka miesięczna')).toHaveValue('300');
  await expect(dialog.getByLabel('Świadczenie — okresowa niezdolność')).toHaveValue('8000');
  await expect(dialog.getByLabel('Suma — zgon')).toHaveValue('50000');
  await dialog.getByRole('button', { name: 'Zapisz' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(karta(page, 'Jerzy Duda')).toContainText(/Składka 3[\s ]?600 zł \/ rok/);
  await expect(wygrany.locator('[data-suma-skladek]')).toContainText(/3[\s ]?600 zł \/ rok/);
  expect(await sql(request, `select skladka_roczna || ':' || skladka_mies || ':' || sprzedaz_wariant_id from public.ud_leady where id = tt.lead('Jerzy Duda')`))
    .toBe('3600.00:300.00:0d000000-0000-0000-0000-00000000000a');
});

test('przeniesienie do Wygrany: okno danych przed zapisem, anulowanie nic nie zmienia, kwota z przecinkiem przechodzi', async ({ page, request }) => {
  await otworz(page);
  await przeciagnijZPrzewijaniem(page, karta(page, 'Anna Kowalska'), 'wygrany');
  const dialog = page.getByRole('dialog', { name: 'Dane sprzedaży' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Brak wariantów');                         // Anna nie ma ofert — kwoty ręcznie
  expect((await wywolania(request)).filter((w) => w.sciezka === 'zmien')).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');

  await przeciagnijZPrzewijaniem(page, karta(page, 'Anna Kowalska'), 'wygrany');
  await dialog.getByRole('button', { name: /Przenieś do/ }).click();
  await expect(dialog.getByText('Składka roczna jest wymagana.')).toBeVisible();
  await dialog.getByLabel('Składka roczna *').fill('1 200,50');
  await dialog.getByLabel('Suma — trwała niezdolność').fill('abc');
  await dialog.getByRole('button', { name: /Przenieś do/ }).click();
  await expect(dialog.getByText('Wpisz kwotę')).toBeVisible();
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');
  await dialog.getByLabel('Suma — trwała niezdolność').fill('');
  await dialog.getByRole('button', { name: /Przenieś do/ }).click();

  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Wygrany');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('wygrany');
  expect(await sql(request, `select skladka_roczna || ':' || coalesce(sprzedawca_id::text, '-') from public.ud_leady where id = tt.lead('Anna Kowalska')`))
    .toBe('1200.50:a0000000-0000-0000-0000-0000000000a2');                      // sprzedawca = opiekun (Ula)
  await expect(karta(page, 'Anna Kowalska')).toContainText(/Składka 1[\s ]?200,5 zł \/ rok/);
});
