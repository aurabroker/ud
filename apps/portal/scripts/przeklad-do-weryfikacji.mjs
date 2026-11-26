#!/usr/bin/env node
/**
 * przeklad-do-weryfikacji.mjs — zestawia polski oryginał z ukraińskim
 * przekładem w plikach .md, które można dać innemu modelowi językowemu
 * (albo człowiekowi) do sprawdzenia.
 *
 *   pnpm build && node scripts/przeklad-do-weryfikacji.mjs [katalog]
 *
 * Skąd bierze treść: z GOTOWEGO builda (`dist/`), nie ze źródeł. W plikach
 * `index.md` stoi dokładnie to, co zobaczy czytelnik — z kwotami, limitami
 * i zdaniami złożonymi z `zus.ts`, `symulacja.ts` i `uk.ts`. Zestawienie ze
 * źródeł pokazałoby szablony z `${…}`, a nie zdania.
 *
 * Co robi:
 *  - pary stron znajduje po `hreflang` w zbudowanym HTML-u (nowy zawód po
 *    ukraińsku trafia tu sam);
 *  - tnie obie strony na sekcje po nagłówkach i zestawia je po kolei; gdy
 *    układ nagłówków się nie zgadza, NIE zgaduje — pokazuje całe strony
 *    jedna pod drugą i wypisuje ostrzeżenie;
 *  - wewnątrz sekcji zestawia akapit z akapitem tylko wtedy, gdy jest ich
 *    tyle samo; inaczej pokazuje sekcję w całości i mówi, że liczba się różni
 *    (to bywa celowy dopisek, ale bywa też pominięcie);
 *  - dokłada napisy, których w `.md` nie ma: tytuły i opisy stron, pasek,
 *    stopkę, baner cookies.
 *
 * Wyniku nie commitujemy (katalog jest w .gitignore) — starzeje się przy
 * każdej zmianie treści. Po poprawkach przekładu: build i jeszcze raz.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const PORTAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(PORTAL, 'dist');
const WYJSCIE = process.argv[2] ?? join(PORTAL, 'przeklad-do-weryfikacji');
const SERWIS = 'https://utratadochodu.pl';
const INSTRUKCJA = '00-instrukcja-dla-modelu.md';
const KOMPLET = 'przeklad-uk-komplet.md';

if (!existsSync(join(DIST, 'uk', 'index.md'))) {
  console.error('Brak dist/uk/index.md — najpierw `pnpm build`.');
  process.exit(1);
}

const ostrzezenia = [];
const ostrzez = (tekst) => { ostrzezenia.push(tekst); };

/* ───────────────────────────── ustawienia treści ───────────────────────────── */

/** Kolejność plików; strony spoza listy idą na koniec, alfabetycznie. */
const KOLEJNOSC = ['/uk/', '/uk/jak-to-dziala/', '/uk/wylaczenia/', '/uk/programista/', '/uk/fryzjer/',
  '/uk/kosmetyczka/', '/uk/wniosek/'];

/**
 * Sekcje, które istnieją tylko po ukraińsku (klucz: nagłówek ukraiński).
 * `podstawa` to zamierzona treść po polsku — nie ma jej na polskiej stronie,
 * więc sprawdzający dostaje ją tutaj. Liczby wstawia skrypt z ukraińskiego
 * tekstu (`{wiekOd}`…), żeby podstawa nie rozjechała się z danymi.
 */
const TYLKO_UK = {
  'Якщо ви з України і працюєте в Польщі': {
    opis: 'Sekcja istnieje tylko w wersji ukraińskiej. Poniżej zamierzona treść po polsku — '
      + 'sprawdź, czy ukraiński mówi to samo, i sprawdź sam język.',
    liczby: { wiekOd: /від (\d+) до \d+ років/, wiekDo: /від \d+ до (\d+) років/, dni: /після (\d+) днів/ },
    tytuly: ['Громадянство', 'PESEL і вік', 'Мова документів', 'ZUS і JDG', 'Поїздки в Україну', 'Документи для виплати'],
    podstawa: [
      '## Jeśli jesteś z Ukrainy i pracujesz w Polsce',
      'Sześć rzeczy, które warto wiedzieć przed złożeniem wniosku. Ubezpieczycielem jest Lloyd’s Insurance '
        + 'Company S.A., a umowę zawiera się za pośrednictwem Leadenhall Insurance S.A. i CEU sp. z o.o. — '
        + 'coverholderów Lloyd’s.',
      '**Obywatelstwo**\n\nW ogólnych warunkach ubezpieczenia (OWU) Leadenhall i CEU nie ma wymogu polskiego '
        + 'obywatelstwa: ubezpieczony to osoba wskazana w polisie. Decyzję o przyjęciu do ubezpieczenia '
        + 'podejmuje ubezpieczyciel po ocenie ryzyka.',
      '**PESEL i wiek**\n\nUbezpieczony musi mieć numer PESEL — bez niego wniosku nie da się złożyć; formularz '
        + 'sprawdza jego cyfrę kontrolną. Ochrona obejmuje osoby w wieku od {wiekOd} do {wiekDo} lat.',
      '**Język dokumentów**\n\nWniosek, zgody, umowa, ogólne warunki ubezpieczenia (OWU) i obsługa wypłaty — '
        + 'po polsku. Ta strona tylko objaśnia je po ukraińsku; wiążące są dokumenty polskie.',
      '**ZUS i JDG**\n\nUbezpieczenie chorobowe w ZUS dla JDG jest dobrowolne. Prawo do zasiłku powstaje po '
        + '{dni} dniach nieprzerwanego dobrowolnego ubezpieczenia, a jego wysokość zależy od podstawy składek, '
        + 'a nie od dochodu.',
      '**Wyjazdy do Ukrainy**\n\nWarunki Leadenhall i CEU obejmują ochroną cały świat, ale wyłączają wojnę '
        + 'i działania wojenne, bunt i rozruchy o skali powstania, a także służbę w formacjach zbrojnych. '
        + 'Przed wyjazdem zadzwoń i zapytaj, jak to się ma do Twojej polisy.',
      '**Dokumenty do wypłaty**\n\nPrzy zgłoszeniu roszczenia dokumentacja medyczna ma być po polsku '
        + '(Leadenhall przyjmuje też angielską), więc dokumenty po ukraińsku trzeba przetłumaczyć; '
        + 'ubezpieczyciel może wezwać na badanie u swojego lekarza. W CEU niezdolność do pracy potwierdza '
        + 'zwolnienie ZUS ZLA, a gdy nie ma do niego prawa — zaświadczenie o stanie zdrowia od lekarza '
        + 'prowadzącego.',
      'Zasady zasiłku chorobowego dla cudzoziemców po ukraińsku opisuje oficjalna strona gov.pl — '
        + '„Podstawowe świadczenia na wypadek choroby”. Ogólne warunki ubezpieczenia — [OWU i karty produktu] '
        + '(po polsku).',
    ],
  },
};

