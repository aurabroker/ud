/**
 * Strona /panel/statystyki (z sekcją „Według źródła", panel v.0.80) i migająca
 * zakładka „Niedokończone" (zmiany z 02.10.2026).
 *
 * Obie renderowane po stronie serwera z prawdziwego komponentu i z danymi z tych
 * samych funkcji co ich `load` (ud_leady_statystyki, liczNiedokonczone) na bazie
 * testowej. Kto co widzi, rozstrzyga SQL — tu sprawdzamy, że strona pokazuje to,
 * co SQL zwrócił, a agent nie dostaje cudzych liczb nawet z parametrem w adresie.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
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

test('prowizja = składka roczna × stawka sprzedawcy: agent widzi swoją, administrator stawki i prowizje agentów', async ({ page, request }) => {
  await sprzedaze(request);
  await sql(request, `update public.ud_user_profiles set prowizja_procent = 15 where id = tt.id_ula()`);
  await wczytaj(page, request, '/__test/ssr-statystyki', 'ula');
  await expect(page.locator('.kafel').nth(3)).toContainText('Twoja prowizja');
  await expect(stat(page, 'prowizja')).toHaveText('540 zł');                     // 3 600 × 15%
  await expect(page.locator('[data-stawka]')).toHaveText('15% składki rocznej');
  await expect(page.locator('[data-bez-stawki]')).toHaveCount(0);

  await wczytaj(page, request, '/__test/ssr-statystyki', 'adm');
  await expect(page.locator('.kafel').nth(3)).toContainText('Prowizja');
  await expect(stat(page, 'prowizja')).toHaveText('540 zł');                     // Olek bez stawki, Bartek bez kwot
  await expect(page.locator('[data-stawka]')).toHaveText('według stawek agentów');
  await expect(page.locator('[data-bez-stawki]')).toHaveText('1 sprzedaż bez stawki — ustaw ją w Panelu Admina.');
  const ula = page.locator('tr[data-agent="a0000000-0000-0000-0000-0000000000a2"] td');
  await expect(ula.nth(3)).toHaveText('15%');
  await expect(ula.nth(4)).toHaveText('540 zł');
  const olek = page.locator(`tr[data-agent="${OLEK}"] td`);
  await expect(olek.nth(3)).toHaveText('—');
  await expect(olek.nth(4)).toHaveText('—');

  // Stawka zapisana przy sprzedaży zostaje, choć agent ma już inną.
  await sql(request, `update public.ud_leady set prowizja_procent = 10 where id = tt.lead('Jerzy Duda')`);
  await wczytaj(page, request, '/__test/ssr-statystyki', 'ula');
  await expect(stat(page, 'prowizja')).toHaveText('360 zł');
  await expect(page.locator('[data-stawka]')).toHaveText('15% składki rocznej');
});

test('ryzyka bez „niezdolność do pracy" i „świadczenie miesięczne"; okresowa z jednostką „/ mies."', async ({ page, request }) => {
  await sprzedaze(request);
  await wczytaj(page, request, '/__test/ssr-statystyki', 'adm');
  await expect(ryzyko(page, 'okresowa').locator('th')).toHaveText('Okresowa');
  await expect(ryzyko(page, 'trwala').locator('th')).toHaveText('Trwała · suma ubezpieczenia');
  await expect(ryzyko(page, 'zgon').locator('th')).toHaveText('Zgon · suma ubezpieczenia');
  await expect(ryzyko(page, 'okresowa').locator('td').nth(1)).toHaveText(/zł \/ mies\.$/);
  const tekst = await page.locator('body').innerText();
  expect(tekst).not.toMatch(/niezdolność do pracy|świadczenie miesięczne/i);
});

// ─── Według źródła (panel v.0.80) ───────────────────────────────────────────
// Źródło z form_data.zrodlo i kod agenta (affiliate_code_used); liczby z SQL
// ud_leady_statystyki_zrodla, rodzaj z src/lib/zrodlo.js.
async function zrodla(request) {
  await sql(request, `
    update public.ud_clients set form_data = '{"zrodlo": {"utm_source": "ads", "utm_medium": "internet", "utm_campaign": "jesien26",
      "platne": true, "zgoda_marketing": true, "gclid": "GCLID-SEKRET-1"}}' where full_name = 'Jerzy Duda';
    update public.ud_clients set form_data = '{"zrodlo": {"platne": true, "gad_source": "1", "gad_campaignid": "998877", "zgoda_marketing": false}}'
     where full_name = 'Celina Zielińska';
    update public.ud_clients set affiliate_code_used = 'AG7' where full_name = 'Grażyna Pawlak';
    update public.ud_clients set form_data = '{"zrodlo": {"utm_source": "Newsletter", "platne": false, "zgoda_marketing": false}}'
     where full_name = 'Anna Kowalska';
    update public.ud_user_profiles set prowizja_procent = 15 where id = tt.id_ula();`);
}
const zrodloWiersz = (page, k) => page.locator(`section[data-zrodla] tr[data-zrodlo="${k}"] > *`);
const podwiersze = (page, k) => page.locator(`section[data-zrodla] tr[data-zrodlo-pod="${k}"] th`);

test('według źródła: wnioski, sprzedane polisy, składki i prowizja na rodzaj; kampanie pod Google Ads; Razem = sprzedaże', async ({ page, request }) => {
  await sprzedaze(request);
  await zrodla(request);
  await wczytaj(page, request, '/__test/ssr-statystyki', 'adm');

  const sekcja = page.locator('section[data-zrodla]');
  await expect(sekcja.getByRole('heading', { name: 'Według źródła' })).toBeVisible();
  await expect(sekcja.locator('thead th')).toHaveText(['Źródło', 'Wnioski', 'Sprzedane polisy', 'Składki roczne', 'Prowizja']);
  await expect(sekcja.locator('tbody tr[data-zrodlo] th')).toHaveText(['Google Ads', 'Link agenta', 'Inne', 'Brak danych']);

  // Jerzy (reklama, sprzedany: 3 600 × 15%) + Celina (reklama, bez sprzedaży).
  await expect(zrodloWiersz(page, 'ads')).toHaveText(['Google Ads', '2', '1', /^3[\s ]?600 zł$/, '540 zł']);
  await expect(podwiersze(page, 'ads')).toHaveText([/kampania:\s+jesien26/, /kampania:\s+998877/]);
  // Grażyna z linku agenta, sprzedana przez Olka (bez stawki).
  await expect(zrodloWiersz(page, 'agent')).toHaveText(['Link agenta', '1', '1', /^2[\s ]?400 zł$/, /^0 zł \(1 sprzedaż bez stawki\)$/]);
  await expect(zrodloWiersz(page, 'inne')).toHaveText(['Inne', '1', '0', '0 zł', '0 zł']);
  await expect(podwiersze(page, 'inne')).toHaveText([/utm_source:\s+newsletter/]);
  // Pozostali klienci z fixture (bez źródła); Bartek sprzedany bez kwot.
  const wszyscy = Number(await sql(request, 'select count(*) from public.ud_clients'));
  await expect(zrodloWiersz(page, 'brak')).toHaveText(['Brak danych', String(wszyscy - 4), '1 (1 bez kwot)', '0 zł', '0 zł']);
  await expect(zrodloWiersz(page, 'razem')).toHaveText(['Razem', String(wszyscy), '3', /^6[\s ]?000 zł$/, '540 zł']);
  // Razem sprzedaży = kafel „Sprzedaże" (ta sama definicja sprzedaży).
  await expect(stat(page, 'sprzedaze')).toHaveText('3');
  await expect(stat(page, 'prowizja')).toHaveText('540 zł');

  await expect(sekcja.locator('[data-zrodla-przypis]')).toContainText('Wnioski liczone po dacie wniosku, sprzedaż po dacie sprzedaży');
  await expect(sekcja.locator('[data-zrodla-przypis]')).toContainText('„Brak danych” = wejście bez parametrów kampanii (wyszukiwarka, adres wpisany ręcznie, link bez UTM-ów), wnioski sprzed 20.11.2026 i klienci dodani w panelu');
  expect(await page.content()).not.toMatch(/SEKRET|gclid/);
});

test('według źródła: agent tylko swoje (także z cudzym agentem w adresie), administrator — wybrany agent', async ({ page, request }) => {
  await sprzedaze(request);
  await zrodla(request);
  // Ula: leady Anna, Dariusz, Filip, Henryk, Jerzy; sprzedaż — Jerzy.
  await wczytaj(page, request, `/__test/ssr-statystyki?agent=${OLEK}`, 'ula');
  await expect(zrodloWiersz(page, 'ads')).toHaveText(['Google Ads', '1', '1', /^3[\s ]?600 zł$/, '540 zł']);
  await expect(podwiersze(page, 'ads')).toHaveText([/jesien26/]);
  await expect(zrodloWiersz(page, 'agent')).toHaveText(['Link agenta', '0', '0', '0 zł', '0 zł']);
  await expect(zrodloWiersz(page, 'razem')).toHaveText(['Razem', '5', '1', /^3[\s ]?600 zł$/, '540 zł']);
  await expect(page.locator('section[data-zrodla]')).not.toContainText('998877');      // kampania klientki Olka
  await expect(page.locator('[data-zrodla-przypis]')).toContainText('Wnioski Twoich klientów i Twoje sprzedaże.');

  await wczytaj(page, request, `/__test/ssr-statystyki?agent=${OLEK}`, 'adm');
  // Olek: Celina (reklama), Grażyna (link agenta, sprzedana), Karolina (brak).
  await expect(zrodloWiersz(page, 'ads')).toHaveText(['Google Ads', '1', '0', '0 zł', '0 zł']);
  await expect(zrodloWiersz(page, 'agent')).toHaveText(['Link agenta', '1', '1', /^2[\s ]?400 zł$/, /bez stawki/]);
  await expect(zrodloWiersz(page, 'razem').nth(2)).toHaveText('1');
});

test('według źródła: wniosek z linku agenta liczy się agentowi od razu, zanim ktoś otworzy tablicę', async ({ page, request }) => {
  // Nowy wniosek z ?agent=<kod Uli>: w ud_clients jest, leada jeszcze nie ma (powstaje przy synchronizacji).
  await sql(request, `update public.ud_user_profiles set affiliate_code = 'AGULA' where id = tt.id_ula();
    insert into public.ud_clients (id, created_at, full_name, email, phone, source, affiliate_code_used, form_data)
    values ('c0000000-0000-0000-0000-0000000000f1', now(), 'Zenon Nowy', 'zenon@x.pl', '500900900', 'form', 'AGULA',
            '{"zrodlo": {"utm_source": "ads", "utm_medium": "internet", "platne": true, "zgoda_marketing": false}}');`);
  expect(await sql(request, `select count(*) from public.ud_leady where klient_id = 'c0000000-0000-0000-0000-0000000000f1'`)).toBe('0');
  await wczytaj(page, request, '/__test/ssr-statystyki', 'ula');
  await expect(zrodloWiersz(page, 'ads')).toHaveText(['Google Ads', '1', '0', '0 zł', '0 zł']);
  await wczytaj(page, request, `/__test/ssr-statystyki?agent=a0000000-0000-0000-0000-0000000000a2`, 'adm');
  await expect(zrodloWiersz(page, 'ads')).toHaveText(['Google Ads', '1', '0', '0 zł', '0 zł']);
});

test('load statystyk synchronizuje leady PRZED obiema funkcjami (harness robi to samo, więc to sprawdza źródło)', () => {
  const kod = readFileSync(new URL('../../src/routes/panel/statystyki/+page.server.js', import.meta.url), 'utf8');
  const sync = kod.indexOf('await synchronizuj(sb);');
  expect(sync, 'load nie woła synchronizuj(sb)').toBeGreaterThan(0);
  expect(sync).toBeLessThan(kod.indexOf('Promise.allSettled('));
});

test('według źródła: okres — wnioski po dacie wniosku, sprzedaż po dacie sprzedaży', async ({ page, request }) => {
  await sprzedaze(request);   // Jerzy sprzedany w poprzednim miesiącu
  await zrodla(request);
  await sql(request, `update public.ud_clients set created_at = date_trunc('month', now()) - interval '15 days' where full_name = 'Jerzy Duda';
                      update public.ud_clients set created_at = now() where full_name = 'Celina Zielińska';`);
  await wczytaj(page, request, '/__test/ssr-statystyki?okres=poprzedni', 'adm');
  await expect(zrodloWiersz(page, 'ads')).toHaveText(['Google Ads', '1', '1', /^3[\s ]?600 zł$/, '540 zł']);
  await expect(podwiersze(page, 'ads')).toHaveText([/jesien26/]);
  await wczytaj(page, request, '/__test/ssr-statystyki?okres=miesiac', 'adm');
  await expect(zrodloWiersz(page, 'ads')).toHaveText(['Google Ads', '1', '0', '0 zł', '0 zł']);
  await expect(podwiersze(page, 'ads')).toHaveText([/998877/]);
});

test('według źródła: brak funkcji w bazie (panel przed migracją) — komunikat w sekcji, reszta statystyk działa', async ({ page, request }) => {
  await sprzedaze(request);
  await wczytaj(page, request, '/__test/ssr-statystyki?brakZrodel=1', 'adm');
  await expect(page.locator('[data-zrodla-blad]')).toHaveText(/nie są jeszcze włączone w bazie — reszta statystyk działa/);
  await expect(page.locator('section[data-zrodla] table')).toHaveCount(0);
  await expect(stat(page, 'sprzedaze')).toHaveText('3');
  await expect(page.locator('section[aria-labelledby="st-agenci"]')).toBeVisible();
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
