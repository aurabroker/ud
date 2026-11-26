/**
 * Zakładka „Klienci": kolumna „Akcja" zamiast „Zawód" (decyzja właściciela
 * z 05.10.2026), kolumna i filtr „Źródło" oraz sekcja „Źródło" na karcie klienta
 * (panel v.0.80), a od 20.11.2026: kolumna „Świadczenie", stan najnowszej
 * wysłanej oferty pod plakietką „Akcja", telefon pod nazwiskiem zamiast kolumny
 * „Kontakt" i strzałki „Poprzedni / Następny klient" na karcie. Strony
 * renderowane po stronie serwera z prawdziwych komponentów, z danymi z tych
 * samych funkcji co ich load (listaKlientow, kartaKlienta) na bazie testowej.
 * Menu klienta (lewy i prawy klik, „⋯") — w przeglądarce: klienci-menu.spec.js.
 */
import { test, expect } from '@playwright/test';
import { adres, reset, sql } from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

async function wczytaj(page, request, u, zapytanie = '') {
  const r = await request.get(`${adres()}/__test/ssr-klienci${zapytanie}`, { headers: { 'x-test-user': u } });
  expect(r.status(), await r.text()).toBe(200);
  await page.setContent(await r.text());
}
const wiersz = (page, nazwa) => page.locator('tbody tr', { has: page.locator('.nazwa-klienta', { hasText: nazwa }) });
const akcja = (page, nazwa) => wiersz(page, nazwa).locator('[data-akcja]');
const nazwy = (page) => page.locator('tbody tr .nazwa-klienta');

test('kolumna „Akcja" z etapu leada; „Zawód" zniknął; odnośnik prowadzi do leada na tablicy', async ({ page, request }) => {
  await sql(request, `update public.ud_leady set etap_id = tt.etap('oferta') where id = tt.lead('Anna Kowalska');
    update public.ud_leady set etap_id = tt.etap('decyzja') where id = tt.lead('Ewa Mazur');
    update public.ud_leady set etap_id = tt.etap('wygrany'), skladka_roczna = 2400, ochrona_od = current_date - 10,
           ochrona_do = current_date + 355 where id = tt.lead('Grażyna Pawlak');
    update public.ud_leady set etap_id = tt.etap('wygrany'), skladka_roczna = 1200, ochrona_od = current_date - 400,
           ochrona_do = current_date - 35 where id = tt.lead('Bartek Nowak');
    update public.ud_leady set etap_id = tt.etap('przegrany'), powod_utraty = 'Za drogo' where id = tt.lead('Filip Lis');
    update public.ud_leady set etap_id = tt.etap('nowy') where id = tt.lead('Irena Kubiak');`);
  await wczytaj(page, request, 'adm');

  await expect(page.locator('thead th')).toHaveText(['Klient', 'Świadczenie', 'Akcja', 'Źródło', 'Przypisany do', 'Dodano']);
  await expect(page.locator('body')).not.toContainText('Zawód');

  await expect(akcja(page, 'Anna Kowalska')).toHaveText('Oferta wysłana');
  await expect(akcja(page, 'Ewa Mazur')).toHaveText('Czeka na decyzję klienta');
  await expect(akcja(page, 'Grażyna Pawlak')).toHaveText('Klient ubezpieczony');
  await expect(akcja(page, 'Bartek Nowak')).toHaveText('Polisa wygasła');
  await expect(akcja(page, 'Filip Lis')).toHaveText('Klient zrezygnował');
  await expect(akcja(page, 'Filip Lis').locator('a')).toHaveAttribute('title', 'Powód: Za drogo');
  await expect(akcja(page, 'Irena Kubiak')).toHaveText('Do kontaktu');

  const lead = await sql(request, `select tt.lead('Anna Kowalska')`);
  await expect(akcja(page, 'Anna Kowalska').locator('a')).toHaveAttribute('href', `/panel/leady?lead=${lead}`);

  // Szukanie obejmuje akcję.
  await expect(page.getByPlaceholder('Szukaj: nazwisko, email, telefon, akcja…')).toBeVisible();
});

