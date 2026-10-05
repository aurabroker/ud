/**
 * Decyzje właściciela z 04.10.2026:
 *  - „dodaj opcję dodawania polisy, nawet jeśli klient nie zgłosił się przez
 *    formularz" — okno „Dodaj polisę" na stronie Statystyk; odczyt PDF może
 *    wymagać hasła = 4 ostatnie cyfry PESEL-u;
 *  - „opłaty dystrybucyjnej nie doliczaj do składki";
 *  - prowizja = składka roczna × stawka agenta; agent widzi swoją.
 *
 * Strona i okno to prawdziwe komponenty w przeglądarce (test/leady/statystyki.html),
 * zapis idzie przez te same funkcje serwera i SQL co na produkcji. Czytnik PDF
 * rozpoznaje znaczniki w treści pliku (UD-TEST-KWOTY, UD-TEST-HASLO, UD-TEST-OPLATA).
 */
import { test, expect } from '@playwright/test';
import { adres, otworz, reset, sql } from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

const pdf = (znacznik, name = 'polisa.pdf') => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${znacznik}\n%%EOF\n`) });

async function statystyki(page, u = 'ula') {
  await page.goto(`${adres()}/test/leady/statystyki.html?u=${u}`);
  await page.waitForSelector('html[data-gotowe]');
}

async function otworzOkno(page) {
  await page.getByRole('button', { name: '+ Dodaj polisę' }).click();
  const okno = page.getByRole('dialog', { name: 'Dodaj polisę' });
  await expect(okno).toBeVisible();
  return okno;
}

test('agent: polisa zaszyfrowana PESEL-em — bez PESEL-u prośba o niego, po wpisaniu odczyt sam; zapis tworzy klienta, lead w Wygrany i plik', async ({ page, request }) => {
  await statystyki(page, 'ula');
  await expect(page.locator('[data-stat="sprzedaze"]')).toHaveText('1');       // Jerzy (fixture), bez kwot
  const okno = await otworzOkno(page);
  await expect(okno.getByLabel('Agent (sprzedawca)')).toHaveCount(0);   // agent dodaje tylko sobie

  await okno.locator('[data-plik-polisy]').setInputFiles(pdf('UD-TEST-HASLO', 'Polisa Nowaka.pdf'));
  await expect(okno.locator('[data-komunikat-polisy]')).toContainText('wpisz PESEL klienta');
  await expect(okno.getByLabel('Składka roczna *')).toHaveValue('');

  await okno.getByLabel('Imię i nazwisko *').fill('Marek  Nowakowski');
  await okno.getByLabel('PESEL').fill('70010102345');
  await expect(okno.locator('[data-komunikat-polisy]')).toContainText('sprawdź je przed zapisem');
  await expect(okno.getByLabel('Składka roczna *')).toHaveValue('1500');
  await expect(okno.getByLabel('Składka miesięczna')).toHaveValue('125');
  await okno.getByLabel('E-mail').fill('marek@x.pl');

  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(page.locator('[data-dodano]')).toContainText('Dodano sprzedaż: Marek Nowakowski (z polisą).');
  await expect(okno).toHaveCount(0);
  await expect(page.locator('[data-stat="sprzedaze"]')).toHaveText('2');    // strona przeładowała dane
  await expect(page.locator('[data-stat="roczna"]')).toHaveText(/^1[\s ]?500 zł$/);

  expect(await sql(request, `select c.full_name || '|' || c.source || '|' || c.pesel || '|' || c.email || '|' || e.klucz || '|' || l.opiekun_id
                               from public.ud_leady l join public.ud_clients c on c.id = l.klient_id join public.ud_leady_etap e on e.id = l.etap_id
                              where c.full_name = 'Marek Nowakowski'`))
    .toBe('Marek Nowakowski|polisa|70010102345|marek@x.pl|wygrany|a0000000-0000-0000-0000-0000000000a2');
  expect(await sql(request, `select string_agg(f.nazwa, ',') from public.ud_leady_pliki f join public.ud_leady l on l.id = f.lead_id
                              join public.ud_clients c on c.id = l.klient_id where c.full_name = 'Marek Nowakowski'`)).toBe('Polisa Nowaka.pdf');
  // Odnośnik prowadzi do leada na tablicy, a agent go tam widzi.
  const href = await page.locator('[data-dodano] a').getAttribute('href');
  await otworz(page, { u: 'ula', zapytanie: href.split('?')[1] });
  await expect(page.locator('[data-szczegoly]')).toContainText('Marek Nowakowski');
  await expect(page.locator('[data-szczegoly] [data-historia]')).toContainText('dodano polisę spoza formularza → Wygrany');
});

test('polisa z opłatą dystrybucyjną: składka bez opłaty (3 036 → 2 760, rata 253 → 230)', async ({ page, request }) => {
  await statystyki(page, 'ula');
  const okno = await otworzOkno(page);
  await okno.locator('[data-plik-polisy]').setInputFiles(pdf('UD-TEST-OPLATA'));
  await expect(okno.getByLabel('Składka roczna *')).toHaveValue('2760');
  await expect(okno.getByLabel('Składka miesięczna')).toHaveValue('230');
  await expect(okno.getByLabel('Świadczenie — okresowa niezdolność')).toHaveValue('5000');
  await okno.getByLabel('Imię i nazwisko *').fill('Ola Opłata');
  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(page.locator('[data-dodano]')).toContainText('Ola Opłata');
  expect(await sql(request, `select skladka_roczna || '/' || skladka_mies from public.ud_leady l join public.ud_clients c on c.id = l.klient_id
                              where c.full_name = 'Ola Opłata'`)).toBe('2760.00/230.00');
});

test('administrator dodaje sprzedaż agentowi, bez pliku i z datą z przeszłości', async ({ page, request }) => {
  await statystyki(page, 'adm');
  const okno = await otworzOkno(page);
  await expect(okno.getByLabel('Agent (sprzedawca)')).toHaveValue('a0000000-0000-0000-0000-0000000000a1');
  await okno.getByLabel('Agent (sprzedawca)').selectOption({ label: 'Olek Agent' });
  await okno.getByLabel('Imię i nazwisko *').fill('Piotr Ręczny');
  await okno.getByLabel('Data sprzedaży *').fill('2026-09-01');
  await okno.getByLabel('Składka roczna *').fill('1 200');
  await okno.getByLabel('Suma — zgon').fill('0');
  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(page.locator('[data-dodano]')).toContainText('Dodano sprzedaż: Piotr Ręczny.');
  expect(await sql(request, `select l.opiekun_id || '|' || l.sprzedawca_id || '|' || to_char(l.sprzedano_at at time zone 'Europe/Warsaw', 'YYYY-MM-DD')
                                    || '|' || coalesce(l.swiadczenie_zgon::text, 'brak') || '|' || coalesce(c.email, 'bez e-maila')
                               from public.ud_leady l join public.ud_clients c on c.id = l.klient_id where c.full_name = 'Piotr Ręczny'`))
    .toBe('a0000000-0000-0000-0000-0000000000a3|a0000000-0000-0000-0000-0000000000a3|2026-09-01|brak|bez e-maila');
});

test('walidacja: bez nazwy i składki — błędy przy polach, nic nie zapisane; ten sam PESEL — odnośnik do istniejącego leada', async ({ page, request }) => {
  await statystyki(page, 'ula');
  let okno = await otworzOkno(page);
  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(okno.getByRole('alert')).toContainText('Popraw zaznaczone pola.');
  await expect(okno.getByLabel('Imię i nazwisko *')).toBeFocused();
  await expect(okno.getByLabel('Imię i nazwisko *')).toHaveAttribute('aria-invalid', 'true');
  await expect(okno.getByLabel('Składka roczna *')).toHaveAttribute('aria-invalid', 'true');
  await okno.getByLabel('PESEL').fill('123');
  await okno.getByLabel('Imię i nazwisko *').fill('Anna Druga');
  await okno.getByLabel('Składka roczna *').fill('2000');
  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(okno.getByText('PESEL ma 11 cyfr.')).toBeVisible();
  expect(await sql(request, `select count(*) from public.ud_clients where full_name = 'Anna Druga'`)).toBe('0');

  // PESEL Anny Kowalskiej (lead Uli) — drugiego klienta nie zakładamy.
  await okno.getByLabel('PESEL').fill('80010112345');
  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(okno.getByRole('alert')).toContainText('Klient z tym PESEL-em jest już w kartotece.');
  await expect(okno.getByRole('link', { name: 'Otwórz lead tego klienta' }))
    .toHaveAttribute('href', `/panel/leady?lead=${await sql(request, `select tt.lead('Anna Kowalska')`)}`);
  expect(await sql(request, `select count(*) from public.ud_clients where full_name = 'Anna Druga'`)).toBe('0');
  await page.keyboard.press('Escape');
  await expect(okno).toHaveCount(0);
});

test('zerwana odpowiedź przy zapisie: ponowne „Zapisz" tym samym kluczem nie zakłada klienta drugi raz', async ({ page, request }) => {
  await statystyki(page, 'ula');
  const okno = await otworzOkno(page);
  await okno.getByLabel('Imię i nazwisko *').fill('Zofia Sieć');
  await okno.getByLabel('Składka roczna *').fill('1800');
  // Serwer zapisuje, ale odpowiedź do przeglądarki nie dochodzi.
  await page.route('**/panel/statystyki/api/polisa', async (r) => { await r.fetch(); await r.abort('connectionreset'); }, { times: 1 });
  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(okno.getByRole('alert')).toContainText('nie wiadomo, czy sprzedaż się zapisała');
  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(page.locator('[data-dodano]')).toContainText('Zofia Sieć');
  expect(await sql(request, `select count(*) from public.ud_clients where full_name = 'Zofia Sieć'`)).toBe('1');
});

test('plik nie doszedł po zapisie sprzedaży: okno zostaje z „Wgraj plik ponownie", sprzedaż już jest', async ({ page, request }) => {
  await statystyki(page, 'ula');
  const okno = await otworzOkno(page);
  await okno.locator('[data-plik-polisy]').setInputFiles(pdf('UD-TEST-KWOTY'));
  await expect(okno.getByLabel('Składka roczna *')).toHaveValue('1500');
  await okno.getByLabel('Imię i nazwisko *').fill('Karol Plik');
  // Pierwsze wgranie pliku do nowego leada kończy się 502.
  await page.route('**/panel/leady/api/polisa/*', (r) =>
    r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ status: 'blad', komunikat: 'Nie udało się zapisać pliku.' }) }),
  { times: 1 });
  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(okno.getByRole('alert')).toContainText('Sprzedaż zapisana, ale pliku polisy nie udało się wgrać');
  expect(await sql(request, `select count(*) from public.ud_clients where full_name = 'Karol Plik'`)).toBe('1');
  await okno.getByRole('button', { name: 'Wgraj plik ponownie' }).click();
  await expect(page.locator('[data-dodano]')).toContainText('Dodano sprzedaż: Karol Plik (z polisą).');
  expect(await sql(request, `select count(*) from public.ud_leady_pliki f join public.ud_leady l on l.id = f.lead_id
                              join public.ud_clients c on c.id = l.klient_id where c.full_name = 'Karol Plik'`)).toBe('1');
});

test('„Dane sprzedaży": kwoty ponownie z polisy wgranej wcześniej — bez opłaty dystrybucyjnej', async ({ page, request }) => {
  const jerzy = await sql(request, `select tt.lead('Jerzy Duda')`);
  const r = await request.post(`${adres()}/panel/leady/api/polisa/${jerzy}`, {
    headers: { 'x-test-user': 'ula', 'content-type': 'application/pdf', 'x-nazwa-pliku': 'polisa%20Jerzego.pdf' },
    data: Buffer.from('%PDF-1.4\n% UD-TEST-OPLATA\n%%EOF\n'),
  });
  expect(r.status()).toBe(200);
  await otworz(page, { u: 'ula', zapytanie: `lead=${jerzy}` });
  await page.locator('[data-szczegoly]').getByRole('button', { name: 'Uzupełnij dane sprzedaży…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dane sprzedaży' });
  const lista = dialog.locator('[data-polisy-leada]');
  await expect(lista).toContainText('polisa Jerzego.pdf');
  await lista.getByRole('button', { name: 'Odczytaj dane z polisy' }).click();
  await expect(dialog.locator('[data-komunikat-polisy]')).toContainText('sprawdź je przed zapisem');
  await expect(dialog.getByLabel('Składka roczna *')).toHaveValue('2760');
  await expect(dialog.getByLabel('Składka miesięczna')).toHaveValue('230');
  await dialog.getByRole('button', { name: 'Zapisz' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await sql(request, `select skladka_roczna || '/' || skladka_mies from public.ud_leady where id = '${jerzy}'`)).toBe('2760.00/230.00');
});
