/**
 * Pozostałe operacje i zachowania interfejsu: panel szczegółów, dialogi
 * (działanie, notatka, opiekun, archiwizacja), blokada równoległych zapisów,
 * wyszukiwanie, filtry w adresie, porzucony wniosek poza tablicą, brak dostępu i sesja.
 */
import { test, expect } from '@playwright/test';
import {
  adres, alert, awaria, etapId, etapLeada, karta, kolumna, leadId, nazwyKart, otworz, przeciagnij, reset, sql, status,
  toast, wersjaLeada, wywolania, zwiniety,
} from './pomocnicy.js';

test.beforeEach(async ({ request }) => { await reset(request); });

const szczegoly = (page) => page.locator('[data-szczegoly]');
const licznik = (page, klucz) => kolumna(page, klucz).locator('[data-licznik]');

test.describe('panel szczegółów', () => {
  test('zawartość, fokus, adres i przywrócenie fokusu po zamknięciu', async ({ page }) => {
    await otworz(page);
    const otworzBtn = karta(page, 'Anna Kowalska').getByRole('button', { name: /^Anna Kowalska/ });
    await otworzBtn.click();
    const sz = szczegoly(page);
    await expect(sz.getByRole('heading', { name: 'Anna Kowalska' })).toBeFocused();
    await expect(page).toHaveURL(/lead=/);
    await expect(sz.getByText('500100200')).toBeVisible();
    await expect(sz.getByRole('link', { name: 'anna@x.pl' })).toHaveAttribute('href', 'mailto:anna@x.pl');
    await expect(sz.getByText('Księgowa')).toBeVisible();
    await expect(sz.getByText('Ula Agent', { exact: false }).first()).toBeVisible();
    await expect(sz).not.toContainText('80010112345');                       // PESEL nie wychodzi do przeglądarki
    await expect(sz.getByRole('link', { name: /Karta klienta/ })).toHaveAttribute('href', /\/panel\/klienci\/c0000000/);

    await sz.getByRole('button', { name: 'Zamknij szczegóły' }).click();
    await expect(sz).toHaveCount(0);
    await expect(page).not.toHaveURL(/lead=/);
    await expect(otworzBtn).toBeFocused();
  });

  test('otwarcie szczegółów nie resetuje filtrów, sortowania ani pozycji przewijania', async ({ page, request }) => {
    await sql(request, `
      insert into public.ud_clients (id, created_at, full_name, email, phone, source, risk_temp_incapacity, temp_incapacity_sum)
      select gen_random_uuid(), now() - (g || ' hours')::interval, 'Lead ' || lpad(g::text, 3, '0'), 'lead' || g || '@x.pl', '700000' || lpad(g::text, 3, '0'), 'form', true, '1000'
        from generate_series(1, 40) g;
      select public.ud_leady_synchronizuj();`);
    await otworz(page, { zapytanie: 'zrodlo=form&sort=data' });
    const lista = kolumna(page, 'nowy').locator('[data-przewijanie-kolumny]');
    await expect(kolumna(page, 'nowy').locator('[data-karta-id]')).toHaveCount(25);
    await lista.evaluate((el) => { el.scrollTop = 600; });
    const przed = await lista.evaluate((el) => el.scrollTop);
    expect(przed).toBeGreaterThan(300);
    const poziomo = await page.locator('[data-przewijanie-poziome]').evaluate((el) => el.scrollLeft);

    // Karta, która po przewinięciu jest w całości widoczna (klik we wskazaną nie wymusza dalszego przewijania).
    const indeksWidocznej = await kolumna(page, 'nowy').locator('[data-karta-id]').evaluateAll((els, l) => {
      const okno = l.getBoundingClientRect();
      return els.findIndex((e) => { const r = e.getBoundingClientRect(); return r.top > okno.top + 10 && r.bottom < okno.bottom - 10; });
    }, await lista.elementHandle());
    expect(indeksWidocznej).toBeGreaterThanOrEqual(0);
    await kolumna(page, 'nowy').locator('[data-karta-id]').nth(indeksWidocznej).locator('.kontekst').click();
    await expect(szczegoly(page)).toBeVisible();
    await expect(page.getByLabel('Źródło')).toHaveValue('form');
    await expect(page.getByLabel('Sortuj')).toHaveValue('data');
    expect(await lista.evaluate((el) => el.scrollTop)).toBe(przed);
    expect(await page.locator('[data-przewijanie-poziome]').evaluate((el) => el.scrollLeft)).toBe(poziomo);
    await expect(page).toHaveURL(/zrodlo=form/);
    await expect(page).toHaveURL(/sort=data/);
  });

  test('zmiana etapu z listy w szczegółach; anulowany formularz powodu przywraca pole', async ({ page, request }) => {
    await otworz(page);
    await karta(page, 'Anna Kowalska').locator('.kontekst').click();
    const pole = szczegoly(page).getByLabel('Etap');
    await pole.selectOption({ label: 'Oferta' });
    await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Oferta');
    expect(await etapLeada(request, 'Anna Kowalska')).toBe('oferta');
    await expect(pole).toHaveValue(await etapId(request, 'oferta'));
    await expect(szczegoly(page).locator('[data-historia]')).toContainText('Nowy → Oferta');

    await pole.selectOption({ label: 'Przegrany' });
    const dialog = page.getByRole('dialog', { name: 'Powód utraty' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await etapLeada(request, 'Anna Kowalska')).toBe('oferta');
    await expect(pole).toHaveValue(await etapId(request, 'oferta'));
  });

  test('notatki: dodanie, lista, historia; odświeżenie pokazuje zapisane', async ({ page, request }) => {
    await otworz(page);
    await karta(page, 'Celina Zielińska').locator('.kontekst').click();
    const sz = szczegoly(page);
    await sz.getByLabel('Nowa notatka').fill('Prosi o ofertę z okresem 36 mies.');
    await sz.getByRole('button', { name: 'Dodaj notatkę' }).click();
    await expect(sz.locator('[data-notatki]')).toContainText('Prosi o ofertę z okresem 36 mies.');
    await expect(sz.locator('[data-notatki]')).toContainText('Ada Admin');
    await expect(sz.getByLabel('Nowa notatka')).toHaveValue('');
    expect(await sql(request, `select count(*) from public.ud_leady_notatki where lead_id = tt.lead('Celina Zielińska')`)).toBe('1');
    await page.reload();
    await page.waitForSelector('html[data-gotowe]');
    await expect(szczegoly(page).locator('[data-notatki]')).toContainText('Prosi o ofertę');   // link z ?lead= otwiera szczegóły
  });

  test('link do nieistniejącego albo zarchiwizowanego leada: komunikat zamiast pustego panelu', async ({ page, request }) => {
    const id = await leadId(request, 'Ewa Mazur');
    await sql(request, `update public.ud_leady set zarchiwizowano_at = now() where id = '${id}'`);
    await otworz(page, { zapytanie: `lead=${id}` });
    await expect(alert(page)).toContainText('nie istnieje albo został zarchiwizowany');
    await expect(szczegoly(page)).toHaveCount(0);
  });
});

test.describe('dialogi', () => {
  test('następne działanie: zaplanowanie, widoczność na karcie i w filtrze, usunięcie', async ({ page, request }) => {
    await otworz(page);
    await expect(karta(page, 'Ewa Mazur')).toContainText('Brak zaplanowanego działania');
    await page.getByRole('button', { name: 'Akcje leada Ewa Mazur' }).click();
    await page.getByRole('menuitem', { name: 'Zaplanuj działanie…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zaplanuj działanie' });
    await expect(dialog.getByLabel('Rodzaj')).toBeFocused();
    await dialog.getByLabel('Rodzaj').selectOption('spotkanie');
    await dialog.getByLabel('Termin').fill('2031-05-04T09:30');
    await dialog.getByLabel('Opis (opcjonalnie)').fill('Biuro klienta');
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(karta(page, 'Ewa Mazur')).toContainText('Spotkanie');
    await expect(karta(page, 'Ewa Mazur')).toContainText('Biuro klienta');
    await expect(karta(page, 'Ewa Mazur')).not.toContainText('Brak zaplanowanego działania');
    expect(await sql(request, `select nastepne_dzialanie_typ || '|' || nastepne_dzialanie_opis from public.ud_leady where id = tt.lead('Ewa Mazur')`)).toBe('spotkanie|Biuro klienta');
    await expect(status(page)).toContainText('zaplanowano działanie');

    // Usunięcie.
    await page.getByRole('button', { name: 'Akcje leada Ewa Mazur' }).click();
    await page.getByRole('menuitem', { name: 'Zaplanuj działanie…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń zaplanowane' }).click();
    await expect(karta(page, 'Ewa Mazur')).toContainText('Brak zaplanowanego działania');
    expect(await sql(request, `select nastepne_dzialanie_typ is null from public.ud_leady where id = tt.lead('Ewa Mazur')`)).toBe('t');
  });

  test('następne działanie: pusty termin nie przechodzi; odmowa serwera zostawia okno z komunikatem', async ({ page }) => {
    await otworz(page);
    await page.getByRole('button', { name: 'Akcje leada Ewa Mazur' }).click();
    await page.getByRole('menuitem', { name: 'Zaplanuj działanie…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zaplanuj działanie' });
    await dialog.getByLabel('Termin').fill('');
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(dialog.getByLabel('Termin')).toHaveJSProperty('validity.valueMissing', true);   // natywna walidacja pola wymaganego
    await dialog.getByLabel('Termin').fill('2031-05-04T09:30');
    await awaria(page.request, { sciezka: 'zmien', tryb: 'odpowiedz', status: 400, body: { status: 'bledne_dane', komunikat: 'Niepoprawne dane żądania.' } });
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Niepoprawne dane żądania');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(karta(page, 'Ewa Mazur')).toContainText('Brak zaplanowanego działania');
  });

  test('opiekun: przydziela tylko administrator; przydział otwiera agentowi dostęp do leada', async ({ page, request }) => {
    // Ula (agent): na własnym leadzie zmiana opiekuna widoczna, ale zablokowana z powodem; w szczegółach bez „Zmień…".
    await otworz(page, { u: 'ula' });
    await expect(karta(page, 'Bartek Nowak')).toHaveCount(0);                      // wolny lead — agent go nie widzi
    await page.getByRole('button', { name: 'Akcje leada Anna Kowalska' }).click();
    const poz = page.getByRole('menuitem', { name: 'Zmień opiekuna…' });
    await expect(poz).toHaveAttribute('aria-disabled', 'true');
    await expect(poz).toContainText('Opiekuna przydziela administrator');
    await page.keyboard.press('Escape');
    await karta(page, 'Anna Kowalska').locator('.kontekst').click();
    await expect(page.locator('[data-szczegoly] [data-opiekun]')).toHaveText('Ula Agent');
    await expect(page.locator('[data-szczegoly]').getByRole('button', { name: 'Zmień…' })).toHaveCount(1);   // tylko przy działaniu, nie przy opiekunie
    await page.getByRole('button', { name: 'Zamknij szczegóły' }).click();

    // Administrator przydziela Bartka Uli — od tej chwili Ula go widzi.
    await otworz(page);
    await page.getByRole('button', { name: 'Akcje leada Bartek Nowak' }).click();
    await page.getByRole('menuitem', { name: 'Zmień opiekuna…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zmień opiekuna' });
    await dialog.getByRole('radio', { name: 'Ula Agent' }).check();
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(karta(page, 'Bartek Nowak')).toContainText('Ula Agent');
    expect(await sql(request, `select opiekun_id from public.ud_leady where id = tt.lead('Bartek Nowak')`)).toBe(await sql(request, 'select tt.id_ula()'));
    await otworz(page, { u: 'ula' });
    await expect(karta(page, 'Bartek Nowak')).toBeVisible();

    // Administrator: wszyscy aktywni agenci (bez Ines), przepisuje cudzy lead.
    await otworz(page);
    await page.getByRole('button', { name: 'Akcje leada Celina Zielińska' }).click();
    await page.getByRole('menuitem', { name: 'Zmień opiekuna…' }).click();
    const d2 = page.getByRole('dialog', { name: 'Zmień opiekuna' });
    expect(await d2.getByRole('radio').evaluateAll((els) => els.map((e) => e.parentElement.textContent.trim()))).toEqual(['Bez opiekuna', 'Ada Admin (ja)', 'Olek Agent', 'Ula Agent']);
    await d2.getByRole('radio', { name: 'Ula Agent' }).check();
    await d2.getByRole('button', { name: 'Zapisz' }).click();
    await expect(karta(page, 'Celina Zielińska')).toContainText('Ula Agent');
    expect(await sql(request, `select wykonawca_nazwa from public.ud_leady_historia where lead_id = tt.lead('Celina Zielińska') and typ = 'opiekun'`)).toBe('Ada Admin');
  });

  test('archiwizacja: potwierdzenie z nazwą; anulowanie nic nie zmienia; zatwierdzenie usuwa kartę i liczniki', async ({ page, request }) => {
    await otworz(page);
    await page.getByRole('button', { name: 'Akcje leada Ewa Mazur' }).click();
    await page.getByRole('menuitem', { name: 'Archiwizuj…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Archiwizować lead?' });
    await expect(dialog).toContainText('Ewa Mazur');
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(karta(page, 'Ewa Mazur')).toBeVisible();

    await karta(page, 'Ewa Mazur').locator('.kontekst').click();                    // szczegóły otwarte — mają się zamknąć razem z leadem
    await page.getByRole('button', { name: 'Archiwizuj…' }).click();
    await page.getByRole('dialog', { name: 'Archiwizować lead?' }).getByRole('button', { name: 'Archiwizuj' }).click();
    await expect(karta(page, 'Ewa Mazur')).toHaveCount(0);
    await expect(szczegoly(page)).toHaveCount(0);
    await expect(toast(page)).toContainText('Lead zarchiwizowany');
    await expect(licznik(page, 'nowy')).toHaveText('6');
    expect(await sql(request, `select zarchiwizowano_at is not null from public.ud_leady where id = tt.lead_wszystkie('Ewa Mazur')`)).toBe('t');
    await page.getByRole('button', { name: 'Odśwież' }).click();
    await expect(karta(page, 'Ewa Mazur')).toHaveCount(0);
  });

  test('kopiowanie linku do leada', async ({ page, request }) => {
    await otworz(page);
    await page.getByRole('button', { name: 'Akcje leada Anna Kowalska' }).click();
    await page.getByRole('menuitem', { name: 'Kopiuj link do leada' }).click();
    await expect(status(page)).toContainText('Skopiowano link');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain(`?lead=${await leadId(request, 'Anna Kowalska')}`);
    await expect(page.getByRole('button', { name: 'Akcje leada Anna Kowalska' })).toBeFocused();
  });
});

test.describe('blokady i cele przeciągania', () => {
  test('lead jest już w tym etapie: cel oznaczony jako niedostępny z powodem, upuszczenie nic nie robi', async ({ page, request }) => {
    await otworz(page);
    await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'), { puszczaj: false });
    await expect(page.locator('[data-cel-podpowiedz]')).toContainText('Przenieś do: Oferta');
    await expect(kolumna(page, 'oferta')).toHaveClass(/cel-ok/);
    const nowy = await kolumna(page, 'nowy').boundingBox();
    await page.mouse.move(nowy.x + nowy.width / 2, nowy.y + 120, { steps: 6 });
    await expect(kolumna(page, 'nowy')).toHaveClass(/cel-blokada/);
    await expect(page.locator('[data-cel-podpowiedz]')).toContainText('już w etapie „Nowy"');
    await page.mouse.up();
    await expect(alert(page)).toContainText('już w etapie „Nowy"');
    expect((await wywolania(request)).filter((w) => w.sciezka === 'zmien')).toHaveLength(0);
    expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');
  });

  test('równoległe operacje na tym samym leadzie są blokowane do rozstrzygnięcia zapisu', async ({ page, request }) => {
    await otworz(page);
    await awaria(request, { sciezka: 'zmien', tryb: 'opoznienie', opoznienieMs: 1500 });
    await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'decyzja'));
    await expect(karta(page, 'Anna Kowalska').locator('[data-stan-zapisu]')).toContainText('Przenoszę do: Decyzja klienta');
    await expect(karta(page, 'Anna Kowalska')).toHaveAttribute('aria-busy', 'true');

    // Druga próba na tej samej karcie: cel zablokowany, menu ma zablokowane pozycje zmieniające stan.
    await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));
    await expect(alert(page)).toContainText('Trwa zapis tego leada');
    await page.getByRole('button', { name: 'Akcje leada Anna Kowalska' }).click();
    await expect(page.getByRole('menuitem', { name: 'Przenieś do…' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('menuitem', { name: 'Archiwizuj…' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('menuitem', { name: 'Dodaj notatkę…' })).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Decyzja klienta', { timeout: 6000 });
    await expect(karta(page, 'Anna Kowalska').locator('[data-stan-zapisu]')).toHaveCount(0);
    expect((await wywolania(request)).filter((w) => w.sciezka === 'zmien')).toHaveLength(1);       // druga próba nie poszła do serwera
    expect(await etapLeada(request, 'Anna Kowalska')).toBe('decyzja');
  });

  test('autoprzewijanie przy prawej krawędzi dowozi dalekie kolumny', async ({ page }) => {
    await otworz(page);
    const obszar = page.locator('[data-przewijanie-poziome]');
    expect(await obszar.evaluate((el) => el.scrollLeft)).toBe(0);
    const k = await karta(page, 'Anna Kowalska').locator('.kontekst').boundingBox();
    const o = await obszar.boundingBox();
    await page.mouse.move(k.x + 12, k.y + 6);
    await page.mouse.down();
    await page.mouse.move(k.x + 30, k.y + 12);
    await page.mouse.move(o.x + o.width - 20, o.y + 200, { steps: 10 });
    await expect.poll(() => obszar.evaluate((el) => el.scrollLeft), { timeout: 10_000 }).toBeGreaterThan(100);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

test.describe('wyszukiwanie i filtry', () => {
  test('wyszukiwanie z opóźnieniem: jedno zapytanie po serii klawiszy, filtr w adresie', async ({ page, request }) => {
    await otworz(page);
    const pole = page.getByLabel('Szukaj leada');
    await pole.pressSequentially('anna', { delay: 40 });
    await expect(licznik(page, 'nowy')).toHaveText('1 z 7');
    await expect(page).toHaveURL(/q=anna/);
    const zapytania = (await wywolania(request)).filter((w) => w.sciezka === 'kolumna').map((w) => new URLSearchParams(w.zapytanie).get('q'));
    expect(zapytania).toContain('anna');
    expect(zapytania.filter((q) => q === 'a' || q === 'an' || q === 'ann')).toEqual([]);          // pośrednich nie wysłano
    await expect(page.locator('[data-karta-id]')).toHaveCount(1);
  });

  test('spóźniona odpowiedź na starsze zapytanie nie nadpisuje nowszego wyniku', async ({ page, request }) => {
    await otworz(page);
    const pole = page.getByLabel('Szukaj leada');
    await awaria(request, { sciezka: 'kolumna', tryb: 'opoznienie', opoznienieMs: 1500 });          // pierwsze zapytanie ruszy powoli
    await pole.fill('bartek');
    await page.waitForTimeout(400);                                                                    // debounce minął, żądanie „bartek" leci
    await pole.fill('celina');                                                                         // nowsze, szybkie
    await expect(page.locator('[data-karta-id]')).toHaveCount(1);
    await expect(karta(page, 'Celina Zielińska')).toBeVisible();
    await page.waitForTimeout(2000);                                                                   // stara odpowiedź już doszła…
    await expect(karta(page, 'Celina Zielińska')).toBeVisible();                                       // …a wynik zostaje nowszy
    await expect(karta(page, 'Bartek Nowak')).toHaveCount(0);
  });

  test('filtry: opiekun (administrator), źródło, zakres i termin; wyczyść; stan wraca po odświeżeniu z adresu', async ({ page }) => {
    await otworz(page);
    await page.getByLabel('Opiekun').selectOption({ label: 'Ula Agent' });
    await expect(licznik(page, 'nowy')).toHaveText('3 z 7');
    await expect.poll(async () => (await nazwyKart(page, 'nowy')).sort()).toEqual(['Anna Kowalska', 'Dariusz Wójcik', 'Filip Lis']);
    await page.getByLabel('Zakres ochrony').selectOption({ label: 'Zgon / inwalidztwo' });
    await expect(licznik(page, 'nowy')).toHaveText('1 z 7');
    await expect(page.locator('[data-aktywne-filtry]')).toContainText('opiekun: Ula Agent');
    await expect(page.locator('[data-aktywne-filtry]')).toContainText('zakres: Zgon / inwalidztwo');
    await page.reload();
    await page.waitForSelector('html[data-gotowe]');
    await expect(page.getByLabel('Opiekun')).toHaveValue('a0000000-0000-0000-0000-0000000000a2');
    await expect(licznik(page, 'nowy')).toHaveText('1 z 7');
    await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
    await expect(licznik(page, 'nowy')).toHaveText('7');
    await expect(page).not.toHaveURL(/opiekun=/);

    await page.getByLabel('Źródło').selectOption({ label: 'Dodany w panelu' });
    await expect(page.locator('[data-karta-id]')).toHaveCount(3);
    await expect(karta(page, 'Irena Kubiak')).toBeVisible();
    await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
    await page.getByLabel('Następne działanie').selectOption({ label: 'Przeterminowane' });
    await expect.poll(() => page.locator('[data-karta-id]').count()).toBe(1);
  });
});

test.describe('porzucony wniosek nie jest leadem', () => {
  test('szkic ze zgodą nie ma karty, filtr źródła nie ma „Porzucony wniosek" (lista „Niedokończone" to osobna zakładka)', async ({ page, request }) => {
    await otworz(page);
    expect(await sql(request, `select count(*) from public.ud_wnioski_szkice where zgoda_kontakt and ukonczony_at is null`)).toBe('1');
    await expect(karta(page, 'Szymon Szkic')).toHaveCount(0);
    await expect(page.getByLabel('Źródło').locator('option', { hasText: 'Porzucony wniosek' })).toHaveCount(0);
    expect(await sql(request, `select count(*) from public.ud_leady where szkic_id is not null`)).toBe('0');
  });
});

test.describe('dostęp i sesja', () => {
  test('nieaktywny agent i brak sesji nie dostają tablicy', async ({ page }) => {
    await page.goto(`${adres()}/test/leady/harness.html?u=ines`);
    await expect(page.locator('#app')).toContainText('Błąd 403');
    await page.goto(`${adres()}/test/leady/harness.html?u=brak`);
    await expect(page.locator('#app')).toContainText('Błąd 401');
  });

  test('wygasła sesja w trakcie pracy: baner, wycofanie zmiany, żadnego zapisu', async ({ page, request }) => {
    await otworz(page);
    await awaria(request, { sciezka: 'zmien', tryb: 'odpowiedz', status: 401, body: { status: 'blad', komunikat: 'Sesja wygasła.', sesja: true } });
    await przeciagnij(page, karta(page, 'Anna Kowalska'), kolumna(page, 'oferta'));
    await expect(page.locator('[data-baner-sesji]')).toContainText('Zaloguj się ponownie');
    await expect(page.locator('[data-baner-sesji] a')).toHaveAttribute('href', '/login');
    await expect(kolumna(page, 'nowy').locator('[data-karta-id]').filter({ hasText: 'Anna Kowalska' })).toHaveCount(1);
    expect(await etapLeada(request, 'Anna Kowalska')).toBe('nowy');
  });
});

test('wszystkie etapy zwinięte: komunikat z akcją, a upuszczenie na zwinięty etap nadal działa', async ({ page, request }) => {
  await otworz(page);
  for (const nazwa of ['Nowy', 'Oferta', 'Decyzja klienta', 'Wygrany']) await page.getByRole('button', { name: `Zwiń etap ${nazwa}` }).click();
  await expect(page.locator('[data-zw-id]')).toHaveCount(4);
  await expect(kolumna(page, 'przegrany')).toBeVisible();
  await page.getByRole('button', { name: 'Zwiń etap Przegrany' }).click();
  await expect(page.getByText('Wszystkie etapy są zwinięte.')).toBeVisible();
  await page.getByRole('button', { name: 'Rozwiń etap Nowy' }).click();
  await przeciagnij(page, karta(page, 'Anna Kowalska'), zwiniety(page, 'Wygrany'));
  const sprzedaz = page.getByRole('dialog', { name: 'Dane sprzedaży' });
  await sprzedaz.getByRole('button', { name: 'Dodaj ręcznie' }).click();      // Anna nie ma ofert: polisa albo ręcznie
  await sprzedaz.getByLabel('Składka roczna *').fill('1500');
  await sprzedaz.getByRole('button', { name: /Przenieś do/ }).click();
  await expect(toast(page)).toContainText('Anna Kowalska: Nowy → Wygrany');
  expect(await etapLeada(request, 'Anna Kowalska')).toBe('wygrany');
  await expect(zwiniety(page, 'Wygrany').locator('[data-licznik]')).toHaveText('2');
});
