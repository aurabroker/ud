/**
 * Nagłówek panelu: Wysyłki, Panel Admina i Ustawienia pod jedną pozycją
 * „Ustawienia" obok nazwy konta (decyzja właściciela z 05.10.2026).
 * Układ i pasek sekcji renderowane po stronie serwera z prawdziwych komponentów.
 */
import { test, expect } from '@playwright/test';
import { adres, reset } from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

async function wczytaj(page, request, sciezka) {
  const r = await request.get(`${adres()}${sciezka}`, { headers: { 'x-test-user': 'ula' } });
  expect(r.status(), await r.text()).toBe(200);
  await page.setContent(await r.text());
}

test('menu bez Wysyłek, Panelu Admina i Ustawień; „Ustawienia" stoi tuż obok nazwy konta', async ({ page, request }) => {
  await wczytaj(page, request, '/__test/ssr-uklad?rola=admin');
  // „Niedokończone" może nieść licznik czekających kontaktów (fixture ma jeden).
  await expect(page.locator('header nav a')).toHaveText(['Leady', 'Statystyki', 'Polisy', 'Klienci', /^Niedokończone\d*$/, 'Oferty', 'Biblioteka OWU']);

  const ustawienia = page.locator('[data-ustawienia]');
  await expect(ustawienia).toHaveText('Ustawienia');
  await expect(ustawienia).toHaveAttribute('href', '/panel/logi');
  // Następny element po „Ustawieniach" to blok z nazwą konta, rolą i wersją.
  const obok = ustawienia.locator('xpath=following-sibling::*[1]');
  await expect(obok).toContainText('Centrala');
  await expect(obok).toContainText(/admin · v\.0\.\d+/);
  await expect(ustawienia).not.toHaveAttribute('aria-current', 'page');
});

test('„Ustawienia" podświetlone na każdej z trzech stron; agent też je ma (Wysyłki)', async ({ page, request }) => {
  for (const s of ['/panel/logi', '/panel/admin', '/panel/admin/podglad-oferty', '/panel/ustawienia']) {
    await wczytaj(page, request, `/__test/ssr-uklad?rola=admin&sciezka=${encodeURIComponent(s)}`);
    await expect(page.locator('[data-ustawienia]'), s).toHaveAttribute('aria-current', 'page');
  }
  await wczytaj(page, request, '/__test/ssr-uklad?sciezka=/panel/logi');
  await expect(page.locator('[data-ustawienia]')).toHaveAttribute('href', '/panel/logi');
  await expect(page.locator('[data-ustawienia]')).toHaveAttribute('aria-current', 'page');
});

test('pasek sekcji: administrator — trzy sekcje z bieżącą zaznaczoną; agent — bez paska (ma tylko Wysyłki)', async ({ page, request }) => {
  await wczytaj(page, request, '/__test/ssr-ustawienia-nav?rola=admin&sciezka=/panel/admin');
  const nav = page.getByRole('navigation', { name: 'Ustawienia' });
  await expect(nav.locator('a')).toHaveText(['Wysyłki', 'Panel Admina', 'Ustawienia systemu']);
  expect(await nav.locator('a').evaluateAll((a) => a.map((x) => x.getAttribute('href'))))
    .toEqual(['/panel/logi', '/panel/admin', '/panel/ustawienia']);
  await expect(nav.getByRole('link', { name: 'Panel Admina' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Wysyłki' })).not.toHaveAttribute('aria-current', 'page');

  await wczytaj(page, request, '/__test/ssr-ustawienia-nav?sciezka=/panel/logi');
  await expect(page.locator('[data-ustawienia-nav]')).toHaveCount(0);
});
