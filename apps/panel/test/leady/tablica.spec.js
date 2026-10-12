/**
 * Scenariusze akceptacyjne K01–K13 (wytyczne „Kanban CRM", sekcja 5.2): klik,
 * przeciąganie, zapis, konflikty, dane wymagane, filtr. Wszystko na prawdziwym
 * interfejsie, prawdziwych funkcjach serwerowych i prawdziwym SQL.
 */
import { test, expect } from '@playwright/test';
import {
  adres, alert, awaria, etapId, etapLeada, karta, kolumna, leadId, liczbaHistorii, nazwyKart, otworz,
  przeciagnij, przeciagnijZPrzewijaniem, reset, sql, status, toast, wersjaLeada, wyczyscAwarie, wywolania, zwiniety,
} from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

const szczegoly = (page) => page.locator('[data-szczegoly]');
const licznik = (page, klucz) => kolumna(page, klucz).locator('[data-licznik]');
const suma = (page, klucz) => kolumna(page, klucz).locator('.suma');

test('wygląd startowy: kolumny w kolejności pipeline\'u, liczniki i sumy, pusta kolumna', async ({ page }) => {
  await otworz(page);
  const klucze = await page.locator('section[data-etap-klucz]').evaluateAll((els) => els.map((e) => e.dataset.etapKlucz));
  expect(klucze).toEqual(['nowy', 'oferta', 'decyzja', 'wygrany', 'przegrany']);
  await expect(licznik(page, 'nowy')).toHaveText('7');
  await expect(suma(page, 'nowy')).toContainText('74');
  await expect(kolumna(page, 'decyzja').getByText('Brak leadów w tym etapie.')).toBeVisible();
  await expect(page.locator('[data-zwiniete-panel]')).toHaveCount(0);   // lewy panel tylko gdy są zwinięte etapy
});

test('renderowanie po stronie serwera (SSR) nie sięga po window ani document i niesie dane', async ({ request }) => {
  const r = await request.get(`${adres()}/__test/ssr?u=ula`);
  expect(r.status()).toBe(200);
  const html = await r.text();
  expect(html).toContain('Anna Kowalska');
  expect(html).toContain('Akcje leada Anna Kowalska');
  expect(html).toContain('Brak leadów w tym etapie.');
  expect(html).not.toContain('undefined');
  expect(html).not.toContain('NaN');
  expect(html).not.toContain('80010112345');                        // PESEL nie trafia do HTML
  expect(html).not.toContain('anna@x.pl');                          // e-mail dopiero w szczegółach
});

test('K01: zwykły klik w kartę otwiera szczegóły i nie rozpoczyna przeciągania', async ({ page, request }) => {
  await otworz(page);
  const v = await wersjaLeada(request, 'Anna Kowalska');
  await karta(page, 'Anna Kowalska').locator('.kontekst').click();
  await expect(szczegoly(page)).toBeVisible();
  await expect(szczegoly(page).getByRole('heading', { name: 'Anna Kowalska' })).toBeVisible();
  await expect(page).toHaveURL(/lead=/);
  expect(await wersjaLeada(request, 'Anna Kowalska')).toBe(v);

  // Ruch poniżej progu (kilka pikseli) to nadal klik, nie przeciąganie.
  await page.getByRole('button', { name: 'Zamknij szczegóły' }).click();
  await expect(szczegoly(page)).toHaveCount(0);
  await karta(page, 'Bartek Nowak').scrollIntoViewIfNeeded();
  const k = await karta(page, 'Bartek Nowak').locator('.kontekst').boundingBox();
  await page.mouse.move(k.x + 10, k.y + 5);
  await page.mouse.down();
  await page.mouse.move(k.x + 14, k.y + 8);
  await expect(page.locator('[data-duch]')).toHaveCount(0);
  await page.mouse.up();
  await expect(szczegoly(page).getByRole('heading', { name: 'Bartek Nowak' })).toBeVisible();
  expect(await etapLeada(request, 'Bartek Nowak')).toBe('nowy');
});