test('zarchiwizowany lead: klient znika z listy i stoi w „Archiwum" — z etapem, bez odnośnika do tablicy', async ({ page, request }) => {
  await sql(request, `update public.ud_leady set etap_id = tt.etap('wygrany'), skladka_roczna = 2400,
           zarchiwizowano_at = now() where id = tt.lead('Grażyna Pawlak');
    update public.ud_leady set etap_id = tt.etap('przegrany'), powod_utraty = 'Za drogo',
           zarchiwizowano_at = now() where id = tt.lead('Filip Lis');`);
  const wszyscy = Number(await sql(request, 'select count(*) from public.ud_clients'));

  await wczytaj(page, request, 'adm');
  await expect(wiersz(page, 'Grażyna Pawlak')).toHaveCount(0);
  await expect(wiersz(page, 'Filip Lis')).toHaveCount(0);
  await expect(page.locator('[data-widok="aktywni"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-widok="aktywni"] .ile')).toHaveText(String(wszyscy - 2));
  await expect(page.locator('[data-widok="archiwum"] .ile')).toHaveText('2');
  await expect(page.locator('[data-widok="archiwum"]')).toHaveAttribute('href', '/panel/klienci?widok=archiwum');
  await expect(page.locator('tbody tr')).toHaveCount(wszyscy - 2);

  await wczytaj(page, request, 'adm', '?widok=archiwum');
  await expect(page.locator('[data-widok="archiwum"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(akcja(page, 'Grażyna Pawlak')).toHaveText('Klient ubezpieczony');
  await expect(akcja(page, 'Grażyna Pawlak').locator('a')).toHaveCount(0);
  await expect(akcja(page, 'Filip Lis')).toHaveText('Klient zrezygnował');
  await expect(akcja(page, 'Filip Lis').locator('[title]')).toHaveAttribute('title', 'Powód: Za drogo');
  await expect(page.locator('main, body')).toContainText('2 w archiwum');
  // Nazwisko nadal prowadzi do karty klienta — z widokiem, z którego agent przyszedł (strzałki na karcie).
  await expect(wiersz(page, 'Grażyna Pawlak').locator('.nazwa-klienta')).toHaveAttribute('href', /^\/panel\/klienci\/[0-9a-f-]{36}\?widok=archiwum$/);
});

test('puste archiwum mówi, co tu trafia', async ({ page, request }) => {
  await wczytaj(page, request, 'adm', '?widok=archiwum');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('body')).toContainText('Archiwum jest puste');
  await expect(page.locator('[data-widok="archiwum"] .ile')).toHaveText('0');
});

test('agent widzi tylko klientów swoich leadów — z ich akcją', async ({ page, request }) => {
  await wczytaj(page, request, 'ula');
  const nazwyUli = await nazwy(page).allTextContents();
  const ula = (await sql(request, `select string_agg(c.full_name, '|' order by c.full_name) from public.ud_leady l
                                     join public.ud_clients c on c.id = l.klient_id
                                    where l.opiekun_id = tt.id_ula() and l.zarchiwizowano_at is null`)).split('|');
  expect([...nazwyUli].map((n) => n.trim()).sort()).toEqual(expect.arrayContaining(ula));
  expect(nazwyUli.length).toBeLessThan(Number(await sql(request, 'select count(*) from public.ud_clients')));
  for (const n of nazwyUli) await expect(akcja(page, n.trim())).not.toHaveText('—');
});

// ─── Źródło (panel v.0.80) ──────────────────────────────────────────────────
// form_data.zrodlo zapisuje kreator wniosku; identyfikator kliknięcia jest tam
// tylko przy zgodzie na cookies marketingowe i nie może dojść do przeglądarki.
async function zrodla(request) {
  await sql(request, `
    update public.ud_clients set form_data = '{"zrodlo": {"utm_source": "ads", "utm_medium": "internet", "utm_campaign": "jesien26",
      "utm_term": "utratadochodu", "platne": true, "zgoda_marketing": true, "gclid": "GCLID-SEKRET-1"},
      "gclid": "GCLID-SEKRET-WIERZCH", "med_heart": "ODPOWIEDZ-ANKIETY"}' where full_name = 'Anna Kowalska';
    update public.ud_clients set affiliate_code_used = 'AG7' where full_name = 'Bartek Nowak';
    update public.ud_clients set form_data = '{"zrodlo": {"utm_source": "facebook", "platne": false, "zgoda_marketing": false}}'
     where full_name = 'Celina Zielińska';
    update public.ud_clients set form_data = '{"zrodlo": {"platne": true, "gad_source": "1", "gad_campaignid": "998877",
      "zgoda_marketing": true, "gbraid": "GBRAID-SEKRET-2"}}' where full_name = 'Dariusz Wójcik';`);
}
const zrodlo = (page, nazwa) => wiersz(page, nazwa).locator('td[data-zrodlo]');
const daneStrony = async (page) => page.locator('#dane-strony').textContent();

test('kolumna „Źródło": rodzaj z reguły zrodlo.js, kampania pod spodem i w podpowiedzi', async ({ page, request }) => {
  await zrodla(request);
  await wczytaj(page, request, 'adm');

  await expect(zrodlo(page, 'Anna Kowalska')).toHaveAttribute('data-zrodlo', 'ads');
  await expect(zrodlo(page, 'Anna Kowalska').locator('.badge')).toHaveText('Google Ads');
  await expect(zrodlo(page, 'Anna Kowalska').locator('.badge')).toHaveAttribute('title', 'Kampania: jesien26 · Słowo kluczowe: utratadochodu');
  await expect(zrodlo(page, 'Anna Kowalska').locator('.kampania')).toHaveText('jesien26');
  await expect(zrodlo(page, 'Dariusz Wójcik').locator('.badge')).toHaveText('Google Ads');
  await expect(zrodlo(page, 'Dariusz Wójcik').locator('.kampania')).toHaveText('998877');   // gad_campaignid bez utm_campaign
  await expect(zrodlo(page, 'Bartek Nowak').locator('.badge')).toHaveText('Link agenta');
  await expect(zrodlo(page, 'Bartek Nowak').locator('.kampania')).toHaveCount(0);
  await expect(zrodlo(page, 'Celina Zielińska').locator('.badge')).toHaveText('Inne: facebook');
  await expect(zrodlo(page, 'Ewa Mazur').locator('.badge')).toHaveText('Brak danych');
  await expect(zrodlo(page, 'Ewa Mazur').locator('.badge')).not.toHaveAttribute('title', /.+/);

  // Do przeglądarki nie idzie identyfikator kliknięcia ani reszta form_data (lista czyta tylko form_data->zrodlo).
  const dane = await daneStrony(page);
  expect(dane).not.toMatch(/SEKRET|gclid|gbraid|wbraid/);
  expect(dane).not.toContain('ODPOWIEDZ-ANKIETY');
  expect(dane).not.toContain('affiliate_code_used');
  expect(await page.content()).not.toMatch(/SEKRET|gclid/);
});

test('filtr źródła w adresie: plakietki z liczbami, łączy się z widokiem Archiwum, szukanie dalej działa', async ({ page, request }) => {
  await zrodla(request);
  const wszyscy = Number(await sql(request, 'select count(*) from public.ud_clients'));
  await wczytaj(page, request, 'adm');

  const filtr = (k) => page.locator(`[data-zrodlo-filtr="${k}"]`);
  await expect(filtr('wszystkie')).toHaveAttribute('aria-current', 'page');
  await expect(filtr('wszystkie').locator('.ile')).toHaveText(String(wszyscy));
  await expect(filtr('ads').locator('.ile')).toHaveText('2');
  await expect(filtr('agent').locator('.ile')).toHaveText('1');
  await expect(filtr('inne').locator('.ile')).toHaveText('1');
  await expect(filtr('brak').locator('.ile')).toHaveText(String(wszyscy - 4));
  await expect(filtr('ads')).toHaveAttribute('href', '/panel/klienci?zrodlo=ads');
  await expect(filtr('wszystkie')).toHaveAttribute('href', '/panel/klienci');

  await wczytaj(page, request, 'adm', '?zrodlo=ads');
  await expect(filtr('ads')).toHaveAttribute('aria-current', 'page');
  await expect(filtr('wszystkie')).not.toHaveAttribute('aria-current', /.+/);
  // Kolejność listy: najnowsi u góry (Dariusz dodany 22 dni temu, Anna — 40).
  await expect(nazwy(page)).toHaveText(['Dariusz Wójcik', 'Anna Kowalska']);
  // Nazwisko niesie filtr na kartę (strzałki „Poprzedni / Następny" po tej samej liście).
  await expect(wiersz(page, 'Anna Kowalska').locator('.nazwa-klienta')).toHaveAttribute('href', /^\/panel\/klienci\/[0-9a-f-]{36}\?zrodlo=ads$/);
  await expect(page.locator('main, body')).toContainText('2 klientów');

  // Nieznana wartość = bez filtra (stary albo zepsuty link nie chowa listy).
  await wczytaj(page, request, 'adm', '?zrodlo=cokolwiek');
  await expect(page.locator('tbody tr')).toHaveCount(wszyscy);

  // Archiwum + źródło: filtr w obrębie widoku, odnośniki niosą oba parametry.
  await sql(request, `update public.ud_leady set zarchiwizowano_at = now() where id in (tt.lead('Anna Kowalska'), tt.lead('Ewa Mazur'))`);
  await wczytaj(page, request, 'adm', '?widok=archiwum&zrodlo=ads');
  await expect(page.locator('[data-widok="archiwum"]')).toHaveAttribute('aria-current', 'page');
  await expect(nazwy(page)).toHaveText(['Anna Kowalska']);
  await expect(filtr('wszystkie').locator('.ile')).toHaveText('2');
  await expect(filtr('brak').locator('.ile')).toHaveText('1');
  await expect(filtr('brak')).toHaveAttribute('href', '/panel/klienci?widok=archiwum&zrodlo=brak');
  await expect(filtr('wszystkie')).toHaveAttribute('href', '/panel/klienci?widok=archiwum');
  await wczytaj(page, request, 'adm', '?widok=archiwum&zrodlo=agent');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('body')).toContainText('Brak klientów ze źródłem „Link agenta".');

  // Szukanie (stan komponentu) działa w przeglądarce — tu sprawdzamy tylko, że pole zostało.
  await expect(page.getByPlaceholder('Szukaj: nazwisko, email, telefon, akcja…')).toBeVisible();
});

