/**
 * Menu kontekstowe i klawiatura: K14–K19, K24 (wytyczne „Kanban CRM", sekcja 3).
 *
 * K24 sprawdza gałąź ze zdarzeniem `contextmenu` + Shift. Przeglądarka z tego
 * środowiska to Chromium; w Firefoksie Shift + prawy klik zwykle w ogóle nie
 * wysyła tego zdarzenia (patrz MDN) — wtedy aplikacja nie ma nic do obsłużenia,
 * więc działa tak samo, ale tego wariantu nie uruchomiono na Firefoksie.
 */
import { test, expect } from '@playwright/test';
import { karta, kolumna, otworz, reset, sql, zwiniety } from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

/** Zapisuje, czy aplikacja zablokowała natywne menu (stan po wszystkich handlerach). */
async function nasluchujMenu(page) {
  await page.evaluate(() => {
    window.__cm = [];
    window.addEventListener('contextmenu', (e) => window.__cm.push(e.defaultPrevented));
  });
}
const ostatnieZablokowane = (page) => page.evaluate(() => window.__cm.at(-1));
const menu = (page) => page.locator('[data-menu]');

test('K14: prawy klik na karcie otwiera menu właściwego leada; kolejny prawy klik — innego, bez skutków na poprzednim', async ({ page, request }) => {
  await otworz(page);
  await nasluchujMenu(page);
  await karta(page, 'Anna Kowalska').locator('.kontekst').click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Anna Kowalska' })).toBeVisible();
  expect(await ostatnieZablokowane(page)).toBe(true);
  const pozycje = await page.getByRole('menuitem').allInnerTexts();
  expect(pozycje.map((p) => p.split('\n')[0])).toEqual([
    'Otwórz szczegóły', 'Przenieś do…', 'Zaplanuj działanie…', 'Dodaj notatkę…', 'Zmień opiekuna…',
    'Zadzwoń: 500100200', 'Kopiuj link do leada', 'Archiwizuj…',
  ]);
  // Nie ma szybkich akcji „Usuń" ani „Duplikuj" (poza MVP).
  expect(pozycje.join('|')).not.toMatch(/usuń|duplik/i);

  // Inna kolumna — pierwsze menu jej nie przykrywa.
  await karta(page, 'Henryk Sikora').locator('.kontekst').click({ button: 'right' });
  await expect(menu(page)).toHaveCount(1);
  await expect(page.getByRole('menu', { name: 'Henryk Sikora' })).toBeVisible();

  await page.getByRole('menuitem', { name: 'Dodaj notatkę…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dodaj notatkę' });
  await expect(dialog).toContainText('Henryk Sikora');
  await dialog.getByLabel('Notatka').fill('Zadzwonić po 16');
  await dialog.getByRole('button', { name: 'Dodaj notatkę' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await sql(request, `select count(*) from public.ud_leady_notatki where lead_id = tt.lead('Henryk Sikora')`)).toBe('1');
  expect(await sql(request, `select count(*) from public.ud_leady_notatki where lead_id = tt.lead('Anna Kowalska')`)).toBe('0');
});

test('K15: prawy klik na nagłówku kolumny i na zwiniętym etapie otwiera menu etapu', async ({ page }) => {
  await otworz(page);
  await nasluchujMenu(page);
  await kolumna(page, 'nowy').locator('[data-naglowek-etapu]').click({ button: 'right', position: { x: 60, y: 14 } });
  await expect(page.getByRole('menu', { name: 'Etap: Nowy' })).toBeVisible();
  const pozycje = (await page.getByRole('menuitem').allInnerTexts()).map((p) => p.split('\n')[0]);
  expect(pozycje).toEqual(['Dodaj lead (nowy klient)', 'Zwiń etap', 'Sortowanie…']);
  expect(pozycje.join('|')).not.toMatch(/usuń etap|przenieś wszystkie/i);
  expect(await ostatnieZablokowane(page)).toBe(true);

  await page.getByRole('menuitem', { name: 'Zwiń etap' }).click();
  await expect(kolumna(page, 'nowy')).toHaveCount(0);
  await zwiniety(page, 'Nowy').click({ button: 'right', position: { x: 40, y: 10 } });
  await expect(page.getByRole('menu', { name: 'Etap: Nowy' })).toBeVisible();
  expect((await page.getByRole('menuitem').allInnerTexts()).map((p) => p.split('\n')[0])).toEqual(['Dodaj lead (nowy klient)', 'Rozwiń etap', 'Sortowanie…']);
  await page.getByRole('menuitem', { name: 'Rozwiń etap', exact: true }).click();
  await expect(kolumna(page, 'nowy')).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
});

test('K16: prawy klik na linku, w polu tekstowym, na zaznaczonym tekście i na pustym obszarze zostawia natywne menu', async ({ page }) => {
  await otworz(page);
  await nasluchujMenu(page);

  await karta(page, 'Anna Kowalska').getByRole('link', { name: /Zadzwoń do Anna/ }).click({ button: 'right' });
  expect(await ostatnieZablokowane(page)).toBe(false);
  await expect(menu(page)).toHaveCount(0);

  // Zaznaczony tekst na karcie.
  const tekst = karta(page, 'Anna Kowalska').locator('.kontekst');
  await tekst.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await tekst.click({ button: 'right' });
  expect(await ostatnieZablokowane(page)).toBe(false);
  await expect(menu(page)).toHaveCount(0);
  await page.evaluate(() => getSelection().removeAllRanges());

  // Puste miejsce na tablicy (nagłówek strony): nikt tu nie przechwytuje menu.
  await page.locator('.pipeline').click({ button: 'right' });
  expect(await ostatnieZablokowane(page)).toBe(false);

  // Pole tekstowe w panelu szczegółów i pole wyszukiwania.
  await karta(page, 'Anna Kowalska').locator('.kontekst').click();
  await page.getByLabel('Nowa notatka').click({ button: 'right' });
  expect(await ostatnieZablokowane(page)).toBe(false);
  await page.getByLabel('Szukaj leada').click({ button: 'right' });
  expect(await ostatnieZablokowane(page)).toBe(false);
  await expect(menu(page)).toHaveCount(0);

  // A zwykły prawy klik na karcie nadal działa (nie wyłączyliśmy go globalnie).
  await karta(page, 'Anna Kowalska').locator('.kontekst').click({ button: 'right' });
  expect(await ostatnieZablokowane(page)).toBe(true);
  await expect(menu(page)).toBeVisible();
});

test('K17: menu mieści się w oknie — przy prawej i dolnej krawędzi zmienia kierunek otwarcia', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 520 });
  await otworz(page);
  const okno = page.viewportSize();

  // Prawa krawędź: karta w drugiej kolumnie, klik blisko jej prawego brzegu.
  const k = await karta(page, 'Henryk Sikora').boundingBox();
  const klik = { x: k.x + k.width - 12, y: k.y + 40 };
  await page.mouse.click(klik.x, klik.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  let m = await menu(page).boundingBox();
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(okno.width);
  expect(m.y + m.height).toBeLessThanOrEqual(okno.height);
  expect(m.x + m.width).toBeLessThanOrEqual(klik.x + 1);                 // otwarte w lewo od wskaźnika
  await page.keyboard.press('Escape');

  // Dolna krawędź: klik nisko na karcie w pierwszej kolumnie — menu wyżej niż wskaźnik.
  // Celujemy w opiekuna (zwykły tekst w dolnym wierszu), a nie w róg karty: tam
  // bywa link tel:, a na linkach zostaje natywne menu przeglądarki (K24).
  const a = await karta(page, 'Anna Kowalska').locator('.opiekun').boundingBox();
  const nisko = { x: a.x + Math.min(10, a.width / 2), y: Math.min(a.y + a.height / 2, okno.height - 12) };
  await page.mouse.click(nisko.x, nisko.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  m = await menu(page).boundingBox();
  expect(m.y).toBeGreaterThanOrEqual(0);
  expect(m.y + m.height).toBeLessThanOrEqual(okno.height);
  expect(m.y + m.height).toBeLessThanOrEqual(nisko.y + 1);               // otwarte w górę od wskaźnika
  await page.keyboard.press('Escape');

  // Menu wyższe niż okno: ograniczone i przewijane, wciąż w całości w oknie.
  await page.setViewportSize({ width: 480, height: 300 });
  await expect(page.locator('.etapy-mobilne')).toBeVisible();              // układ telefonu: jeden etap naraz
  // Klik przez lokator: Playwright czeka, aż układ ustabilizuje się po zmianie rozmiaru okna.
  await karta(page, 'Anna Kowalska').locator('.nazwa').click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  m = await menu(page).boundingBox();
  expect(m.y).toBeGreaterThanOrEqual(0);
  expect(m.y + m.height).toBeLessThanOrEqual(300);
  expect(await menu(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});

test('K18: Shift+F10 i klawisz menu na karcie otwierają menu bez myszy; Esc oddaje fokus', async ({ page }) => {
  await otworz(page);
  const otworzSzczegoly = karta(page, 'Anna Kowalska').getByRole('button', { name: /^Anna Kowalska/ });
  await otworzSzczegoly.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Anna Kowalska' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Otwórz szczegóły' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(otworzSzczegoly).toBeFocused();

  await page.keyboard.press('ContextMenu');
  await expect(page.getByRole('menu', { name: 'Anna Kowalska' })).toBeVisible();
  await page.keyboard.press('Escape');

  // To samo z fokusem na przycisku „…" i na nagłówku etapu.
  const trzy = karta(page, 'Celina Zielińska').getByRole('button', { name: 'Akcje leada Celina Zielińska' });
  await trzy.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Celina Zielińska' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trzy).toBeFocused();

  await kolumna(page, 'oferta').getByRole('button', { name: 'Akcje etapu Oferta' }).focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Etap: Oferta' })).toBeVisible();
});

test('K19: strzałki, Home/End, Enter, Esc, Tab — pełna obsługa i prawidłowy fokus', async ({ page }) => {
  await otworz(page);
  const przycisk = page.getByRole('button', { name: 'Akcje leada Celina Zielińska' });
  await przycisk.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'Celina Zielińska' })).toBeVisible();
  await expect(przycisk).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem', { name: 'Otwórz szczegóły' })).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Przenieś do…' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Dodaj notatkę…' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Zaplanuj działanie…' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Archiwizuj…' })).toBeFocused();
  await page.keyboard.press('ArrowDown');                                   // zawijanie
  await expect(page.getByRole('menuitem', { name: 'Otwórz szczegóły' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Archiwizuj…' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitem', { name: 'Otwórz szczegóły' })).toBeFocused();
  await page.keyboard.press('a');                                           // skok po pierwszej literze
  await expect(page.getByRole('menuitem', { name: 'Archiwizuj…' })).toBeFocused();

  // Pozycja zablokowana: widoczna, z przyczyną, nie wykonuje akcji.
  const opiekun = page.getByRole('menuitem', { name: 'Zmień opiekuna…' });
  await expect(opiekun).toHaveAttribute('aria-disabled', 'true');
  await expect(opiekun).toContainText('Zmienić go może administrator');           // przyczyna widoczna
  await expect(opiekun).toHaveAccessibleDescription(/Zmienić go może administrator/);   // i czytana jako opis
  await opiekun.click({ force: true });                                       // aria-disabled nie blokuje kliknięcia — akcja po prostu się nie wykonuje
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(menu(page)).toBeVisible();

  // Esc: zamknięcie i powrót fokusu do przycisku.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(przycisk).toBeFocused();
  await expect(przycisk).toHaveAttribute('aria-expanded', 'false');

  // Enter na pozycji otwierającej formularz: fokus w formularzu; Esc → powrót do przycisku.
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Dodaj notatkę…' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Dodaj notatkę' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Notatka')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(przycisk).toBeFocused();

  // Tab zamyka menu i nie więzi fokusu.
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(menu(page)).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-menu]')))).toBe(false);

  // Kliknięcie poza menu zamyka je.
  await przycisk.click();
  await expect(menu(page)).toBeVisible();
  await page.locator('.pipeline').click();
  await expect(menu(page)).toHaveCount(0);
});

