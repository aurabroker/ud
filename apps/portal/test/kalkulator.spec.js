import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sprawdzKalibracje, bledyKalibracji, MNOZNIK_HIV_WZW } from '../src/lib/symulacja.ts';

/**
 * Kwoty liczone są w teście ze stawek z kalibracja.json, tym samym wzorem co
 * symuluj() — plik przepisuje kalibrator pull requestem, więc kwot wpisanych
 * na sztywno trzeba by poprawiać przy każdym scaleniu, a test pilnowałby
 * wtedy wczorajszych stawek zamiast tego, czy strona liczy z pliku.
 *
 *   suma    = dochód × 0,8            (kalkulator liczy tylko B2B / JDG)
 *   stawka  = stawka.dol … stawka.gora z kalibracja.json, ×1,07 z HIV/WZW
 *   składka = round(suma × stawka)
 *
 * Przy stawkach z 14.10.2026 (0,0202 … 0,0322) i sumie 14 400 zł to 291–464 zł.
 *
 * Składka jest przedziałem, nie liczbą. Stawka 1,5% ze starego Calculator.js
 * leżała poniżej najtańszej oferty, jaką realnie wystawiliśmy — przy sumie
 * 14 400 zł dawała 216 zł, a najtańsza oferta 291 zł.
 */

const KALIBRACJA = JSON.parse(readFileSync(new URL('../src/lib/kalibracja.json', import.meta.url), 'utf8'));
const { dol, gora } = KALIBRACJA.stawka;

/** „1 234" — tak grupuje zlZakres() (Playwright i tak normalizuje twardą spację). */
const grupuj = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Przedział składki dla sumy świadczenia — wzór z symuluj(). */
function zakres(suma, klauzula = 1) {
  const od = Math.round(suma * dol * klauzula);
  const do_ = Math.round(suma * gora * klauzula);
  return od === do_ ? `${grupuj(od)} zł` : `${grupuj(od)}–${grupuj(do_)} zł`;
}

const wynik = (page, etykieta) =>
  page.locator('dt', { hasText: etykieta }).locator('xpath=following-sibling::dd[1]');

test.beforeEach(async ({ page }, testInfo) => {
  // Walidator i niezmienniki stawek czytają sam plik — strony nie potrzebują.
  if (testInfo.tags.includes('@plik')) return;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Symulacja składki/ })).toBeVisible();
});

test('wartości domyślne: 18 000 zł na B2B', async ({ page }) => {
  // 18 000 × 0,8 = 14 400;  przy 0,0202 … 0,0322: 290,88 → 291 … 463,68 → 464
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('14 400 zł');
  await expect(wynik(page, 'Szacowana składka')).toHaveText(zakres(14400));
  // Duży ZUS 2026: 5 652 × (1 − 0,1371) × 0,8 = 3 901,69 → 3 902. Zasiłek nie
  // zależy od dochodu, tylko od podstawy. Do 21.10.2026 stało tu 2 240 zł —
  // płaca minimalna z 2021 r. pomnożona przez 0,8 (patrz src/lib/zus.ts).
  await expect(wynik(page, 'Zasiłek chorobowy z ZUS')).toHaveText('3 902 zł');
  const zus = page.locator('dt', { hasText: 'Zasiłek chorobowy z ZUS' });
  await expect(zus).toContainText('duży ZUS z chorobowym');
  await expect(zus).toContainText('na preferencyjnym ZUS-ie około 995 zł, bez chorobowego 0 zł');
});

/**
 * Tylko B2B (decyzja właściciela z 21.10.2026). Przełącznik „Umowa o pracę"
 * pokazywał przy etacie zasiłek przedsiębiorcy — a na etacie zasiłek zależy
 * od pensji. Etat dostaje zdanie opisu, bez kwot.
 */
test('kalkulator liczy tylko B2B, etat opisuje zdaniem', async ({ page }) => {
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('Forma zatrudnienia')).toHaveCount(0);
  await expect(page.locator('[data-etat]').first()).toHaveText(
    'Na umowie o pracę ZUS wypłaca co najmniej 80% pensji przez 182 dni. '
    + 'Polisa chroni dochód przy dłuższej niezdolności.',
  );
  await expect(page.getByText('do 80% udokumentowanego dochodu z działalności').first()).toBeVisible();
});

test('składka jest podana razem z opłatą dystrybucyjną', async ({ page }) => {
  const kwoty = page.locator('dl').filter({ hasText: 'Szacowana składka' }).first();
  await expect(kwoty).toContainText('razem z opłatą dystrybucyjną');
});

