import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FIRMA, COVERHOLDERZY, UBEZPIECZYCIELE, OPIS_PODMIOTOW } from '../src/lib/firma.ts';
import { EKSPERT } from '../src/lib/ekspert.ts';

/**
 * Kto jest kim — ubezpieczyciel, coverholderzy, agent — oraz opinie i ekspert.
 *
 * Do 21.10.2026 serwis nazywał Leadenhall Insurance S.A. i CEU sp. z o.o.
 * „ubezpieczycielami", także w klauzuli RODO („Ubezpieczycielom, w imieniu
 * których działamy: …") i w polityce prywatności („ubezpieczycielom
 * i reasekuratorom: …"). OWU mówią co innego:
 *
 *  - LW044 § 1 ust. 3: „Leadenhall Insurance S.A. działa w Polsce jako Lloyd’s
 *    coverholder i jest przedstawicielem Ubezpieczyciela…",
 *  - OWU CEU § 1: „CEU posiada uprawnienia coverholdera Lloyd’s i działa
 *    w oparciu o pełnomocnictwo określonego w Polisie Ubezpieczyciela",
 *  - karty produktu obu: „Przedsiębiorstwo: Lloyd’s Insurance Company S.A.".
 *
 * Ubezpieczyciel jest więc jeden, a Leadenhall i CEU to jego przedstawiciele.
 * Test pilnuje stron z pakietu poprawek z 21.10.2026 — na treściach sprzed
 * poprawki wywala się na klauzuli, polityce, /wniosek/, /pracuj-z-nami/,
 * /wylaczenia/ i /o-nas/.
 *
 * Opinie: obie opublikowane opinie zdjęte 21.10.2026 (właściciel: nie
 * pochodziły od klientów), a z nimi zdania „publikujemy po weryfikacji"
 * i „każda przechodzi weryfikację" — jedyną weryfikacją był Turnstile.
 */

const STRONY = [
  '/o-nas/',
  '/klauzula-informacyjna/',
  '/polityka-prywatnosci/',
  '/podziekowanie/',
  '/pracuj-z-nami/',
  '/regulamin/',
  '/wylaczenia/',
  '/wniosek/',
  '/dokumenty/',
  '/opinie/',
];

/** Treść strony, którą czyta człowiek i robot: tytuł, opis i <main>. */
async function tekstStrony(page, adres) {
  await page.goto(adres);
  const tytul = await page.title();
  const opis = await page.locator('meta[name="description"]').getAttribute('content');
  const tresc = await page.locator('main').innerText();
  return [tytul, opis ?? '', tresc].join('\n');
}

/**
 * Dzieli tekst na zdania i ich człony. Skróty z kropką („S.A.", „sp. z o.o.")
 * są zwijane wcześniej — inaczej „Leadenhall Insurance S.A." rozcinałby zdanie
 * w środku nazwy.
 */
