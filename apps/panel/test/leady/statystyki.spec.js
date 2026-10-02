/**
 * Strona /panel/statystyki i migająca zakładka „Niedokończone" (zmiany z 02.10.2026).
 *
 * Obie renderowane po stronie serwera z prawdziwego komponentu i z danymi z tych
 * samych funkcji co ich `load` (ud_leady_statystyki, liczNiedokonczone) na bazie
 * testowej. Kto co widzi, rozstrzyga SQL — tu sprawdzamy, że strona pokazuje to,
 * co SQL zwrócił, a agent nie dostaje cudzych liczb nawet z parametrem w adresie.
 */
import { test, expect } from '@playwright/test';
import { adres, leadId, reset, sql } from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

const OLEK = 'a0000000-0000-0000-0000-0000000000a3';   // UZYTKOWNICY.olek w serwer.mjs / fixture-ui.sql

async function wczytaj(page, request, sciezka, u) {
  const r = await request.get(`${adres()}${sciezka}`, { headers: { 'x-test-user': u } });
  expect(r.status(), await r.text()).toBe(200);
  await page.setContent(await r.text());
}

const stat = (page, id) => page.locator(`[data-stat="${id}"]`);
const ryzyko = (page, id) => page.locator(`tr[data-ryzyko="${id}"]`);

/**
 * Trzy sprzedaże: Jerzy (Ula) z pełnymi danymi i ratą, Grażyna (Olek) z samą
 * składką roczną i sumą trwałej, Bartek (bez opiekuna) bez kwot. Jerzy sprzedany
 * w poprzednim miesiącu, pozostali dziś.
 */
async function sprzedaze(request) {
  await sql(request, `update public.ud_leady set skladka_roczna = 3600, skladka_mies = 300, swiadczenie_okresowa = 8000,
                        swiadczenie_zgon = 50000, sprzedano_at = date_trunc('month', now()) - interval '10 days'
                       where id = tt.lead('Jerzy Duda')`);
  await sql(request, `update public.ud_leady set etap_id = tt.etap('wygrany'), skladka_roczna = 2400, swiadczenie_trwala = 100000,
                        sprzedano_at = now() where id = tt.lead('Grażyna Pawlak')`);
  await sql(request, `update public.ud_leady set etap_id = tt.etap('wygrany'), sprzedano_at = now() where id = tt.lead('Bartek Nowak')`);
}

test('administrator: suma i średnie składek, świadczenia per ryzyko, podział na agentów, lista do uzupełnienia', async ({ page, request }) => {
  await sprzedaze(request);
  await wczytaj(page, request, '/__test/ssr-statystyki', 'adm');

  await expect(page.getByRole('heading', { name: 'Statystyki sprzedaży' })).toBeVisible();
  await expect(page.locator('.naglowek')).toContainText('Wszyscy agenci.');
  await expect(stat(page, 'sprzedaze')).toHaveText('3');
  await expect(page.locator('.kafel').first()).toContainText('2 z kwotami — 1 do uzupełnienia');
  await expect(stat(page, 'roczna')).toHaveText(/^6[\s ]?000 zł$/);
  await expect(page.locator('.kafel').nth(1)).toContainText(/średnio 3[\s ]?000 zł na sprzedaż/);
  await expect(stat(page, 'mies-suma')).toHaveText('500 zł');                    // 300 zapisane + 2400 / 12
  await expect(page.locator('.kafel').nth(2)).toContainText('w tym 1 wyliczona jako 1/12 rocznej');
  await expect(stat(page, 'mies-srednia')).toHaveText('250 zł');

  await expect(ryzyko(page, 'okresowa').locator('td')).toHaveText(['1', /^8[\s ]?000 zł \/ mies\.$/, /^8[\s ]?000 zł \/ mies\.$/]);
  await expect(ryzyko(page, 'trwala').locator('td')).toHaveText(['1', /^100[\s ]?000 zł$/, /^100[\s ]?000 zł$/]);
  await expect(ryzyko(page, 'zgon').locator('td')).toHaveText(['1', /^50[\s ]?000 zł$/, /^50[\s ]?000 zł$/]);

  const agenci = page.locator('section[aria-labelledby="st-agenci"] tbody tr');
  await expect(agenci).toHaveCount(3);
  await expect(agenci.nth(0)).toContainText('Ula Agent');
  await expect(agenci.nth(0)).toContainText(/3[\s ]?600 zł/);
  await expect(agenci.nth(1)).toContainText('Olek Agent');
  await expect(agenci.nth(2)).toContainText('Bez opiekuna');
  await expect(agenci.nth(2)).toContainText('1 (1 bez kwot)');
  await expect(agenci.nth(1).getByRole('link', { name: 'Olek Agent' })).toHaveAttribute('href', `?agent=${OLEK}`);

  const uzupelnij = page.locator('section[aria-labelledby="st-bez"]');
  await expect(uzupelnij.getByRole('heading')).toHaveText('Do uzupełnienia: 1 sprzedaż bez kwot');
  await expect(uzupelnij.getByRole('link', { name: 'Bartek Nowak' }))
    .toHaveAttribute('href', `/panel/leady?lead=${await leadId(request, 'Bartek Nowak')}`);

  // Filtr agenta dostępny tylko administratorowi.
  await expect(page.getByRole('combobox', { name: 'Agent' })).toBeVisible();
});

