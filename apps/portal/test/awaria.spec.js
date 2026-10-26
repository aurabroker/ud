import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Okienko awarii (`public/awaria.js`) a kod wstrzyknięty przez przeglądarkę.
 *
 * 25.10.2026 klient z przeglądarki wbudowanej w Facebooka (iPhone, FBAN/FBIOS)
 * dostał okienko „coś poszło nie tak" z treścią „Can't find variable:
 * _AutofillCallbackHandler @ https://utratadochodu.pl/?fbclid=…:1". To nie był
 * nasz błąd: aplikacja wstrzykuje własny kod i woła funkcję, której na stronie
 * nie ma, a WebKit podaje wtedy jako plik adres strony i linię 1.
 */

const DIST = 'dist';
const modal = (page) => page.locator('#ud-awaria');

/** Wywołuje zdarzenie `error` tak, jak robi to przeglądarka po błędzie skryptu. */
const bladSkryptu = (page, { komunikat, plik, linia }) => page.evaluate(({ komunikat, plik, linia }) => {
  window.dispatchEvent(new ErrorEvent('error', {
    message: komunikat, filename: plik === 'strona' ? location.href : location.origin + plik, lineno: linia,
  }));
}, { komunikat, plik, linia });

test('błąd wstrzyknięty przez przeglądarkę Facebooka nie otwiera okienka awarii', async ({ page }) => {
  await page.goto('/?fbclid=IwZXh0bgNhZW0CMTEAAR0');
  // Dokładnie ten, który zgłosił klient — wywołany tak, jak robi to aplikacja:
  // skrypt dopisany do strony, bez własnego pliku.
  await page.addScriptTag({ content: '_AutofillCallbackHandler.zapamietaj({});' });
  await bladSkryptu(page, { komunikat: "ReferenceError: Can't find variable: _AutofillCallbackHandler", plik: 'strona', linia: 1 });
  await bladSkryptu(page, { komunikat: "TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers')", plik: 'strona', linia: 3 });
  await page.waitForTimeout(300);
  await expect(modal(page)).toHaveCount(0);
});

test('nieznany kod wstrzyknięty w linię 1 adresu strony też nie straszy', async ({ page }) => {
  await page.goto('/kalkulator/');
  await bladSkryptu(page, { komunikat: 'ReferenceError: noweNarzedzieAplikacji is not defined', plik: 'strona', linia: 1 });
  await page.waitForTimeout(300);
  await expect(modal(page)).toHaveCount(0);
});

test('błąd naszego skryptu dalej otwiera okienko awarii', async ({ page }) => {
  await page.goto('/');
  await bladSkryptu(page, { komunikat: 'TypeError: x is undefined', plik: '/_astro/Kalkulator.js', linia: 12 });
  await expect(modal(page)).toBeVisible();
  await expect(modal(page)).toContainText('Kod: SKRYPT');
});

test('błąd skryptu wpisanego w HTML (dalej niż linia 1) dalej otwiera okienko', async ({ page }) => {
  await page.goto('/');
  await bladSkryptu(page, { komunikat: 'ReferenceError: dataLayer is not defined', plik: 'strona', linia: 7 });
  await expect(modal(page)).toBeVisible();
});

test('w pierwszej linii żadnej zbudowanej strony nie ma skryptu', () => {
  // Na tym stoi reguła „adres strony + linia 1 = kod wstrzyknięty". Gdyby build
  // zaczął sklejać HTML w jedną linię, nasze własne błędy znikłyby po cichu.
  const strony = [];
  const szukaj = (katalog) => {
    for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
      const sciezka = join(katalog, wpis.name);
      if (wpis.isDirectory()) szukaj(sciezka);
      else if (wpis.name.endsWith('.html')) strony.push(sciezka);
    }
  };
  szukaj(DIST);
  expect(strony.length).toBeGreaterThan(100);
  const zSkryptem = strony.filter((s) => readFileSync(s, 'utf8').split('\n')[0].includes('<script'));
  expect(zSkryptem, `skrypt w pierwszej linii: ${zSkryptem.slice(0, 5).join(', ')}`).toEqual([]);
});
