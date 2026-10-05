/**
 * Wykaz polis (decyzja właściciela z 05.10.2026: „wykaz polis, z datami,
 * składkami miesięcznymi"). Prawdziwa strona /panel/polisy w przeglądarce
 * (test/leady/statystyki.html?strona=polisy) na prawdziwych funkcjach SQL.
 */
import { test, expect } from '@playwright/test';
import { adres, otworz, reset, sql } from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });


async function wykaz(page, u = 'adm') {
  await page.goto(`${adres()}/test/leady/statystyki.html?strona=polisy&u=${u}`);
  await page.waitForSelector('html[data-gotowe]');
}
const wiersz = (page, nazwa) => page.locator('tr[data-polisa-wiersz]', { hasText: nazwa });

/**
 * Jerzy (Ula): aktywna, numer, rata zapisana. Grażyna (Olek): wygasa za 10 dni,
 * składka miesięczna wyliczona z rocznej. Bartek (bez opiekuna): bez kwot i dat.
 */
async function polisyTestowe(request) {
  await sql(request, `update public.ud_user_profiles set prowizja_procent = 15 where id = tt.id_ula();
    update public.ud_leady set skladka_roczna = 3600, skladka_mies = 300, polisa_numer = 'LHP 1/2026',
           ochrona_od = current_date - 30, ochrona_do = current_date + 334, sprzedano_at = now() - interval '30 days'
     where id = tt.lead('Jerzy Duda');
    update public.ud_leady set etap_id = tt.etap('wygrany'), skladka_roczna = 2400, polisa_numer = 'CEU-77',
           ochrona_od = current_date - 355, ochrona_do = current_date + 10, sprzedano_at = now() - interval '355 days'
     where id = tt.lead('Grażyna Pawlak');
    update public.ud_leady set etap_id = tt.etap('wygrany'), sprzedano_at = now() where id = tt.lead('Bartek Nowak');`);
}

test('administrator: wszystkie polisy z numerem, okresem ochrony, statusem, składką miesięczną i sumami', async ({ page, request }) => {
  await polisyTestowe(request);
  await wykaz(page);
  await expect(page.getByRole('heading', { name: 'Wykaz polis' })).toBeVisible();
  await expect(page.locator('tr[data-polisa-wiersz]')).toHaveCount(3);

  const jerzy = wiersz(page, 'Jerzy Duda');
  await expect(jerzy).toContainText('LHP 1/2026');
  await expect(jerzy.locator('[data-status]')).toHaveText('Aktywna');
  await expect(jerzy.locator('td').nth(3)).toHaveText(/^300 zł$/);
  await expect(jerzy.locator('td').nth(5)).toHaveText('540 zł');           // 3 600 × 15%
  await expect(jerzy.locator('td').nth(6)).toHaveText('Ula Agent');
  const grazyna = wiersz(page, 'Grażyna Pawlak');
  await expect(grazyna.locator('[data-status]')).toHaveText('Wygasa za 10 dni');
  await expect(grazyna.locator('td').nth(3)).toHaveText('≈ 200 zł');         // 2 400 / 12
  await expect(wiersz(page, 'Bartek Nowak').locator('[data-status]')).toHaveText('Bez dat ochrony');
  await expect(wiersz(page, 'Bartek Nowak')).toContainText('brak numeru');

  await expect(page.locator('[data-suma="liczba"]')).toHaveText('3');
  await expect(page.locator('[data-suma="mies"]')).toHaveText('500 zł');
  await expect(page.locator('[data-suma="roczna"]')).toHaveText(/^6[\s ]?000 zł$/);
  await expect(page.locator('[data-podsumowanie]')).toContainText('w tym 1 jako 1/12 rocznej');
  await expect(page.locator('main')).toContainText('1 polisa bez dat ochrony');
  // Odnośnik prowadzi do leada na tablicy.
  await expect(jerzy.getByRole('link', { name: 'Jerzy Duda' }))
    .toHaveAttribute('href', `/panel/leady?lead=${await sql(request, `select tt.lead('Jerzy Duda')`)}`);
});

test('filtry statusu i szukanie działają na miejscu, liczniki przy chipach; sortowanie po końcu ochrony', async ({ page, request }) => {
  await polisyTestowe(request);
  await wykaz(page);
  await expect(page.locator('[data-status-filtr="wygasa"] .ile')).toHaveText('1');
  await expect(page.locator('[data-status-filtr="aktywne"] .ile')).toHaveText('2');
  await page.locator('[data-status-filtr="wygasa"]').click();
  await expect(page.locator('tr[data-polisa-wiersz]')).toHaveCount(1);
  await expect(page.locator('[data-suma="liczba"]')).toHaveText('1');
  await expect(wiersz(page, 'Grażyna Pawlak')).toBeVisible();
  await page.locator('[data-status-filtr="wszystkie"]').click();
  await page.getByPlaceholder('Szukaj: klient, numer polisy').fill('ceu');
  await expect(page.locator('tr[data-polisa-wiersz]')).toHaveCount(1);
  await page.getByPlaceholder('Szukaj: klient, numer polisy').fill('');

  await page.getByRole('button', { name: 'Ochrona' }).click();
  await expect(page.locator('tr[data-polisa-wiersz] th')).toHaveText([/Grażyna Pawlak/, /Jerzy Duda/, /Bartek Nowak/]);
  await expect(page.getByRole('columnheader', { name: 'Ochrona' })).toHaveAttribute('aria-sort', 'ascending');
});

