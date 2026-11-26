import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Każdy formularz z Turnstile musi mieć na stronie skrypt Cloudflare'a.
 *
 * Opinia.svelte i SzybkiKontakt.svelte montują widżet przez window.turnstile,
 * którego bez api.js nie ma. Skrypt stał tylko na /wniosek/, więc /opinie/
 * i /pracuj-z-nami/ wysyłały pusty token, a review-submit i /wspolpraca
 * odpowiadały 400 — od przepięcia domeny 14.10.2026 do 21.10.2026 nie
 * wpłynęła żadna opinia ani zgłoszenie współpracy, bez śladu w ud_errors.
 */

const DIST = 'dist';
const SKRYPT = 'challenges.cloudflare.com/turnstile/v0/api.js';
const ATRAPA = 'window.turnstile={render:()=>"w1",getResponse:()=>"token-testowy",reset(){},remove(){}};'
  + 'window.onloadTurnstileCallback&&window.onloadTurnstileCallback();';

test('każda strona z wyspą przyjmującą kluczTurnstile ładuje skrypt Turnstile', () => {
  const strony = readdirSync(DIST, { recursive: true }).map(String).filter((p) => p.endsWith('index.html'));
  const zFormularzem = [];
  const bezSkryptu = [];
  for (const p of strony) {
    const html = readFileSync(join(DIST, p), 'utf8');
    // Wyspy Astro niosą propsy w atrybucie — klucz Turnstile jest tam jawnie.
    if (!/<astro-island[^>]*kluczTurnstile/.test(html)) continue;
    zFormularzem.push(p);
    if (!html.includes(SKRYPT)) bezSkryptu.push(p);
  }
  expect(zFormularzem.length, 'nie znaleziono żadnego formularza — zmienił się zapis propsów?').toBeGreaterThanOrEqual(3);
  expect(bezSkryptu).toEqual([]);
});

test('formularz współpracy wysyła token Turnstile do /wspolpraca', async ({ page }) => {
  let pobranoSkrypt = false;
  await page.route(`https://${SKRYPT}*`, (route) => {
    pobranoSkrypt = true;
    return route.fulfill({ contentType: 'application/javascript', body: ATRAPA });
  });
  let cialo = null;
  await page.route('**/wspolpraca', async (route) => {
    cialo = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
  });

  await page.goto('/pracuj-z-nami/');
  await page.fill('#k-imie', 'Jan Kowalski');
  await page.fill('#k-email', 'jan@example.com');
  await page.fill('#k-telefon', '600700800');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Wyślij zgłoszenie' }).click();

  await expect(page.getByRole('status')).toContainText('Zgłoszenie przyjęte');
  expect(pobranoSkrypt, 'strona nie wczytuje skryptu Turnstile').toBe(true);
  expect(cialo).toMatchObject({ 'cf-turnstile-response': 'token-testowy' });
});