test('K02: klik w „…" otwiera menu i nie otwiera szczegółów; klik w telefon też nie', async ({ page }) => {
  await otworz(page);
  const przycisk = page.getByRole('button', { name: 'Akcje leada Anna Kowalska' });
  await expect(przycisk).toHaveAttribute('aria-haspopup', 'menu');
  await expect(przycisk).toHaveAttribute('aria-expanded', 'false');
  await przycisk.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(przycisk).toHaveAttribute('aria-expanded', 'true');
  await expect(szczegoly(page)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('a[href^="tel:"]')) e.preventDefault(); }));
  await karta(page, 'Anna Kowalska').getByRole('link', { name: /Zadzwoń do Anna/ }).click();
  await expect(szczegoly(page)).toHaveCount(0);
});

test('K03: przeniesienie myszą — zapis, liczniki, sumy, historia i komunikat zgodne', async ({ page, request }) => {
  await otworz(page);
  const v = await wersjaLeada(request, 'Anna Kowalska');
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));

  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Oferta');
  await expect(status(page)).toHaveText('Anna Kowalska: Nowy → Oferta');
  await page.waitForTimeout(400);
  await expect(szczegoly(page)).toHaveCount(0);                  // upuszczenie nie jest kliknięciem w kartę
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);
  await expect(kolumna(page, 'nowy').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(0);

  // Baza.
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('oferta');
  expect(await wersjaLeada(request, 'Anna Kowalska')).toBe(v + 1);
  expect(await sql(request, `select count(*) from public.ud_leady_historia where lead_id = tt.lead('Anna Kowalska') and typ = 'etap' and wykonawca_nazwa = 'Ada Admin'`)).toBe('1');

  // Liczniki i sumy po stronie interfejsu = po stronie serwera.
  await expect(licznik(page, 'nowy')).toHaveText('6');
  await expect(licznik(page, 'oferta')).toHaveText('3');
  await expect(suma(page, 'nowy')).toContainText('66 000');
  await expect(suma(page, 'oferta')).toContainText('21 000');
  await page.getByRole('button', { name: 'Odśwież' }).click();
  await expect(licznik(page, 'nowy')).toHaveText('6');
  await expect(suma(page, 'oferta')).toContainText('21 000');
  await expect(karta(page, 'Anna Kowalska')).toHaveAttribute('data-etap-id', await etapId(request, 'oferta'));
});

test('K04: upuszczenie do pustej kolumny zmienia etap', async ({ page, request }) => {
  await otworz(page);
  await expect(kolumna(page, 'decyzja').locator('[data-karta-id]')).toHaveCount(0);
  await przeciagnij(page, karta(page, 'Bartek Nowak'), kolumna(page, 'decyzja'));
  await expect(kolumna(page, 'decyzja').locator('[data-karta-id]')).toHaveCount(1);
  await expect(kolumna(page, 'decyzja').getByText('Brak leadów w tym etapie.')).toHaveCount(0);
  await expect(licznik(page, 'decyzja')).toHaveText('1');
  expect(await etapLeada(request, 'Bartek Nowak')).toBe('decyzja');
});