test('agent widzi tylko swoje polisy, bez kolumny agenta, z własną prowizją', async ({ page, request }) => {
  await polisyTestowe(request);
  await wykaz(page, 'ula');
  await expect(page.locator('tr[data-polisa-wiersz]')).toHaveCount(1);
  await expect(wiersz(page, 'Jerzy Duda')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Agent' })).toHaveCount(0);
  await expect(page.locator('[data-podsumowanie]')).toContainText('Twoja prowizja');
  await expect(page.getByRole('combobox', { name: 'Agent' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Grażyna');
});

test('Pobierz CSV: plik dla Excela z widocznymi wierszami', async ({ page, request }) => {
  await polisyTestowe(request);
  await wykaz(page);
  await page.locator('[data-status-filtr="aktywne"]').click();
  const [plik] = await Promise.all([page.waitForEvent('download'), page.locator('[data-csv]').click()]);
  expect(plik.suggestedFilename()).toMatch(/^polisy-\d{4}-\d{2}-\d{2}\.csv$/);
  const tresc = await (await plik.createReadStream()).toArray().then((k) => Buffer.concat(k).toString('utf8'));
  expect(tresc.startsWith('﻿Klient;Numer polisy;Ochrona od;Ochrona do;Status;')).toBeTruthy();
  const linie = tresc.trim().split('\r\n');
  expect(linie).toHaveLength(3);                                             // nagłówek + Jerzy + Grażyna
  expect(tresc).toContain('Jerzy Duda;LHP 1/2026;');
  expect(tresc).toContain(';300;3600;540;Ula Agent');
  expect(tresc).not.toContain('Bartek Nowak');
});

test('Dodaj polisę z wykazu: numer i „Ochrona na rok" — nowy wiersz od razu w wykazie', async ({ page, request }) => {
  await wykaz(page, 'ula');
  await page.getByRole('button', { name: '+ Dodaj polisę' }).click();
  const okno = page.getByRole('dialog', { name: 'Dodaj polisę' });
  await okno.getByLabel('Imię i nazwisko *').fill('Nowa Polisa');
  await okno.getByLabel('Składka roczna *').fill('1200');
  await okno.getByLabel('Numer polisy').fill('LHP 55/2026');
  await okno.getByLabel('Data sprzedaży *').fill('2026-09-01');
  await okno.locator('[data-rok-ochrony]').click();
  await expect(okno.getByLabel('Ochrona od')).toHaveValue('2026-09-01');
  await expect(okno.getByLabel('Ochrona do')).toHaveValue('2027-08-31');
  await okno.getByRole('button', { name: 'Zapisz sprzedaż' }).click();
  await expect(page.locator('[data-dodano]')).toContainText('Nowa Polisa');
  const w = wiersz(page, 'Nowa Polisa');
  await expect(w).toContainText('LHP 55/2026');
  await expect(w.locator('.daty')).toHaveText('01.09.2026 – 31.08.2027');
  await expect(w.locator('td').nth(3)).toHaveText('≈ 100 zł');
  expect(await sql(request, `select polisa_numer || '|' || ochrona_od || '|' || ochrona_do from public.ud_leady
                              where id = (select l.id from public.ud_leady l join public.ud_clients c on c.id = l.klient_id where c.full_name = 'Nowa Polisa')`))
    .toBe('LHP 55/2026|2026-09-01|2027-08-31');
});

test('„Dane sprzedaży" na tablicy: numer i okres ochrony; koniec przed początkiem — błąd przy polu, nic nie zapisane', async ({ page, request }) => {
  const jerzy = await sql(request, `select tt.lead('Jerzy Duda')`);
  await otworz(page, { u: 'ula', zapytanie: `lead=${jerzy}` });
  await page.locator('[data-szczegoly]').getByRole('button', { name: 'Uzupełnij dane sprzedaży…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dane sprzedaży' });
  await dialog.getByLabel('Inny — wpiszę kwoty ręcznie').check();
  await dialog.getByLabel('Składka roczna *').fill('3000');
  await dialog.getByLabel('Numer polisy').fill('LHP 7/2026');
  await dialog.getByLabel('Ochrona od').fill('2026-10-01');
  await dialog.getByLabel('Ochrona do').fill('2026-09-01');
  await dialog.getByRole('button', { name: 'Zapisz' }).click();
  await expect(dialog.getByText('Koniec ochrony nie może być przed jej początkiem.')).toBeVisible();
  expect(await sql(request, `select coalesce(polisa_numer, 'brak') from public.ud_leady where id = '${jerzy}'`)).toBe('brak');

  await dialog.locator('[data-rok-ochrony]').click();
  await expect(dialog.getByLabel('Ochrona do')).toHaveValue('2027-09-30');
  await dialog.getByRole('button', { name: 'Zapisz' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await sql(request, `select polisa_numer || '|' || ochrona_od || '|' || ochrona_do from public.ud_leady where id = '${jerzy}'`))
    .toBe('LHP 7/2026|2026-10-01|2027-09-30');
  const szczegoly = page.locator('[data-szczegoly]');
  await expect(szczegoly.locator('[data-polisa-numer]')).toContainText('LHP 7/2026');
  await expect(szczegoly.locator('[data-ochrona]')).toContainText('01.10.2026 – 30.09.2027');
  // Ponowne otwarcie okna pokazuje zapisane wartości.
  await szczegoly.getByRole('button', { name: 'Zmień dane sprzedaży…' }).click();
  await expect(page.getByRole('dialog', { name: 'Dane sprzedaży' }).getByLabel('Numer polisy')).toHaveValue('LHP 7/2026');
});

test('telefon (390 px): strona nie rozjeżdża się w bok — tabela przewija się w swojej ramce', async ({ page, request }) => {
  await polisyTestowe(request);
  await page.setViewportSize({ width: 390, height: 800 });
  await wykaz(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
