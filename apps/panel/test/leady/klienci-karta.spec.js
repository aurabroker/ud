/**
 * Karta klienta w przeglądarce: strzałka „Następny klient" zmienia w SvelteKicie
 * tylko parametr trasy — strona zostaje, przychodzi nowe `data`. Karta musi
 * wtedy pokazać nowego klienta, a nie zostać przy poprzednim pod nowym adresem
 * (do 20.11.2026 `const c = data.client` czytało dane raz, przy tworzeniu strony).
 * Harness: test/leady/karta.html.
 */
import { test, expect } from '@playwright/test';
import { adres, reset, sql } from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

test('przejście na sąsiada podmienia całą kartę: nagłówek, dane, oferty i strzałki', async ({ page, request }) => {
  await page.goto(`${adres()}/test/leady/karta.html?u=adm&nazwa=${encodeURIComponent('Jerzy Duda')}&zrodlo=brak`);
  await page.waitForSelector('html[data-gotowe]');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jerzy Duda');
  await expect(page.locator('body')).toContainText('jerzy@x.pl');
  await expect(page.locator('body')).toContainText('Oferty klienta (1)');
  const irena = await sql(request, `select id from public.ud_clients where full_name = 'Irena Kubiak'`);
  await expect(page.locator('[data-nastepny]')).toHaveAttribute('href', `/panel/klienci/${irena}?zrodlo=brak`);

  await page.evaluate(() => window.__pokazKlienta('Irena Kubiak'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Irena Kubiak');
  await expect(page.locator('body')).toContainText('irena@x.pl');
  await expect(page.locator('body')).not.toContainText('jerzy@x.pl');
  await expect(page.locator('body')).toContainText('Oferty klienta (0)');
  await expect(page).toHaveTitle('Irena Kubiak — Karta klienta');
  const jerzy = await sql(request, `select id from public.ud_clients where full_name = 'Jerzy Duda'`);
  await expect(page.locator('[data-poprzedni]')).toHaveAttribute('href', `/panel/klienci/${jerzy}?zrodlo=brak`);
  await expect(page.locator('[data-powrot]')).toHaveAttribute('href', '/panel/klienci?zrodlo=brak');
});