test('K05: upuszczenie na zwinięty etap — zmiana etapu bez trwałego rozwinięcia, podgląd po 600 ms', async ({ page, request }) => {
  await otworz(page);
  await page.getByRole('button', { name: 'Zwiń etap Oferta' }).click();
  await expect(kolumna(page, 'oferta')).toHaveCount(0);
  const pozycja = zwiniety(page, 'Oferta');
  await expect(pozycja).toBeVisible();
  await expect(pozycja.locator('[data-licznik]')).toHaveText('2');

  // Najpierw zatrzymanie nad zwiniętym etapem: po ~600 ms pojawia się podgląd (kolumna się NIE rozwija).
  const { koniec } = await przeciagnij(page, karta(page, 'Anna Kowalska'), pozycja, { puszczaj: false });
  await expect(page.locator('[data-cel-podpowiedz]')).toContainText('Przenieś do: Oferta');
  await page.waitForTimeout(250);
  await expect(page.locator('[data-podglad]')).toHaveCount(0);
  await expect(page.locator('[data-podglad]')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('[data-podglad]')).toContainText('Henryk Sikora');
  await expect(kolumna(page, 'oferta')).toHaveCount(0);

  await page.mouse.up();
  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Oferta');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('oferta');
  // Stan zwinięcia przywrócony: nadal zwinięty, licznik 3, podglądu nie ma.
  await expect(page.locator('[data-podglad]')).toHaveCount(0);
  await expect(kolumna(page, 'oferta')).toHaveCount(0);
  await expect(pozycja.locator('[data-licznik]')).toHaveText('3');
  expect(await sql(request, `select count(*) from public.ud_leady_widok_uzytkownika where user_id = tt.id_adm() and cardinality(zwiniete) = 1`)).toBe('1');
});

test('K06: zwinięcie i rozwinięcie przywraca kolumnę na jej miejsce; panel w kolejności pipeline\'u', async ({ page }) => {
  await otworz(page);
  const kolejnosc = () => page.locator('section[data-etap-klucz]').evaluateAll((els) => els.map((e) => e.dataset.etapKlucz));

  // Zwijamy w odwrotnej kolejności niż pipeline — panel ma i tak pokazać go po kolei.
  await page.getByRole('button', { name: 'Zwiń etap Decyzja klienta' }).click();
  await page.getByRole('button', { name: 'Zwiń etap Oferta' }).click();
  expect(await kolejnosc()).toEqual(['nowy', 'wygrany', 'przegrany']);
  const wPanelu = await page.locator('[data-zw-id] .nazwa').allInnerTexts();
  expect(wPanelu).toEqual(['Oferta', 'Decyzja klienta']);
  await expect(page.locator('[data-zw-id]').first().locator('.nr')).toHaveText('2');

  await page.getByRole('button', { name: 'Rozwiń etap Oferta' }).click();
  await page.getByRole('button', { name: 'Rozwiń etap Decyzja klienta' }).click();
  expect(await kolejnosc()).toEqual(['nowy', 'oferta', 'decyzja', 'wygrany', 'przegrany']);
  await expect(page.locator('[data-zwiniete-panel]')).toHaveCount(0);

  // „Rozwiń wszystkie" z panelu.
  await page.getByRole('button', { name: 'Zwiń etap Wygrany' }).click();
  await page.getByRole('button', { name: 'Zwiń etap Przegrany' }).click();
  await page.locator('[data-zwiniete-panel]').getByRole('button', { name: 'Rozwiń wszystkie' }).click();
  expect(await kolejnosc()).toEqual(['nowy', 'oferta', 'decyzja', 'wygrany', 'przegrany']);
});

test('K07: Esc podczas przeciągania nie zmienia danych', async ({ page, request }) => {
  await otworz(page);
  const v = await wersjaLeada(request, 'Anna Kowalska');
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'), { puszczaj: false });
  await expect(page.locator('[data-duch]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-przeciaganie', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-duch]')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-przeciaganie', '');
  await page.mouse.up();
  // Przeglądarka po takim puszczeniu wysyła `click` na karcie — nie ma otwierać szczegółów.
  await page.waitForTimeout(300);
  await expect(szczegoly(page)).toHaveCount(0);
  await expect(status(page)).toContainText('anulowane');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');
  expect(await wersjaLeada(request, 'Anna Kowalska')).toBe(v);
  expect((await wywolania(request)).filter((w) => w.sciezka === 'zmien')).toHaveLength(0);
  await expect(kolumna(page, 'nowy').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);
  await expect(karta(page, 'Anna Kowalska')).not.toHaveAttribute('data-przeciagana', '');
  await expect(szczegoly(page)).toHaveCount(0);   // po Esc nie wypada „klik" otwierający szczegóły
});

