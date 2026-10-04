import { test, expect } from '@playwright/test';

/**
 * Testy kreatora wniosku w przeglądarce.
 *
 * Sprawdzają to, czego nie widać w buildzie: czy wyspa się hydratuje, czy
 * walidacja zatrzymuje na kroku, czy próg miliona złotych faktycznie odsłania
 * rozszerzoną ankietę. Kompilacja tego nie gwarantuje.
 */

const PESEL = '90010112349'; // wyliczony, z poprawną cyfrą kontrolną

/**
 * Krok „kontakt" jest pierwszy: imię, e-mail i telefon. Wszystkie testy, które
 * chcą dojść do kolejnych kroków, przechodzą go tym helperem.
 */
async function kontakt(page, imie = 'Jan Kowalski', { zgoda = false } = {}) {
  await page.fill('input[name="fullName"]', imie);
  await page.fill('input[name="email"]', 'jan@example.com');
  await page.fill('input[name="phone"]', '504400901');
  if (zgoda) await page.check('input[name="zgodaKontakt"]');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.locator('input[name="pesel"]')).toBeVisible();
}

/** Atrapa Turnstile: liczy wywołania render/remove i zawsze oddaje token. */
async function atrapaTurnstile(page) {
  await page.addInitScript(() => {
    window.__turnstile = { render: [], remove: [] };
    window.turnstile = {
      render: (el, opcje) => {
        const id = `w${window.__turnstile.render.length + 1}`;
        window.__turnstile.render.push({ id, opcje, polaczony: el.isConnected });
        el.dataset.widget = id;
        return id;
      },
      remove: (id) => { window.__turnstile.remove.push(id); },
      getResponse: () => 'token-testowy',
      reset() {},
    };
  });
}

const ID_SZKICU = '11111111-1111-4111-8111-111111111111';

test.beforeEach(async ({ page }) => {
  await page.goto('/wniosek/');
  // Wyspa ładuje się przy wejściu w pole widzenia — czekamy na jej pierwsze pole.
  await expect(page.locator('input[name="fullName"]')).toBeVisible();
});

test('walidacja zatrzymuje na kroku i tłumaczy, czego brakuje', async ({ page }) => {
  await page.getByRole('button', { name: 'Dalej' }).click();

  await expect(page.getByText('Podaj imię i nazwisko.')).toBeVisible();
  await expect(page.getByText(/Podaj adres e-mail/)).toBeVisible();
  await expect(page.getByText(/Podaj numer telefonu/)).toBeVisible();
  // Nadal krok pierwszy.
  await expect(page.locator('input[name="fullName"]')).toBeVisible();
  await expect(page.locator('input[name="pesel"]')).toHaveCount(0);

  // Po kontakcie dopiero krok danych pyta o PESEL i zawód.
  await kontakt(page);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByText(/PESEL ma 11 cyfr/)).toBeVisible();
  await expect(page.getByText('Wybierz zawód z listy albo wpisz własny.')).toBeVisible();
});

test('błędny PESEL nie przepuszcza, poprawny przepuszcza', async ({ page }) => {
  await kontakt(page);
  await page.fill('input[name="profession"]', 'Lekarz');

  await page.fill('input[name="pesel"]', '90010112345');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByText(/cyfrą kontrolną/)).toBeVisible();

  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();
  // Kotwicą kroku drugiego jest lista ryzyk, a nie klauzule — te są warunkowe.
  await expect(page.locator('input[name="riskTempIncapacity"]')).toBeVisible();
});

test('forma zatrudnienia zmienia limit świadczenia', async ({ page }) => {
  await kontakt(page);
  await expect(page.getByText('Świadczenie obejmie do 80% udokumentowanego dochodu.')).toBeVisible();
  await page.selectOption('select[name="employmentType"]', 'uop');
  await expect(page.getByText('Świadczenie obejmie do 65% udokumentowanego dochodu.')).toBeVisible();
});

