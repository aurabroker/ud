import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  miesiaceDoKwoty, odlozone, dniSwiadczenia, rownowartoscSlownie, czasSlownie, wZakresie,
  PRZYKLAD, ZAKRES_ODKLADANIA,
} from '../src/lib/odkladanie.ts';
import { SWIADCZENIE_MAX } from '../src/lib/granice.ts';

/**
 * „Odkładać samemu czy się ubezpieczyć?" na /kalkulator/#odkladanie
 * (pomysł właściciela z 21.10.2026: klientka uznała 250 zł składki za dużo
 * i chciała tyle odkładać, przy świadczeniu 10 000 zł miesięcznie).
 *
 * Liczby w oczekiwaniach są policzone ręcznie, nie wzięte z biblioteki —
 * inaczej test sprawdzałby rachunek nim samym.
 */

test.describe('rachunek', () => {
  test('ile miesięcy odkładania na jedno i dwa świadczenia', () => {
    // 10 000 / 250 = 40;  20 000 / 250 = 80.
    expect(miesiaceDoKwoty(10000, 250)).toBe(40);
    expect(miesiaceDoKwoty(20000, 250)).toBe(80);
    // Niepełny miesiąc liczy się jako pełny: 10 000 / 300 = 33,3 → 34.
    expect(miesiaceDoKwoty(10000, 300)).toBe(34);
    // 4% rocznie, kapitalizacja miesięczna: ln(1 + 10 000·0,04/12/250) / ln(1 + 0,04/12) = 37,6 → 38.
    expect(miesiaceDoKwoty(10000, 250, 4)).toBe(38);
    expect(miesiaceDoKwoty(10000, 0)).toBe(Infinity);
    expect(miesiaceDoKwoty(0, 250)).toBe(0);
  });

  test('ile odłożysz przez rok i ile to świadczenia', () => {
    expect(odlozone(250, 12)).toBe(3000);
    // (1 + 0,04/12)^12 = 1,040742;  (1,040742 − 1) / (0,04/12) = 12,2225;  × 250 = 3 055,62
    expect(odlozone(250, 12, 4)).toBeCloseTo(3055.62, 2);
    // 3 000 zł przy 10 000 zł / mies. = 333,33 zł / dzień → 9 pełnych dni.
    expect(dniSwiadczenia(3000, 10000)).toBe(9);
    expect(rownowartoscSlownie(3000, 10000)).toBe('9 dni');
    // 1 000 zł przy 30 000 zł / mies. = dokładnie jeden dzień.
    expect(rownowartoscSlownie(1000, 30000)).toBe('1 dnia');
    // 50 zł · 12 = 600 zł przy 50 000 zł / mies. (1 666 zł / dzień) — mniej niż dzień, nie „0 dni".
    expect(rownowartoscSlownie(600, 50000)).toBe('mniej niż 1 dnia');
    // Od 30 dni w miesiącach: 2 000 · 12 = 24 000 przy 2 000 → 12; 3 000 przy 2 000 → 1,5.
    expect(rownowartoscSlownie(24000, 2000)).toBe('12 miesięcy');
    expect(rownowartoscSlownie(3000, 2000)).toBe('1,5 miesiąca');
    expect(rownowartoscSlownie(2000, 2000)).toBe('1 miesiąca');
    expect(rownowartoscSlownie(4000, 2000)).toBe('2 miesięcy');
  });

  test('czas słownie, z odmianą', () => {
    expect(czasSlownie(40)).toBe('3 lata i 4 miesiące');
    expect(czasSlownie(80)).toBe('6 lat i 8 miesięcy');
    expect(czasSlownie(12)).toBe('1 rok');
    expect(czasSlownie(25)).toBe('2 lata i 1 miesiąc');
    expect(czasSlownie(22)).toBe('1 rok i 10 miesięcy');
    expect(czasSlownie(5)).toBe('5 miesięcy');
    expect(czasSlownie(1)).toBe('1 miesiąc');
    expect(czasSlownie(0)).toBe('0 miesięcy');
    expect(czasSlownie(12 * 12 + 2)).toBe('12 lat i 2 miesiące');
    expect(czasSlownie(22 * 12)).toBe('22 lata');
    expect(czasSlownie(Infinity)).toBe('nigdy');
  });

  test('wartości z adresu i z pola wracają do zakresu', () => {
    const { min, max } = ZAKRES_ODKLADANIA;
    expect(wZakresie('abc', min, max, 1, 250)).toBe(250);
    expect(wZakresie('', min, max, 1, 250)).toBe(250);
    expect(wZakresie(null, min, max, 1, 250)).toBe(250);
    expect(wZakresie('999999', min, max, 1, 250)).toBe(max);
    expect(wZakresie('-5', min, max, 1, 250)).toBe(min);
    expect(wZakresie(' 1 000 ', min, max, 1, 250)).toBe(1000);
    // Separator tysięcy w kwotach — „1.500" to 1 500 zł, nie 1,5 zł przycięte do 50.
    expect(wZakresie('1.500', min, max, 1, 250)).toBe(1500);
    expect(wZakresie('1,500', min, max, 1, 250)).toBe(1500);
    expect(wZakresie('1.500.000', 2000, 50000, 1, 10000)).toBe(50000);
    // …ale nie w procentach: „2,5" to dwa i pół.
    expect(wZakresie('2,5', 0, 8, 0.1, 0)).toBe(2.5);
  });
});

