import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  miesiaceDoKwoty, odlozone, dniSwiadczenia, rownowartoscSlownie, czasSlownie, wZakresie,
  PRZYKLAD, ZAKRES_ODKLADANIA, OPROCENTOWANIE,
} from '../src/lib/odkladanie.ts';

/**
 * „Gdyby odkładać samodzielnie" — druga kolumna karty kalkulatora na
 * /kalkulator/ (pomysł właściciela z 21.10.2026; od 23.10.2026 obok składki,
 * karta na 2/3 strony, oprocentowanie stałe 3% rocznie).
 *
 * Miesiące w oczekiwaniach liczy ten test sam, miesiąc po miesiącu — nie
 * wzorem z biblioteki, bo test sprawdzałby wtedy rachunek nim samym. Kwoty
 * składki biorą się z kalibracja.json, jak w kalkulator.spec.js: plik zmienia
 * kalibrator i kwoty wpisane na sztywno zestarzałyby się przy pierwszym
 * scaleniu.
 */

const KALIBRACJA = JSON.parse(readFileSync(new URL('../src/lib/kalibracja.json', import.meta.url), 'utf8'));
const grupuj = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const zl = (n) => `${grupuj(Math.round(n))} zł`;

/** Miesiąc po miesiącu: wpłata na koniec miesiąca, odsetki od salda. */
function miesiacePoKolei(cel, wplata, procent = OPROCENTOWANIE) {
  let saldo = 0;
  let n = 0;
  while (saldo < cel - 1e-6) {
    saldo = saldo * (1 + procent / 1200) + wplata;
    n += 1;
  }
  return n;
}
function saldoPoKolei(wplata, miesiace, procent = OPROCENTOWANIE) {
  let saldo = 0;
  for (let i = 0; i < miesiace; i += 1) saldo = saldo * (1 + procent / 1200) + wplata;
  return saldo;
}

/** Kwota, za którą idzie pole: górna granica składki, w dziesiątkach złotych. */
const zeSkladki = (swiadczenie) =>
  Math.min(ZAKRES_ODKLADANIA.max, Math.max(ZAKRES_ODKLADANIA.min,
    Math.round(Math.round(swiadczenie * KALIBRACJA.stawka.gora) / 10) * 10));

test.describe('rachunek', () => {
  test('oprocentowanie jest stałe: 3% rocznie (decyzja właściciela z 23.10.2026)', () => {
    expect(OPROCENTOWANIE).toBe(3);
  });

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
    // Wzór i rachunek miesiąc po miesiącu dają to samo na całej siatce kwot.
    for (const cel of [2000, 9999, 14400, 28800, 50000]) {
      for (const wplata of [50, 137, 460, 2000]) {
        expect(miesiaceDoKwoty(cel, wplata, OPROCENTOWANIE), `${cel} po ${wplata}`).toBe(miesiacePoKolei(cel, wplata));
      }
    }
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
    // Dochód w kalkulatorze idzie co 500 zł.
    expect(wZakresie('18.000', 3000, 60000, 500, 18000)).toBe(18000);
    expect(wZakresie('12 345', 3000, 60000, 500, 18000)).toBe(12500);
  });
});

const wynik = (page, nazwa) => page.locator(`[data-wynik="${nazwa}"]`);
const kwota = (page) => page.getByRole('spinbutton', { name: 'Ile możesz odkładać co miesiąc' });
const suwakKwoty = (page) => page.getByRole('slider', { name: /Kwota odkładana/ });
const suwakDochodu = (page) => page.getByRole('slider', { name: /Miesięczny dochód netto/ });

/** Wynik odkładania dla świadczenia i wpłaty — policzony miesiąc po miesiącu. */
async function sprawdzWynik(page, swiadczenie, wplata) {
  await expect(kwota(page)).toHaveValue(String(wplata));
  await expect(wynik(page, 'jeden')).toHaveText(czasSlownie(miesiacePoKolei(swiadczenie, wplata)));
  await expect(wynik(page, 'dwa')).toHaveText(czasSlownie(miesiacePoKolei(2 * swiadczenie, wplata)));
  await expect(wynik(page, 'rok')).toHaveText(zl(saldoPoKolei(wplata, 12)));
  await expect(page.locator('#odkladanie')).toContainText(`${zl(swiadczenie)}, odkładając ${zl(wplata)} miesięcznie`);
}