test('suma powyżej miliona odsłania rozszerzoną ankietę', async ({ page }) => {
  await kontakt(page, 'Jan Kowalski');
  await page.fill('input[name=\"profession\"]', 'Lekarz');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.fill('input[name="tempIncapacitySum"]', '12000');
  await page.check('input[name="riskPermIncapacity"]');

  // Na progu jeszcze nie, dopiero powyżej.
  await page.fill('input[name="permIncapacitySum"]', '1000000');
  await expect(page.getByText(/rozszerzonej ankiety zdrowotnej/)).toHaveCount(0);

  await page.fill('input[name="permIncapacitySum"]', '1500000');
  await expect(page.getByText(/rozszerzonej ankiety zdrowotnej/)).toBeVisible();

  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByRole('heading', { name: 'Ankieta rozszerzona' })).toBeVisible();
  await expect(page.getByText('Choroby i układy')).toBeVisible();
});

test('odpowiedź TAK wymusza opis', async ({ page }) => {
  await kontakt(page, 'Jan Kowalski');
  await page.fill('input[name=\"profession\"]', 'Lekarz');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.fill('input[name="tempIncapacitySum"]', '12000');
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.check('input[name="med_heart"][value="yes"]');
  await expect(page.locator('textarea[name="med_heart_notes"]')).toBeVisible();

  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByText(/opisz krótko, czego dotyczy/i).first()).toBeVisible();

  await page.fill('textarea[name="med_heart_notes"]', 'Nadciśnienie, leczone od 2020.');
  await page.getByRole('button', { name: 'Dalej' }).click();
  // Ostatni krok to zgody — kotwicą jest zgoda na wyłączenia, nie e-mail.
  await expect(page.locator('input[name="exclusions_accepted"]')).toBeVisible();
});

test('zgody są obowiązkowe, a wstecz nie gubi danych', async ({ page }) => {
  await kontakt(page, 'Anna Nowak');
  await page.fill('input[name="profession"]', 'Stomatolog');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.fill('input[name="tempIncapacitySum"]', '9000');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Dalej' }).click();

  // Ostatni krok to już tylko zgody — e-mail i telefon padły w pierwszym.
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Wyślij wniosek' }).click();
  await expect(page.getByText(/głównymi wyłączeniami/i).first()).toBeVisible();

  // Cofnięcie o cztery kroki musi zachować to, co wpisano na pierwszych dwóch.
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Wstecz' }).click();
  await expect(page.locator('input[name="fullName"]')).toHaveValue('Anna Nowak');
  await expect(page.locator('input[name="email"]')).toHaveValue('jan@example.com');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.locator('input[name="pesel"]')).toHaveValue(PESEL);
});