/** Sekcje, które w obu językach są celowo różne (klucz: nagłówek ukraiński). */
const ROZNE_CELOWO = {
  'Інші професії українською': 'Po polsku stoi tu lista zawodów pokrewnych, po ukraińsku — pozostałe zawody, '
    + 'które mają stronę ukraińską. Sprawdź sam język.',
  'Для кого цей поліс': 'Po polsku stoi tu lista branż, po ukraińsku — zawody, które mają stronę ukraińską, '
    + 'i odnośnik do polskiej listy. Sprawdź pierwsze zdanie z polskim i sam język reszty.',
};

/**
 * Akapity dopisane tylko po ukraińsku w sekcji, która poza tym jest przekładem.
 * Wyjmujemy je przed zestawieniem akapit z akapitem — inaczej jeden dopisek
 * rozsuwałby całą sekcję — i pokazujemy osobno, z oznaczeniem.
 */
const DOPISKI_UK = [
  /^Заявка, договір і загальні умови страхування — польською мовою\./,
];

/**
 * Słownik przekładu. `rdzen` to wyrażenie regularne, którym skrypt sprawdza,
 * czy termin naprawdę występuje na stronach ukraińskich — słownik, który
 * opisuje co innego niż tekst, jest gorszy niż jego brak.
 */
const SLOWNIK = [
  ['ubezpieczenie utraty dochodu', 'страхування від втрати доходу', /страхування від втрати доходу/],
  ['polisa', 'поліс', /поліс/],
  ['świadczenie (z polisy), wypłata', 'виплата (за полісом)', /виплат[аиу] за полісом/],
  ['składka (ubezpieczeniowa)', 'внесок', /внесок|внеску/, 'to samo słowo co przy składkach ZUS — jak po polsku'],
  ['składki ZUS', 'внески ZUS', /внесків/],
  ['podstawa wymiaru składek', 'база нарахування внесків', /баз[аиу] нарахування внесків/],
  ['zasiłek chorobowy', 'допомога по хворобі', /допомог[аиу] по хворобі/],
  ['ubezpieczenie chorobowe (w ZUS)', 'страхування на випадок хвороби', /страхування(м)? на випадок хвороби/],
  ['zwolnienie lekarskie, L4', 'лікарняний', /лікарнян/],
  ['preferencyjny ZUS', 'пільговий ZUS', /пільгов\S+ ZUS/],
  ['duży ZUS', 'duży ZUS (zostaje po polsku)', /duży ZUS/],
  ['okres wyczekiwania', 'період очікування', /період\S* очікування/, 'nigdy „каренція”'],
  ['okres wypłaty (okres odszkodowawczy)', 'період виплати', /період\S* виплати/],
  ['najdłużej przez … miesięcy', 'щонайдовше (протягом) … місяців', /щонайдовше/, 'okres jest maksymalny, nie gwarantowany'],
  ['niezdolność do pracy', 'непрацездатність', /непрацездатн/],
  ['okresowa / trwała niezdolność do pracy', 'тимчасова / постійна непрацездатність', /постійн\S+ непрацездатн/],
  ['częściowa niezdolność do pracy', 'часткова непрацездатність', /[Чч]астков\S+ непрацездатн/],
  ['nieszczęśliwy wypadek', 'нещасний випадок', /нещасн\S+ випад/],
  ['wyłączenia (odpowiedzialności)', 'виключення', /[Вв]иключен/],
  ['wniosek', 'заявка', /заявк/],
  ['oferta', 'пропозиція', /пропозиці/],
  ['ubezpieczyciel', 'страховик', /страховик/, 'tylko Lloyd’s Insurance Company S.A.'],
  ['coverholder', 'ковергольдер', /ковергольдер/, 'Leadenhall i CEU; nie „страховик”'],
  ['ubezpieczony', 'застрахований, застрахована особа', /[Зз]астрахован/],
  ['ogólne warunki ubezpieczenia (OWU)', 'загальні умови страхування (OWU)', /загальн\S+ умов\S* страхування/],
  ['klauzula', 'клаузула', /[Кк]лаузул/],
  ['ocena ryzyka', 'оцінка ризику', /оцінк\S+ ризику/],
  ['klasa ryzyka (zawodu)', 'клас ризику', /клас\S* (професійного )?ризику/],
  ['ankieta medyczna', 'медична анкета', /медичн\S+ анкет/],
  ['opłata dystrybucyjna', 'дистрибуційна оплата', /дистрибуційн\S+ оплат/],
  ['składka w ratach', 'внесок частинами', /частинами/],
  ['zgłoszenie roszczenia, szkoda', 'звернення по виплату', /звернення по виплату/],
  ['działalność gospodarcza', 'підприємницька діяльність', /підприємницьк\S+ діяльн/],
  ['samozatrudnienie, samozatrudnieni', 'самозайнятість, самозайняті', /самозайнят/],
  ['umowa o pracę', 'трудовий договір (umowa o pracę)', /трудов\S+ договор/],
  ['ryczałt', 'ричалт (ryczałt)', /ричалт/],
  ['symulacja (składki)', 'симуляція (внеску)', /[Сс]имуляці/],
  ['fryzjer / kosmetyczka / programista', 'перукар / косметолог / програміст', /косметолог/],
];