test('klauzula HIV/WZW podnosi stawkę o 7%', async ({ page }) => {
  expect(MNOZNIK_HIV_WZW).toBe(1.07);
  await page.getByLabel('Klauzula HIV / WZW').check();
  // 14 400 × 0,0202 × 1,07 = 311,24 → 311;  14 400 × 0,0322 × 1,07 = 496,14 → 496
  await expect(wynik(page, 'Szacowana składka')).toHaveText(zakres(14400, 1.07));

  await page.getByLabel('Klauzula HIV / WZW').uncheck();
  await expect(wynik(page, 'Szacowana składka')).toHaveText(zakres(14400));
});

/**
 * Skąd te liczby — to musi stać przy kwocie, nie w dokumentacji.
 *
 * Poprzednia stawka (1,5%) nie była niczym poparta i nikt tego po stronie nie
 * poznawał. Jeśli przedział znowu zacznie brać się znikąd, ten test padnie.
 */
test('przy składce stoi, że przedział pochodzi z wystawionych ofert', async ({ page }) => {
  const kwoty = page.locator('dl').filter({ hasText: 'Szacowana składka' }).first();
  await expect(kwoty).toContainText('przedział z ostatnio wystawionych ofert');
  // Zdanie zmienione decyzją właściciela z 14.10.2026: opisuje metodę (wariant
  // porównywalny z kalkulatorem), bez liczby ofert i wariantów — ta
  // zestarzałaby się przy pierwszej nowej ofercie.
  await expect(page.getByText(
    /policzyliśmy z ofert wystawionych w ostatnich 12 miesiącach, w wariancie porównywalnym z kalkulatorem: samo świadczenie miesięczne, wypłata przez 24 miesiące, okres wyczekiwania do 21 dni, składka w ratach — od najtańszej do najdroższej stawki/,
  )).toBeVisible();
  await expect(page.getByText(/ze wszystkich wariantów we wszystkich ofertach/)).toHaveCount(0);
  await expect(page.getByText(/o które ten kalkulator nie pyta/)).toBeVisible();
});

/**
 * Okres wypłaty jest w kalkulatorze informacją, nie przełącznikiem.
 *
 * Warianty są cztery — 24, 36, 48 i 60 miesięcy — ale współczynników stawki
 * dla dłuższych nie mamy z tabeli ubezpieczyciela. Przełącznik pokazywałby
 * wtedy cenę wariantu 24-miesięcznego pod etykietą 60-miesięcznego, czyli
 * dokładnie ten błąd, który miał tu wcześniej przełącznik „24 zamiast 12":
 * okres, którego nie da się kupić, w pozycji domyślnej.
 *
 * Test pilnuje więc trzech rzeczy naraz: że okresy są wymienione w komplecie,
 * że napisane jest, którego z nich dotyczy składka, i że wariant 12-miesięczny
 * nie wrócił.
 */
test('kalkulator wymienia cztery okresy i mówi, którego dotyczy składka', async ({ page }) => {
  const kwoty = page.locator('dl').filter({ hasText: 'Świadczenie z polisy' }).first();
  // Okres odszkodowawczy to NAJDŁUŻSZY czas wypłaty (LW044 § 15 pkt 9), nie
  // najkrótszy. Do 21.10.2026 stało tu „minimum przez 24 miesiące".
  await expect(kwoty).toContainText('najdłużej przez 24 miesiące');
  await expect(page.getByText(/minimum przez/)).toHaveCount(0);
  await expect(page.getByText(/wypłacane jest najdłużej przez 24, 36, 48 albo 60 miesięcy/)).toBeVisible();
  await expect(page.getByText(/składka dotyczy wariantu najkrótszego, 24-miesięcznego/)).toBeVisible();
  await expect(page.getByText(/zamiast 12/)).toHaveCount(0);
});

test('strona kalkulatora tłumaczy okresy wypłaty w pytaniach', async ({ page }) => {
  await page.goto('/kalkulator/');
  // Pytanie jest czwarte z kolei, a otwarte z marszu są dwa pierwsze.
  await page.locator('summary', { hasText: 'Jak długo wypłacane jest świadczenie' }).click();
  await expect(page.getByText(/Do wyboru są cztery okresy: 24, 36, 48, 60 miesięcy/)).toBeVisible();
});

test('suwak zmienia świadczenie', async ({ page }) => {
  const suwak = page.getByLabel('Miesięczny dochód netto z działalności lub kontraktu B2B, w złotych');
  await suwak.fill('30000');
  // 30 000 × 0,8 = 24 000;  przy 0,0202 … 0,0322: 484,8 → 485 … 772,8 → 773
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('24 000 zł');
  await expect(wynik(page, 'Szacowana składka')).toHaveText(zakres(24000));
});

test('przy każdej kwocie stoi zastrzeżenie, że to nie jest oferta', async ({ page }) => {
  await expect(page.getByText(/To jest symulacja, nie oferta/)).toBeVisible();
});