/** Kalkulator jest `client:idle` — czekamy, aż wyspa się zhydratuje. */
async function otworz(page, adres = '/kalkulator/') {
  await page.goto(adres);
  await expect(page.locator('astro-island:has(#odkladanie)')).not.toHaveAttribute('ssr', /.*/);
}

test.describe('karta kalkulatora z odkładaniem', () => {
  test('od razu po wejściu: dochód 18 000 zł, odkładanie tyle co górna granica składki', async ({ page }) => {
    await otworz(page);
    // 18 000 × 0,8 = 14 400 zł świadczenia.
    await sprawdzWynik(page, 14400, zeSkladki(14400));
    await expect(page.locator('[data-podpowiedz]')).toContainText('Tyle co górna granica szacowanej składki');
    await expect(page.locator('#odkladanie [data-rownowartosc]'))
      .toHaveText(`równowartość ${rownowartoscSlownie(saldoPoKolei(zeSkladki(14400), 12), 14400)} świadczenia`);
  });

  test('suwak dochodu: świadczenie i kwota odkładana idą za kalkulatorem', async ({ page }) => {
    await otworz(page);
    await suwakDochodu(page).fill('30000');
    // 30 000 × 0,8 = 24 000 zł.
    await sprawdzWynik(page, 24000, zeSkladki(24000));
    // Klauzula HIV/WZW podnosi składkę — kwota odkładana idzie za nią.
    await page.getByLabel('Klauzula HIV / WZW').check();
    const zKlauzula = Math.round(Math.round(24000 * KALIBRACJA.stawka.gora * 1.07) / 10) * 10;
    await expect(kwota(page)).toHaveValue(String(zKlauzula));
  });

  test('własna kwota zostaje przy zmianie dochodu, „tyle co składka" wraca do składki', async ({ page }) => {
    await otworz(page);
    await kwota(page).fill('250');
    await expect(page.locator('[data-podpowiedz]')).toContainText('Twoja kwota');
    await sprawdzWynik(page, 14400, 250);
    await expect(suwakKwoty(page)).toHaveValue('250');

    await suwakDochodu(page).fill('30000');
    await sprawdzWynik(page, 24000, 250);

    await page.getByRole('button', { name: 'Odkładaj tyle co składka' }).click();
    await sprawdzWynik(page, 24000, zeSkladki(24000));
  });

  test('suwak kwoty odkładanej zmienia wynik i pole', async ({ page }) => {
    await otworz(page);
    await suwakKwoty(page).fill('1000');
    await sprawdzWynik(page, 14400, 1000);
  });

  test('pole poza zakresem: wynik od razu z zakresu, pole poprawione po wyjściu', async ({ page }) => {
    await otworz(page);
    await kwota(page).fill('99999');
    // Jeszcze w polu: wpisane zostaje, a wynik liczy się z 2 000 zł.
    await expect(kwota(page)).toHaveValue('99999');
    await expect(wynik(page, 'jeden')).toHaveText(czasSlownie(miesiacePoKolei(14400, ZAKRES_ODKLADANIA.max)));
    await kwota(page).blur();
    await expect(kwota(page)).toHaveValue(String(ZAKRES_ODKLADANIA.max));
  });

  test('wyczyszczone pole nie gubi wpisanej kwoty i nie przestawia suwaka', async ({ page }) => {
    await otworz(page);
    await kwota(page).fill('500');
    await kwota(page).fill('');
    await expect(wynik(page, 'jeden')).toHaveText(czasSlownie(miesiacePoKolei(14400, 500)));
    await expect(suwakKwoty(page)).toHaveValue('500');
    await kwota(page).blur();
    await expect(kwota(page)).toHaveValue('500');
  });

  test('bez pola oprocentowania — przy wyniku stoi „3% rocznie"', async ({ page }) => {
    await otworz(page);
    await expect(page.getByRole('spinbutton', { name: /Oprocentowanie/ })).toHaveCount(0);
    await expect(page.getByRole('slider', { name: /Oprocentowanie/ })).toHaveCount(0);
    const uczciwie = page.locator('#odkladanie [data-uczciwie]');
    await expect(uczciwie).toContainText('oprocentowanie oszczędności 3% rocznie');
    await expect(uczciwie).toContainText('składka nie wraca');
    await expect(uczciwie).toContainText('po okresie wyczekiwania');
    await expect(uczciwie).toContainText('Symulacja, nie oferta');
  });

  test('wartości z adresu: dochód, dawne ?swiadczenie= i kwota od agenta', async ({ page }) => {
    await otworz(page, '/kalkulator/?dochod=30000#odkladanie');
    await expect(page.locator('#odkladanie')).toContainText('24 000 zł, odkładając');
    // Dawny link z kwotą świadczenia: 10 000 / 0,8 = 12 500 zł dochodu.
    await otworz(page, '/kalkulator/?swiadczenie=10000');
    await expect(page.locator('output', { hasText: 'zł' }).first()).toHaveText('12 500 zł');
    await sprawdzWynik(page, 10000, zeSkladki(10000));
    // Kwota od agenta: własna, nie idzie za składką.
    await otworz(page, '/kalkulator/?odkladam=250&dochod=12500');
    await sprawdzWynik(page, 10000, 250);
    await expect(page.locator('[data-podpowiedz]')).toContainText('Twoja kwota');
    // Separator tysięcy i śmieci.
    await otworz(page, '/kalkulator/?odkladam=1.500&dochod=abc');
    await expect(kwota(page)).toHaveValue('1500');
    await expect(page.locator('output', { hasText: 'zł' }).first()).toHaveText('18 000 zł');
  });

  test('czytnik ekranu: jedno podsumowanie po zmianie, nic przy wczytaniu', async ({ page }) => {
    await otworz(page);
    const komunikat = page.locator('#odkladanie [aria-live="polite"]');
    await expect(komunikat).toHaveCount(1);
    await page.waitForTimeout(1200);
    await expect(komunikat).toHaveText('');
    await kwota(page).fill('500');
    await expect(komunikat).toHaveText(`Odkładając 500 zł miesięcznie: jeden miesiąc świadczenia — `
      + `${czasSlownie(miesiacePoKolei(14400, 500))}, dwa miesiące — ${czasSlownie(miesiacePoKolei(28800, 500))}.`);
  });

  test('układ: tekst 1/3, karta 2/3, odkładanie obok składki (1440 px)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await otworz(page);
    const tekst = await page.locator('[data-odpowiedz]').boundingBox();
    const karta = await page.locator('astro-island:has(#odkladanie) > div').first().boundingBox();
    expect(karta.x, 'karta po prawej stronie tekstu').toBeGreaterThan(tekst.x + tekst.width);
    const proporcja = karta.width / (karta.width + tekst.width);
    expect(proporcja, `karta zajmuje ${Math.round(proporcja * 100)}% szerokości`).toBeGreaterThan(0.6);
    expect(proporcja).toBeLessThan(0.72);
    const skladka = await page.getByRole('heading', { name: 'Symulacja składki' }).boundingBox();
    const odkladanie = await page.getByRole('heading', { name: 'Gdyby odkładać samodzielnie' }).boundingBox();
    expect(Math.abs(odkladanie.y - skladka.y), 'nagłówki obu kolumn na jednej wysokości').toBeLessThan(5);
    expect(odkladanie.x).toBeGreaterThan(skladka.x + skladka.width);
  });

  test('na telefonie (390 px): odkładanie zaraz pod przyciskiem, przypisy na końcu, bez poziomego przewijania', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await otworz(page);
    const przycisk = await page.getByRole('link', { name: 'Przejdź do wniosku' }).boundingBox();
    const odkladanie = await page.getByRole('heading', { name: 'Gdyby odkładać samodzielnie' }).boundingBox();
    const przypis = await page.getByText('To jest symulacja, nie oferta.').boundingBox();
    expect(odkladanie.y).toBeGreaterThan(przycisk.y);
    expect(przypis.y, 'przypisy pod odkładaniem').toBeGreaterThan(odkladanie.y);
    const nadmiar = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(nadmiar, `/kalkulator/ rozpycha stronę na 390 px o ${nadmiar} px`).toBeLessThanOrEqual(0);
  });

  test('osobnej sekcji odkładania na dole strony już nie ma', async ({ page }) => {
    await otworz(page);
    await expect(page.locator('#odkladanie')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: /Odkładać samemu czy się ubezpieczyć/ })).toHaveCount(0);
  });
});