async function karta(page, request, u, nazwa, status = 200) {
  const r = await request.get(`${adres()}/__test/ssr-klient?nazwa=${encodeURIComponent(nazwa)}`, { headers: { 'x-test-user': u } });
  expect(r.status(), await r.text()).toBe(status);
  if (status === 200) await page.setContent(await r.text());
}

test('karta klienta: sekcja „Źródło" — rodzaj, kampania, słowo; identyfikatora kliknięcia nie ma ani na stronie, ani w danych', async ({ page, request }) => {
  await zrodla(request);
  await karta(page, request, 'adm', 'Anna Kowalska');

  const sekcja = page.locator('[data-zrodlo-karta]');
  await expect(sekcja).toHaveAttribute('data-zrodlo-karta', 'ads');
  await expect(sekcja.getByRole('heading', { name: 'Źródło' })).toBeVisible();
  await expect(sekcja.locator('[data-zrodlo-rodzaj]')).toHaveText('Google Ads');
  await expect(sekcja.locator('[data-zrodlo-kampania]')).toHaveText('jesien26');
  await expect(sekcja.locator('[data-zrodlo-slowo]')).toHaveText('utratadochodu');
  await expect(sekcja.locator('[data-zrodlo-brak]')).toHaveCount(0);
  await expect(sekcja.locator('tr td:first-child')).toHaveText(['Rodzaj', 'Kampania', 'Słowo kluczowe']);

  // Kolumna source to „Sposób zgłoszenia" — dwóch etykiet „Źródło…" na karcie nie ma.
  await expect(page.locator('body')).toContainText('Sposób zgłoszenia');
  await expect(page.locator('body')).not.toContainText('Źródło zgłoszenia');

  expect(await page.content()).not.toMatch(/SEKRET|gclid|gbraid|wbraid/);
  const dane = await daneStrony(page);
  expect(dane).not.toMatch(/SEKRET|gclid|gbraid|wbraid/);
  // Wycięte są TYLKO identyfikatory: reszta form_data (i źródła) zostaje.
  const d = JSON.parse(dane);
  expect(d.client.form_data.med_heart).toBe('ODPOWIEDZ-ANKIETY');
  expect(d.client.form_data.zrodlo).toEqual({ utm_source: 'ads', utm_medium: 'internet', utm_campaign: 'jesien26',
    utm_term: 'utratadochodu', platne: true, zgoda_marketing: true });
  expect(d.zrodlo).toEqual({ klucz: 'ads', etykieta: 'Google Ads', kampania: 'jesien26', slowo: 'utratadochodu' });
  // W bazie identyfikator został — panel go tylko nie pokazuje.
  expect(await sql(request, `select form_data->'zrodlo'->>'gclid' from public.ud_clients where full_name = 'Anna Kowalska'`)).toBe('GCLID-SEKRET-1');
});