test('strona zawodu ma kalkulator z dochodem dobranym do zawodu', async ({ page }) => {
  await page.goto('/lekarz/');
  const naglowek = page.getByRole('heading', { name: /Symulacja składki dla lekarza/ });
  await naglowek.scrollIntoViewIfNeeded();
  await expect(naglowek).toBeVisible();
  // Lekarz: świadczenie 500 zł/dzień → dochód przykładowy 19 000 zł, suma 15 200 zł.
  await expect(wynik(page, 'Świadczenie z polisy')).toHaveText('15 200 zł');
});

/**
 * Niezmienniki stawek — niezależne od tego, co akurat policzył kalibrator.
 * Walidator przy imporcie symulacja.ts pilnuje tego samego (build pada), ale
 * test mówi wprost, która granica pękła.
 */
test('stawki z kalibracja.json: dół < góra, obie w przedziale 1–5%', { tag: '@plik' }, () => {
  expect(Number.isFinite(dol) && Number.isFinite(gora)).toBe(true);
  expect(dol).toBeLessThan(gora);
  expect(dol).toBeGreaterThanOrEqual(0.01);
  expect(gora).toBeLessThanOrEqual(0.05);
  expect(KALIBRACJA.stawka.srodek).toBeGreaterThanOrEqual(dol);
  expect(KALIBRACJA.stawka.srodek).toBeLessThanOrEqual(gora);
  expect(KALIBRACJA.okresy['24']).toBe(1);
  expect(bledyKalibracji(KALIBRACJA)).toEqual([]);
});

/**
 * Plik kalibracji przepisuje bot pull requestem. Walidator przy imporcie
 * symulacja.ts ma zatrzymać build na pliku, który dałby na stronie bzdurę —
 * Pages zostawia wtedy poprzednie wdrożenie zamiast pokazać składkę NaN zł.
 */
test.describe('walidator kalibracja.json (sprawdzKalibracje)', { tag: '@plik' }, () => {
  const dobry = () => structuredClone(KALIBRACJA);
  const z = (zmien) => { const k = dobry(); zmien(k); return k; };

  test('obecny plik przechodzi i wraca bez zmian', () => {
    expect(sprawdzKalibracje(dobry())).toEqual(KALIBRACJA);
  });

  const ZLE = [
    ['brak stawka.gora', z((k) => { delete k.stawka.gora; })],
    ['brak stawki', z((k) => { delete k.stawka; })],
    ['brak okresów', z((k) => { delete k.okresy; })],
    ['brak policzono', z((k) => { delete k.policzono; })],
    ['brak zrodlo', z((k) => { delete k.zrodlo; })],
    ['napis zamiast liczby', z((k) => { k.stawka.dol = '0.0202'; })],
    ['NaN', z((k) => { k.stawka.srodek = NaN; })],
    ['Infinity', z((k) => { k.stawka.gora = Infinity; })],
    ['dół > góra', z((k) => { k.stawka = { dol: 0.03, srodek: 0.03, gora: 0.02 }; })],
    ['środek poza przedziałem', z((k) => { k.stawka.srodek = 0.04; })],
    ['stawka powyżej 5%', z((k) => { k.stawka.gora = 0.06; })],
    ['stawka poniżej 1%', z((k) => { k.stawka.dol = 0.009; })],
    ['okresy["24"] ≠ 1', z((k) => { k.okresy['24'] = 1.01; })],
    ['brak okresu 24', z((k) => { k.okresy = { 36: 1.25 }; })],
    ['klucz 72', z((k) => { k.okresy['72'] = 1.9; })],
    ['mnożnik ponad 2', z((k) => { k.okresy['36'] = 2.01; })],
    ['mnożnik jako napis', z((k) => { k.okresy['36'] = '1.25'; })],
    ['mnożniki malejące', z((k) => { k.okresy = { 24: 1, 36: 1.4, 48: 1.3 }; })],
    ['policzono w złym formacie', z((k) => { k.policzono = '14.10.2026'; })],
    ['policzono — nieistniejący dzień', z((k) => { k.policzono = '2026-02-30'; })],
    ['tablica zamiast obiektu', []],
    ['null', null],
  ];

  for (const [opis, plik] of ZLE) {
    test(`odrzuca: ${opis}`, () => {
      expect(bledyKalibracji(plik).length, opis).toBeGreaterThan(0);
      expect(() => sprawdzKalibracje(plik), opis).toThrow(/kalibracja\.json jest niepoprawny/);
    });
  }

  test('przyjmuje granice 1% i 5% oraz komplet okresów', () => {
    expect(bledyKalibracji(z((k) => { k.stawka = { dol: 0.01, srodek: 0.03, gora: 0.05 }; }))).toEqual([]);
    expect(bledyKalibracji(z((k) => { k.okresy = { 24: 1, 36: 1.25, 48: 1.5, 60: 1.75 }; }))).toEqual([]);
  });
});