test('K08: upuszczenie poza tablicą nie zmienia danych', async ({ page, request }) => {
  await otworz(page);
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'), { puszczaj: false });
  await page.mouse.move(40, 20, { steps: 6 });          // nad nagłówkiem aplikacji — nie jest celem
  await page.mouse.up();
  await page.waitForTimeout(300);                                // przeglądarka wysyła `click` na karcie — nie ma otwierać szczegółów
  await expect(szczegoly(page)).toHaveCount(0);
  await expect(page.locator('[data-duch]')).toHaveCount(0);
  await expect(status(page)).toContainText('poza etapem');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');
  expect((await wywolania(request)).filter((w) => w.sciezka === 'zmien')).toHaveLength(0);
  await expect(szczegoly(page)).toHaveCount(0);
});

test('K09: błąd zapisu — spójny powrót i komunikat (liczniki wracają)', async ({ page, request }) => {
  await otworz(page);
  await awaria(request, { sciezka: 'zmien', tryb: 'odpowiedz', status: 500, body: { status: 'blad', komunikat: 'Baza chwilowo niedostępna.' } });
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));
  await expect(toast(page)).toContainText('Baza chwilowo niedostępna');
  await expect(alert(page)).toContainText('Baza chwilowo niedostępna');
  await expect(kolumna(page, 'nowy').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(0);
  await expect(licznik(page, 'nowy')).toHaveText('7');
  await expect(licznik(page, 'oferta')).toHaveText('2');
  await expect(suma(page, 'nowy')).toContainText('74');
  await expect(page.locator('[data-stan-zapisu]')).toHaveCount(0);
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');
  // Po błędzie można spróbować ponownie.
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));
  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Oferta');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('oferta');
});

test('K09b: zerwana sieć, a zapis NIE przeszedł — sprawdzamy stan i wycofujemy zmianę', async ({ page, request }) => {
  await otworz(page);
  // Każda próba zmiany pada, zanim dotrze do bazy (przeglądarka sama ponawia POST na zerwanym
  // połączeniu, więc liczba prób po stronie serwera jest większa niż po stronie aplikacji); odczyt stanu działa.
  await awaria(request, { sciezka: 'zmien', tryb: 'zerwij', ile: 99 });
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));
  await expect(toast(page)).toContainText('Nie udało się zapisać zmiany', { timeout: 10_000 });
  await expect(kolumna(page, 'nowy').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');
  await expect(licznik(page, 'nowy')).toHaveText('7');
});

test('K09c: zerwana sieć i nie wiadomo, czy zapis przeszedł — karta oznaczona, „spróbuj ponownie" nie dubluje', async ({ page, request }) => {
  await otworz(page);
  // Pierwsza próba dochodzi do bazy, ale odpowiedź ginie; kolejne próby i odczyt stanu padają.
  await awaria(request, { sciezka: 'zmien', tryb: 'zgubOdpowiedz' });
  await awaria(request, { sciezka: 'zmien', tryb: 'zerwij', ile: 99 });
  await awaria(request, { sciezka: 'lead', tryb: 'zerwij', ile: 99 });
  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));

  const stanZapisu = karta(page, 'Anna Kowalska').locator('[data-stan-zapisu="niepewny"]');
  await expect(stanZapisu).toBeVisible({ timeout: 10_000 });
  await expect(stanZapisu).toContainText('Stan nieznany');
  await expect(toast(page)).toContainText('nie wiemy, czy zmiana została zapisana');
  // Zapis faktycznie przeszedł (pierwsza próba) — interfejs tego jeszcze nie wie.
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('oferta');
  const v = await wersjaLeada(request, 'Anna Kowalska');
  const h = await liczbaHistorii(request, 'Anna Kowalska');

  await wyczyscAwarie(request);                                              // sieć wróciła
  await stanZapisu.getByRole('button', { name: 'Spróbuj ponownie' }).click();
  await expect(karta(page, 'Anna Kowalska').locator('[data-stan-zapisu]')).toHaveCount(0);
  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Oferta');
  expect(await wersjaLeada(request, 'Anna Kowalska')).toBe(v);              // ten sam klucz: bez drugiego skutku
  expect(await liczbaHistorii(request, 'Anna Kowalska')).toBe(h);
});