test('karta klienta: kampania z gad_campaignid, link agenta bez kampanii, „Brak danych" z wyjaśnieniem', async ({ page, request }) => {
  await zrodla(request);
  await karta(page, request, 'adm', 'Dariusz Wójcik');
  await expect(page.locator('[data-zrodlo-rodzaj]')).toHaveText('Google Ads');
  await expect(page.locator('[data-zrodlo-kampania]')).toHaveText('998877');
  await expect(page.locator('[data-zrodlo-slowo]')).toHaveCount(0);
  expect(await daneStrony(page)).not.toMatch(/SEKRET|gbraid/);

  await karta(page, request, 'adm', 'Bartek Nowak');
  await expect(page.locator('[data-zrodlo-rodzaj]')).toHaveText('Link agenta');
  await expect(page.locator('[data-zrodlo-kampania]')).toHaveCount(0);
  await expect(page.locator('[data-zrodlo-brak]')).toHaveCount(0);

  await karta(page, request, 'adm', 'Ewa Mazur');
  await expect(page.locator('[data-zrodlo-karta]')).toHaveAttribute('data-zrodlo-karta', 'brak');
  await expect(page.locator('[data-zrodlo-rodzaj]')).toHaveText('Brak danych');
  await expect(page.locator('[data-zrodlo-brak]')).toHaveText('Wejście bez parametrów kampanii (wyszukiwarka, adres wpisany ręcznie, link bez UTM-ów), wniosek sprzed zapisywania źródła albo klient dodany w panelu.');
});

test('karta klienta: agent widzi tylko klientów swoich leadów (cudzy = 404)', async ({ page, request }) => {
  await zrodla(request);
  await karta(page, request, 'ula', 'Anna Kowalska');                 // lead Uli
  await expect(page.locator('[data-zrodlo-rodzaj]')).toHaveText('Google Ads');
  await karta(page, request, 'ula', 'Celina Zielińska', 404);         // lead Olka
  await karta(page, request, 'ines', 'Anna Kowalska', 404);           // konto nieaktywne
});

// ─── 20.11.2026: Świadczenie, stan oferty, telefon pod nazwiskiem, strzałki na karcie ──

