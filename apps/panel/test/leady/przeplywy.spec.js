/**
 * K20–K23 i K25 (wytyczne „Kanban CRM", sekcja 5.2): telefon, ponowione żądanie
 * po utracie odpowiedzi, sortowanie, liczniki przy częściowo załadowanej kolumnie,
 * zapamiętanie zwinięcia po odświeżeniu.
 */
import { test, expect } from '@playwright/test';
import {
  awaria, etapId, etapLeada, karta, kolumna, liczbaHistorii, nazwyKart, otworz, przeciagnij, reset, sql, status,
  toast, wersjaLeada, wywolania, zwiniety,
} from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

const licznik = (page, klucz) => kolumna(page, klucz).locator('[data-licznik]');
const suma = (page, klucz) => kolumna(page, klucz).locator('.suma');

/** 40 dodatkowych leadów w etapie „Oferta" (razem 42): do testów stronicowania. */
async function dosypLeady(request) {
  await sql(request, `
    insert into public.ud_clients (id, created_at, full_name, email, phone, source, risk_temp_incapacity, temp_incapacity_sum)
    select gen_random_uuid(), now() - (g || ' hours')::interval, 'Lead ' || lpad(g::text, 3, '0'), 'lead' || g || '@x.pl',
           '7000000' || lpad(g::text, 2, '0'), 'form', true, '1000'
      from generate_series(1, 40) g;
    select public.ud_leady_synchronizuj();
    update public.ud_leady set etap_id = tt.etap('oferta')
     where klient_id in (select id from public.ud_clients where full_name like 'Lead %');`);
}

test.describe('K20: telefon', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('wszystkie główne akcje dostępne przez widoczne kontrolki, bez przeciągania i bez poziomego przewijania', async ({ page, request }) => {
    await otworz(page);
    await expect(page.locator('.etapy-mobilne')).toBeVisible();
    await expect(page.locator('section[data-etap-klucz]')).toHaveCount(1);       // jeden etap naraz
    await expect(page.locator('[data-uchwyt]')).toHaveCount(0);                  // uchwytu przeciągania nie ma
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    // Przełącznik etapów.
    await page.locator('.etapy-mobilne').getByRole('button', { name: /^Nowy/ }).click();
    await expect(kolumna(page, 'nowy')).toBeVisible();
    await expect(karta(page, 'Filip Lis')).toBeVisible();

    // Zmiana etapu przez menu „…" → „Przenieś do…" (podstawa na telefonie).
    await page.getByRole('button', { name: 'Akcje leada Filip Lis' }).click();
    await page.getByRole('menuitem', { name: 'Przenieś do…' }).click();
    await page.getByRole('dialog', { name: 'Przenieś do…' }).getByRole('button', { name: /^Oferta/ }).click();
    await expect(toast(page)).toContainText('Filip Lis: Nowy → Oferta');
    expect(await etapLeada(request, 'Filip Lis')).toBe('oferta');
    await expect(karta(page, 'Filip Lis')).toHaveCount(0);                       // znikł z oglądanego etapu

    // Szczegóły na całym ekranie, z przyciskiem zamknięcia.
    await karta(page, 'Grażyna Pawlak').getByRole('button', { name: /^Grażyna Pawlak/ }).click();
    const sz = page.locator('[data-szczegoly]');
    await expect(sz).toBeVisible();
    const box = await sz.boundingBox();
    expect(box.width).toBeGreaterThan(340);
    await sz.getByLabel('Nowa notatka').fill('Z telefonu');
    await sz.getByRole('button', { name: 'Dodaj notatkę' }).click();
    await expect(sz.locator('[data-notatki]')).toContainText('Z telefonu');
    await sz.getByRole('button', { name: 'Zamknij szczegóły' }).click();
    await expect(sz).toHaveCount(0);

    // Pozostałe akcje z menu: działanie, opiekun, archiwizacja.
    await page.getByRole('button', { name: 'Akcje leada Grażyna Pawlak' }).click();
    await page.getByRole('menuitem', { name: 'Zaplanuj działanie…' }).click();
    await expect(page.getByRole('dialog', { name: 'Zaplanuj działanie' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();
    await page.getByRole('button', { name: 'Akcje leada Grażyna Pawlak' }).click();
    await page.getByRole('menuitem', { name: 'Archiwizuj…' }).click();
    await page.getByRole('dialog', { name: 'Archiwizować lead?' }).getByRole('button', { name: 'Archiwizuj' }).click();
    await expect(karta(page, 'Grażyna Pawlak')).toHaveCount(0);
    expect(await sql(request, `select zarchiwizowano_at is not null from public.ud_leady where id = tt.lead_any('Grażyna Pawlak')`.replace('tt.lead_any', 'tt.lead_wszystkie'))).toBe('t');
  });

  test('widok listy: wszystkie etapy jeden pod drugim', async ({ page }) => {
    await otworz(page);
    await page.getByRole('button', { name: 'Lista', exact: true }).click();
    await expect(page.locator('section[data-etap-klucz]')).toHaveCount(5);
    await expect(karta(page, 'Henryk Sikora')).toBeVisible();
    await expect(karta(page, 'Jerzy Duda')).toBeVisible();
    await expect(page.locator('[data-uchwyt]')).toHaveCount(0);
  });
});

test('K21: ponowione żądanie po utracie odpowiedzi — brak podwójnego efektu', async ({ page, request }) => {
  await otworz(page);
  const v = await wersjaLeada(request, 'Anna Kowalska');
  const h = await liczbaHistorii(request, 'Anna Kowalska');
  // Serwer wykonuje zmianę, ale odpowiedź ginie (połączenie zerwane).
  await awaria(request, { sciezka: 'zmien', tryb: 'zgubOdpowiedz' });
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));

  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Oferta');
  await expect(toast(page)).toHaveAttribute('data-toast-typ', 'ok');
  await expect(page.locator('[data-stan-zapisu]')).toHaveCount(0);
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('oferta');
  expect(await wersjaLeada(request, 'Anna Kowalska')).toBe(v + 1);                    // jedna zmiana, nie dwie
  expect(await liczbaHistorii(request, 'Anna Kowalska')).toBe(h + 1);
  expect((await wywolania(request)).filter((w) => w.sciezka === 'zmien').length).toBeGreaterThanOrEqual(2);   // było ponowienie
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);
});