const wynik = (page, nazwa) => page.locator(`[data-wynik="${nazwa}"]`);
/** Pole liczbowe — obok każdego stoi suwak o podobnej nazwie, więc szukamy po roli. */
const pole = (sekcja, nazwa) => sekcja.getByRole('spinbutton', { name: nazwa });
const suwak = (sekcja, nazwa) => sekcja.getByRole('slider', { name: nazwa });

/** Wyspa jest `client:visible` — hydratuje się dopiero po przewinięciu do niej. */
async function otworz(page, adres = '/kalkulator/') {
  await page.goto(adres);
  const sekcja = page.locator('#odkladanie');
  await sekcja.scrollIntoViewIfNeeded();
  await expect(sekcja.locator('astro-island')).not.toHaveAttribute('ssr', /.*/);
  return sekcja;
}

test.describe('symulator na stronie', () => {
  test('wartości startowe: 250 zł odkładane, świadczenie 10 000 zł', async ({ page }) => {
    const sekcja = await otworz(page);
    await expect(pole(sekcja, 'Ile możesz odkładać co miesiąc')).toHaveValue(String(PRZYKLAD.odkladam));
    await expect(pole(sekcja, 'Miesięczne świadczenie z polisy')).toHaveValue(String(PRZYKLAD.swiadczenie));
    await expect(wynik(page, 'jeden')).toHaveText('3 lata i 4 miesiące');
    await expect(wynik(page, 'dwa')).toHaveText('6 lat i 8 miesięcy');
    await expect(wynik(page, 'rok')).toHaveText('3 000 zł');
    await expect(sekcja.locator('[data-rownowartosc]')).toHaveText('równowartość 9 dni świadczenia');
  });

  test('przy wyniku: składka nie wraca, okres wyczekiwania, wariant 24 miesiące', async ({ page }) => {
    const sekcja = await otworz(page);
    const uczciwie = sekcja.locator('[data-uczciwie]');
    await expect(uczciwie).toContainText('składka nie wraca');
    await expect(uczciwie).toContainText('po okresie wyczekiwania');
    await expect(uczciwie).toContainText('Symulacja, nie oferta');
    const skladka = sekcja.locator('[data-skladka]');
    await expect(skladka).toContainText('razem z opłatą dystrybucyjną');
    await expect(skladka).toContainText('najdłużej przez 24 miesiące');
    await expect(skladka).toContainText('po okresie wyczekiwania');
    // LW044 za okres wyczekiwania świadczenia nie daje — „za każdy miesiąc" to „od pierwszego dnia" innymi słowami.
    await expect(skladka).not.toContainText('za każdy miesiąc');
  });

  test('pole liczbowe i suwak zmieniają wynik', async ({ page }) => {
    const sekcja = await otworz(page);
    // 10 000 / 500 = 20 miesięcy; 20 000 / 500 = 40.
    await pole(sekcja, 'Ile możesz odkładać co miesiąc').fill('500');
    await expect(wynik(page, 'jeden')).toHaveText('1 rok i 8 miesięcy');
    await expect(wynik(page, 'dwa')).toHaveText('3 lata i 4 miesiące');
    await expect(suwak(sekcja, /Kwota odkładana/)).toHaveValue('500');

    // Suwak świadczenia: 20 000 / 500 = 40, a pole idzie za suwakiem.
    await suwak(sekcja, /Miesięczne świadczenie/).fill('20000');
    await expect(pole(sekcja, 'Miesięczne świadczenie z polisy')).toHaveValue('20000');
    await expect(wynik(page, 'jeden')).toHaveText('3 lata i 4 miesiące');

    // Odsetki: 10 000 przy 250 zł i 4% rocznie — 38 miesięcy (rachunek wyżej).
    await pole(sekcja, 'Ile możesz odkładać co miesiąc').fill('250');
    await pole(sekcja, 'Miesięczne świadczenie z polisy').fill('10000');
    await pole(sekcja, 'Oprocentowanie oszczędności').fill('4');
    await expect(wynik(page, 'jeden')).toHaveText('3 lata i 2 miesiące');
    await expect(sekcja.locator('[data-uczciwie]')).toContainText('odsetki 4% rocznie');
  });

  test('pole poza zakresem: wynik od razu z zakresu, pole poprawione po wyjściu', async ({ page }) => {
    const sekcja = await otworz(page);
    const kwota = pole(sekcja, 'Ile możesz odkładać co miesiąc');
    await kwota.fill('99999');
    // Jeszcze w polu: wpisane zostaje, a wynik liczy się z 2 000 zł (10 000 / 2 000 = 5 miesięcy).
    await expect(kwota).toHaveValue('99999');
    await expect(wynik(page, 'jeden')).toHaveText('5 miesięcy');
    await kwota.blur();
    await expect(kwota).toHaveValue(String(ZAKRES_ODKLADANIA.max));
  });

  test('wyczyszczone pole nie gubi wpisanej kwoty i nie przestawia suwaka', async ({ page }) => {
    const sekcja = await otworz(page);
    const kwota = pole(sekcja, 'Ile możesz odkładać co miesiąc');
    await kwota.fill('500');
    await kwota.fill('');
    // W trakcie poprawiania: wynik i suwak trzymają 500 zł, nie wracają do 250 ani na środek suwaka.
    await expect(wynik(page, 'jeden')).toHaveText('1 rok i 8 miesięcy');
    await expect(suwak(sekcja, /Kwota odkładana/)).toHaveValue('500');
    await kwota.blur();
    await expect(kwota).toHaveValue('500');
  });

  test('wartości z adresu — link agenta', async ({ page }) => {
    let sekcja = await otworz(page, '/kalkulator/?odkladam=500&swiadczenie=14400#odkladanie');
    await expect(pole(sekcja, 'Ile możesz odkładać co miesiąc')).toHaveValue('500');
    await expect(pole(sekcja, 'Miesięczne świadczenie z polisy')).toHaveValue('14400');
    // 14 400 / 500 = 28,8 → 29 miesięcy.
    await expect(wynik(page, 'jeden')).toHaveText('2 lata i 5 miesięcy');

    // Śmieci w jednym parametrze nie psują drugiego (500 dowodzi, że adres był czytany).
    sekcja = await otworz(page, '/kalkulator/?odkladam=500&swiadczenie=abc');
    await expect(pole(sekcja, 'Ile możesz odkładać co miesiąc')).toHaveValue('500');
    await expect(pole(sekcja, 'Miesięczne świadczenie z polisy')).toHaveValue(String(PRZYKLAD.swiadczenie));
    sekcja = await otworz(page, '/kalkulator/?odkladam=999999&swiadczenie=999999');
    await expect(pole(sekcja, 'Ile możesz odkładać co miesiąc')).toHaveValue(String(ZAKRES_ODKLADANIA.max));
    await expect(pole(sekcja, 'Miesięczne świadczenie z polisy')).toHaveValue(String(SWIADCZENIE_MAX));
    // Kwota z separatorem tysięcy, jak ją ktoś przepisze z oferty.
    sekcja = await otworz(page, '/kalkulator/?odkladam=1.500');
    await expect(pole(sekcja, 'Ile możesz odkładać co miesiąc')).toHaveValue('1500');
  });

  test('czytnik ekranu: jedno podsumowanie po zmianie, nic przy wczytaniu', async ({ page }) => {
    const sekcja = await otworz(page);
    const komunikat = sekcja.locator('[aria-live="polite"]');
    await expect(komunikat).toHaveCount(1);
    await page.waitForTimeout(1200);
    await expect(komunikat).toHaveText('');
    await pole(sekcja, 'Ile możesz odkładać co miesiąc').fill('500');
    await expect(komunikat).toHaveText(
      'Odkładając 500 zł miesięcznie: jeden miesiąc świadczenia — 1 rok i 8 miesięcy, dwa miesiące — 3 lata i 4 miesiące.');
  });

  test('kalkulator prowadzi do symulatora ze swoim świadczeniem', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('a[data-odkladanie]');
    // Domyślnie 18 000 zł dochodu → świadczenie 14 400 zł.
    await expect(link).toHaveAttribute('href', '/kalkulator/?swiadczenie=14400#odkladanie');
    // Link idzie za suwakiem: 30 000 zł dochodu → 24 000 zł świadczenia.
    await page.getByRole('slider', { name: /Miesięczny dochód netto/ }).fill('30000');
    await expect(link).toHaveAttribute('href', '/kalkulator/?swiadczenie=24000#odkladanie');
    await link.click();
    const sekcja = page.locator('#odkladanie');
    await expect(sekcja.locator('astro-island')).not.toHaveAttribute('ssr', /.*/);
    await expect(pole(sekcja, 'Miesięczne świadczenie z polisy')).toHaveValue('24000');
  });

  test('na telefonie (390 px) nic nie wychodzi poza ekran', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await otworz(page);
    const nadmiar = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(nadmiar, `/kalkulator/ rozpycha stronę na 390 px o ${nadmiar} px`).toBeLessThanOrEqual(0);
  });
});