test('kolumny „Kontakt" nie ma: telefon pod nazwiskiem (tel:), e-mail tylko w danych strony (menu)', async ({ page, request }) => {
  await sql(request, `update public.ud_clients set phone = '+48 600 200 300' where full_name = 'Bartek Nowak';
    update public.ud_clients set phone = 'brak' where full_name = 'Celina Zielińska';
    update public.ud_clients set phone = null where full_name = 'Ewa Mazur';`);
  await wczytaj(page, request, 'adm');

  await expect(page.locator('thead th', { hasText: 'Kontakt' })).toHaveCount(0);
  const tel = (nazwa) => wiersz(page, nazwa).locator('td:first-child [data-telefon]');
  await expect(tel('Anna Kowalska')).toHaveText('500100200');
  await expect(tel('Anna Kowalska')).toHaveAttribute('href', 'tel:500100200');
  await expect(tel('Bartek Nowak')).toHaveText('+48 600 200 300');
  await expect(tel('Bartek Nowak')).toHaveAttribute('href', 'tel:+48600200300');
  // Napis bez cyfr zostaje napisem — nie robimy z niego odnośnika do dzwonienia.
  await expect(tel('Celina Zielińska')).toHaveText('brak');
  await expect(tel('Celina Zielińska')).not.toHaveAttribute('href', /.*/);
  await expect(tel('Ewa Mazur')).toHaveCount(0);
  // Ta sama komórka co nazwisko (układ „pod nazwiskiem" ze stylami sprawdza klienci-menu.spec.js).
  await expect(wiersz(page, 'Anna Kowalska').locator('td:first-child .nazwa-klienta')).toHaveText('Anna Kowalska');

  // E-mail zniknął z tabeli, ale jest w danych strony — z nich menu robi „Napisz e-mail".
  await expect(page.locator('table')).not.toContainText('anna@x.pl');
  const dane = JSON.parse(await daneStrony(page));
  expect(dane.find((c) => c.full_name === 'Anna Kowalska').email).toBe('anna@x.pl');
  // Każdy wiersz ma przycisk menu dla klawiatury.
  await expect(wiersz(page, 'Anna Kowalska').locator('button[data-menu-klienta]')).toHaveAttribute('aria-haspopup', 'menu');
  await expect(wiersz(page, 'Anna Kowalska').locator('button[data-menu-klienta]')).toHaveAttribute('aria-expanded', 'false');
  await expect(wiersz(page, 'Anna Kowalska').locator('button[data-menu-klienta]')).toHaveAttribute('aria-label', 'Menu klienta: Anna Kowalska');
});

test('kolumna „Świadczenie": kwota miesięczna z wniosku po polsku, „—" przy pustej i nieczytelnej, nigdy NaN', async ({ page, request }) => {
  // Kolumna jest tekstowa (na produkcji 20.11.2026: 73 wiersze z samymi cyframi, 10 pustych); reszta to wpisy z panelu.
  await sql(request, `update public.ud_clients set temp_incapacity_sum = '12 500 zł' where full_name = 'Bartek Nowak';
    update public.ud_clients set temp_incapacity_sum = 'abc' where full_name = 'Dariusz Wójcik';
    update public.ud_clients set temp_incapacity_sum = '1e5' where full_name = 'Filip Lis';
    update public.ud_clients set temp_incapacity_sum = '7 500,50' where full_name = 'Grażyna Pawlak';
    update public.ud_clients set temp_incapacity_sum = '0' where full_name = 'Henryk Sikora';
    update public.ud_clients set temp_incapacity_sum = '   ' where full_name = 'Irena Kubiak';
    update public.ud_clients set temp_incapacity_sum = '-5000' where full_name = 'Jerzy Duda';`);
  await wczytaj(page, request, 'adm');
  const sw = (nazwa) => wiersz(page, nazwa).locator('td[data-swiadczenie]');

  await expect(sw('Anna Kowalska')).toHaveText('8000 zł/mies.');          // format panelu (money): 4 cyfry bez spacji
  await expect(sw('Celina Zielińska')).toHaveText('15 000 zł/mies.');
  await expect(sw('Bartek Nowak')).toHaveText('12 500 zł/mies.');
  await expect(sw('Grażyna Pawlak')).toHaveText('7500,5 zł/mies.');
  await expect(sw('Henryk Sikora')).toHaveText('0 zł/mies.');
  for (const n of ['Ewa Mazur', 'Dariusz Wójcik', 'Filip Lis', 'Irena Kubiak', 'Jerzy Duda']) await expect(sw(n)).toHaveText('—');
  await expect(page.locator('table')).not.toContainText('NaN');
  await expect(page.locator('table')).not.toContainText('undefined');

  // Do przeglądarki idzie liczba, nie surowy tekst kolumny.
  const dane = JSON.parse(await daneStrony(page));
  const anna = dane.find((c) => c.full_name === 'Anna Kowalska');
  expect(anna.swiadczenie).toBe(8000);
  expect(anna).not.toHaveProperty('temp_incapacity_sum');
  expect(dane.find((c) => c.full_name === 'Dariusz Wójcik').swiadczenie).toBeNull();
});

