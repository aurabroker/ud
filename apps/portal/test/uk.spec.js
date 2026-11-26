import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ZAWODY, TRESCI } from '@ud/zawody';
import { KROKI } from '@ud/wniosek';
import { PARY } from '../src/lib/jezyki.ts';
import { ZAWODY_UK } from '../src/dane/uk/zawody.ts';
import { GRANICE_WIEKU, KROKI_UK, ZUS_TEKST_UK } from '../src/lib/uk.ts';
import { ZUS_TEKST, ZASILEK_JDG } from '../src/lib/zus.ts';
import { symuluj, zl, zlZakres } from '../src/lib/symulacja.ts';
import { GRUPY } from '../src/lib/wylaczenia.ts';
import { GRUPY_UK } from '../src/dane/uk/wylaczenia.ts';

/**
 * Wersja ukraińska (`/uk/`).
 *
 * Tłumaczenie psuje się inaczej niż kod: nic się nie wysypuje, strona wygląda
 * normalnie, a po kilku miesiącach polska wersja mówi co innego niż ukraińska.
 * Na stronie o tym, co polisa obejmie, a czego nie, to jest błąd merytoryczny,
 * nie kosmetyczny — klient z Ukrainy czyta wersję, której właściciel serwisu
 * sam nie sprawdzi. Dlatego większość testów tutaj nie sprawdza samej wersji
 * ukraińskiej, tylko jej ZGODNOŚĆ z polską: te same kwoty, tyle samo wyłączeń,
 * tyle samo kroków i pytań.
 *
 * Czego te testy NIE sprawdzają: jakości przekładu. Zdanie przetłumaczone
 * błędnie, ale obecne, przechodzi. To sprawdza człowiek znający oba języki.
 */

const DIST = 'dist';
const SERWIS = 'https://utratadochodu.pl';

const html = (sciezka) => readFileSync(join(DIST, sciezka, 'index.html'), 'utf8');

/** Adresy wszystkich zbudowanych stron ukraińskich, z ukośnikiem na końcu. */
function stronyUk(katalog = join(DIST, 'uk'), zebrane = []) {
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const p = join(katalog, wpis.name);
    if (wpis.isDirectory()) stronyUk(p, zebrane);
    else if (wpis.name === 'index.html') {
      zebrane.push('/' + relative(DIST, p).split(sep).slice(0, -1).map((c) => `${c}/`).join(''));
    }
  }
  return zebrane;
}

/** Treść strony bez nawigacji i stopki — one są wspólne i nie o nie tu chodzi. */
const tresc = (dokument) => dokument.match(/<main id="tresc">([\s\S]*?)<\/main>/)?.[1] ?? '';