test.describe('treść w buildzie', () => {
  /** Sama wyspa symulatora — bez nagłówka sekcji i FAQ, które powtarzają część zdań. */
  const wyspaHtml = () => {
    const html = readFileSync('dist/kalkulator/index.html', 'utf8');
    const od = html.indexOf('<astro-island', html.indexOf('id="odkladanie"'));
    return html.slice(od, html.indexOf('</astro-island>', od));
  };
  const sekcjaMd = () => {
    const md = readFileSync('dist/kalkulator/index.md', 'utf8');
    return md.slice(md.indexOf('## Odkładać samemu'), md.indexOf('## Jak czytać'));
  };

  test('wynik i zastrzeżenie są w wyspie wyrenderowanej w HTML-u i w .md', () => {
    for (const [nazwa, tekst] of [['index.html (wyspa)', wyspaHtml()], ['index.md (sekcja)', sekcjaMd()]]) {
      expect(tekst.length, `${nazwa} — brak sekcji`).toBeGreaterThan(500);
      expect(tekst, nazwa).toContain('3 lata i 4 miesiące');
      // Kwota wpłaty przy wyniku — w .md pól nie ma, bez niej wynik nie mówi, przy jakiej wpłacie.
      expect(tekst, nazwa).toContain('odkładając 250 zł miesięcznie');
      // Uczciwie wobec odkładania — bez tego symulator byłby reklamą.
      expect(tekst, nazwa).toContain('składka nie wraca');
      expect(tekst, nazwa).toContain('po okresie wyczekiwania');
      expect(tekst, nazwa).toContain('razem z opłatą dystrybucyjną');
      expect(tekst, nazwa).not.toContain('za każdy miesiąc');
    }
  });

  test('pytanie o odkładanie w FAQ, z liczbami z rachunku', () => {
    const html = readFileSync('dist/kalkulator/index.html', 'utf8');
    const blok = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    const faq = JSON.parse(blok)['@graph'].find((w) => w['@type'] === 'FAQPage');
    const pytanie = faq.mainEntity.find((p) => p.name.startsWith('Czy nie lepiej odkładać'));
    expect(pytanie, 'brak pytania o odkładanie w FAQPage').toBeTruthy();
    const odp = pytanie.acceptedAnswer.text;
    expect(odp).toContain('3 lata i 4 miesiące');
    expect(odp).toContain('6 lat i 8 miesięcy');
    // Odpowiedź z FAQ cytuje się bez reszty strony — zastrzeżenia muszą stać w niej samej.
    expect(odp).toContain('razem z opłatą dystrybucyjną');
    expect(odp).toContain('najdłużej przez 24 miesiące');
    expect(odp).toContain('nie oferta');
    expect(odp).toContain('po okresie wyczekiwania');
    expect(odp).toContain('składka nie wraca');
  });
});