// Oferty o stałych datach (południe czasu polskiego), żeby „DD.MM" nie zależało od godziny testu.
async function oferty(request) {
  await sql(request, `insert into public.ud_offers (client_id, user_id, status, offer_number, created_at, sent_at, viewed_at, wersja, decided_at, client_choice, archived_at) values
    -- Anna: wysłana i otwarta po wysyłce.
    ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2', 'viewed', 'UD/2026/A1', '2026-11-09 12:00+01',
     '2026-11-10 12:00+01', '2026-11-12 09:00+01', 1, null, null, null),
    -- Bartek: wysłana, nieotwarta.
    ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000a2', 'sent', 'UD/2026/B1', '2026-11-15 11:00+01',
     '2026-11-15 12:00+01', null, 1, null, null, null),
    -- Celina: klient otworzył wersję 1 (12.11), agent wysłał wersję 2 (16.11) — tej nie otworzył.
    ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000a3', 'sent', 'UD/2026/C1', '2026-11-10 11:00+01',
     '2026-11-16 10:00+01', '2026-11-12 18:00+01', 2, null, null, null),
    -- Dariusz: starsza otwarta, nowsza nieotwarta, szkic (nie liczy się) i najnowsza — otwarta, potem zarchiwizowana.
    -- Liczy się najnowsza wysłana, także z archiwum (z dopiskiem); powrót do D2 byłby „nieotwarta" o kliencie, który otworzył.
    ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-0000000000a2', 'viewed', 'UD/2026/D1', '2026-10-31 12:00+01',
     '2026-11-01 12:00+01', '2026-11-02 12:00+01', 1, null, null, null),
    ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-0000000000a2', 'sent', 'UD/2026/D2', '2026-11-13 12:00+01',
     '2026-11-14 12:00+01', null, 1, null, null, null),
    ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-0000000000a2', 'draft', 'UD/2026/D3', '2026-11-19 12:00+01',
     null, null, 1, null, null, null),
    ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-0000000000a2', 'viewed', 'UD/2026/D4', '2026-11-17 12:00+01',
     '2026-11-18 12:00+01', '2026-11-18 13:00+01', 1, null, null, '2026-11-19 12:00+01'),
    -- Ewa: otwarta i wybrany wariant.
    ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-0000000000a2', 'chosen', 'UD/2026/E1', '2026-11-04 12:00+01',
     '2026-11-05 12:00+01', '2026-11-06 12:00+01', 1, '2026-11-07 15:00+01', '{"document_id": "x", "chosen_at": "2026-11-07T15:00:00+01:00"}', null),
    -- Filip: otwarta i rezygnacja.
    ('c0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-0000000000a2', 'rejected', 'UD/2026/F1', '2026-11-02 12:00+01',
     '2026-11-03 12:00+01', '2026-11-04 12:00+01', 1, '2026-11-08 10:00+01', '{"rejected": true, "rejected_at": "2026-11-08T10:00:00+01:00"}', null),
    -- Grażyna: tylko szkic — nic do pokazania.
    ('c0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-0000000000a3', 'draft', 'UD/2026/G1', '2026-11-18 12:00+01',
     null, null, 1, null, null, null),
    -- Henryk: wybór kliknięty w karcie otwartej przed ponowną wysyłką — ani „otwarta", ani „nieotwarta".
    ('c0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-0000000000a2', 'chosen', 'UD/2026/H1', '2026-11-09 12:00+01',
     '2026-11-16 12:00+01', '2026-11-10 12:00+01', 2, '2026-11-17 12:00+01', '{"document_id": "y", "chosen_at": "2026-11-17T12:00:00+01:00"}', null);`);
}
const oferta = (page, nazwa) => wiersz(page, nazwa).locator('[data-oferta]');

test('„Akcja": pod plakietką stan najnowszej wysłanej oferty — wysłana / otwarta / nieotwarta, ponowna wysyłka bez fałszywego „otwarta"', async ({ page, request }) => {
  await oferty(request);
  await wczytaj(page, request, 'adm');

  await expect(oferta(page, 'Anna Kowalska')).toHaveText('wysłana 10.11 · otwarta 12.11');
  await expect(oferta(page, 'Anna Kowalska')).toHaveAttribute('data-oferta', 'otwarta');
  await expect(oferta(page, 'Anna Kowalska')).toHaveAttribute('title',
    'Najnowsza wysłana oferta UD/2026/A1: wysłana 10.11.2026, otwarta 12.11.2026. Otwarta = klient wpisał kod i zobaczył ofertę.');
  await expect(oferta(page, 'Bartek Nowak')).toHaveText('wysłana 15.11 · nieotwarta');
  await expect(oferta(page, 'Bartek Nowak')).toHaveAttribute('data-oferta', 'nieotwarta');
  // Ponowna wysyłka po otwarciu poprzedniej wersji: viewed_at starsze niż sent_at.
  await expect(oferta(page, 'Celina Zielińska')).toHaveText('wysłana ponownie 16.11 · nieotwarta (poprzednia wersja otwarta 12.11)');
  await expect(oferta(page, 'Celina Zielińska')).toHaveAttribute('data-oferta', 'nieotwarta');
  await expect(oferta(page, 'Celina Zielińska')).toHaveAttribute('title', /wysłana 16\.11\.2026 \(wersja 2\), ta wersja jeszcze nieotwarta, poprzednia wersja otwarta 12\.11\.2026/);
  await expect(oferta(page, 'Dariusz Wójcik')).toHaveText('wysłana 18.11 · otwarta 18.11 · w archiwum');
  await expect(oferta(page, 'Dariusz Wójcik')).toHaveAttribute('data-oferta', 'otwarta');
  await expect(oferta(page, 'Dariusz Wójcik')).toHaveAttribute('title', /^Najnowsza wysłana oferta UD\/2026\/D4 \(w archiwum\): /);
  await expect(oferta(page, 'Ewa Mazur')).toHaveText('wysłana 05.11 · otwarta 06.11 · wariant wybrany 07.11');
  await expect(oferta(page, 'Filip Lis')).toHaveText('wysłana 03.11 · otwarta 04.11 · rezygnacja 08.11');
  await expect(oferta(page, 'Henryk Sikora')).toHaveText('wysłana ponownie 16.11 · wariant wybrany 17.11');
  await expect(oferta(page, 'Henryk Sikora')).toHaveAttribute('data-oferta', 'decyzja');
  await expect(oferta(page, 'Grażyna Pawlak')).toHaveCount(0);
  await expect(oferta(page, 'Irena Kubiak')).toHaveCount(0);
  await expect(oferta(page, 'Jerzy Duda')).toHaveAttribute('data-oferta', 'otwarta');   // oferta z fixture

  // Plakietka etapu zostaje osobno (ten sam [data-akcja] co wcześniej).
  await expect(akcja(page, 'Anna Kowalska')).toHaveText('Do kontaktu');
  // Do przeglądarki idą tylko opisy — bez identyfikatorów ofert ani wyboru klienta.
  const dane = await daneStrony(page);
  expect(dane).not.toContain('document_id');
  expect(dane).not.toContain('client_choice');
});