/** Odnośniki `hreflang` z nagłówka strony: język → adres. */
function wersje(dokument) {
  const glowa = dokument.slice(0, dokument.indexOf('</head>'));
  return Object.fromEntries(
    [...glowa.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(([, j, h]) => [j, h]),
  );
}

/** Kwoty w złotych w kolejności wystąpienia; twarda spacja jak zwykła. */
const kwoty = (tekst) => [...tekst.replace(/ |&nbsp;|&#160;/g, ' ')
  .matchAll(/\d{1,3}(?: \d{3})+(?:–\d{1,3}(?: \d{3})*)? zł|\d{2,3}–\d{2,3} zł/g)].map((m) => m[0]);

test('są zbudowane wszystkie strony ukraińskie i każda trafiła do mapy strony', () => {
  const oczekiwane = ['/uk/', '/uk/jak-to-dziala/', '/uk/wylaczenia/', '/uk/wniosek/',
    ...ZAWODY_UK.map((z) => `/uk/${z.slug}/`)].sort();
  expect(stronyUk().sort()).toEqual(oczekiwane);

  const mapa = readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8');
  for (const s of oczekiwane) expect(mapa, `brak ${s} w mapie strony`).toContain(`<loc>${SERWIS}${s}</loc>`);
});

test('strona ukraińska deklaruje język „uk", a nie kod kraju „ua"', () => {
  for (const s of stronyUk()) {
    const d = html(s);
    expect(d, `${s}: zły atrybut lang`).toMatch(/<html lang="uk"/);
    expect(d, `${s}: „ua" to kod kraju, nie języka`).not.toMatch(/(?:lang|hreflang)="ua"/i);
    expect(d, `${s}: adres kanoniczny ma wskazywać tę stronę`).toContain(`<link rel="canonical" href="${SERWIS}${s}"`);
    expect(d, `${s}: og:locale`).toContain('<meta property="og:locale" content="uk_UA"');
    expect(existsSync(join(DIST, s, 'index.md')), `${s}: brak bliźniaczego pliku .md`).toBe(true);
    // Deklaracja kodowania w pierwszym kilobajcie — przy cyrylicy bez niej nie ma tekstu.
    expect(Buffer.from(d).subarray(0, 1024).toString('utf8'), `${s}: charset poza pierwszym 1 KB`).toMatch(/<meta charset/i);
  }
});

test('strona ukraińska składa tekst jednym krojem, bez krojów pozbawionych cyrylicy', () => {
  /**
   * Newsreader i Public Sans nie mają cyrylicy. Gdyby zostały na stronie
   * ukraińskiej, cyfry i „ZUS" szłyby z nich, a litery ukraińskie z kroju
   * zastępczego — dwa kroje w jednym zdaniu.
   */
  for (const s of stronyUk()) {
    const glowa = html(s).split('</head>')[0];
    expect(glowa, `${s}: brak krojów systemowych`).toContain('--font-naglowek:Georgia');
    expect(glowa, `${s}: krój bez cyrylicy`).not.toMatch(/Newsreader|Public Sans/);
  }
  // Strona polska zostaje przy swoich krojach.
  expect(html('/').split('</head>')[0]).toMatch(/--font-naglowek:\s*"?Newsreader/);
});

test('pary językowe wskazują się nawzajem, a strony bez przekładu nie mają hreflang', () => {
  for (const [pl, uk] of Object.entries(PARY)) {
    const oczekiwane = { pl: SERWIS + pl, uk: SERWIS + uk, 'x-default': SERWIS + pl };
    expect(wersje(html(pl)), `${pl}: hreflang`).toEqual(oczekiwane);
    expect(wersje(html(uk)), `${uk}: hreflang`).toEqual(oczekiwane);
  }

  /**
   * hreflang znaczy „ta sama treść w innym języku". Przewodnik po wniosku nie
   * jest przekładem formularza, więc pary nie tworzy — a sam formularz nie
   * może przez tłumaczenie dostać niczego nowego w <head>.
   */
  for (const s of ['/wniosek/', '/uk/wniosek/', '/kalkulator/', '/lekarz/', '/dokumenty/']) {
    expect(wersje(html(s)), `${s}: hreflang bez przekładu`).toEqual({});
  }
  expect(html('/wniosek/')).toMatch(/<html lang="pl"/);
});

test('przełącznik języka prowadzi do tej samej strony, a bez przekładu — na stronę główną', () => {
  const przelacznik = (dokument) => dokument.slice(dokument.indexOf('<header'), dokument.indexOf('</header>'))
    .match(/<a href="([^"]+)"[^>]*hreflang="(?:uk|pl)"/)?.[1];

  expect(przelacznik(html('/programista/'))).toBe('/uk/programista/');
  expect(przelacznik(html('/uk/programista/'))).toBe('/programista/');
  expect(przelacznik(html('/kalkulator/'))).toBe('/uk/');
  expect(przelacznik(html('/uk/wniosek/'))).toBe('/');

  // Na telefonie przełącznik w pasku strony polskiej jest schowany — wersję
  // ukraińską musi wskazywać stopka, na każdej stronie.
  for (const s of ['/', '/kalkulator/', '/lekarz/']) {
    const stopka = html(s).slice(html(s).indexOf('<footer'));
    expect(stopka, `${s}: stopka bez odnośnika do wersji ukraińskiej`).toMatch(/<a href="\/uk\/[^"]*"[^>]*hreflang="uk"[^>]*>Українською</);
  }
});

test('na stronach ukraińskich nie zostały polskie napisy układu i kalkulatora', () => {
  const POLSKIE = ['Przejdź do treści', 'Policz składkę', 'Symulacja składki', 'Przejdź do wniosku',
    'Zawody według branży', 'Najczęstsze pytania', 'Strona główna', 'Świadczenie z polisy',
    'Zasiłek chorobowy z ZUS', 'Szacowana składka', 'Wolisz odkładać', 'aria-label="Główna"',
    'agent ubezpieczeniowy', 'Czego polisa nie obejmuje', 'To jest symulacja', 'Źródło:'];
  for (const s of stronyUk()) {
    const d = html(s);
    for (const napis of POLSKIE) expect(d, `${s}: został polski napis „${napis}"`).not.toContain(napis);
  }
});

test('odnośnik z ukraińskiej strony do polskiej jest oznaczony jako polski', () => {
  /**
   * Dokumenty, strony prawne i formularz istnieją tylko po polsku. Odnośnik do
   * nich bez oznaczenia to dla czytnika ekranu polska nazwa czytana po
   * ukraińsku, a dla klienta — niespodzianka po kliknięciu.
   */
  const przetlumaczone = new Set(stronyUk());
  for (const s of stronyUk()) {
    for (const [znacznik, href] of html(s).matchAll(/<a\s[^>]*href="(\/[^"#?]*)"[^>]*>/g)) {
      if (href.startsWith('/uk/') || href.startsWith('/_astro/')) continue;
      if (przetlumaczone.has(href)) continue;
      expect(znacznik, `${s}: odnośnik do ${href} bez hreflang="pl"`).toMatch(/hreflang="pl"/);
    }
  }
});

test('strona ukraińska pokazuje te same kwoty co polska', () => {
  /**
   * Kwoty nie są przepisane — idą z symulacja.ts i ze schematu wniosku. Ten
   * test łapie chwilę, w której ktoś jednak wpisze liczbę na sztywno albo
   * policzy przykład inaczej niż strona polska.
   */
  for (const [pl, uk] of Object.entries(PARY)) {
    const poPolsku = new Set(kwoty(tresc(html(pl))));
    const poUkrainsku = kwoty(tresc(html(uk)));
    expect(poUkrainsku.length, `${uk}: brak kwot — czy strona się zbudowała?`).toBeGreaterThan(0);
    const obce = [...new Set(poUkrainsku)].filter((k) => !poPolsku.has(k));
    expect(obce, `${uk}: kwoty, których nie ma na ${pl}`).toEqual([]);
  }

  // Strona zawodu: komplet w obie strony — to ten sam szablon z tym samym dochodem.
  for (const z of ZAWODY_UK) {
    const poPolsku = [...new Set(kwoty(tresc(html(`/${z.slug}/`))))].sort();
    const poUkrainsku = [...new Set(kwoty(tresc(html(`/uk/${z.slug}/`))))].sort();
    expect(poUkrainsku, `/uk/${z.slug}/: inne kwoty niż po polsku`).toEqual(poPolsku);
  }
});

test('limity 80% i 65% oraz okresy wypłaty stoją na stronie głównej tak jak po polsku', () => {
  const uk = tresc(html('/uk/'));
  expect(uk).toContain('до 80% доходу на B2B');
  expect(uk).toContain('до 65% на трудовому');
  // Okres wypłaty to czas NAJDŁUŻSZY (CLAUDE.md, „Kalkulator — okres wypłaty świadczenia").
  expect(uk).toMatch(/Виплата триває щонайдовше 24, 36, 48 або 60 місяців/);
  // Zastrzeżenie przy kwocie: symulacja, nie oferta.
  expect(uk).toMatch(/Це симуляція, а не пропозиція/);
  expect(uk).toMatch(/діапазон з останніх виставлених пропозицій/);
  // Wyjątek od limitu B2B stoi wszędzie tam, gdzie limit jest podany jako reguła.
  expect(uk).toContain('CEU «Utrata dochodu» ліміт становить 65%');
});

test('wersja ukraińska nie obiecuje więcej niż polska: bez „od pierwszego dnia" i bez sumy ZUS + polisa', () => {
  /**
   * Trzy zdania zdjęte z polskiego serwisu 21.10.2026 (CLAUDE.md), które stały
   * w pierwszej wersji przekładu, bo powstała z nieaktualnej gałęzi:
   * świadczenie „od pierwszego dnia", okres wypłaty jako minimum i suma
   * zasiłku brutto ze świadczeniem. Skan po plikach .md — tak jak zus.spec.js.
   */
  for (const s of stronyUk()) {
    const md = readFileSync(join(DIST, s, 'index.md'), 'utf8');
    expect(md, `${s}: „od pierwszego dnia"`).not.toMatch(/першого дня/);
    expect(md, `${s}: okres wypłaty jako minimum`).not.toMatch(/щонайменше протягом \d+ місяц/);
    expect(md, `${s}: suma zasiłku i świadczenia`).not.toMatch(/ZUS \+ поліс|Разом на лікарняному/);
    expect(md, `${s}: „karencja" po ukraińsku`).not.toMatch(/каренці/i);
  }
});

test('Leadenhall i CEU nie są po ukraińsku ubezpieczycielami', () => {
  /**
   * Ubezpieczycielem jest Lloyd’s Insurance Company S.A.; Leadenhall i CEU to
   * coverholderzy (CLAUDE.md, „Kto jest kim"). „Страховики" w liczbie mnogiej
   * to w tym serwisie zawsze błąd — ubezpieczyciel jest jeden.
   */
  for (const s of stronyUk()) {
    const md = readFileSync(join(DIST, s, 'index.md'), 'utf8');
    expect(md, `${s}: Leadenhall i CEU nazwani ubezpieczycielami`)
      .not.toMatch(/страховики|двох страховиків|обох страховиків|обидва страховики/i);
  }
  const glowna = readFileSync(join(DIST, 'uk', 'index.md'), 'utf8');
  expect(glowna).toContain('Страховиком є Lloyd’s Insurance Company S.A.');
  expect(glowna).toMatch(/ковергольдерів Lloyd’s/);
  // Nazwa kończąca się na „S.A." albo „sp. z o.o." nie dostaje drugiej kropki.
  for (const s of stronyUk()) {
    expect(readFileSync(join(DIST, s, 'index.md'), 'utf8'), `${s}: podwójna kropka`).not.toMatch(/(S\.A|o\.o)\.\./);
  }
});

test('ubezpieczony musi mieć PESEL — strona ukraińska mówi to wprost', () => {
  // Potwierdzenie właściciela z 26.11.2026; kreator ma to pole jako wymagane.
  expect(readFileSync(join(DIST, 'uk', 'index.md'), 'utf8')).toMatch(/повинна мати номер PESEL/);
  expect(readFileSync(join(DIST, 'uk', 'wniosek', 'index.md'), 'utf8')).toMatch(/Номер PESEL/);
});

test('zdania o ZUS-ie i napisy kalkulatora mają po ukraińsku te same pola co po polsku', () => {
  expect(Object.keys(ZUS_TEKST_UK).sort()).toEqual(Object.keys(ZUS_TEKST).sort());
  // Kwoty w przekładzie idą z tych samych stałych, więc muszą w nim stać.
  expect(ZUS_TEKST_UK.dopiski).toContain(zl(ZASILEK_JDG.preferencyjny));

  /**
   * Kalkulator: jeden komponent, dwa zestawy napisów. Klucz dopisany tylko po
   * polsku dałby po ukraińsku `undefined` w treści albo wyjątek w funkcji.
   */
  const zrodlo = readFileSync('src/components/Kalkulator.svelte', 'utf8');
  const blok = (jezyk, koniec) => zrodlo.slice(zrodlo.indexOf(`    ${jezyk}: {`), zrodlo.indexOf(koniec));
  const klucze = (tekst) => [...tekst.matchAll(/^ {6}(\w+):/gm)].map(([, k]) => k).sort();
  const pl = klucze(blok('pl', '    uk: {'));
  const uk = klucze(blok('uk', '  const t = $derived'));
  expect(pl.length, 'nie znaleziono napisów kalkulatora — zmienił się układ pliku?').toBeGreaterThan(10);
  expect(uk).toEqual(pl);
});

test('wyłączenia po ukraińsku: tyle samo grup, pozycji i pytań co po polsku', () => {
  const policz = (dokument) => ({
    grupy: (dokument.match(/<h2 id="g-/g) ?? []).length,
    pozycje: (dokument.match(/<li class="border-l-\[3px\] border-alarm/g) ?? []).length,
    pytania: (dokument.match(/<details/g) ?? []).length,
  });
  const pl = policz(tresc(html('/wylaczenia/')));
  expect(pl.pozycje, 'polska lista wyłączeń jest pusta — zmienił się szablon?').toBeGreaterThan(5);
  expect(policz(tresc(html('/uk/wylaczenia/')))).toEqual(pl);
});

test('wyłączenia po ukraińsku: przekład pozycja w pozycję, z paragrafami z polskiego źródła', () => {
  /**
   * Lista polska ma przy każdej pozycji paragrafy OWU. Przekład ich nie
   * przepisuje — bierze je z polskiego pliku po numerze grupy i pozycji —
   * więc liczba pozycji w każdej grupie musi się zgadzać, inaczej przekład
   * stanąłby przy cudzym paragrafie.
   */
  expect(GRUPY_UK.map((g) => g.pozycje.length)).toEqual(GRUPY.map((g) => g.pozycje.length));
  for (const g of GRUPY_UK) {
    for (const p of g.pozycje) {
      expect(p.co.trim().length, 'pusta nazwa pozycji').toBeGreaterThan(5);
      expect(p.czemu, `„${p.co}": opis nie po ukraińsku`).toMatch(/[а-яіїєґ]{4,}/i);
    }
  }

  const uk = tresc(html('/uk/wylaczenia/'));
  const wszystkie = GRUPY.flatMap((g) => g.pozycje);
  expect((uk.match(/Джерело:/g) ?? []).length).toBe(wszystkie.length);
  // Paragrafy stoją w zapisie polskim, słowo w słowo jak na stronie polskiej.
  const bezEncji = uk.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
  for (const p of wszystkie) {
    expect(bezEncji, `brak źródła „${p.zrodla.slice(0, 40)}…"`).toContain(p.zrodla);
  }
  // Wojna: polska pozycja mówi o wojnie i działaniach wojennych, nie o samym „udziale".
  expect(uk).toMatch(/Виключено війну та воєнні дії/);
  expect(tresc(html('/uk/'))).toMatch(/охоплюють захистом увесь світ, але виключають війну/);
});

test('wyłączenia po ukraińsku trzymają się OWU: zakażenie HIV/WZW nie jest wyłączeniem', () => {
  const md = readFileSync(join(DIST, 'uk', 'wylaczenia', 'index.md'), 'utf8');
  const [lista, pytania = ''] = md.split(/^#+ Найчастіші запитання/m);
  expect(pytania, 'nie znaleziono sekcji pytań').not.toBe('');

  // „ВІЛ" wielkimi literami i bez /i: „віл" siedzi w „добровільне" i „цивільного".
  expect(lista, 'HIV/WZW na ukraińskiej liście wyłączeń').not.toMatch(/HIV|WZW|гепатит/i);
  expect(lista, 'HIV/WZW na ukraińskiej liście wyłączeń').not.toMatch(/ВІЛ/);
  expect(pytania).toMatch(/Саме зараження не виключено/);
  expect(pytania).toMatch(/LW048/);
  expect(pytania).toMatch(/LW049/);
  // Psychiatria: Leadenhall wyłącza tylko jako JEDYNĄ przyczynę, CEU bez tego zastrzeżenia.
  expect(lista).toMatch(/єдина причина непрацездатності/i);
  expect(lista).toMatch(/У CEU такого застереження немає/);
  // Tych pozycji nie ma w żadnym OWU i nie mogą wrócić w przekładzie.
  expect(lista).not.toMatch(/вроджен|естетичн/i);
});

test('„jak to działa" po ukraińsku: tyle samo etapów i pytań, wszystkie kroki wniosku', () => {
  const policz = (dokument) => ({
    etapy: (dokument.match(/<h3 /g) ?? []).length,
    pytania: (dokument.match(/<details/g) ?? []).length,
  });
  const uk = tresc(html('/uk/jak-to-dziala/'));
  expect(policz(uk)).toEqual(policz(tresc(html('/jak-to-dziala/'))));

  for (const k of KROKI) {
    expect(KROKI_UK[k.id], `krok „${k.id}" bez ukraińskiej nazwy w lib/uk.ts`).toBeTruthy();
    expect(uk.toLowerCase(), `brak kroku „${k.id}" w opisie`).toContain(KROKI_UK[k.id].tytul.toLowerCase());
  }
});

test('zawody po ukraińsku: przekład ma tyle samo ryzyk i pytań co polska treść', () => {
  const slugi = new Set(ZAWODY.map((z) => z.slug));
  for (const z of ZAWODY_UK) {
    expect(slugi.has(z.slug), `${z.slug}: nie ma takiego zawodu po polsku`).toBe(true);
    const pl = TRESCI[z.slug];
    expect(pl, `${z.slug}: polski zawód nie ma treści redakcyjnej, więc nie ma czego tłumaczyć`).toBeTruthy();
    expect(z.ryzyka.length, `${z.slug}: liczba ryzyk`).toBe(pl.ryzyka.length);
    expect(z.pytania.length, `${z.slug}: liczba pytań`).toBe(pl.pytania.length);

    const d = html(`/uk/${z.slug}/`);
    expect(d, `${z.slug}: nagłówek`).toContain(`Страхування від втрати доходу для ${z.dopelniacz}`);
    // Zdjęcie to samo co po polsku, z opisem po ukraińsku.
    expect(d.match(/<img[^>]*\balt="([^"]*)"/)?.[1]).toBe(`Ілюстративне фото — ${z.nazwa.toLowerCase()}`);
  }
});

test('przewodnik po wniosku cytuje etykiety, które naprawdę są w kreatorze', () => {
  /**
   * Formularz zostaje po polsku, a przewodnik objaśnia jego pola. Etykieta,
   * której w kreatorze już nie ma, wysyła klienta na poszukiwanie nieistniejącego
   * pola — w formularzu w obcym języku.
   */
  const kreator = readFileSync('src/components/Wniosek.svelte', 'utf8')
    + readFileSync('../../packages/wniosek/src/schemat.js', 'utf8');
  const d = tresc(html('/uk/wniosek/'));

  const etykiety = [...d.matchAll(/<dt[^>]*lang="pl"[^>]*>([^<]+)<\/dt>/g)].map(([, e]) => e.trim());
  expect(etykiety.length, 'przewodnik bez polskich etykiet').toBeGreaterThan(10);
  const nieaktualne = etykiety.filter((e) => !kreator.includes(e));
  expect(nieaktualne, `etykiety spoza kreatora: ${nieaktualne.join(' | ')}`).toEqual([]);

  // Tyle kroków, ile ma kreator, i w tej samej kolejności.
  const kroki = [...d.matchAll(/Крок (\d+) із (\d+) · <span lang="pl">([^<]+)<\/span>/g)].map(([, , , t]) => t);
  expect(kroki).toEqual(KROKI.map((k) => k.tytul));

  // Mówi wprost, że formularz jest po polsku, i do niego prowadzi.
  expect(d).toMatch(/Чому форма польською/);
  expect(d).toMatch(/<a href="\/wniosek\/" hreflang="pl"/);
});

test('wiek na stronach ukraińskich zgadza się ze schematem wniosku', () => {
  const schemat = readFileSync('../../packages/wniosek/src/schemat.js', 'utf8');
  expect(schemat, 'granice wieku w schemacie wniosku są inne niż w lib/uk.ts')
    .toContain(`wiek < ${GRANICE_WIEKU.od} || wiek > ${GRANICE_WIEKU.do}`);
  expect(tresc(html('/uk/'))).toContain(`від ${GRANICE_WIEKU.od} до ${GRANICE_WIEKU.do} років`);
});

test('strona ukraińska mówi, w jakim języku jest obsługa, zanim klient zacznie wniosek', () => {
  for (const s of stronyUk()) {
    expect(tresc(html(s)), `${s}: brak informacji, że dokumenty i obsługa są po polsku`).toMatch(/польською/);
  }
});

/* ── W przeglądarce ───────────────────────────────────────────────────────── */

const wynik = (page, etykieta) =>
  page.locator('dt', { hasText: etykieta }).locator('xpath=following-sibling::dd[1]');

test('kalkulator po ukraińsku liczy to samo co polski', async ({ page }) => {
  await page.goto('/uk/');
  await expect(page.getByRole('heading', { name: /Симуляція внеску/ })).toBeVisible();

  // Kwoty liczone z tych samych plików co strona (jak w kalkulator.spec.js) — wpisane
  // na sztywno robiłyby się czerwone przy każdej zmianie stawek w kalibracja.json.
  const w = symuluj({ dochod: 18000 });
  await expect(wynik(page, 'Виплата за полісом')).toHaveText(zl(w.swiadczenie));
  await expect(wynik(page, 'Орієнтовний місячний внесок')).toHaveText(zlZakres(w.skladkaOd, w.skladkaDo));
  await expect(wynik(page, 'Допомога по хворобі від ZUS')).toHaveText(zl(ZASILEK_JDG.duzy));

  // Kalkulator liczy tylko B2B (decyzja z 21.10.2026): etat ma zdanie opisu, bez przełącznika.
  await expect(page.locator('[data-etat]')).toHaveText(ZUS_TEKST_UK.etat);
  await expect(page.locator('input[type="radio"]')).toHaveCount(0);

  // Odkładanie liczy tylko polska strona — odnośnik mówi to wprost i niesie hreflang.
  const odkladanie = page.locator('a[data-odkladanie]');
  await expect(odkladanie).toHaveAttribute('hreflang', 'pl');
  await expect(odkladanie).toContainText('польською');

  // Przycisk prowadzi do przewodnika, nie wprost do polskiego formularza.
  await expect(page.getByRole('link', { name: 'Як подати заявку' }).last()).toHaveAttribute('href', '/uk/wniosek/');
});

test('kalkulator na stronie zawodu po ukraińsku ma ten sam dochód co po polsku', async ({ page }) => {
  await page.goto('/programista/');
  const polski = page.getByRole('heading', { name: /Symulacja składki dla programisty/ });
  await polski.scrollIntoViewIfNeeded();
  const kwotaPl = await wynik(page, 'Świadczenie z polisy').textContent();

  await page.goto('/uk/programista/');
  const ukrainski = page.getByRole('heading', { name: /Симуляція внеску для програміста/ });
  await ukrainski.scrollIntoViewIfNeeded();
  await expect(ukrainski).toBeVisible();
  await expect(wynik(page, 'Виплата за полісом')).toHaveText(kwotaPl.trim());
});

/** Żądania do zewnętrznej analityki — jak w zgody.spec.js. */
function nasluchuj(strona) {
  const trafienia = [];
  strona.on('request', (r) => {
    const u = r.url();
    if (/googletagmanager\.com|google-analytics\.com|analytics\.google\.com|facebook\.(net|com)|doubleclick\.net|googleadservices\.com/.test(u)) {
      trafienia.push(u);
    }
  });
  return trafienia;
}

test('baner cookies na stronie ukraińskiej jest po ukraińsku i działa tak samo', async ({ page }) => {
  /**
   * Zgoda udzielona w banerze, którego odwiedzający nie rozumie, nie jest
   * świadoma. Język banera idzie za językiem strony; logika — nie.
   */
  const ruch = nasluchuj(page);
  await page.goto('/uk/');
  const baner = page.locator('#ud-zgody');
  await expect(baner).toBeVisible();
  await expect(baner).toContainText('Файли cookie');
  await expect(baner).not.toContainText('Pliki cookies');

  const nie = page.getByRole('button', { name: 'Відхиляю всі' });
  const tak = page.getByRole('button', { name: 'Приймаю всі' });
  await expect(page.getByRole('button', { name: 'Налаштування' })).toBeVisible();

  // Odrzucenie tak samo widoczne jak akceptacja — także po ukraińsku.
  const pudloNie = await nie.boundingBox();
  const pudloTak = await tak.boundingBox();
  expect(Math.abs(pudloNie.height - pudloTak.height)).toBeLessThan(2);

  await page.waitForTimeout(600);
  expect(ruch, `wyciek przed zgodą:\n${ruch.join('\n')}`).toHaveLength(0);

  await nie.click();
  await expect(baner).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(ruch, `wyciek po odmowie:\n${ruch.join('\n')}`).toHaveLength(0);
  expect(await page.evaluate(() => window.UDCookies.stan())).toMatchObject({ analityka: false, marketing: false });

  // Decyzja jest wspólna dla obu wersji językowych: strona polska nie pyta drugi raz.
  await page.goto('/');
  await expect(page.locator('#ud-zgody')).toHaveCount(0);
});

test('po akceptacji na stronie ukraińskiej tagi startują', async ({ page }) => {
  const ruch = nasluchuj(page);
  await page.goto('/uk/');
  await page.getByRole('button', { name: 'Приймаю всі' }).click();
  await page.waitForTimeout(1200);
  expect(ruch.some((u) => u.includes('googletagmanager.com')), 'brak Google').toBe(true);
});

test('strona ukraińska mieści się w ekranie telefonu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const s of ['/uk/', '/uk/wniosek/', '/uk/wylaczenia/', '/uk/programista/', '/uk/jak-to-dziala/']) {
    await page.goto(s);
    const nadmiar = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(nadmiar, `${s}: strona przewija się w poziomie o ${nadmiar} px`).toBeLessThanOrEqual(0);
    // Pasek nawigacji: logo, przełącznik i przycisk w jednym wierszu, bez wyjścia poza ekran.
    const pasek = await page.locator('header nav').boundingBox();
    const przycisk = await page.locator('header nav a').last().boundingBox();
    expect(przycisk.x + przycisk.width, `${s}: przycisk wychodzi poza pasek`).toBeLessThanOrEqual(pasek.x + pasek.width + 0.5);
  }
});