test('klauzule dodatkowe otwierają się dopiero powyżej 300 000 zł', async ({ page }) => {
  await kontakt(page, 'Jan Kowalski');
  await page.fill('input[name=\"profession\"]', 'Elektryk');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.check('input[name="riskDeathInvalidity"]');
  await expect(page.getByText(/otwierają się przy sumie/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Klauzule dodatkowe' })).toHaveCount(0);

  // Na progu jeszcze zamknięte.
  await page.fill('input[name="nwDeathSum"]', '300000');
  await expect(page.getByRole('heading', { name: 'Klauzule dodatkowe' })).toHaveCount(0);

  await page.fill('input[name="nwDeathSum"]', '400000');
  await expect(page.getByRole('heading', { name: 'Klauzule dodatkowe' })).toBeVisible();
  await expect(page.locator('select[name="nwFuneral"]')).toBeVisible();

  // Zejście poniżej progu chowa je z powrotem.
  await page.fill('input[name="nwDeathSum"]', '100000');
  await expect(page.getByRole('heading', { name: 'Klauzule dodatkowe' })).toHaveCount(0);
});

test('kreator pokazuje wszystkie aktywności podwyższonego ryzyka', async ({ page }) => {
  await kontakt(page, 'Jan Kowalski');
  await page.fill('input[name=\"profession\"]', 'Lekarz');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.fill('input[name="tempIncapacitySum"]', '12000');
  await page.getByRole('button', { name: 'Dalej' }).click();

  /**
   * Liczba pól ma odpowiadać liczbie kolumn risk_* w tabeli ud_clients.
   * Stary formularz pokazywał osiem z piętnastu, więc underwriter dostawał
   * puste pole tam, gdzie klient mógł mieć „tak".
   */
  const pola = page.locator('input[type="checkbox"][name^="risk_"]');
  await expect(pola).toHaveCount(15);
  await expect(page.getByText('Spadochroniarstwo')).toBeVisible();
  await expect(page.getByText('Lotnictwo — pilot lub członek załogi')).toBeVisible();
});

test('pola formularza mają czytelne obramowanie i ten sam krój co strona', async ({ page }) => {
  const pole = page.locator('input[name="fullName"]');
  await pole.waitFor({ state: 'visible' });

  const styl = await pole.evaluate((el) => {
    const s = getComputedStyle(el);
    return { obramowanie: s.borderTopColor, kroj: s.fontFamily };
  });
  const krojStrony = await page.evaluate(() => getComputedStyle(document.body).fontFamily);

  // #5E9AB9 — token --color-linia-pole, 3,09:1 na bieli. Poprzedni dawał 1,26:1.
  expect(styl.obramowanie).toBe('rgb(94, 154, 185)');
  expect(styl.kroj, 'pole używa innego kroju niż reszta strony').toBe(krojStrony);
});

test('okresowa niezdolność jest zaznaczona na stałe, a sama śmierć nie przechodzi', async ({ page }) => {
  await kontakt(page, 'Jan Kowalski');
  await page.fill('input[name=\"profession\"]', 'Elektryk');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();

  // Ryzyko podstawowe: zaznaczone od startu i nie do odznaczenia.
  const podstawowe = page.locator('input[name="riskTempIncapacity"]');
  await expect(podstawowe).toBeChecked();
  await expect(podstawowe).toBeDisabled();
  await expect(page.getByText(/Ryzyko podstawowe/)).toBeVisible();

  // Sama śmierć / inwalidztwo bez kwoty okresowej — kreator stoi na kroku.
  await page.check('input[name="riskDeathInvalidity"]');
  await page.fill('input[name="nwDeathSum"]', '1000000');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.locator('input[name="tempIncapacitySum"]')).toBeVisible();
  await expect(page.getByText('Wpisz kwotę.')).toBeVisible();

  // Z kwotą okresowej idzie dalej.
  await page.fill('input[name="tempIncapacitySum"]', '8000');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.locator('input[name="riskTempIncapacity"]')).toHaveCount(0);
});