test('agent: stan oferty tylko przy swoich klientach', async ({ page, request }) => {
  await oferty(request);
  await wczytaj(page, request, 'ula');
  await expect(oferta(page, 'Anna Kowalska')).toHaveText('wysłana 10.11 · otwarta 12.11');
  await expect(wiersz(page, 'Celina Zielińska')).toHaveCount(0);   // klientka Olka
  expect(await daneStrony(page)).not.toContain('UD/2026/C1');
});

// ─── Karta klienta: „Poprzedni / Następny klient" ───────────────────────────
const KOLEJNOSC_SQL = `select string_agg(full_name, '|' order by created_at desc, id desc) from public.ud_clients`;
const idKlienta = (request, nazwa) => sql(request, `select id from public.ud_clients where full_name = '${nazwa}'`);
async function kartaZ(page, request, u, nazwa, zapytanie = '') {
  const r = await request.get(`${adres()}/__test/ssr-klient?nazwa=${encodeURIComponent(nazwa)}${zapytanie ? `&${zapytanie}` : ''}`,
    { headers: { 'x-test-user': u } });
  expect(r.status(), await r.text()).toBe(200);
  await page.setContent(await r.text());
}
const poprzedni = (page) => page.locator('[data-poprzedni]');
const nastepny = (page) => page.locator('[data-nastepny]');
async function prowadziDo(request, locator, nazwa, zapytanie = '') {
  await expect(locator).toHaveAttribute('href', `/panel/klienci/${await idKlienta(request, nazwa)}${zapytanie}`);
}
async function nieaktywny(locator) {
  await expect(locator).toHaveAttribute('aria-disabled', 'true');
  await expect(locator).not.toHaveAttribute('href', /.*/);
}

test('karta: strzałki idą dokładnie w kolejności listy (najnowsi u góry), na końcach są nieaktywne', async ({ page, request }) => {
  const kolejnosc = (await sql(request, KOLEJNOSC_SQL)).split('|');
  // Lista ma tę samą kolejność co niezależnie policzona w SQL.
  await wczytaj(page, request, 'adm');
  await expect(nazwy(page)).toHaveText(kolejnosc);

  await kartaZ(page, request, 'adm', kolejnosc[0]);
  await nieaktywny(poprzedni(page));
  await prowadziDo(request, nastepny(page), kolejnosc[1]);
  await expect(page.locator('[data-pozycja]')).toHaveText(`1 z ${kolejnosc.length}`);
  await expect(page.locator('[data-powrot]')).toHaveAttribute('href', '/panel/klienci');

  const i = 4;
  await kartaZ(page, request, 'adm', kolejnosc[i]);
  await prowadziDo(request, poprzedni(page), kolejnosc[i - 1]);
  await prowadziDo(request, nastepny(page), kolejnosc[i + 1]);
  await expect(poprzedni(page)).toHaveAttribute('title', `Poprzedni klient: ${kolejnosc[i - 1]}`);
  await expect(nastepny(page)).toHaveAttribute('title', `Następny klient: ${kolejnosc[i + 1]}`);
  await expect(page.locator('[data-pozycja]')).toHaveText(`${i + 1} z ${kolejnosc.length}`);

  await kartaZ(page, request, 'adm', kolejnosc.at(-1));
  await prowadziDo(request, poprzedni(page), kolejnosc.at(-2));
  await nieaktywny(nastepny(page));
});

test('karta: ta sama chwila dodania — rozstrzyga identyfikator, tak samo na liście i na karcie', async ({ page, request }) => {
  await sql(request, `update public.ud_clients set created_at = '2026-11-01 12:00:00+01'
                       where full_name in ('Henryk Sikora', 'Irena Kubiak')`);
  const kolejnosc = (await sql(request, KOLEJNOSC_SQL)).split('|');
  const h = kolejnosc.indexOf('Henryk Sikora');
  expect(kolejnosc[h - 1]).toBe('Irena Kubiak');           // id …09 > …08
  await wczytaj(page, request, 'adm');
  await expect(nazwy(page)).toHaveText(kolejnosc);
  await kartaZ(page, request, 'adm', 'Irena Kubiak');
  await prowadziDo(request, nastepny(page), 'Henryk Sikora');
  await kartaZ(page, request, 'adm', 'Henryk Sikora');
  await prowadziDo(request, poprzedni(page), 'Irena Kubiak');
});