test('K10: równoległa zmiana przez inną osobę — konflikt, bez cichego nadpisania', async ({ page, request }) => {
  await otworz(page);
  // Ula (opiekunka, inna sesja) przenosi Annę, zanim administrator coś zrobi.
  await sql(request, `select public.ud_lead_zmien('przenies', tt.lead('Anna Kowalska'), tt.wersja(tt.lead('Anna Kowalska')), 'ula-rownolegle-1', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('decyzja')))`);
  const vOlka = await wersjaLeada(request, 'Anna Kowalska');

  await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));
  await expect(toast(page)).toContainText('ktoś zmienił ten lead');
  await expect(alert(page)).toContainText('Anna Kowalska');
  // Interfejs pokazuje stan serwera (Decyzja klienta), nie próbę Uli (Oferta).
  await expect(kolumna(page, 'decyzja').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);
  await expect(kolumna(page, 'oferta').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(0);
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('decyzja');
  expect(await wersjaLeada(request, 'Anna Kowalska')).toBe(vOlka);
  expect(await sql(request, `select count(*) from public.ud_leady_historia where lead_id = tt.lead('Anna Kowalska') and typ = 'etap'`)).toBe('1');
  await expect(licznik(page, 'oferta')).toHaveText('2');
  await expect(licznik(page, 'decyzja')).toHaveText('1');
});

