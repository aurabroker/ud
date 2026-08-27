import { test, expect } from '@playwright/test';

/**
 * Zgody na cookies.
 *
 * Ten plik istnieje, bo w starym serwisie baner zgód był atrapą: Meta Pixel,
 * GA4 i Google Ads startowały bezwarunkowo w <head>, a baner gatował zupełnie
 * inną właściwość GA4 i był wpięty na dwóch z sześciu stron. Na formularzu
 * z ankietą medyczną banera nie było wcale. Nie da się tego pilnować okiem —
 * trzeba patrzeć na ruch sieciowy.
 */

/** Żądania do zewnętrznej analityki, wychwycone na poziomie sieci. */
function nasluchuj(strona) {
  const trafienia = [];
  strona.on('request', (r) => {
    const u = r.url();
    if (/googletagmanager\.com|google-analytics\.com|analytics\.google\.com|facebook\.(net|com)|doubleclick\.net|googleadservices\.com/.test(u)) {
      trafienia.push(u);
    }
  });
  return trafienia;
}

const baner = (s) => s.locator('#ud-zgody');

test('przed decyzją nie leci żadne żądanie do Google ani Meta', async ({ page }) => {
  const ruch = nasluchuj(page);
  await page.goto('/');
  await expect(baner(page)).toBeVisible();
  await page.waitForTimeout(600);
  expect(ruch, `wyciek przed zgodą:\n${ruch.join('\n')}`).toHaveLength(0);
});

test('odrzucenie jest jednym kliknięciem, tak samo jak akceptacja', async ({ page }) => {
  await page.goto('/');
  const nie = page.getByRole('button', { name: 'Odrzucam wszystkie' });
  const tak = page.getByRole('button', { name: 'Akceptuję wszystkie' });
  await expect(nie).toBeVisible();
  await expect(tak).toBeVisible();

  // Oba przyciski mają być tak samo czytelne — brak tego jest najczęstszym
  // powodem kar za bannery cookie, a różnicę widać w wysokości i rozmiarze pisma.
  const pudloNie = await nie.boundingBox();
  const pudloTak = await tak.boundingBox();
  expect(Math.abs(pudloNie.height - pudloTak.height)).toBeLessThan(2);
  const fontNie = await nie.evaluate((e) => getComputedStyle(e).fontSize);
  const fontTak = await tak.evaluate((e) => getComputedStyle(e).fontSize);
  expect(fontNie).toBe(fontTak);
});

test('po odrzuceniu nadal nic nie leci, a decyzja przeżywa przeładowanie', async ({ page }) => {
  const ruch = nasluchuj(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Odrzucam wszystkie' }).click();
  await expect(baner(page)).toHaveCount(0);

  await page.goto('/kalkulator/');
  await expect(baner(page)).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(ruch, `wyciek po odmowie:\n${ruch.join('\n')}`).toHaveLength(0);

  const stan = await page.evaluate(() => window.UDCookies.stan());
  expect(stan).toMatchObject({ analityka: false, marketing: false });
});

test('po akceptacji tagi startują', async ({ page }) => {
  const ruch = nasluchuj(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Akceptuję wszystkie' }).click();
  await page.waitForTimeout(1200);
  expect(ruch.some((u) => u.includes('googletagmanager.com')), 'brak Google').toBe(true);
  expect(ruch.some((u) => u.includes('facebook.net')), 'brak Meta Pixel').toBe(true);
});

test('Pixel nie startuje na wniosku z ankietą medyczną, Google tak', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Akceptuję wszystkie' }).click();

  const ruch = nasluchuj(page);
  await page.goto('/wniosek/');
  await page.waitForTimeout(1200);

  expect(ruch.some((u) => /facebook\.(net|com)/.test(u)),
    `Pixel odpalił na stronie z danymi o zdrowiu:\n${ruch.join('\n')}`).toBe(false);
  expect(ruch.some((u) => u.includes('googletagmanager.com')), 'Google powinno działać').toBe(true);
});

test('ustawienia pozwalają wpuścić samą analitykę', async ({ page }) => {
  const ruch = nasluchuj(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await page.locator('[data-zgoda="analityka"]').check();
  await page.getByRole('button', { name: 'Zapisz wybrane' }).click();
  await page.waitForTimeout(1200);

  const stan = await page.evaluate(() => window.UDCookies.stan());
  expect(stan).toMatchObject({ analityka: true, marketing: false });
  expect(ruch.some((u) => u.includes('googletagmanager.com')), 'brak GA4').toBe(true);
  expect(ruch.some((u) => /facebook\.(net|com)/.test(u)), 'Pixel bez zgody na marketing').toBe(false);
});

test('domyślne odmowy Consent Mode trafiają do dataLayer przed tagami', async ({ page }) => {
  await page.goto('/');
  const domyslne = await page.evaluate(() =>
    (window.dataLayer ?? []).map((a) => Array.from(a)).find((a) => a[0] === 'consent' && a[1] === 'default'));

  expect(domyslne, 'brak gtag("consent","default")').toBeTruthy();
  expect(domyslne[2]).toMatchObject({
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });
});

test('polityka cookies otwiera panel zgód, a nie alert', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Odrzucam wszystkie' }).click();

  let byloAlert = false;
  page.on('dialog', async (d) => { byloAlert = true; await d.dismiss(); });

  await page.goto('/polityka-cookies/');
  await page.getByRole('button', { name: 'Zmień preferencje cookies' }).click();
  await expect(baner(page)).toBeVisible();
  await expect(page.locator('[data-zgoda="analityka"]')).toBeVisible();
  expect(byloAlert, 'przycisk pokazał alert zamiast panelu').toBe(false);
});

test('modal awarii jest dostępny na każdej stronie', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => typeof window.Awaria?.pokaz)).toBe('function');
  await page.evaluate(() => window.Awaria.pokaz({ kod: 'TEST' }));
  const modal = page.locator('#ud-awaria');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('504 400 901');
  // Modal awarii musi leżeć nad banerem zgód — inaczej zasłania go komunikat
  // o cookies akurat w momencie, gdy coś się psuje.
  const [zAwaria, zZgody] = await page.evaluate(() => [
    Number(getComputedStyle(document.getElementById('ud-awaria')).zIndex),
    Number(getComputedStyle(document.getElementById('ud-zgody')).zIndex),
  ]);
  expect(zAwaria).toBeGreaterThan(zZgody);
});

test('konwersja Ads na podziękowaniu czeka na zgodę na marketing', async ({ page }) => {
  // Bez zgody: żadnego zdarzenia konwersji.
  await page.goto('/podziekowanie/');
  await page.getByRole('button', { name: 'Odrzucam wszystkie' }).click();
  await page.waitForTimeout(400);
  let konwersje = await page.evaluate(() =>
    (window.dataLayer ?? []).map((a) => Array.from(a)).filter((a) => a[1] === 'conversion'));
  expect(konwersje, 'konwersja poleciała mimo odmowy').toHaveLength(0);

  // Po akceptacji: dokładnie jedno zdarzenie.
  await page.evaluate(() => localStorage.clear());
  await page.goto('/podziekowanie/');
  await page.getByRole('button', { name: 'Akceptuję wszystkie' }).click();
  await page.waitForTimeout(600);
  konwersje = await page.evaluate(() =>
    (window.dataLayer ?? []).map((a) => Array.from(a)).filter((a) => a[1] === 'conversion'));
  expect(konwersje, 'brak konwersji po zgodzie').toHaveLength(1);
  expect(konwersje[0][2].send_to).toContain('AW-18020137303/');
});