test('administrator: jeden agent i okres — liczby tylko z wybranego zakresu', async ({ page, request }) => {
  await sprzedaze(request);
  await wczytaj(page, request, `/__test/ssr-statystyki?agent=${OLEK}`, 'adm');
  await expect(page.locator('.naglowek')).toContainText('Sprzedaże: Olek Agent.');
  await expect(stat(page, 'sprzedaze')).toHaveText('1');
  await expect(stat(page, 'roczna')).toHaveText(/^2[\s ]?400 zł$/);
  await expect(page.locator('section[aria-labelledby="st-agenci"]')).toHaveCount(0);

  await wczytaj(page, request, '/__test/ssr-statystyki?okres=poprzedni', 'adm');
  await expect(stat(page, 'sprzedaze')).toHaveText('1');                        // tylko Jerzy
  await expect(stat(page, 'roczna')).toHaveText(/^3[\s ]?600 zł$/);
  await wczytaj(page, request, '/__test/ssr-statystyki?okres=miesiac', 'adm');
  await expect(stat(page, 'sprzedaze')).toHaveText('2');                        // Grażyna i Bartek
});

test('agent widzi wyłącznie swoje — także z cudzym agentem w adresie; nieaktywny nie widzi nic', async ({ page, request }) => {
  await sprzedaze(request);
  await wczytaj(page, request, `/__test/ssr-statystyki?agent=${OLEK}`, 'ula');
  await expect(page.locator('.naglowek')).toContainText('Twoje sprzedaże.');
  await expect(stat(page, 'sprzedaze')).toHaveText('1');
  await expect(stat(page, 'roczna')).toHaveText(/^3[\s ]?600 zł$/);           // Jerzy, nie Grażyna Olka
  await expect(page.getByRole('combobox', { name: 'Agent' })).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="st-agenci"]')).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="st-bez"]')).toHaveCount(0); // Bartek nie jest jej
  await expect(page.locator('body')).not.toContainText('Olek Agent');

  const r = await request.get(`${adres()}/__test/ssr-statystyki`, { headers: { 'x-test-user': 'ines' } });
  expect(r.status()).toBe(403);
});

test('zakładka „Niedokończone" miga, dopóki czeka kontakt ze zgodą; obsłużone, bez zgody i ukończone się nie liczą', async ({ page, request }) => {
  const zakladka = () => page.locator('a[data-zakladka="/panel/niedokonczone"]');

  // Fixture: Szymon Szkic — porzucony ze zgodą, nieobsłużony.
  await wczytaj(page, request, '/__test/ssr-uklad', 'ula');
  await expect(zakladka()).toHaveClass(/\balarm\b/);
  await expect(zakladka()).toHaveAttribute('aria-label', 'Niedokończone — 1 kontakt czeka');
  await expect(zakladka().locator('.licznik-alarmu')).toHaveText('1');

  await sql(request, `insert into public.ud_wnioski_szkice (ostatni_krok, imie, email, phone, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at)
                      values ('zakres', 'Tomasz Test', 'tomasz@x.pl', '601 000 000', true, 'v1-2026-10', 'treść zgody', now())`);
  await wczytaj(page, request, '/__test/ssr-uklad', 'ula');
  await expect(zakladka()).toHaveAttribute('aria-label', 'Niedokończone — 2 kontakty czekają');
  await expect(zakladka().locator('.licznik-alarmu')).toHaveText('2');

  // Obsłużone znikają z licznika; anonimowy szkic i ukończony wniosek nie są kontaktem do obsłużenia.
  await sql(request, `update public.ud_wnioski_szkice set obsluzony_at = now()`);
  await sql(request, `insert into public.ud_wnioski_szkice (ostatni_krok) values ('dane')`);
  await sql(request, `insert into public.ud_wnioski_szkice (ostatni_krok, ukonczony_at, imie, email, phone, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at)
                      values ('zgody', now(), 'Urszula Gotowa', 'u@x.pl', '602 000 000', true, 'v1-2026-10', 'treść zgody', now())`);
  await wczytaj(page, request, '/__test/ssr-uklad', 'ula');
  await expect(zakladka()).not.toHaveClass(/\balarm\b/);
  await expect(zakladka()).not.toHaveAttribute('aria-label', /.+/);
  await expect(zakladka().locator('.licznik-alarmu')).toHaveCount(0);
  await expect(zakladka()).toHaveText('Niedokończone');
});