test('karta: filtr źródła i widok Archiwum idą z listy na kartę — w strzałkach i w „Wróć do listy"', async ({ page, request }) => {
  await zrodla(request);   // Google Ads: Anna (40 dni) i Dariusz (22 dni)
  await kartaZ(page, request, 'adm', 'Dariusz Wójcik', 'zrodlo=ads');
  await nieaktywny(poprzedni(page));
  await prowadziDo(request, nastepny(page), 'Anna Kowalska', '?zrodlo=ads');
  await expect(page.locator('[data-pozycja]')).toHaveText('1 z 2');
  await expect(page.locator('[data-powrot]')).toHaveAttribute('href', '/panel/klienci?zrodlo=ads');
  await kartaZ(page, request, 'adm', 'Anna Kowalska', 'zrodlo=ads');
  await prowadziDo(request, poprzedni(page), 'Dariusz Wójcik', '?zrodlo=ads');
  await nieaktywny(nastepny(page));

  // Archiwum: Grażyna (16 dni) i Filip (18 dni).
  await sql(request, `update public.ud_leady set zarchiwizowano_at = now() where id in (tt.lead('Grażyna Pawlak'), tt.lead('Filip Lis'))`);
  await kartaZ(page, request, 'adm', 'Filip Lis', 'widok=archiwum');
  await prowadziDo(request, poprzedni(page), 'Grażyna Pawlak', '?widok=archiwum');
  await nieaktywny(nastepny(page));
  await expect(page.locator('[data-pozycja]')).toHaveText('2 z 2');
  await expect(page.locator('[data-powrot]')).toHaveAttribute('href', '/panel/klienci?widok=archiwum');
  // Oba filtry naraz (Archiwum + „Brak danych").
  await kartaZ(page, request, 'adm', 'Grażyna Pawlak', 'widok=archiwum&zrodlo=brak');
  await nieaktywny(poprzedni(page));
  await prowadziDo(request, nastepny(page), 'Filip Lis', '?widok=archiwum&zrodlo=brak');

  // Karta klienta spoza widoku (zarchiwizowana, otwarta z listy bieżącej): sąsiedzi z miejsca,
  // w którym by stała — bez numeru pozycji, bo na tej liście jej nie ma.
  await kartaZ(page, request, 'adm', 'Grażyna Pawlak');
  await prowadziDo(request, poprzedni(page), 'Henryk Sikora');
  await prowadziDo(request, nastepny(page), 'Ewa Mazur');
  await expect(page.locator('[data-pozycja]')).toHaveCount(0);
  // Nieznany filtr = bez filtra (jak na liście).
  await kartaZ(page, request, 'adm', 'Dariusz Wójcik', 'zrodlo=cokolwiek&widok=xyz');
  await expect(page.locator('[data-powrot]')).toHaveAttribute('href', '/panel/klienci');
});

test('karta: agent przechodzi tylko po swoich klientach — cudzych nie ma ani w strzałkach, ani w danych strony', async ({ page, request }) => {
  // Ula: Jerzy (10 dni), Henryk (14), Filip (18), Dariusz (22), Anna (40). Między nimi klienci Olka i bez opiekuna.
  await kartaZ(page, request, 'ula', 'Jerzy Duda');
  await nieaktywny(poprzedni(page));                       // Karolina i Irena są nowsze, ale nie jej
  await prowadziDo(request, nastepny(page), 'Henryk Sikora');
  await expect(page.locator('[data-pozycja]')).toHaveText('1 z 5');

  await kartaZ(page, request, 'ula', 'Dariusz Wójcik');
  await prowadziDo(request, poprzedni(page), 'Filip Lis');  // pomija Ewę (bez opiekuna)
  await prowadziDo(request, nastepny(page), 'Anna Kowalska'); // pomija Celinę (Olek) i Bartka (bez opiekuna)
  await expect(page.locator('[data-pozycja]')).toHaveText('4 z 5');
  const dane = await daneStrony(page);
  for (const cudzy of ['Celina', 'Bartek', 'Ewa', 'Grażyna', 'Irena', 'Karolina']) expect(dane).not.toContain(cudzy);
  for (const id of ['000000000003', '000000000002', '000000000005', '000000000007', '000000000009', '00000000000b']) {
    expect(dane).not.toContain(`c0000000-0000-0000-0000-${id}`);
  }
  expect(await page.content()).not.toContain('Celina');

  await kartaZ(page, request, 'ula', 'Anna Kowalska');
  await prowadziDo(request, poprzedni(page), 'Dariusz Wójcik');
  await nieaktywny(nastepny(page));

  // Olek: Grażyna (16 dni), Celina (25 dni), Karolina (9 dni).
  await kartaZ(page, request, 'olek', 'Celina Zielińska');
  await prowadziDo(request, poprzedni(page), 'Grażyna Pawlak');
  await nieaktywny(nastepny(page));
});