test('K24: Shift + prawy klik zostawia natywne menu, a aplikacja działa dalej', async ({ page }) => {
  await otworz(page);
  await nasluchujMenu(page);
  await karta(page, 'Anna Kowalska').locator('.kontekst').click({ button: 'right', modifiers: ['Shift'] });
  expect(await ostatnieZablokowane(page)).toBe(false);
  await expect(menu(page)).toHaveCount(0);
  // Aplikacja nadal reaguje: własne menu przez „…" i zwykły prawy klik.
  await page.getByRole('button', { name: 'Akcje leada Anna Kowalska' }).click();
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await karta(page, 'Anna Kowalska').locator('.kontekst').click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
});

test('menu: przycisk „…" i prawy klik pokazują ten sam zestaw; menu znika z usuniętym rekordem', async ({ page, request }) => {
  await otworz(page);
  await page.getByRole('button', { name: 'Akcje leada Anna Kowalska' }).click();
  const przezPrzycisk = (await page.getByRole('menuitem').allInnerTexts()).map((p) => p.split('\n')[0]);
  await page.keyboard.press('Escape');
  await karta(page, 'Anna Kowalska').locator('.kontekst').click({ button: 'right' });
  const przezPrawyKlik = (await page.getByRole('menuitem').allInnerTexts()).map((p) => p.split('\n')[0]);
  expect(przezPrawyKlik).toEqual(przezPrzycisk);
  await page.keyboard.press('Escape');

  // Rekord znika spod menu (archiwizacja z innej sesji + odświeżenie) → menu się zamyka.
  await page.getByRole('button', { name: 'Akcje leada Anna Kowalska' }).click();
  await expect(menu(page)).toBeVisible();
  await sql(request, `update public.ud_leady set zarchiwizowano_at = now() where id = tt.lead('Anna Kowalska')`);
  await page.getByRole('button', { name: 'Odśwież' }).click({ force: true });
  await expect(karta(page, 'Anna Kowalska')).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);
});