test('K21b: 502 z proxy zanim żądanie dotarło do bazy — ponowienie przechodzi raz', async ({ page, request }) => {
  await otworz(page);
  const v = await wersjaLeada(request, 'Anna Kowalska');
  await awaria(request, { sciezka: 'zmien', tryb: 'odpowiedz', status: 502, body: { status: 'blad', komunikat: 'Bad gateway', ponow: true } });
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));
  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Oferta');
  expect(await wersjaLeada(request, 'Anna Kowalska')).toBe(v + 1);
  expect((await wywolania(request)).filter((w) => w.sciezka === 'zmien')).toHaveLength(2);
});

test('K21c: serwer wykonał zmianę, ale odpowiedź 502 zginęła — aplikacja ponawia TYM SAMYM kluczem i nie dubluje', async ({ page, request }) => {
  await otworz(page);
  const v = await wersjaLeada(request, 'Anna Kowalska');
  const h = await liczbaHistorii(request, 'Anna Kowalska');
  await awaria(request, { sciezka: 'zmien', tryb: 'przetworzI502' });
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));
  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Oferta');
  await expect(toast(page)).toHaveAttribute('data-toast-typ', 'ok');         // nie „konflikt" i nie „błąd"
  await expect(page.locator('[data-stan-zapisu]')).toHaveCount(0);
  expect(await wersjaLeada(request, 'Anna Kowalska')).toBe(v + 1);
  expect(await liczbaHistorii(request, 'Anna Kowalska')).toBe(h + 1);
  expect((await wywolania(request)).filter((w) => w.sciezka === 'zmien')).toHaveLength(2);
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);
});

