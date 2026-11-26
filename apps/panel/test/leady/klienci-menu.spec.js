/**
 * Zakładka „Klienci" w przeglądarce (decyzja właściciela z 20.11.2026: „dodaj
 * menu do lewego przycisku myszy"): menu klienta na lewy klik w wiersz, na
 * prawy klik i na przycisk „⋯", telefon pod nazwiskiem, szukanie po stanie
 * oferty, szerokość telefonu. Prawdziwa strona (+page.svelte) z danymi z tej
 * samej funkcji co jej load — harness test/leady/klienci.html.
 */
import { test, expect } from '@playwright/test';
import { adres, reset, sql } from './pomocnicy.js';

test.beforeEach(async ({ page, request }) => {
  await reset(request);
  // Odnośniki z menu i z listy prowadzą do tras panelu, których w harnessie nie ma.
  await page.route(/\/panel\/(klienci\/[0-9a-f-]{36}|new|leady)(\?|$)/, (r) =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>cel</title><h1>cel nawigacji</h1>' }));
});

async function otworzKlientow(page, { u = 'adm', zapytanie = '' } = {}) {
  await page.goto(`${adres()}/test/leady/klienci.html?u=${u}${zapytanie ? `&${zapytanie}` : ''}`);
  await page.waitForSelector('html[data-gotowe]');
}
const wiersz = (page, nazwa) => page.locator('tbody tr', { has: page.locator('.nazwa-klienta', { hasText: nazwa }) });
const menu = (page) => page.locator('[data-menu][data-menu-typ="klient"]');
const pozycje = (page) => menu(page).getByRole('menuitem');
const przycisk = (page, nazwa) => wiersz(page, nazwa).locator('button[data-menu-klienta]');
const idKlienta = (request, nazwa) => sql(request, `select id from public.ud_clients where full_name = '${nazwa}'`);
const PELNE = ['Otwórz kartę klienta', 'Utwórz ofertę', 'Pokaż na tablicy', 'Zadzwoń: 500100200', 'Napisz e-mail: anna@x.pl', 'Kopiuj telefon'];

/** Śledzi, czy ostatnie `contextmenu` zostało przejęte (preventDefault) — natywne menu przeglądarki tego nie pokazuje. */
async function sledzKontekst(page) {
  await page.evaluate(() => {
    window.__kontekst = [];
    window.addEventListener('contextmenu', (e) => window.__kontekst.push(e.defaultPrevented));
  });
}
const ostatniKontekst = (page) => page.evaluate(() => window.__kontekst.at(-1));

test('lewy klik w wiersz otwiera menu w miejscu kursora; nazwisko prowadzi prosto do karty', async ({ page, request }) => {
  await otworzKlientow(page);
  const anna = await idKlienta(request, 'Anna Kowalska');
  const lead = await sql(request, `select tt.lead('Anna Kowalska')`);

  const komorka = wiersz(page, 'Anna Kowalska').locator('td').nth(4);       // „Przypisany do" — poza plakietką
  const b = await komorka.boundingBox();
  const punkt = { x: b.x + b.width - 6, y: b.y + b.height / 2 };
  await page.mouse.click(punkt.x, punkt.y);

  await expect(menu(page)).toBeVisible();
  await expect(menu(page)).toHaveAttribute('role', 'menu');
  await expect(menu(page)).toHaveAttribute('aria-label', 'Anna Kowalska');
  await expect(pozycje(page)).toHaveText(PELNE);
  await expect(menu(page).locator('[role="separator"]')).toHaveCount(1);
  await expect(menu(page).locator('[data-akcja="karta"]')).toHaveAttribute('href', `/panel/klienci/${anna}`);
  await expect(menu(page).locator('[data-akcja="oferta"]')).toHaveAttribute('href', `/panel/new?client=${anna}`);
  await expect(menu(page).locator('[data-akcja="tablica"]')).toHaveAttribute('href', `/panel/leady?lead=${lead}`);
  await expect(menu(page).locator('[data-akcja="zadzwon"]')).toHaveAttribute('href', 'tel:500100200');
  await expect(menu(page).locator('[data-akcja="email"]')).toHaveAttribute('href', 'mailto:anna@x.pl');
  // W miejscu kursora (a przy krawędzi — po drugiej stronie kursora).
  const m = await menu(page).boundingBox();
  expect(Math.min(Math.abs(m.x - punkt.x), Math.abs(m.x + m.width - punkt.x))).toBeLessThan(2);
  expect(Math.min(Math.abs(m.y - punkt.y), Math.abs(m.y + m.height - punkt.y))).toBeLessThan(2);
  await expect(przycisk(page, 'Anna Kowalska')).toHaveAttribute('aria-expanded', 'true');

  // Klik poza menu zamyka.
  await page.getByRole('heading', { name: 'Klienci' }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(przycisk(page, 'Anna Kowalska')).toHaveAttribute('aria-expanded', 'false');

  // Klik w plakietkę etapu (odnośnik) i w nazwisko — bez menu, prosto pod adres.
  await wiersz(page, 'Anna Kowalska').locator('.nazwa-klienta').click();
  await page.waitForURL(`**/panel/klienci/${anna}`);
  await expect(page.getByRole('heading', { name: 'cel nawigacji' })).toBeVisible();
});

test('drugi klik w „⋯" zamyka menu; klik w inny wiersz przenosi menu do niego', async ({ page }) => {
  await otworzKlientow(page);
  await przycisk(page, 'Anna Kowalska').click();
  await expect(menu(page)).toHaveAttribute('aria-label', 'Anna Kowalska');
  await przycisk(page, 'Anna Kowalska').click();
  await expect(menu(page)).toHaveCount(0);
  await przycisk(page, 'Anna Kowalska').click();
  await wiersz(page, 'Bartek Nowak').locator('td[data-swiadczenie]').click();
  await expect(menu(page)).toHaveAttribute('aria-label', 'Bartek Nowak');
  await expect(menu(page)).toHaveCount(1);
});

test('prawy klik otwiera to samo menu; Shift + prawy klik i prawy klik na odnośniku zostają natywne; Esc oddaje fokus „⋯"', async ({ page }) => {
  await otworzKlientow(page);
  await sledzKontekst(page);

  await wiersz(page, 'Anna Kowalska').locator('td').last().click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  await expect(pozycje(page)).toHaveText(PELNE);
  expect(await ostatniKontekst(page)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(przycisk(page, 'Anna Kowalska')).toBeFocused();

  // Shift + prawy klik — menu przeglądarki, nie nasze.
  await wiersz(page, 'Anna Kowalska').locator('td').last().click({ button: 'right', modifiers: ['Shift'] });
  await expect(menu(page)).toHaveCount(0);
  expect(await ostatniKontekst(page)).toBe(false);
  // Prawy klik na nazwisku (odnośnik: „Otwórz w nowej karcie") — natywne.
  await wiersz(page, 'Anna Kowalska').locator('.nazwa-klienta').click({ button: 'right' });
  await expect(menu(page)).toHaveCount(0);
  expect(await ostatniKontekst(page)).toBe(false);
});

test('zaznaczanie tekstu w wierszu i dwuklik nie otwierają menu', async ({ page }) => {
  await otworzKlientow(page);
  const kwota = wiersz(page, 'Celina Zielińska').locator('td[data-swiadczenie]');
  const b = await kwota.boundingBox();
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  expect((await page.evaluate(() => window.getSelection().toString())).trim()).not.toBe('');
  await expect(menu(page)).toHaveCount(0);

  await page.evaluate(() => window.getSelection().removeAllRanges());
  await kwota.dblclick();
  await expect(menu(page)).toHaveCount(0);
});

test('„⋯" z klawiatury: Enter otwiera, strzałki/Home/End, Esc wraca na przycisk, Enter na pozycji idzie pod adres z filtrem listy', async ({ page, request }) => {
  await otworzKlientow(page, { zapytanie: 'zrodlo=brak' });      // Anna nie ma źródła → „Brak danych"
  const anna = await idKlienta(request, 'Anna Kowalska');
  const ust = przycisk(page, 'Anna Kowalska');
  await ust.focus();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await expect(ust).toHaveAttribute('aria-expanded', 'true');
  await expect(pozycje(page).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(pozycje(page).nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(pozycje(page).last()).toHaveText('Kopiuj telefon');
  await expect(pozycje(page).last()).toBeFocused();
  await page.keyboard.press('ArrowDown');                         // zawija na początek
  await expect(pozycje(page).first()).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await expect(pozycje(page).first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(ust).toBeFocused();
  await expect(ust).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await expect(menu(page).locator('[data-akcja="karta"]')).toHaveAttribute('href', `/panel/klienci/${anna}?zrodlo=brak`);
  await page.keyboard.press('Enter');                              // „Otwórz kartę klienta"
  await page.waitForURL(`**/panel/klienci/${anna}?zrodlo=brak`);
});

test('„Kopiuj telefon": numer w schowku i krótkie potwierdzenie; pozycji bez danych nie ma', async ({ page, request }) => {
  await sql(request, `update public.ud_clients set phone = null, email = null where full_name = 'Ewa Mazur';
    update public.ud_clients set email = 'bez-malpy' where full_name = 'Bartek Nowak';
    update public.ud_leady set zarchiwizowano_at = now() where id = tt.lead('Grażyna Pawlak');`);
  await otworzKlientow(page);

  // Region na żywo jest w drzewie dostępności, ZANIM dostanie tekst — inaczej czytnik
  // ekranu może przemilczeć komunikat (region i tekst pojawiałyby się naraz).
  const region = page.locator('[data-ogloszenie]');
  await expect(region).toHaveCount(1);
  await expect(region).toHaveText('');
  await expect(region).toHaveAttribute('role', 'status');
  const [display, visibility] = await region.evaluate((el) => [getComputedStyle(el).display, getComputedStyle(el).visibility]);
  expect(display).not.toBe('none');
  expect(visibility).toBe('visible');
  expect(await page.getByRole('status').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-ogloszenie-widok]')).toHaveCount(0);

  await przycisk(page, 'Anna Kowalska').click();
  await menu(page).getByRole('menuitem', { name: 'Kopiuj telefon' }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(region).toHaveText('Skopiowano telefon: 500100200');
  await expect(region).toHaveAttribute('role', 'status');
  // Dymek dla oczu: widoczny, ten sam tekst, czytnik go pomija (nie przeczyta dwa razy).
  await expect(page.locator('[data-ogloszenie-widok]')).toBeVisible();
  await expect(page.locator('[data-ogloszenie-widok]')).toHaveText('Skopiowano telefon: 500100200');
  await expect(page.locator('[data-ogloszenie-widok]')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('500100200');
  await expect(przycisk(page, 'Anna Kowalska')).toBeFocused();

  // Bez telefonu i e-maila — tylko karta, oferta, tablica.
  await przycisk(page, 'Ewa Mazur').click();
  await expect(pozycje(page)).toHaveText(['Otwórz kartę klienta', 'Utwórz ofertę', 'Pokaż na tablicy']);
  await page.keyboard.press('Escape');
  // Napis, który nie jest adresem e-mail, nie robi się odnośnikiem mailto:.
  await przycisk(page, 'Bartek Nowak').click();
  await expect(menu(page).locator('[data-akcja="email"]')).toHaveCount(0);
  await expect(menu(page).locator('[data-akcja="zadzwon"]')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Zarchiwizowany lead nie stoi na tablicy — „Pokaż na tablicy" znika; karta niesie widok Archiwum.
  await otworzKlientow(page, { zapytanie: 'widok=archiwum' });
  await przycisk(page, 'Grażyna Pawlak').click();
  await expect(menu(page).locator('[data-akcja="tablica"]')).toHaveCount(0);
  await expect(menu(page).locator('[data-akcja="karta"]')).toHaveAttribute('href', /\?widok=archiwum$/);
});

test('„Zadzwoń" i „Napisz e-mail" (tel:, mailto:) nie zabierają ze strony — fokus wraca do „⋯", nie na <body>', async ({ page }) => {
  await otworzKlientow(page);
  // Przeglądarka testowa nie ma aplikacji do tel: i mailto:. Próba jej uruchomienia
  // zabiera oknu fokus z opóźnieniem (blur), a blur zamyka NASTĘPNE otwarte menu —
  // artefakt testu. Domyślne przejście blokujemy; obsługa kliknięcia w menu działa
  // bez zmian (to ona oddaje fokus), więc bez poprawki fokus i tak spada na <body>.
  await page.evaluate(() => window.addEventListener('click', (e) => {
    if (e.target?.closest?.('a[href^="tel:"], a[href^="mailto:"]')) e.preventDefault();
  }, true));
  const url = page.url();
  for (const nazwa of [/^Zadzwoń: 500100200$/, /^Napisz e-mail: anna@x\.pl$/]) {
    // Klawiatura: „⋯", Enter, pozycja, Enter.
    await przycisk(page, 'Anna Kowalska').focus();
    await page.keyboard.press('Enter');
    await menu(page).getByRole('menuitem', { name: nazwa }).focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveCount(0);
    expect(page.url()).toBe(url);
    await expect(przycisk(page, 'Anna Kowalska'), String(nazwa)).toBeFocused();
    // Mysz: to samo, a kolejny klik w „⋯" znowu otwiera menu (nie łapie się na „drugi klik zamyka").
    await przycisk(page, 'Anna Kowalska').click();
    await menu(page).getByRole('menuitem', { name: nazwa }).click();
    await expect(menu(page)).toHaveCount(0);
    await expect(przycisk(page, 'Anna Kowalska'), String(nazwa)).toBeFocused();
    await przycisk(page, 'Anna Kowalska').click();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('telefon stoi pod nazwiskiem; szukanie obejmuje stan oferty', async ({ page, request }) => {
  await sql(request, `insert into public.ud_offers (client_id, user_id, status, sent_at, viewed_at, wersja) values
    ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000a2', 'sent', '2026-11-15 12:00+01', null, 1),
    ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2', 'viewed', '2026-11-10 12:00+01', '2026-11-12 12:00+01', 1),
    -- Celina: wersja 2 nieotwarta, poprzednia otwarta 11.11 — linijka zawiera słowo „otwarta".
    ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000a3', 'sent', '2026-11-16 12:00+01', '2026-11-11 12:00+01', 2);`);
  await otworzKlientow(page);

  const nazwa = await wiersz(page, 'Anna Kowalska').locator('.nazwa-klienta').boundingBox();
  const numer = await wiersz(page, 'Anna Kowalska').locator('[data-telefon]').boundingBox();
  expect(numer.y).toBeGreaterThanOrEqual(nazwa.y + nazwa.height - 1);
  expect(Math.abs(numer.x - nazwa.x)).toBeLessThan(2);

  const nazwiska = async () => (await page.locator('tbody tr .nazwa-klienta').allInnerTexts()).sort();
  await page.getByPlaceholder('Szukaj: nazwisko, email, telefon, akcja…').fill('nieotwarta');
  await expect.poll(nazwiska).toEqual(['Bartek Nowak', 'Celina Zielińska']);
  // „otwarta" = stan oferty, nie fragment tekstu: bez „nieotwarta" i bez „poprzednia wersja otwarta".
  await page.getByPlaceholder('Szukaj: nazwisko, email, telefon, akcja…').fill(' Otwarta ');
  await expect.poll(nazwiska).toEqual(['Anna Kowalska', 'Jerzy Duda']);   // Jerzy — oferta z fixture
  await expect(wiersz(page, 'Celina Zielińska').locator('[data-oferta]')).toHaveCount(0);
  await page.getByPlaceholder('Szukaj: nazwisko, email, telefon, akcja…').fill('otwarta 12.11');
  await expect(page.locator('tbody tr .nazwa-klienta')).toHaveText(['Anna Kowalska']);
  // E-mail nie stoi w tabeli, ale da się po nim szukać.
  await page.getByPlaceholder('Szukaj: nazwisko, email, telefon, akcja…').fill('celina@x.pl');
  await expect(page.locator('tbody tr .nazwa-klienta')).toHaveText(['Celina Zielińska']);
});

test('390 px: strona nie przewija się w poziomie, „⋯" widać, menu z klawiatury i z kliknięcia mieści się w oknie', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await otworzKlientow(page);
  const okno = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(okno.w);

  const wewnatrz = async () => {
    const m = await menu(page).boundingBox();
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(okno.w);
    expect(m.y + m.height).toBeLessThanOrEqual(okno.h);
  };

  // „⋯" w pierwszej komórce — widoczny bez przewijania tabeli.
  const ust = przycisk(page, 'Karolina Mróz');
  await expect(ust).toBeInViewport();
  await ust.focus();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await wewnatrz();
  await page.keyboard.press('Escape');

  // Kliknięcie przy prawej krawędzi okna: menu otwiera się w lewo od kursora.
  const komorka = wiersz(page, 'Karolina Mróz').locator('td[data-swiadczenie]');
  const b = await komorka.boundingBox();
  const x = Math.min(b.x + b.width - 3, okno.w - 6);
  await page.mouse.click(x, b.y + b.height / 2);
  await expect(menu(page)).toBeVisible();
  await wewnatrz();
  await page.keyboard.press('Escape');

  // Wiersz przy dolnej krawędzi: menu otwiera się w górę.
  const ostatni = page.locator('tbody tr').last();
  await ostatni.scrollIntoViewIfNeeded();
  const d = await ostatni.locator('td[data-swiadczenie]').boundingBox();
  await page.waitForTimeout(250);                                   // menu zamyka się na przewinięcie — niech minie
  await page.mouse.click(d.x + 4, Math.min(d.y + d.height / 2, okno.h - 4), { button: 'right' });
  await expect(menu(page)).toBeVisible();
  await wewnatrz();
});