test.describe('szkic wniosku', () => {
  /** Zbiera wszystko, co kreator wysyła do szkicu, i odpowiada jak funkcja brzegowa. */
  async function przechwycSzkic(page) {
    const zapytania = [];
    await page.route('**/functions/v1/wniosek-szkic', async (route) => {
      zapytania.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', id: ID_SZKICU }),
      });
    });
    return zapytania;
  }

  async function przejdzDoZgod(page) {
    await page.fill('input[name="profession"]', 'Lekarz');
    await page.fill('input[name="pesel"]', PESEL);
    await page.getByRole('button', { name: 'Dalej' }).click();
    await page.fill('input[name="tempIncapacitySum"]', '12000');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await page.check('input[name="med_heart"][value="yes"]');
    await page.fill('textarea[name="med_heart_notes"]', 'Nadciśnienie, leczone od 2020.');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByRole('button', { name: 'Wyślij wniosek' })).toBeVisible();
  }

  test('zgoda na kontakt jest niezaznaczona i nie warunkuje przejścia dalej', async ({ page }) => {
    const zgoda = page.locator('input[name="zgodaKontakt"]');
    await expect(zgoda).not.toBeChecked();
    await expect(page.getByText(/Zgadzam się na kontakt e-mailowy i telefoniczny ze strony Aura Expert/)).toBeVisible();
    await expect(page.getByText('Zgoda jest dobrowolna')).toBeVisible();

    await kontakt(page);          // bez zaznaczenia — krok przechodzi
    await expect(page.locator('input[name="pesel"]')).toBeVisible();
  });

  test('pasek pokazuje wszystkie kroki, a pierwszy to „Kontakt"', async ({ page }) => {
    const pasek = page.locator('#wniosek-gora ol').first();
    await expect(pasek.locator('li')).toHaveCount(5);
    await expect(pasek.locator('li').first()).toContainText('Kontakt');
    await expect(pasek.locator('li').first()).toContainText('Krok 1 z 5');
  });

  test('bez zgody szkic dostaje tylko krok — ani imienia, ani e-maila, ani telefonu', async ({ page }) => {
    await atrapaTurnstile(page);
    const zapytania = await przechwycSzkic(page);
    await page.reload();
    await expect(page.locator('input[name="fullName"]')).toBeVisible();

    await kontakt(page, 'Jan Kowalski');
    await expect.poll(() => zapytania.length).toBeGreaterThan(0);

    const start = zapytania[0];
    expect(start).toMatchObject({ akcja: 'start', zgoda: false, 'cf-turnstile-response': 'token-testowy' });
    expect(Object.keys(start).sort()).toEqual(['akcja', 'cf-turnstile-response', 'zgoda', 'zgoda_wersja']);
  });

  test('ze zgodą szkic dostaje imię, e-mail i telefon oraz wersję zgody', async ({ page }) => {
    await atrapaTurnstile(page);
    const zapytania = await przechwycSzkic(page);
    await page.reload();
    await expect(page.locator('input[name="fullName"]')).toBeVisible();

    await kontakt(page, 'Jan Kowalski', { zgoda: true });
    await expect.poll(() => zapytania.length).toBeGreaterThan(0);

    expect(zapytania[0]).toMatchObject({
      akcja: 'start', zgoda: true, zgoda_wersja: 'v1-2026-10',
      imie: 'Jan Kowalski', email: 'jan@example.com', phone: '504400901',
    });
    // Treść zgody wysyła funkcja brzegowa z własnej mapy, nie przeglądarka.
    expect(zapytania[0]).not.toHaveProperty('zgoda_tresc');
  });

  test('cały przebieg: kroki idą po kolei, a do szkicu nigdy nie trafia PESEL ani ankieta', async ({ page }) => {
    await atrapaTurnstile(page);
    const zapytania = await przechwycSzkic(page);
    await page.route('**/functions/v1/form-submit', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"status":"success"}',
    }));
    await page.reload();
    await expect(page.locator('input[name="fullName"]')).toBeVisible();

    await kontakt(page, 'Jan Kowalski', { zgoda: true });
    await przejdzDoZgod(page);
    await page.check('input[name="exclusions_accepted"]');
    await page.check('input[name="informedAccepted"]');
    await page.getByRole('button', { name: 'Wyślij wniosek' }).click();
    await page.waitForURL('**/podziekowanie/');

    await expect.poll(() => zapytania.map((z) => z.akcja).join(','), { timeout: 5000 }).toContain('ukoncz');
    const kroki = zapytania.filter((z) => z.akcja === 'krok').map((z) => z.krok);
    expect(kroki).toEqual(['dane', 'zakres', 'zdrowie']);
    expect(zapytania.at(-1)).toMatchObject({ akcja: 'ukoncz', id: ID_SZKICU });
    for (const z of zapytania.filter((x) => x.akcja !== 'start')) expect(z.id).toBe(ID_SZKICU);

    // Nic z wniosku poza krokiem nie wychodzi do szkicu.
    const wszystko = JSON.stringify(zapytania);
    expect(wszystko).not.toMatch(/pesel|med_|hs_|hsd_|Nadciśnienie|90010112349/i);
  });

  /** Przechodzi cały kreator z adresu `adres` i zwraca to, co poszło do form-submit. */
  async function zlozWniosek(page, adres) {
    await atrapaTurnstile(page);
    const szkice = await przechwycSzkic(page);
    const wnioski = [];
    await page.route('**/functions/v1/form-submit', async (route) => {
      wnioski.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
    });
    await page.goto(adres);
    await expect(page.locator('input[name="fullName"]')).toBeVisible();
    await kontakt(page, 'Jan Kowalski');
    await przejdzDoZgod(page);
    await page.check('input[name="exclusions_accepted"]');
    await page.check('input[name="informedAccepted"]');
    await page.getByRole('button', { name: 'Wyślij wniosek' }).click();
    await page.waitForURL('**/podziekowanie/');
    expect(wnioski).toHaveLength(1);
    return { wniosek: wnioski[0], szkice };
  }

  test('link agenta: kod z ?agent= idzie do form-submit jako affiliateCode (lead trafi do tego agenta), do szkicu nie', async ({ page }) => {
    const { wniosek, szkice } = await zlozWniosek(page, '/wniosek/?agent=0004');
    expect(wniosek.affiliateCode).toBe('0004');
    expect(wniosek.pesel).toBe(PESEL);                                  // reszta wniosku bez zmian
    expect(JSON.stringify(szkice)).not.toContain('0004');
  });

  test('bez linku agenta i z niepoprawnym kodem wniosek idzie bez affiliateCode', async ({ page }) => {
    const { wniosek } = await zlozWniosek(page, '/wniosek/?agent=%3Cscript%3E');
    expect(wniosek).not.toHaveProperty('affiliateCode');
    expect(wniosek.pesel).toBe(PESEL);
  });

  test('Wstecz i zmiana zgody na kroku „kontakt" aktualizuje szkic, brak zmiany — nie', async ({ page }) => {
    await atrapaTurnstile(page);
    const zapytania = await przechwycSzkic(page);
    await page.reload();
    await expect(page.locator('input[name="fullName"]')).toBeVisible();

    await kontakt(page, 'Jan Kowalski', { zgoda: true });
    await expect.poll(() => zapytania.length).toBe(1);

    // Wstecz i Dalej bez zmian — żadnego dodatkowego wywołania o kontakt.
    await page.getByRole('button', { name: 'Wstecz' }).click();
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.locator('input[name="pesel"]')).toBeVisible();
    await page.waitForTimeout(300);
    expect(zapytania.filter((z) => z.akcja === 'kontakt')).toHaveLength(0);

    // Odznaczenie zgody czyści dane kontaktowe szkicu.
    await page.getByRole('button', { name: 'Wstecz' }).click();
    await page.uncheck('input[name="zgodaKontakt"]');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect.poll(() => zapytania.filter((z) => z.akcja === 'kontakt').length).toBe(1);
    expect(zapytania.find((z) => z.akcja === 'kontakt')).toMatchObject({ id: ID_SZKICU, zgoda: false });
  });

  test('widżet kroku „kontakt" jest niewidoczny, dopóki Cloudflare nie zażąda kliknięcia', async ({ page }) => {
    await atrapaTurnstile(page);
    await page.reload();
    await expect(page.locator('input[name="fullName"]')).toBeVisible();
    const renders = await page.evaluate(() => window.__turnstile.render);
    expect(renders).toHaveLength(1);
    expect(renders[0].opcje.appearance).toBe('interaction-only');
  });

  test('widżet ostatniego kroku montuje się przy KAŻDYM wejściu, nie tylko za pierwszym', async ({ page }) => {
    // Kontener siedzi w bloku {#if}: po Wstecz element ginie, a po Dalej powstaje
    // nowy, pusty. Stary kod trzymał uchwyt i nie montował widżetu drugi raz —
    // po wygaśnięciu starego tokenu przycisk „Wyślij" nie miał czego kliknąć.
    await atrapaTurnstile(page);
    await page.reload();
    await expect(page.locator('input[name="fullName"]')).toBeVisible();
    await kontakt(page);
    await przejdzDoZgod(page);

    await expect(page.locator('[data-widget]')).toHaveCount(1);
    const przed = await page.evaluate(() => window.__turnstile.render.length);   // kontakt + zgody

    await page.getByRole('button', { name: 'Wstecz' }).click();
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByRole('button', { name: 'Wyślij wniosek' })).toBeVisible();

    const po = await page.evaluate(() => ({ render: window.__turnstile.render.length, remove: window.__turnstile.remove }));
    expect(po.render, 'drugi render widżetu po powrocie do kroku').toBe(przed + 1);
    expect(po.remove.length, 'stary widżet powinien zostać zdjęty przy wyjściu z kroku').toBeGreaterThan(0);
    await expect(page.locator('[data-widget]')).toHaveCount(1);
  });
});
