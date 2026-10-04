/**
 * Decyzje właściciela z 02.10.2026 (po pierwszym nowym agencie):
 *  - agent widzi i obsługuje wyłącznie leady, których jest opiekunem;
 *  - przy wygranej klient bez ofert w panelu: „Wgraj polisę" albo „Dodaj ręcznie";
 *    z polisy kwoty, gdy czytnik je rozpozna (Leadenhall: hasło = 4 ostatnie
 *    cyfry PESEL-u, czytane na serwerze).
 *
 * Czytnik PDF w serwerze testowym rozpoznaje znaczniki w treści pliku
 * (UD-TEST-KWOTY, UD-TEST-HASLO) — prawdziwego PDF-u polisy w repozytorium nie ma.
 */
import { test, expect } from '@playwright/test';
import { adres, etapLeada, karta, kolumna, otworz, przeciagnijZPrzewijaniem, reset, sql, toast } from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

const pdf = (znacznik = '') => ({ name: 'Polisa Anny.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${znacznik}\n%%EOF\n`) });

test('agent widzi tylko swoje leady; bez filtra opiekuna; liczniki bez cudzych', async ({ page }) => {
  await otworz(page, { u: 'ula' });
  const nazwy = await page.locator('[data-karta-id] .nazwa').allInnerTexts();
  expect(nazwy.sort()).toEqual(['Anna Kowalska', 'Dariusz Wójcik', 'Filip Lis', 'Henryk Sikora', 'Jerzy Duda']);
  await expect(page.getByLabel('Opiekun')).toHaveCount(0);
  await expect(kolumna(page, 'nowy').locator('[data-licznik]')).toHaveText('3');
  // Administrator widzi wszystkie i ma filtr opiekuna.
  await otworz(page);
  await expect(karta(page, 'Bartek Nowak')).toBeVisible();
  await expect(page.getByLabel('Opiekun')).toBeVisible();
});

test('agent: link do cudzego leada nie otwiera szczegółów', async ({ page, request }) => {
  const celina = await sql(request, `select tt.lead('Celina Zielińska')`);   // lead Olka
  await otworz(page, { u: 'ula', zapytanie: `lead=${celina}` });
  await expect(page.locator('[data-szczegoly]')).toHaveCount(0);
  const r = await request.get(`${adres()}/panel/leady/api/lead/${celina}`, { headers: { 'x-test-user': 'ula' } });
  expect(r.status()).toBe(404);
});

test('Wygrany bez ofert: „Wgraj polisę" — plik zapisany, kwoty odczytane i do sprawdzenia, potem przeniesienie', async ({ page, request }) => {
  await otworz(page);
  await przeciagnijZPrzewijaniem(page, karta(page, 'Anna Kowalska'), 'wygrany');
  const dialog = page.getByRole('dialog', { name: 'Dane sprzedaży' });
  await expect(dialog.getByRole('button', { name: 'Wgraj polisę (PDF)' })).toBeVisible();
  await dialog.locator('[data-plik-polisy]').setInputFiles(pdf('UD-TEST-KWOTY'));

  await expect(dialog.locator('[data-komunikat-polisy]')).toContainText('sprawdź je przed zapisem');
  await expect(dialog.locator('[data-polisa-wgrana]')).toContainText('Polisa Anny.pdf');
  await expect(dialog.getByLabel('Składka roczna *')).toHaveValue('1500');
  await expect(dialog.getByLabel('Składka miesięczna')).toHaveValue('125');
  await expect(dialog.getByLabel('Świadczenie — okresowa niezdolność')).toHaveValue('4000');
  await expect(dialog.getByLabel('Suma — zgon')).toHaveValue('');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');            // wgranie nie zmienia etapu

  await dialog.getByRole('button', { name: /Przenieś do/ }).click();
  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Wygrany');
  expect(await sql(request, `select skladka_roczna || ':' || skladka_mies || ':' || swiadczenie_okresowa from public.ud_leady where id = tt.lead('Anna Kowalska')`))
    .toBe('1500.00:125.00:4000.00');

  // Szczegóły: polisa na liście, link prowadzi do pliku.
  await karta(page, 'Anna Kowalska').locator('.kontekst').click();
  const link = page.locator('[data-szczegoly] [data-polisa]');
  await expect(link).toHaveText('Polisa Anny.pdf');
  const r = await request.get(`${adres()}${await link.getAttribute('href')}`, { headers: { 'x-test-user': 'adm' } });
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('application/pdf');
  expect((await r.body()).toString('latin1')).toContain('UD-TEST-KWOTY');
  // Inny agent pliku nie pobierze.
  const plikId = (await link.getAttribute('href')).split('/').pop();
  const obcy = await request.get(`${adres()}/panel/leady/api/plik/${plikId}`, { headers: { 'x-test-user': 'olek' }, maxRedirects: 0 });
  expect(obcy.status()).toBe(404);
});

test('polisa z hasłem = 4 ostatnie cyfry PESEL-u: serwer otwiera ją sam; nieznany układ → zapis i kwoty ręcznie', async ({ page, request }) => {
  await otworz(page, { u: 'ula' });                                          // opiekunka Anny wgrywa sama
  await przeciagnijZPrzewijaniem(page, karta(page, 'Anna Kowalska'), 'wygrany');
  const dialog = page.getByRole('dialog', { name: 'Dane sprzedaży' });
  await dialog.locator('[data-plik-polisy]').setInputFiles(pdf('UD-TEST-HASLO'));
  await expect(dialog.getByLabel('Składka roczna *')).toHaveValue('1500');
  await expect(dialog).not.toContainText('80010112345');

  await dialog.locator('[data-plik-polisy]').setInputFiles({ ...pdf('inny układ'), name: 'skan.pdf' });
  await expect(dialog.locator('[data-komunikat-polisy]')).toContainText('wpisz je ręcznie');
  await expect(dialog.locator('[data-polisa-wgrana]')).toContainText('skan.pdf');
  await page.keyboard.press('Escape');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');            // anulowanie: etap bez zmian, polisy zostają
  expect(await sql(request, `select string_agg(nazwa, ',' order by created_at) from public.ud_leady_pliki where lead_id = tt.lead('Anna Kowalska')`))
    .toBe('Polisa Anny.pdf,skan.pdf');
});

test('polisa: nie-PDF i za duży plik — komunikat, nic nie zapisane', async ({ page, request }) => {
  await otworz(page);
  await przeciagnijZPrzewijaniem(page, karta(page, 'Anna Kowalska'), 'wygrany');
  const dialog = page.getByRole('dialog', { name: 'Dane sprzedaży' });
  await dialog.locator('[data-plik-polisy]').setInputFiles({ name: 'polisa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>nie pdf</html>') });
  await expect(dialog.getByRole('alert')).toContainText('To nie jest plik PDF.');
  await dialog.locator('[data-plik-polisy]').setInputFiles({ name: 'duza.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x25) });
  await expect(dialog.getByRole('alert')).toContainText('za duży');
  expect(await sql(request, `select count(*) from public.ud_leady_pliki`)).toBe('0');
  // „Dodaj ręcznie" nadal działa.
  await dialog.getByRole('button', { name: 'Dodaj ręcznie' }).click();
  await expect(dialog.getByLabel('Składka roczna *')).toBeFocused();
});
