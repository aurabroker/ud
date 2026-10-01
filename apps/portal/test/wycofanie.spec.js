import { test, expect } from '@playwright/test';

/**
 * Strona wycofania zgody na kontakt (/wycofaj-zgode/), na którą prowadzi link
 * z maila przypominającego. Wycofanie ma być tak łatwe jak udzielenie zgody
 * (art. 7 ust. 3 RODO): jedno kliknięcie w mailu i po sprawie.
 */

const ID = '11111111-1111-4111-8111-111111111111';
const SIG = 'a'.repeat(64);

async function przechwyc(page, odpowiedz) {
  const zapytania = [];
  await page.route('**/functions/v1/wniosek-szkic', async (route) => {
    zapytania.push({ metoda: route.request().method(), cialo: route.request().postDataJSON() });
    await route.fulfill(odpowiedz);
  });
  return zapytania;
}

test('link z maila wycofuje zgodę od razu i usuwa identyfikator z paska adresu', async ({ page }) => {
  const zapytania = await przechwyc(page, { status: 200, contentType: 'application/json', body: '{"status":"success"}' });
  await page.goto(`/wycofaj-zgode/#id=${ID}&sig=${SIG}`);

  await expect(page.getByText('Zgoda wycofana.')).toBeVisible();
  expect(zapytania).toEqual([{ metoda: 'POST', cialo: { akcja: 'wycofaj', id: ID, sig: SIG } }]);

  // Identyfikator szkicu wskazuje wiersz z danymi osoby — nie ma zostać w historii
  // przeglądarki ani w adresie, który ktoś mógłby skopiować czy wysłać dalej.
  const adres = new URL(page.url());
  expect(adres.hash).toBe('');
  expect(adres.search).toBe('');
});

test('identyfikator i podpis idą we fragmencie, więc nie ma ich w żądaniu o stronę', async ({ page }) => {
  const adresy = [];
  page.on('request', (r) => adresy.push(r.url()));
  await przechwyc(page, { status: 200, contentType: 'application/json', body: '{"status":"success"}' });
  await page.goto(`/wycofaj-zgode/#id=${ID}&sig=${SIG}`);
  await expect(page.getByText('Zgoda wycofana.')).toBeVisible();

  // Fragment nie opuszcza przeglądarki: żadne żądanie o zasób nie niesie id ani podpisu w adresie.
  expect(adresy.filter((u) => u.includes(ID) || u.includes(SIG))).toEqual([]);
});

test('link bez identyfikatora: komunikat, żadnego żądania', async ({ page }) => {
  const zapytania = await przechwyc(page, { status: 200, contentType: 'application/json', body: '{"status":"success"}' });
  await page.goto('/wycofaj-zgode/');

  await expect(page.getByText('Ten link jest niepełny.')).toBeVisible();
  expect(zapytania).toHaveLength(0);
});

test('błąd funkcji: człowiek dostaje telefon i adres, żeby wycofać zgodę ręcznie', async ({ page }) => {
  await przechwyc(page, { status: 403, contentType: 'application/json', body: '{"status":"error"}' });
  await page.goto(`/wycofaj-zgode/#id=${ID}&sig=${SIG}`);

  await expect(page.getByText('Nie udało się wycofać zgody.')).toBeVisible();
  await expect(page.locator('#wynik').getByRole('link', { name: 'info@utratadochodu.pl' })).toBeVisible();
  await expect(page.locator('#wynik').getByRole('link', { name: /504 400 901/ })).toBeVisible();
});

test('strona jest noindex, poza mapą strony i bez Pixela', async ({ page, request }) => {
  await page.goto('/wycofaj-zgode/');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const mapa = await request.get('/sitemap-0.xml');
  expect(await mapa.text()).not.toContain('wycofaj-zgode');
});