test('K22: zmiana sortowania — pozycja zgodna z wybranym sortowaniem (także po przeniesieniu)', async ({ page, request }) => {
  await otworz(page);
  // Domyślnie: najbliższe działanie. Przeterminowane Anny pierwsze, potem Filip (za 2 h) i Celina (jutro).
  expect((await nazwyKart(page, 'nowy')).slice(0, 3)).toEqual(['Anna Kowalska', 'Filip Lis', 'Celina Zielińska']);

  await page.getByLabel('Sortuj').selectOption({ label: 'Wartość malejąco' });
  await expect(page).toHaveURL(/sort=wartosc/);
  await expect.poll(async () => (await nazwyKart(page, 'nowy')).slice(0, 6))
    .toEqual(['Filip Lis', 'Celina Zielińska', 'Dariusz Wójcik', 'Grażyna Pawlak', 'Bartek Nowak', 'Anna Kowalska']);
  expect((await nazwyKart(page, 'nowy')).slice(6)).toEqual(['Ewa Mazur']);   // bez kwoty — na końcu

  await page.getByLabel('Sortuj').selectOption({ label: 'Najnowsze zgłoszenia' });
  await expect.poll(() => nazwyKart(page, 'nowy'))
    .toEqual(['Grażyna Pawlak', 'Filip Lis', 'Ewa Mazur', 'Dariusz Wójcik', 'Celina Zielińska', 'Bartek Nowak', 'Anna Kowalska']);

  // Po przeniesieniu karta trafia tam, gdzie postawiłoby ją sortowanie, a nie na początek ani koniec.
  await page.getByLabel('Sortuj').selectOption({ label: 'Wartość malejąco' });
  await expect.poll(() => nazwyKart(page, 'oferta')).toEqual(['Henryk Sikora', 'Irena Kubiak']);
  await przeciagnij(page, karta(page, 'Henryk Sikora'), kolumna(page, 'nowy'));
  await expect(toast(page)).toContainText('Henryk Sikora: Oferta → Nowy');
  expect(await nazwyKart(page, 'nowy')).toEqual(['Filip Lis', 'Celina Zielińska', 'Dariusz Wójcik', 'Grażyna Pawlak', 'Bartek Nowak',
    'Anna Kowalska', 'Henryk Sikora', 'Ewa Mazur']);                                // … 8000, 7000, bez kwoty

  await page.getByLabel('Sortuj').selectOption({ label: 'Najbliższe działanie' });
  await expect.poll(async () => (await nazwyKart(page, 'nowy')).slice(0, 6)).toEqual(['Anna Kowalska', 'Filip Lis', 'Celina Zielińska',
    'Henryk Sikora', 'Dariusz Wójcik', 'Grażyna Pawlak']);                          // wczoraj, za 2 h, jutro, za 2 dni, za 3 dni, za 5 dni; bez terminu — na końcu

  // Sortowanie jednej kolumny z menu etapu nie rusza pozostałych.
  const ofertaPrzed = await nazwyKart(page, 'oferta');
  await page.getByRole('button', { name: 'Akcje etapu Nowy' }).click();
  await page.getByRole('menuitem', { name: 'Sortowanie…' }).click();
  await page.getByRole('dialog').locator('[data-sort-opcja="wartosc"]').click();
  await expect.poll(async () => (await nazwyKart(page, 'nowy')).slice(0, 2)).toEqual(['Filip Lis', 'Celina Zielińska']);
  expect(await nazwyKart(page, 'oferta')).toEqual(ofertaPrzed);                      // sąsiednia kolumna bez zmian
  expect(await etapLeada(request, 'Henryk Sikora')).toBe('nowy');
});