function czlony(tekst) {
  return tekst
    .replace(/S\.A\./g, 'SA')
    .replace(/sp\. z o\.\s?o\./gi, 'spzoo')
    .replace(/\bnr\./g, 'nr')
    .split(/[.;!?\n]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

const COVERHOLDER = /\b(?:Leadenhall|CEU)\b/;
const UBEZPIECZYCIEL = /ubezpieczyc/i;
const WYJASNIENIE = /coverholder|przedstawiciel/i;
/** Liczba mnoga — ubezpieczyciel w tej ofercie jest jeden. */
const MNOGA = /\bubezpieczyciel(?:e|i|om|ami|ach)\b/i;

test.describe('Leadenhall i CEU to coverholderzy, nie ubezpieczyciele', () => {
  for (const adres of STRONY) {
    test(`${adres}: nikt nie nazywa coverholdera ubezpieczycielem`, async ({ page }) => {
      const tekst = await tekstStrony(page, adres);

      const zle = czlony(tekst).filter(
        (c) => COVERHOLDER.test(c) && UBEZPIECZYCIEL.test(c) && !WYJASNIENIE.test(c),
      );
      expect(zle, 'zdanie łączy Leadenhall/CEU z „ubezpieczycielem" bez słowa, '
        + 'że to coverholder / przedstawiciel ubezpieczyciela').toEqual([]);

      const mnoga = czlony(tekst).filter((c) => MNOGA.test(c));
      expect(mnoga, 'liczba mnoga „ubezpieczycieli" — ubezpieczycielem jest wyłącznie '
        + `${FIRMA.ubezpieczyciel}`).toEqual([]);

      // Nazwa kończąca się kropką na końcu zdania: „CEU sp. z o.o.." (stało w klauzuli).
      expect(tekst).not.toMatch(/(?:o\.o|S\.A)\.\./);
    });
  }

  test('strony prawne i „o nas" nazywają ubezpieczyciela z karty produktu', async ({ page }) => {
    for (const adres of ['/o-nas/', '/klauzula-informacyjna/', '/polityka-prywatnosci/', '/dokumenty/']) {
      const tekst = await tekstStrony(page, adres);
      expect(tekst, adres).toContain(FIRMA.ubezpieczyciel);
      for (const c of COVERHOLDERZY) expect(tekst, adres).toContain(c);
    }
  });

  test('odbiorcy danych w RODO: ubezpieczyciel ORAZ coverholderzy, bez starego brzmienia', async ({ page }) => {
    for (const adres of ['/klauzula-informacyjna/', '/polityka-prywatnosci/']) {
      const tekst = await tekstStrony(page, adres);
      const odbiorcy = czlony(tekst).filter((c) => c.includes(FIRMA.ubezpieczyciel.replace('S.A.', 'SA')));
      expect(odbiorcy.some((c) => /coverholder/i.test(c) && COVERHOLDER.test(c)),
        `${adres}: w zdaniu z ubezpieczycielem brak coverholderów`).toBe(true);
      expect(tekst).not.toMatch(/w imieniu których działamy/i);
      expect(tekst).not.toMatch(/ubezpieczycielom i reasekuratorom/i);
    }
  });

  test('CEU nie likwiduje szkód — OWU CEU powierzają to WAGAS S.A.', async ({ page }) => {
    const tekst = await tekstStrony(page, '/o-nas/');
    expect(tekst).not.toMatch(/Prowadzi likwidację szkód/);
    expect(tekst).not.toMatch(/największego rynku ubezpieczeniowego/);
    expect(tekst).not.toMatch(/Agencja ubezpieczeniowa i coverholder/);
  });

  test('firma.ts: stara nazwa to alias coverholderów, a opis ról mówi, kto jest kim', () => {
    expect(COVERHOLDERZY).toEqual(['Leadenhall Insurance S.A.', 'CEU sp. z o.o.']);
    expect(COVERHOLDERZY).not.toContain(FIRMA.ubezpieczyciel);
    expect(UBEZPIECZYCIELE).toBe(COVERHOLDERZY);
    expect(FIRMA.ubezpieczycieleWg).toBe(FIRMA.coverholderzyWg);
    expect(OPIS_PODMIOTOW).toContain(`Ubezpieczycielem jest ${FIRMA.ubezpieczyciel}`);
    for (const c of COVERHOLDERZY) expect(OPIS_PODMIOTOW).toContain(c);
    expect(OPIS_PODMIOTOW).toContain('coverholderzy Lloyd’s');
    expect(OPIS_PODMIOTOW).toContain('agentem ubezpieczeniowym');
    expect(OPIS_PODMIOTOW).toContain(FIRMA.rpu);
  });
});

test.describe('/o-nas/: ekspert i status agenta', () => {
  test('ekspert z ekspert.ts, słowo w słowo, i odpowiedzialność za treści', async ({ page }) => {
    await page.goto('/o-nas/');
    const sekcja = page.locator('#ekspert');
    await expect(sekcja).toContainText(EKSPERT.imie);
    await expect(sekcja).toContainText(EKSPERT.opis);
    await expect(sekcja).toContainText('Odpowiada merytorycznie za treści');
  });

  test('agent ubezpieczeniowy z numerem RPU i odnośnikiem do rejestru KNF', async ({ page }) => {
    await page.goto('/o-nas/');
    const main = page.locator('main');
    await expect(main).toContainText('agent ubezpieczeniowy');
    await expect(main).toContainText(FIRMA.rpu);
    await expect(main.locator(`a[href="${FIRMA.rejestrUrl}"]`)).toHaveCount(1);
  });
});

test.describe('/opinie/: bez opinii, których nikt nie potwierdził', () => {
  const OPINIE = JSON.parse(readFileSync(new URL('../src/dane/opinie.json', import.meta.url), 'utf8')).opinie;
  const POTWIERDZONE = OPINIE.filter((o) => o.potwierdzonoKlienta);

  /** Fragmenty dwóch opinii zdjętych 21.10.2026 — nie mogą wrócić, np. z pełnej synchronizacji. */
  const ZDJETE = ['Po raz pierwszy ktoś wyjaśnił zasady', 'musicie wybrać UtrataDochodu.pl'];

  test('karta opinii tylko dla opinii z potwierdzeniem, że autor jest klientem', async ({ page }) => {
    await page.goto('/opinie/');
    await expect(page.locator('main blockquote')).toHaveCount(POTWIERDZONE.length);
    const tekst = await page.locator('main').innerText();
    for (const z of ZDJETE) {
      expect(tekst).not.toContain(z);
      expect(POTWIERDZONE.some((o) => o.tresc.includes(z)), `zdjęta opinia „${z}…" wróciła jako potwierdzona`).toBe(false);
    }
  });

  test('bez obietnic weryfikacji, której nie było', async ({ page }) => {
    const tekst = await tekstStrony(page, '/opinie/');
    expect(tekst).not.toMatch(/po weryfikacji/i);
    expect(tekst).not.toMatch(/przechodzi weryfikację/i);
    expect(tekst).not.toMatch(/Publikujemy wszystkie/i);
    expect(tekst).not.toMatch(/bez selekcji/i);
    expect(tekst).toContain('gdy potwierdzimy, że autor zawarł polisę');
  });

  test('żadna strona pakietu nie ma Review ani AggregateRating w JSON-LD', async ({ page }) => {
    for (const adres of STRONY) {
      await page.goto(adres);
      const bloki = await page.locator('script[type="application/ld+json"]').allTextContents();
      const jsonld = bloki.join('\n');
      expect(jsonld, adres).not.toMatch(/"(?:Review|AggregateRating)"|reviewRating|ratingValue|aggregateRating/);
    }
  });

  test('gwiazdki z poprawną odmianą dla czytnika ekranu', async ({ page }) => {
    await page.goto('/opinie/');
    const etykiety = await page.locator('form fieldset label span.sr-only').allTextContents();
    expect(etykiety.map((e) => e.trim())).toEqual([
      '1 gwiazdka z 5', '2 gwiazdki z 5', '3 gwiazdki z 5', '4 gwiazdki z 5', '5 gwiazdek z 5',
    ]);
  });

  test('formularz opinii dalej wysyła ocenę do review-submit', async ({ page }) => {
    await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      window.turnstile = { render: () => 'w1', getResponse: () => 'token-testowy', reset() {}, remove() {} };
    });
    let cialo = null;
    await page.route('**/functions/v1/review-submit', async (route) => {
      cialo = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
    });

    await page.goto('/opinie/');
    await page.fill('#o-imie', 'Anna');
    await page.fill('#o-miasto', 'Poznań');
    await page.locator('form fieldset label').nth(4).click();
    await page.getByRole('button', { name: 'Wyślij opinię' }).click();

    await expect(page.getByRole('status')).toContainText('gdy potwierdzimy, że jesteś naszym klientem');
    expect(cialo).toMatchObject({ name: 'Anna', city: 'Poznań', rating: 5, 'cf-turnstile-response': 'token-testowy' });
  });
});