/* ───────────────────────────── czytanie builda ───────────────────────────── */

const czytaj = (sciezka, plik) => readFileSync(join(DIST, sciezka, plik), 'utf8');
const md = (sciezka) => czytaj(sciezka, 'index.md');
const dokument = (sciezka) => parse(czytaj(sciezka, 'index.html'));

/** Wszystkie strony ukraińskie z builda, jako ścieżki `/uk/…/`. */
function stronyUkrainskie(katalog = join(DIST, 'uk'), sciezka = '/uk/') {
  const strony = existsSync(join(katalog, 'index.md')) ? [sciezka] : [];
  for (const nazwa of readdirSync(katalog)) {
    const pelna = join(katalog, nazwa);
    if (statSync(pelna).isDirectory()) strony.push(...stronyUkrainskie(pelna, `${sciezka}${nazwa}/`));
  }
  return strony;
}

/** Polski odpowiednik strony ukraińskiej — z `hreflang`, czyli z tego samego źródła co wyszukiwarka. */
function odpowiednikPolski(sciezkaUk) {
  const href = dokument(sciezkaUk).querySelector('link[rel="alternate"][hreflang="pl"]')?.getAttribute('href');
  return href ? new URL(href, SERWIS).pathname : null;
}

/** Adresy w odnośnikach to szum dla sprawdzającego — zostaje sam napis w nawiasach. */
const bezAdresow = (tekst) => tekst
  // Obrazek bywa wewnątrz odnośnika (kafelek) — jego opis idzie w nawiasach
  // okrągłych, żeby nie zamknął przedwcześnie nawiasu kwadratowego odnośnika.
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, opis) => (opis ? `(obraz: ${opis}) ` : ''))
  .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '[$1]');

/**
 * Sekcje po nagłówkach. Nagłówek bywa w punkcie listy („- ### Ciąża…")
 * — tak konwersja zapisuje listę wyłączeń — więc dopuszczamy znak listy.
 */