test('K23: filtry i częściowo załadowana kolumna — licznik i suma dotyczą całego filtrowanego zbioru', async ({ page, request }) => {
  await dosypLeady(request);
  await otworz(page);

  // Bez filtra: 42 w etapie, załadowane 25, suma z całego zbioru.
  await expect(licznik(page, 'oferta')).toHaveText('42');
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]')).toHaveCount(25);
  await expect(suma(page, 'oferta')).toContainText('53 000');
  const wiecej = kolumna(page, 'oferta').getByRole('button', { name: /Pokaż więcej \(25 z 42\)/ });
  await expect(wiecej).toBeVisible();
  await wiecej.click();
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]')).toHaveCount(42);
  const ids = await kolumna(page, 'oferta').locator('[data-karta-id]').evaluateAll((els) => els.map((e) => e.dataset.kartaId));
  expect(new Set(ids).size).toBe(42);
  await expect(wiecej).toHaveCount(0);

  // Z filtrem „bez opiekuna": 41 z 42, ale załadowane tylko 25 — licznik i suma o całym zbiorze.
  await page.getByLabel('Opiekun').selectOption('brak');
  await expect(licznik(page, 'oferta')).toHaveText('41 z 42');
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]')).toHaveCount(25);
  await expect(suma(page, 'oferta')).toContainText('46 000');
  await expect(suma(page, 'oferta')).toContainText('po filtrze');
  await expect(licznik(page, 'oferta')).toHaveAttribute('aria-label', '41 z 42 leadów po filtrze');
  await expect(kolumna(page, 'oferta').getByRole('button', { name: /Pokaż więcej \(25 z 41\)/ })).toBeVisible();
  await expect(page).toHaveURL(/opiekun=brak/);

  // Filtr na jednego agenta (Ula): jeden lead, reszta kolumny poza zbiorem.
  await page.getByLabel('Opiekun').selectOption({ label: 'Ula Agent' });
  await expect(licznik(page, 'oferta')).toHaveText('1 z 42');
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]')).toHaveCount(1);
  await expect(suma(page, 'oferta')).toContainText('7000');

  // Szukanie: wynik pasuje do liczników, „Wyczyść filtry" wraca do pełnego zbioru.
  await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
  await expect(licznik(page, 'oferta')).toHaveText('42');
  await page.getByLabel('Szukaj leada').fill('Lead 03');
  await expect(licznik(page, 'oferta')).toHaveText('10 z 42');
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]')).toHaveCount(10);
  await expect(kolumna(page, 'nowy').getByText(/Brak leadów spełniających filtr/)).toBeVisible();
});

test('K25: odświeżenie aplikacji przywraca osobisty stan zwinięcia etapów (per użytkownik)', async ({ page, request }) => {
  await otworz(page);
  await page.getByRole('button', { name: 'Zwiń etap Decyzja klienta' }).click();
  await page.getByRole('button', { name: 'Zwiń etap Oferta' }).click();
  await expect(page.locator('[data-zwiniete-panel]')).toBeVisible();

  await page.reload();
  await page.waitForSelector('html[data-gotowe]');
  await expect(kolumna(page, 'oferta')).toHaveCount(0);
  await expect(kolumna(page, 'decyzja')).toHaveCount(0);
  expect(await page.locator('[data-zw-id] .nazwa').allInnerTexts()).toEqual(['Oferta', 'Decyzja klienta']);   // kolejność pipeline'u
  await expect(zwiniety(page, 'Oferta').locator('[data-licznik]')).toHaveText('2');
  await expect(page.locator('section[data-etap-klucz]')).toHaveCount(3);

  // Inny użytkownik ma własny, niezależny stan.
  await otworz(page, { u: 'olek' });
  await expect(page.locator('section[data-etap-klucz]')).toHaveCount(5);
  await expect(page.locator('[data-zwiniete-panel]')).toHaveCount(0);

  // „Rozwiń wszystkie" też jest zapamiętane.
  await otworz(page);
  await page.locator('[data-zwiniete-panel]').getByRole('button', { name: 'Rozwiń wszystkie' }).click();
  await page.reload();
  await page.waitForSelector('html[data-gotowe]');
  await expect(page.locator('section[data-etap-klucz]')).toHaveCount(5);
  expect(await sql(request, `select cardinality(zwiniete) from public.ud_leady_widok_uzytkownika where user_id = tt.id_adm()`)).toBe('0');
});

test('K25b: zwinięcie nie zmienia danych leadów ani kolejności etapów', async ({ page, request }) => {
  await otworz(page);
  const przed = await sql(request, `select string_agg(id::text || ':' || wersja || ':' || etap_id::text, ',' order by id) from public.ud_leady`);
  const kolejnoscPrzed = await sql(request, `select string_agg(klucz || pozycja, ',' order by pozycja) from public.ud_leady_etap`);
  await page.getByRole('button', { name: 'Zwiń etap Oferta' }).click();
  await page.getByRole('button', { name: 'Zwiń etap Nowy' }).click();
  await page.getByRole('button', { name: 'Rozwiń etap Nowy' }).click();
  await page.waitForTimeout(300);
  expect(await sql(request, `select string_agg(id::text || ':' || wersja || ':' || etap_id::text, ',' order by id) from public.ud_leady`)).toBe(przed);
  expect(await sql(request, `select string_agg(klucz || pozycja, ',' order by pozycja) from public.ud_leady_etap`)).toBe(kolejnoscPrzed);
});