test.describe('kalkulator na innych stronach', () => {
  test('bez kolumny odkładania, z odnośnikiem idącym za dochodem', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#odkladanie')).toHaveCount(0);
    const link = page.locator('a[data-odkladanie]');
    await expect(link).toHaveAttribute('href', '/kalkulator/?dochod=18000#odkladanie');
    await suwakDochodu(page).fill('30000');
    await expect(link).toHaveAttribute('href', '/kalkulator/?dochod=30000#odkladanie');
    await link.click();
    await expect(page.locator('astro-island:has(#odkladanie)')).not.toHaveAttribute('ssr', /.*/);
    await sprawdzWynik(page, 24000, zeSkladki(24000));
  });
});

test.describe('treść w buildzie', () => {
  /** Kolumna odkładania w wyspie wyrenderowanej na serwerze. */
  const kolumnaHtml = () => {
    const html = readFileSync('dist/kalkulator/index.html', 'utf8');
    const od = html.indexOf('id="odkladanie"');
    return od < 0 ? '' : html.slice(od, html.indexOf('</astro-island>', od));
  };
  const kolumnaMd = () => {
    const md = readFileSync('dist/kalkulator/index.md', 'utf8');
    const od = md.indexOf('## Gdyby odkładać samodzielnie');
    return od < 0 ? '' : md.slice(od, md.indexOf('## Punkty odniesienia'));
  };

  test('wynik i zastrzeżenia są w HTML-u z serwera i w .md, nie tylko po hydratacji', () => {
    const wplata = zeSkladki(14400);
    for (const [nazwa, tekst] of [['index.html (kolumna)', kolumnaHtml()], ['index.md (kolumna)', kolumnaMd()]]) {
      expect(tekst.length, `${nazwa} — brak kolumny odkładania`).toBeGreaterThan(500);
      expect(tekst, nazwa).toContain(czasSlownie(miesiacePoKolei(14400, wplata)));
      // Kwota wpłaty przy wyniku — w .md pól nie ma, bez niej wynik nie mówi, przy jakiej wpłacie.
      expect(tekst, nazwa).toContain(`odkładając ${zl(wplata)} miesięcznie`);
      expect(tekst, nazwa).toContain('składka nie wraca');
      expect(tekst, nazwa).toContain('po okresie wyczekiwania');
      expect(tekst, nazwa).toContain('3% rocznie');
      expect(tekst, nazwa).not.toContain('za każdy miesiąc');
    }
  });

  test('pytanie o odkładanie w FAQ, przy 3% rocznie', () => {
    const html = readFileSync('dist/kalkulator/index.html', 'utf8');
    const blok = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    const faq = JSON.parse(blok)['@graph'].find((w) => w['@type'] === 'FAQPage');
    const pytanie = faq.mainEntity.find((p) => p.name.startsWith('Czy nie lepiej odkładać'));
    expect(pytanie, 'brak pytania o odkładanie w FAQPage').toBeTruthy();
    const odp = pytanie.acceptedAnswer.text;
    expect(odp).toContain(czasSlownie(miesiacePoKolei(PRZYKLAD.swiadczenie, PRZYKLAD.odkladam)));
    expect(odp).toContain(czasSlownie(miesiacePoKolei(2 * PRZYKLAD.swiadczenie, PRZYKLAD.odkladam)));
    expect(odp).toContain('3% rocznie');
    // Odpowiedź z FAQ cytuje się bez reszty strony — zastrzeżenia muszą stać w niej samej.
    expect(odp).toContain('razem z opłatą dystrybucyjną');
    expect(odp).toContain('najdłużej przez 24 miesiące');
    expect(odp).toContain('nie oferta');
    expect(odp).toContain('po okresie wyczekiwania');
    expect(odp).toContain('składka nie wraca');
  });
});