function sekcje(tekst) {
  const wynik = [{ poziom: 0, tytul: '', linie: [] }];
  for (const linia of bezAdresow(tekst).split('\n')) {
    const naglowek = linia.match(/^(?:[-*]\s+|\d+\.\s+)?(#{1,6})\s+(.+?)\s*$/);
    if (naglowek) wynik.push({ poziom: naglowek[1].length, tytul: naglowek[2], linie: [linia] });
    else wynik.at(-1).linie.push(linia);
  }
  return wynik.map((s) => ({ ...s, tekst: s.linie.join('\n').trim() })).filter((s) => s.tekst);
}

/** Akapity sekcji: bloki rozdzielone pustą linią. */
const akapity = (tekst) => tekst.split(/\n\s*\n/).map((a) => a.trim()).filter(Boolean);

const naglowkiKarty = (sciezka) => {
  const d = dokument(sciezka);
  const meta = (wybor) => d.querySelector(wybor)?.getAttribute('content')?.trim() ?? '';
  return {
    tytul: d.querySelector('title')?.text.trim() ?? '',
    opis: meta('meta[name="description"]'),
    ogTytul: meta('meta[property="og:title"]'),
    ogOpis: meta('meta[property="og:description"]'),
  };
};

/* ───────────────────────────── składanie plików ───────────────────────────── */

/**
 * Nagłówek cytowany w segmencie nie może być nagłówkiem tego dokumentu —
 * rozbijałby jego układ (sekcja 3 miałaby w środku dwa „##"). Zostaje jako
 * zwykła linia z dopiskiem, że na stronie to nagłówek.
 */
const bezNaglowkow = (tekst) => tekst.replace(/^((?:[-*]\s+|\d+\.\s+)?)#{1,6}\s+(.+?)\s*$/gm, '$1(nagłówek) $2');

const para = (id, pl, uk) => `**[${id}] PL**\n\n${bezNaglowkow(pl)}\n\n**[${id}] UK**\n\n${bezNaglowkow(uk)}\n`;
const samoUk = (id, uk) => `**[${id}] UK**\n\n${bezNaglowkow(uk)}\n`;

function kartaStrony(sciezkaPl, sciezkaUk) {
  const uk = naglowkiKarty(sciezkaUk);
  const pl = sciezkaPl ? naglowkiKarty(sciezkaPl) : null;
  const pola = [['tytul', 'tytuł karty przeglądarki i wyniku wyszukiwania'], ['opis', 'opis w wynikach wyszukiwania'],
    ['ogTytul', 'tytuł przy udostępnieniu'], ['ogOpis', 'opis przy udostępnieniu']];
  const czesci = ['## 0. Tytuł i opis strony', '',
    'Tych napisów nie widać w treści — stoją w wynikach wyszukiwania i na kartach udostępnień.', ''];
  let nr = 0;
  const widziane = new Set();
  for (const [pole, coTo] of pola) {
    // Tytuł i opis udostępnienia zwykle powtarzają zwykłe — nie pokazujemy ich dwa razy.
    if (!uk[pole] || widziane.has(uk[pole])) continue;
    widziane.add(uk[pole]);
    nr += 1;
    czesci.push(`_${coTo}_`, '', pl?.[pole] ? para(`0.${nr}`, pl[pole], uk[pole]) : samoUk(`0.${nr}`, uk[pole]));
  }
  return czesci.join('\n');
}

/** Podstawa po polsku dla sekcji, która istnieje tylko po ukraińsku. */
function podstawaTylkoUk(ustawienia, sekcjaUk, gdzie) {
  const liczby = {};
  for (const [nazwa, wzor] of Object.entries(ustawienia.liczby ?? {})) {
    const trafienie = sekcjaUk.tekst.match(wzor);
    if (!trafienie) ostrzez(`${gdzie}: w sekcji tylko-UK nie znalazłem liczby „${nazwa}” — podstawa po polsku ma lukę.`);
    liczby[nazwa] = trafienie?.[1] ?? '[?]';
  }
  for (const tytul of ustawienia.tytuly ?? []) {
    if (!sekcjaUk.tekst.includes(`**${tytul}**`)) {
      ostrzez(`${gdzie}: sekcja tylko-UK nie ma już pozycji „${tytul}” — popraw TYLKO_UK w skrypcie.`);
    }
  }
  const ileUk = (sekcjaUk.tekst.match(/^\*\*[^*]+\*\*$/gm) ?? []).length;
  if (ustawienia.tytuly && ileUk !== ustawienia.tytuly.length) {
    ostrzez(`${gdzie}: sekcja tylko-UK ma ${ileUk} pozycji, a podstawa po polsku ${ustawienia.tytuly.length}.`);
  }
  return ustawienia.podstawa.join('\n\n').replace(/\{(\w+)\}/g, (_, n) => liczby[n] ?? '[?]');
}

function zestawStrone({ nr, sciezkaUk, sciezkaPl }) {
  const ukSekcje = sekcje(md(sciezkaUk));
  const tytulUk = ukSekcje.find((s) => s.poziom === 1)?.tytul ?? sciezkaUk;
  const naglowek = [`# ${String(nr).padStart(2, '0')} · ${sciezkaPl ?? sciezkaUk} — ${tytulUk}`, ''];
  const czesci = [];
  const licznik = { sekcje: 0, pary: 0, niezgodne: [] };

  if (!sciezkaPl) {
    naglowek.push(`Strona ukraińska: \`${sciezkaUk}\`. **Nie ma polskiego odpowiednika** — to przewodnik po polskim `
      + 'formularzu wniosku. Polskie napisy pogrubione albo w cudzysłowie to etykiety pól cytowane z formularza '
      + '(zostają po polsku). Sprawdź język ukraiński i to, czy objaśnienie zgadza się z polską etykietą obok.', '');
    czesci.push(kartaStrony(null, sciezkaUk));
    ukSekcje.forEach((s, i) => {
      czesci.push(`## ${i + 1}. ${s.tytul || '(początek strony)'}`, '', samoUk(`${i + 1}`, s.tekst));
      licznik.sekcje += 1;
    });
    return { tytul: tytulUk, tekst: [...naglowek, ...czesci].join('\n'), licznik };
  }

  naglowek.push(`Polski oryginał: \`${sciezkaPl}\` · ukraiński przekład: \`${sciezkaUk}\`.`, '');
  czesci.push(kartaStrony(sciezkaPl, sciezkaUk));

  const plSekcje = sekcje(md(sciezkaPl));
  const ukDoPary = ukSekcje.filter((s) => !TYLKO_UK[s.tytul]);
  const uklad = (lista) => lista.map((s) => s.poziom).join(' ');

  if (uklad(plSekcje) !== uklad(ukDoPary)) {
    ostrzez(`${sciezkaUk}: układ nagłówków inny niż na ${sciezkaPl} (PL: ${uklad(plSekcje)} | UK: ${uklad(ukDoPary)}) `
      + '— strona zestawiona w całości, bez podziału na sekcje.');
    czesci.push('## 1. Cała strona', '',
      '_Układ nagłówków w obu wersjach jest różny, więc treść stoi w całości, bez podziału na sekcje._', '',
      para('1', plSekcje.map((s) => s.tekst).join('\n\n'), ukSekcje.map((s) => s.tekst).join('\n\n')));
    licznik.niezgodne.push('cała strona');
    return { tytul: tytulUk, tekst: [...naglowek, ...czesci].join('\n'), licznik };
  }

  let iPl = 0;
  let numer = 0;
  for (const uk of ukSekcje) {
    numer += 1;
    licznik.sekcje += 1;
    const tylkoUk = TYLKO_UK[uk.tytul];
    if (tylkoUk) {
      const gdzie = `${sciezkaUk} „${uk.tytul}”`;
      czesci.push(`## ${numer}. (tylko po ukraińsku) ${uk.tytul}`, '', `_${tylkoUk.opis}_`, '',
        `**[${numer}] PL — zamierzona treść, nie ma jej na polskiej stronie**`, '',
        bezNaglowkow(podstawaTylkoUk(tylkoUk, uk, gdzie)), '', samoUk(`${numer}`, uk.tekst));
      continue;
    }
    const pl = plSekcje[iPl];
    iPl += 1;
    const tytul = `## ${numer}. ${pl.tytul || '(początek strony)'}${uk.tytul ? ` ↔ ${uk.tytul}` : ''}`;
    if (ROZNE_CELOWO[uk.tytul]) {
      czesci.push(tytul, '', `_${ROZNE_CELOWO[uk.tytul]}_`, '', para(`${numer}`, pl.tekst, uk.tekst));
      continue;
    }
    const aPl = akapity(pl.tekst);
    const wszystkieUk = akapity(uk.tekst);
    const dopiski = wszystkieUk.filter((a) => DOPISKI_UK.some((wzor) => wzor.test(a)));
    const aUk = wszystkieUk.filter((a) => !dopiski.includes(a));
    if (aPl.length === aUk.length) {
      czesci.push(tytul, '', ...aPl.map((a, i) => para(aPl.length > 1 ? `${numer}.${i + 1}` : `${numer}`, a, aUk[i])));
      dopiski.forEach((a, i) => czesci.push(
        `**[${numer}.${aPl.length + i + 1}] UK — celowy dopisek, nie ma go po polsku (sprawdź sam język)**`, '', a, ''));
      licznik.pary += aPl.length + dopiski.length;
    } else {
      licznik.niezgodne.push(`${numer} (${aPl.length} ↔ ${aUk.length})`);
      czesci.push(tytul, '',
        `_W tej sekcji polski ma ${aPl.length} akapitów, a ukraiński ${aUk.length}, więc stoją w całości. `
        + 'Sprawdź, czy różnica to celowy dopisek wersji ukraińskiej (patrz instrukcja), czy pominięcie._', '',
        para(`${numer}`, pl.tekst, uk.tekst));
      licznik.pary += 1;
    }
  }
  return { tytul: tytulUk, tekst: [...naglowek, ...czesci].join('\n'), licznik };
}

/* ───────────────────────── napisy spoza treści stron ───────────────────────── */

const htmlNaTekst = new NodeHtmlMarkdown();

function fragmentStrony(sciezka, wybor) {
  const element = dokument(sciezka).querySelector(wybor);
  if (!element) { ostrzez(`${sciezka}: brak elementu ${wybor}.`); return { tekst: '', nazwy: [] }; }
  const nazwy = [...new Set(element.querySelectorAll('[aria-label]').map((e) => e.getAttribute('aria-label').trim())
    .concat(element.getAttribute('aria-label')?.trim() ?? []).filter(Boolean))];
  for (const zbedny of element.querySelectorAll('script, style, svg')) zbedny.remove();
  // Sąsiednie elementy w wierszu (flex) nie mają między sobą spacji w HTML-u —
  // bez niej „REGON 363673048” sklejał się z odnośnikiem obok.
  const html = element.toString().replace(/></g, '> <');
  const tekst = bezAdresow(htmlNaTekst.translate(html)).replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim();
  return { tekst, nazwy };
}

/**
 * Pasek wypisany pozycja po pozycji: przycisk ma dwa napisy (krótki na
 * telefonie, pełny na komputerze), a przełącznik języka — skrót i nazwę
 * dla czytnika ekranu. Konwersja całego paska sklejała je w jedno słowo.
 */
function pasek(sciezka) {
  const nav = dokument(sciezka).querySelector('header nav');
  const tekst = (e) => e.text.replace(/\s+/g, ' ').trim();
  const menu = nav.querySelectorAll('ul a').map((a) => `- ${tekst(a)}`);
  const przelacznik = nav.querySelector('a[hreflang]');
  const przycisk = nav.querySelectorAll('a').at(-1);
  const warianty = przycisk.querySelectorAll('span').map(tekst).filter(Boolean);
  return [
    `Nazwa nawigacji dla czytnika ekranu: ${nav.getAttribute('aria-label')}`,
    'Menu:', ...menu,
    `Przełącznik języka (obok flagi): ${tekst(przelacznik)} — nazwa dla czytnika ekranu i podpowiedź: ${przelacznik.getAttribute('aria-label')}`,
    `Przycisk: ${warianty.length > 1 ? `${warianty[0]} (telefon) / ${warianty[1]} (komputer)` : tekst(przycisk)}`,
  ].join('\n');
}

/** Napisy banera cookies — słownik `NAPISY` z public/zgody.js, klucz w klucz. */
function banerCookies() {
  const zrodlo = readFileSync(join(PORTAL, 'public', 'zgody.js'), 'utf8');
  const literal = zrodlo.match(/var NAPISY = (\{[\s\S]*?\n {2}\});/)?.[1];
  if (!literal) { ostrzez('public/zgody.js: nie znalazłem słownika NAPISY.'); return null; }
  // Nasz własny plik z repozytorium, sam literał obiektu — nie cudza treść.
  return new Function(`return (${literal});`)();
}

function plikInterfejsu(nr) {
  const czesci = [`# ${String(nr).padStart(2, '0')} · Napisy wspólne: pasek, stopka, baner cookies`, '',
    'Napisy, które stoją na każdej stronie. Pasek i stopka mają w obu wersjach **inne pozycje** (wersja ukraińska '
    + 'linkuje tylko do stron, które naprawdę są po ukraińsku, a polskie dokumenty oznacza jako polskie) — '
    + 'nie zestawiaj ich pozycja w pozycję; sprawdź język i to, czy napisy mówią prawdę o tym, dokąd prowadzą.', ''];

  czesci.push('## 1. Pasek nawigacji', '',
    '_Przełącznik pokazuje język, NA KTÓRY przełącza — dlatego na stronie polskiej stoi „UA” i nazwa po ukraińsku, '
    + 'a na ukraińskiej „PL” i nazwa po polsku._', '', para('1', pasek('/'), pasek('/uk/')));

  const [stopkaPl, stopkaUk] = [fragmentStrony('/', 'footer'), fragmentStrony('/uk/', 'footer')];
  czesci.push('## 2. Stopka', '', para('2.1', stopkaPl.tekst, stopkaUk.tekst));
  if (stopkaPl.nazwy.length || stopkaUk.nazwy.length) {
    czesci.push('_Nazwy czytane przez czytnik ekranu (niewidoczne):_', '',
      para('2.2', stopkaPl.nazwy.join(' · ') || '—', stopkaUk.nazwy.join(' · ') || '—'));
  }

  const skok = (sciezka) => dokument(sciezka).querySelector('a[href="#tresc"]')?.text.trim() ?? '';
  czesci.push('## 3. Odnośnik „przejdź do treści” (dla klawiatury i czytnika ekranu)', '', para('3', skok('/'), skok('/uk/')));

  const baner = banerCookies();
  if (baner) {
    czesci.push('## 4. Baner cookies', '',
      'Zestawione klucz w klucz. Znaczniki `<a …>` zostają bez zmian; „polityka cookies” jest po polsku, '
      + 'bo prowadzi do polskiego dokumentu.', '');
    const klucze = Object.keys(baner.pl);
    for (const klucz of Object.keys(baner.uk)) if (!klucze.includes(klucz)) ostrzez(`baner cookies: klucz „${klucz}” tylko po ukraińsku.`);
    klucze.forEach((klucz, i) => {
      if (!(klucz in baner.uk)) { ostrzez(`baner cookies: brak klucza „${klucz}” po ukraińsku.`); return; }
      const tekst = (w) => (Array.isArray(w) ? w.join(' — ') : w);
      czesci.push(para(`4.${i + 1}`, tekst(baner.pl[klucz]), tekst(baner.uk[klucz])));
    });
  }
  return czesci.join('\n');
}

/* ───────────────────────────── instrukcja ───────────────────────────── */

function instrukcja({ pliki, wszystkoUk }) {
  for (const [pl, uk, rdzen] of SLOWNIK) {
    if (!rdzen.test(wszystkoUk)) ostrzez(`słownik: „${uk}” (${pl}) nie występuje na stronach ukraińskich.`);
  }
  const slownik = SLOWNIK.map(([pl, uk, , uwaga]) => `| ${pl} | ${uk} | ${uwaga ?? ''} |`).join('\n');
  const lista = pliki.map((p) => `- \`${p.plik}\` — ${p.opis}`).join('\n');

  return `# Weryfikacja przekładu z polskiego na ukraiński — instrukcja dla modelu

Stan na ${new Date().toISOString().slice(0, 10)}. Wersja ukraińska nie jest jeszcze opublikowana.

## Twoje zadanie

Sprawdzasz **gotowy przekład** z polskiego na ukraiński. Nie tłumaczysz od nowa i nie poprawiasz stylu
„po swojemu” — szukasz błędów i mówisz, jak je naprawić. Odpowiadasz **po polsku**, ukraińskie cytaty
i poprawki zostawiasz po ukraińsku.

## Co to za tekst

- Serwis utratadochodu.pl prowadzi agent ubezpieczeniowy (Aura Expert sp. z o.o.). Sprzedaje w Polsce
  **ubezpieczenie utraty dochodu**: polisę, która wypłaca miesięczne świadczenie, gdy choroba albo wypadek
  nie pozwalają pracować.
- Wersja ukraińska jest dla obywateli Ukrainy, którzy prowadzą w Polsce jednoosobową działalność (JDG)
  albo pracują na kontrakcie B2B. Czytelnik zna polskie realia (ZUS, PESEL, zwolnienie lekarskie),
  ale czyta po ukraińsku.
- **Polski tekst jest wzorcem**: był sprawdzany z ogólnymi warunkami ubezpieczenia (OWU). Przekład ma go
  oddawać zdanie w zdanie — bez dopowiedzeń, pominięć, łagodzenia i wzmacniania. W ubezpieczeniach różnica
  między „może” a „musi”, „najdłużej przez” a „przez”, „jedyna przyczyna” a „przyczyna” zmienia to,
  co klientowi obiecano.

## Co sprawdzasz — w tej kolejności

1. **Znaczenie.** Czy ukraińskie zdanie mówi dokładnie to, co polskie: te same warunki, wyjątki,
   zastrzeżenia, ten sam stopień pewności („może”, „zwykle”, „nie przysługuje”), ten sam podmiot
   (kto płaci, kto decyduje, kto jest kim).
2. **Liczby i nazwy.** Kwoty, procenty, okresy, daty, paragrafy, nazwy produktów i firm muszą być
   identyczne. Liczby wstawia ten sam kod w obu wersjach, więc różnica oznacza błąd w programie —
   zgłoś ją jako krytyczną.
3. **Terminologia.** Czy terminy ubezpieczeniowe, prawne i podatkowe są tymi, których używa się
   w Ukrainie (ustawodawstwo, rynek ubezpieczeń, język urzędowy), i czy są użyte konsekwentnie.
   Słownik niżej pokazuje, co wybrano — **jeśli termin ze słownika jest zły albo nienaturalny, napisz to
   wprost** i zaproponuj lepszy; nie powielaj go tylko dlatego, że stoi w słowniku.
4. **Język.** Gramatyka, odmiana, pisownia (Український правопис 2019), apostrof, interpunkcja.
   Kalki z polskiego i rusycyzmy. Czy tekst brzmi jak napisany przez osobę, dla której ukraiński
   jest językiem ojczystym.
5. **Obietnice, których w tym serwisie nie wolno składać.** Zgłoś jako krytyczne, jeśli po ukraińsku
   pojawia się którakolwiek z nich:
   - wypłata „od pierwszego dnia” niezdolności do pracy (świadczenie zaczyna się po okresie wyczekiwania);
   - okres wypłaty podany jako gwarantowany albo minimalny zamiast **najdłuższego** („щонайдовше”);
   - zasiłek z ZUS i świadczenie z polisy zsumowane w jedną kwotę;
   - Leadenhall albo CEU nazwane ubezpieczycielem („страховик”) — ubezpieczycielem jest wyłącznie
     Lloyd’s Insurance Company S.A., a Leadenhall Insurance S.A. i CEU sp. z o.o. to coverholderzy Lloyd’s;
   - zakażenie HIV albo WZW przedstawione jako wyłączenie z ochrony;
   - słowo „каренція” zamiast „період очікування”.

## Czego nie zgłaszaj — to decyzje celowe

- **Po polsku zostają**: nazwy własne i skróty (ZUS, PESEL, OWU, JDG, B2B, NIP, Leadenhall, CEU, Lloyd’s,
  symbole LW044 itd., nazwy produktów „Utrata dochodu”, „LOI Premium”), „duży ZUS”, kwoty w „zł”,
  nazwy polskich dokumentów i etykiety pól formularza (formularz wniosku jest tylko po polsku),
  wiersze „Джерело: …” z paragrafami OWU oraz polski termin w nawiasie przy ukraińskim
  (np. „період очікування (okres wyczekiwania)”).
- **Zdania, których nie ma po polsku**, bo dotyczą tylko czytelnika ukraińskiego: że wniosek, umowa, OWU
  i rozmowa z doradcą są po polsku; dopiski „(польською)” przy odnośnikach do polskich stron; zdanie,
  że lista wyłączeń jest przekładem polskiej strony; sekcja „Якщо ви з України і працюєте в Польщі”.
- **Przyciski prowadzą gdzie indziej**: polskie „Policz swoją składkę” / „Przejdź do wniosku” to po
  ukraińsku „Як подати заявку” — odnośnik do przewodnika po polskim formularzu, nie do samego formularza.
- **Forma zwrotu**: polskie „Ty” → ukraińskie „ви” małą literą.
- **Nie oceniasz samych warunków ubezpieczenia** — to zrobiono na polskim tekście. Oceniasz, czy
  ukraiński mówi to samo co polski.

## Słownik użyty w przekładzie

| polski | ukraiński | uwagi |
| --- | --- | --- |
${slownik}

## Pytania, na które szczególnie chcemy odpowiedzi

1. **„внесок”** jako składka ubezpieczeniowa — czy klient w Ukrainie tak to nazwie, czy raczej
   „страховий платіж” / „страхова премія”? Tekst używa „внесок” także dla składek ZUS (jak polskie „składka”).
2. **„виплата (за полісом)”** jako świadczenie z polisy — czy wystarcza, czy powinno być „страхова виплата”?
3. **„допомога по хворобі”** jako zasiłek chorobowy z ZUS — czy to naturalny odpowiednik?
4. **„період очікування”** jako okres wyczekiwania (czas od początku niezdolności do pierwszej wypłaty).
5. **„ковергольдер”**, **„клаузула”**, **„дистрибуційна оплата”** — zrozumiałe czy żargon? Co zamiast?
6. **„страхування на випадок хвороби”** jako dobrowolne ubezpieczenie chorobowe w ZUS oraz **„пільговий ZUS”**.
7. **„заявка”** jako wniosek o ubezpieczenie (a nie „заява”).
8. **„косметолог”** jako polska „kosmetyczka” (zawód: zabiegi kosmetyczne, stylizacja paznokci, bez
   wykształcenia medycznego) i **„перукар”** jako „fryzjer” — czy czytelnik rozpozna w tym swój zawód?
9. Czy gdziekolwiek tekst brzmi jak przekład z polskiego albo z rosyjskiego — podaj trzy najgorsze miejsca.

## Jak czytać pliki

${lista}

- Każda strona jest pocięta na sekcje po nagłówkach, a sekcje na akapity. Segment ma numer w nawiasie
  kwadratowym, np. **[3.2]**: najpierw wersja **PL**, pod nią **UK**. W odpowiedzi podawaj plik i ten numer.
- Gdy polski i ukraiński mają w sekcji różną liczbę akapitów, sekcja stoi w całości (jeden segment)
  z uwagą kursywą. Sprawdź wtedy, czy różnica to celowy dopisek z listy wyżej, czy pominięcie.
- „(tylko po ukraińsku)” — sekcja bez polskiego odpowiednika na stronie; nad nią stoi zamierzona treść
  po polsku.
- Adresy odnośników są usunięte; \`[napis]\` w nawiasach kwadratowych to odnośnik, a \`(obraz: …)\`
  to opis zdjęcia czytany przez czytnik ekranu.
- „(nagłówek)” na początku linii znaczy, że na stronie ten tekst jest nagłówkiem.
- Tekst jest zapisem gotowej strony, więc trafiają się ślady układu: dwa podpisy suwaka sklejone
  w „3 000 zł60 000 zł”, kwota w osobnej linii pod swoim opisem. To nie są błędy przekładu.

## Format odpowiedzi

### Usterki

| nr | plik | segment | waga | kategoria | fragment UK | co jest nie tak | proponowana wersja UK |
| --- | --- | --- | --- | --- | --- | --- | --- |

- **waga**: *krytyczna* — zmienia znaczenie warunków, kwotę, zakres ochrony albo obiecuje coś, czego
  nie ma po polsku; *istotna* — błąd językowy albo terminologiczny, który czytelnik zauważy;
  *drobna* — lepsze słowo, styl.
- **kategoria**: znaczenie · liczba/nazwa · termin · gramatyka/pisownia · kalka · styl.
- Najpierw krytyczne, potem istotne, na końcu drobne.

### Terminy ze słownika

Tylko te, które zmieniłbyś: obecny → proponowany, dlaczego, na ile jesteś pewny (wysoka / średnia / niska).

### Odpowiedzi na pytania

Krótko, punkt po punkcie.

### Uwagi do polskiego oryginału

Tylko jeśli polskie zdanie jest niejasne albo dwuznaczne i przez to nie da się ocenić przekładu.

### Ocena ogólna

Dwa–trzy zdania: czy tekst brzmi jak pisany przez rodzimego użytkownika i co jest największym ryzykiem.

## Zasady

- Zgłaszaj tylko to, co umiesz uzasadnić. Gdy nie masz pewności, napisz „niepewne” i dlaczego.
- Nie przepisuj zdań, które są poprawne. Segmentów bez zastrzeżeń nie wymieniaj.
- Nie zgaduj brakującego kontekstu — zapytaj albo zaznacz, czego nie da się ocenić.
- Poprawka ma być gotowa do wklejenia: całe zdanie albo cały zwrot po ukraińsku, nie opis zmiany.
`;
}

/* ───────────────────────────── przebieg ───────────────────────────── */

const strony = stronyUkrainskie().sort((a, b) => {
  const [ia, ib] = [KOLEJNOSC.indexOf(a), KOLEJNOSC.indexOf(b)].map((i) => (i < 0 ? KOLEJNOSC.length : i));
  return ia - ib || a.localeCompare(b);
});

const slug = (sciezka) => sciezka.replace(/^\/uk\//, '').replace(/\/$/, '').replace(/\//g, '-') || 'strona-glowna';
const pliki = [];
strony.forEach((sciezkaUk, i) => {
  const nr = i + 1;
  const sciezkaPl = odpowiednikPolski(sciezkaUk);
  const { tytul, tekst, licznik } = zestawStrone({ nr, sciezkaUk, sciezkaPl });
  pliki.push({
    plik: `${String(nr).padStart(2, '0')}-${slug(sciezkaUk)}.md`,
    opis: sciezkaPl ? `\`${sciezkaPl}\` ↔ \`${sciezkaUk}\` — ${tytul}` : `\`${sciezkaUk}\` — ${tytul} (tylko po ukraińsku)`,
    tekst, licznik, sciezkaUk,
  });
});
const nrInterfejsu = pliki.length + 1;
pliki.push({
  plik: `${String(nrInterfejsu).padStart(2, '0')}-napisy-wspolne.md`,
  opis: 'pasek nawigacji, stopka, baner cookies',
  tekst: plikInterfejsu(nrInterfejsu),
});

const wszystkoUk = strony.map((s) => md(s)).join('\n');
const tekstInstrukcji = instrukcja({ pliki, wszystkoUk });

rmSync(WYJSCIE, { recursive: true, force: true });
mkdirSync(WYJSCIE, { recursive: true });
const zapisz = (nazwa, tekst) => writeFileSync(join(WYJSCIE, nazwa), `${tekst.trim()}\n`);
zapisz(INSTRUKCJA, tekstInstrukcji);
for (const p of pliki) zapisz(p.plik, p.tekst);
zapisz(KOMPLET, [
  tekstInstrukcji.trim(),
  '---\n\n> Poniżej wszystkie pliki po kolei, w jednym dokumencie. W odpowiedzi podawaj numer części (01, 02…) i numer segmentu.',
  ...pliki.map((p) => p.tekst.trim()),
].join('\n\n---\n\n'));

for (const p of pliki) {
  const l = p.licznik;
  const rozmiar = `${(Buffer.byteLength(p.tekst) / 1024).toFixed(1)} kB`;
  console.log(`${p.plik.padEnd(30)} ${rozmiar.padStart(8)}`
    + (l ? `  sekcji ${l.sekcje}, segmentów ${l.pary}${l.niezgodne.length ? `, w całości: ${l.niezgodne.join(', ')}` : ''}` : ''));
}
console.log(`${KOMPLET.padEnd(30)} ${(statSync(join(WYJSCIE, KOMPLET)).size / 1024).toFixed(1).padStart(6)} kB`);
console.log(`\nZapisane w ${WYJSCIE}`);
if (ostrzezenia.length) {
  console.log(`\nOSTRZEŻENIA (${ostrzezenia.length}):`);
  for (const o of ostrzezenia) console.log(` - ${o}`);
  process.exitCode = 2;
}