test('K11: etap z polem wymaganym — formularz przed zapisem; anulowanie zostawia stary etap', async ({ page, request }) => {
  await otworz(page);
  await przeciagnijZPrzewijaniem(page, karta(page, 'Anna Kowalska'), 'przegrany');
  const dialog = page.getByRole('dialog', { name: 'Powód utraty' });
  await expect(dialog).toBeVisible();
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');                  // nic jeszcze nie zapisano
  expect((await wywolania(request)).filter((w) => w.sciezka === 'zmien')).toHaveLength(0);
  await expect(kolumna(page, 'nowy').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');
  await expect(kolumna(page, 'nowy').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);

  // Za krótki powód nie przechodzi, poprawny tak.
  await przeciagnijZPrzewijaniem(page, karta(page, 'Anna Kowalska'), 'przegrany');
  await dialog.getByLabel('Powód utraty').fill('ab');
  await dialog.getByRole('button', { name: /Przenieś do/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('co najmniej 3 znaki');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');
  await dialog.getByLabel('Powód utraty').fill('Wybrał konkurencję');
  await dialog.getByRole('button', { name: /Przenieś do/ }).click();
  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Przegrany');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('przegrany');
  expect(await sql(request, `select powod_utraty from public.ud_leady where id = tt.lead('Anna Kowalska')`)).toBe('Wybrał konkurencję');
  // W „Przegrany" karta jest zwinięta do nazwy — powód widać po rozwinięciu.
  await karta(page, 'Anna Kowalska').getByRole('button', { name: 'Anna Kowalska', exact: true }).click();
  await expect(karta(page, 'Anna Kowalska')).toContainText('Powód utraty: Wybrał konkurencję');
});

test('K12: niedozwolony etap i brak uprawnień — odmowa także przy bezpośrednim wywołaniu API', async ({ request }) => {
  const lead = await leadId(request, 'Anna Kowalska');
  const v = await wersjaLeada(request, 'Anna Kowalska');
  await sql(request, `insert into public.ud_leady_pipeline (klucz, nazwa) values ('inny', 'Inny')`);
  const obcy = await sql(request, `insert into public.ud_leady_etap (pipeline_id, klucz, nazwa, pozycja) select id, 'obcy', 'Obcy', 10 from public.ud_leady_pipeline where klucz = 'inny' returning id`);
  const wyslij = (uzytkownik, dane, naglowki = {}) => request.post(`${adres()}/panel/leady/api/zmien`, {
    headers: { 'x-test-user': uzytkownik, 'content-type': 'application/json', ...naglowki },
    data: dane,
  });
  const baza = (k) => ({ leadId: lead, expectedVersion: v, idempotencyKey: `api-bezposrednio-${k}`, targetStageId: obcy });

  let r = await wyslij('ula', baza(1));
  expect(r.status()).toBe(422);
  expect((await r.json()).status).toBe('niedozwolony');
  r = await wyslij('ula', { ...baza(2), targetStageId: '00000000-0000-4000-8000-000000000000' });
  expect(r.status()).toBe(422);
  r = await wyslij('ines', { ...baza(3), targetStageId: await etapId(request, 'oferta') });
  expect(r.status()).toBe(403);
  r = await wyslij('brak', baza(4));
  expect(r.status()).toBe(401);
  r = await request.post(`${adres()}/panel/leady/api/zmien`, { headers: { 'x-test-user': 'ula', 'content-type': 'text/plain' }, data: JSON.stringify(baza(5)) });
  expect(r.status()).toBe(415);
  r = await wyslij('ula', { ...baza(6), targetStageId: await etapId(request, 'oferta'), userId: 'a0000000-0000-0000-0000-0000000000a1' });
  expect(r.status()).toBe(200);
  expect(await sql(request, `select wykonawca_id from public.ud_leady_historia where lead_id = '${lead}' order by id desc limit 1`)).toBe('a0000000-0000-0000-0000-0000000000a2');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('oferta');
  expect(await wersjaLeada(request, 'Anna Kowalska')).toBe(v + 1);                 // tylko to jedno, poprawne żądanie
});

test('K13: lead przestaje pasować do filtra po przeniesieniu — znika z wyjaśnieniem i akcją otwarcia', async ({ page, request }) => {
  await otworz(page, { zapytanie: 'termin=przeterminowane' });
  await expect(page.locator('[data-aktywne-filtry]')).toContainText('działanie: Przeterminowane');
  await expect(karta(page, 'Anna Kowalska')).toBeVisible();
  await expect(licznik(page, 'nowy')).toHaveText('1 z 7');

  await page.getByRole('button', { name: 'Akcje leada Anna Kowalska' }).click();
  await page.getByRole('menuitem', { name: 'Przenieś do…' }).click();
  await page.getByRole('dialog', { name: 'Przenieś do…' }).getByRole('button', { name: /^Wygrany/ }).click();
  // „Wygrany" wymaga danych sprzedaży — najpierw okno, dopiero potem zmiana etapu.
  const sprzedaz = page.getByRole('dialog', { name: 'Dane sprzedaży' });
  await sprzedaz.getByRole('button', { name: 'Dodaj ręcznie' }).click();
  await sprzedaz.getByLabel('Składka roczna *').fill('1200');
  await sprzedaz.getByRole('button', { name: /Przenieś do/ }).click();

  // Zamknięcie sprawy kasuje zaplanowane działanie, więc lead nie jest już „przeterminowany".
  await expect(karta(page, 'Anna Kowalska')).toHaveCount(0);
  await expect(toast(page)).toContainText('nie pasuje już do filtrów');
  await expect(toast(page)).toContainText('działanie: Przeterminowane');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('wygrany');
  await expect(licznik(page, 'nowy')).toHaveText('0 z 6');

  await page.getByRole('button', { name: /^Otwórz szczegóły:/ }).click();
  await expect(szczegoly(page).getByRole('heading', { name: 'Anna Kowalska' })).toBeVisible();
  await expect(szczegoly(page).getByLabel('Etap')).toHaveValue(await etapId(request, 'wygrany'));
});
