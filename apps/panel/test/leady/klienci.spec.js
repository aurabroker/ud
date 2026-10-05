/**
 * Zakładka „Klienci": kolumna „Akcja" zamiast „Zawód" (decyzja właściciela
 * z 05.10.2026). Strona renderowana po stronie serwera z prawdziwego komponentu,
 * z danymi z tej samej funkcji co jej load (listaKlientow) na bazie testowej.
 */
import { test, expect } from '@playwright/test';
import { adres, reset, sql } from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

async function wczytaj(page, request, u) {
  const r = await request.get(`${adres()}/__test/ssr-klienci`, { headers: { 'x-test-user': u } });
  expect(r.status(), await r.text()).toBe(200);
  await page.setContent(await r.text());
}
const wiersz = (page, nazwa) => page.locator('tbody tr', { hasText: nazwa });
const akcja = (page, nazwa) => wiersz(page, nazwa).locator('[data-akcja]');

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

  await expect(page.locator('thead th')).toHaveText(['Klient', 'Kontakt', 'Akcja', 'Przypisany do', 'Dodano']);
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

test('zarchiwizowany lead: etap zostaje, dopisek „archiwum", bez odnośnika do tablicy', async ({ page, request }) => {
  await sql(request, `update public.ud_leady set etap_id = tt.etap('wygrany'), skladka_roczna = 2400,
           zarchiwizowano_at = now() where id = tt.lead('Grażyna Pawlak');`);
  await wczytaj(page, request, 'adm');
  await expect(akcja(page, 'Grażyna Pawlak')).toContainText('Klient ubezpieczony');
  await expect(akcja(page, 'Grażyna Pawlak')).toContainText('archiwum');
  await expect(akcja(page, 'Grażyna Pawlak').locator('a')).toHaveCount(0);
});

test('agent widzi tylko klientów swoich leadów — z ich akcją', async ({ page, request }) => {
  await wczytaj(page, request, 'ula');
  const nazwy = await page.locator('tbody tr td:first-child').allTextContents();
  const ula = (await sql(request, `select string_agg(c.full_name, '|' order by c.full_name) from public.ud_leady l
                                     join public.ud_clients c on c.id = l.klient_id
                                    where l.opiekun_id = tt.id_ula() and l.zarchiwizowano_at is null`)).split('|');
  expect([...nazwy].map((n) => n.trim()).sort()).toEqual(expect.arrayContaining(ula));
  expect(nazwy.length).toBeLessThan(Number(await sql(request, 'select count(*) from public.ud_clients')));
  for (const n of nazwy) await expect(akcja(page, n.trim())).not.toHaveText('—');
});
