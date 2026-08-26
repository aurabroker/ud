/**
 * odmiana.js — deklinacja nazw zawodów.
 *
 * Po co to jest
 * -------------
 * Stary generator wstawiał mianownik w każde miejsce w zdaniu, przez co 228
 * podstron miało tytuły w rodzaju „Ubezpieczenie dla Lekarz". To błąd, który
 * widzi i człowiek, i model językowy oceniający jakość strony, a naprawić go
 * można wyłącznie odmieniając.
 *
 * Jak to działa
 * -------------
 * Silnik jest regułowy: końcówka rzeczownika wyznacza wzorzec odmiany, a
 * przydawka zgadza się z głową frazy. Reguły uogólniają się na nowe zawody,
 * ale polska morfologia ma za dużo wyjątków, żeby ufać samym regułom — dlatego
 * wynik dla wszystkich zawodów wyliczamy RAZ, w czasie budowania, zapisujemy w
 * data/zawody.json i trzymamy pod testem migawkowym. Dodanie nowego zawodu
 * pokazuje się w diffie jako propozycja do sprawdzenia, a nie jako cicha zmiana.
 *
 * W runtime to jest odczyt pola z JSON-a, nie wywołanie silnika.
 */

/** Przypadki i liczby, których używa treść serwisu. */
export const FORMY = /** @type {const} */ ([
  'mianownik',    // Lekarz              — kto? co?
  'dopelniacz',   // dla lekarza         — kogo? czego?
  'celownik',     // lekarzowi           — komu? czemu?
  'biernik',      // chroni lekarza      — kogo? co?
  'narzednik',    // jesteś lekarzem     — z kim? z czym?
  'miejscownik',  // o lekarzu           — o kim? o czym?
  'mnoga',        // lekarze             — mianownik liczby mnogiej
  'mnogaDop',     // dla lekarzy         — dopełniacz liczby mnogiej
]);

export const MESKI = 'm';
export const ZENSKI = 'z';

/* ── Rzeczowniki ─────────────────────────────────────────────────────────── */

/** Skrót zapisu wzorca: kolejność jak w FORMY, bez mianownika. */
const w = (dop, cel, bier, narz, miejsc, mn, mnDop) => ({
  dopelniacz: dop, celownik: cel, biernik: bier,
  narzednik: narz, miejscownik: miejsc, mnoga: mn, mnogaDop: mnDop,
});

/**
 * Wzorce dla rzeczowników MĘSKOOSOBOWYCH. Pierwszy pasujący wygrywa, więc
 * kolejność ma znaczenie: dłuższe końcówki stoją przed krótszymi.
 */
const MESKIE = [
  // Rzeczowniki męskie o odmianie żeńskiej: „dentysta", „programista".
  [/ista$/,  w('isty', 'iście', 'istę', 'istą', 'iście', 'iści', 'istów')],
  [/ysta$/,  w('ysty', 'yście', 'ystę', 'ystą', 'yście', 'yści', 'ystów')],
  [/ca$/,    w('cy',   'cy',    'cę',   'cą',   'cy',    'cy',   'ców')],
  [/eda$/,   w('edy',  'edzie', 'edę',  'edą',  'edzie', 'edzi', 'edów')],   // logopeda, ortopeda
  [/atra$/,  w('atry', 'atrze', 'atrę', 'atrą', 'atrze', 'atrzy','atrów')],  // pediatra, psychiatra
  [/euta$/,  w('euty', 'eucie', 'eutę', 'eutą', 'eucie', 'euci', 'eutów')],  // terapeuta, farmaceuta
  [/onta$/,  w('onty', 'oncie', 'ontę', 'ontą', 'oncie', 'onci', 'ontów')],  // ortodonta
  [/eta$/,   w('ety',  'ecie',  'etę',  'etą',  'ecie',  'eci',  'etów')],   // geodeta
  [/sta$/,   w('sty',  'ście',  'stę',  'stą',  'ście',  'ści',  'stów')],   // diagnosta
  [/ta$/,    w('ty',   'cie',   'tę',   'tą',   'cie',   'ci',   'tów')],
  [/śla$/,   w('śli',  'śli',   'ślę',  'ślą',  'śli',   'śle',  'śli')],    // cieśla
  [/a$/,     w('y',    'ie',    'ę',    'ą',    'ie',    'owie', 'ów')],

  // „e" ruchome: w przypadkach zależnych wypada — „handlowiec" → „handlowca".
  [/iec$/,   w('ca',   'cowi',  'ca',   'cem',  'cu',    'cy',   'ców')],

  // Spółgłoski historycznie miękkie.
  [/arz$/,   w('arza', 'arzowi','arza', 'arzem','arzu',  'arze', 'arzy')],
  [/cz$/,    w('cza',  'czowi', 'cza',  'czem', 'czu',   'cze',  'czy')],
  [/sz$/,    w('sza',  'szowi', 'sza',  'szem', 'szu',   'sze',  'szy')],
  [/j$/,     w('ja',   'jowi',  'ja',   'jem',  'ju',    'je',   'jów')],

  // Tylnojęzykowe: g → dz, k → c w mianowniku liczby mnogiej.
  [/log$/,   w('loga', 'logowi','loga', 'logiem','logu', 'lodzy','logów')],
  [/g$/,     w('ga',   'gowi',  'ga',   'giem', 'gu',    'dzy',  'gów')],
  [/yk$/,    w('yka',  'ykowi', 'yka',  'ykiem','yku',   'ycy',  'yków')],
  [/ik$/,    w('ika',  'ikowi', 'ika',  'ikiem','iku',   'icy',  'ików')],
  [/k$/,     w('ka',   'kowi',  'ka',   'kiem', 'ku',    'cy',   'ków')],
  [/ch$/,    w('cha',  'chowi', 'cha',  'chem', 'chu',   'chowie','chów')], // coach

  // Zębowe i przednie: miejscownik zmiękcza, mnoga ma alternację.
  [/nt$/,    w('nta',  'ntowi', 'nta',  'ntem', 'ncie',  'nci',  'ntów')],
  [/st$/,    w('sta',  'stowi', 'sta',  'stem', 'ście',  'ści',  'stów')],   // Analyst, Scientist
  [/t$/,     w('ta',   'towi',  'ta',   'tem',  'cie',   'ci',   'tów')],
  [/er$/,    w('era',  'erowi', 'era',  'erem', 'erze',  'erzy', 'erów')],
  [/or$/,    w('ora',  'orowi', 'ora',  'orem', 'orze',  'orzy', 'orów')],
  [/r$/,     w('ra',   'rowi',  'ra',   'rem',  'rze',   'rzy',  'rów')],
  [/d$/,     w('da',   'dowi',  'da',   'dem',  'dzie',  'dzi',  'dów')],
  [/s$/,     w('sa',   'sowi',  'sa',   'sem',  'sie',   'si',   'sów')],
  [/z$/,     w('za',   'zowi',  'za',   'zem',  'zie',   'zi',   'zów')],
  [/n$/,     w('na',   'nowi',  'na',   'nem',  'nie',   'ni',   'nów')],
  [/ł$/,     w('ła',   'łowi',  'ła',   'łem',  'le',    'li',   'łów')],
  [/l$/,     w('la',   'lowi',  'la',   'lem',  'lu',    'le',   'li')],
  [/m$/,     w('ma',   'mowi',  'ma',   'mem',  'mie',   'mowie','mów')],
  [/p$/,     w('pa',   'powi',  'pa',   'pem',  'pie',   'powie','pów')],
  [/b$/,     w('ba',   'bowi',  'ba',   'bem',  'bie',   'bowie','bów')],
  [/w$/,     w('wa',   'wowi',  'wa',   'wem',  'wie',   'wi',   'wów')],
];

const MESKI_DOMYSLNY = w('a', 'owi', 'a', 'em', 'ie', 'owie', 'ów');

/** Wzorce dla rzeczowników ŻEŃSKICH. */
const ZENSKIE = [
  [/ka$/,    w('ki',   'ce',    'kę',   'ką',   'ce',    'ki',   'ek')],    // pielęgniarka, kosmetyczka
  [/ga$/,    w('gi',   'dze',   'gę',   'gą',   'dze',   'gi',   'g')],
  [/ja$/,    w('ji',   'ji',    'ję',   'ją',   'ji',    'je',   'ji')],
  [/la$/,    w('li',   'li',    'lę',   'lą',   'li',    'le',   'li')],
  [/nia$/,   w('ni',   'ni',    'nię',  'nią',  'ni',    'nie',  'ni')],
  [/na$/,    w('nej',  'nej',   'ną',   'ną',   'nej',   'ne',   'nych')],  // położna — odmiana przymiotnikowa
  [/a$/,     w('y',    'ie',    'ę',    'ą',    'ie',    'y',    '')],
];

/* ── Przymiotniki ────────────────────────────────────────────────────────── */

/** Rodzaj męski — mianownik liczby mnogiej jest męskoosobowy (twarde → miękkie). */
const PRZYM_M = [
  [/cki$/,   w('ckiego','ckiemu','ckiego','ckim','ckim','ccy','ckich')],
  [/ski$/,   w('skiego','skiemu','skiego','skim','skim','scy','skich')],
  [/dzki$/,  w('dzkiego','dzkiemu','dzkiego','dzkim','dzkim','dzcy','dzkich')],
  [/ki$/,    w('kiego', 'kiemu', 'kiego', 'kim', 'kim', 'cy',  'kich')],
  [/gi$/,    w('giego', 'giemu', 'giego', 'gim', 'gim', 'dzy', 'gich')],
  [/owy$/,   w('owego', 'owemu', 'owego', 'owym','owym','owi', 'owych')],
  [/ny$/,    w('nego',  'nemu',  'nego',  'nym', 'nym', 'ni',  'nych')],
  [/ły$/,    w('łego',  'łemu',  'łego',  'łym', 'łym', 'li',  'łych')],
  [/y$/,     w('ego',   'emu',   'ego',   'ym',  'ym',  'i',   'ych')],
  [/i$/,     w('iego',  'iemu',  'iego',  'im',  'im',  'i',   'ich')],
];

/** Rodzaj żeński. */
const PRZYM_Z = [
  [/ka$/,    w('kiej', 'kiej', 'ką', 'ką', 'kiej', 'kie', 'kich')],
  [/ga$/,    w('giej', 'giej', 'gą', 'gą', 'giej', 'gie', 'gich')],
  [/a$/,     w('ej',   'ej',   'ą',  'ą',  'ej',   'e',   'ych')],
];

/* ── Klasyfikacja wyrazów w nazwie wielowyrazowej ────────────────────────── */

/**
 * Skróty i wtrącenia nieodmienne. Zostają w mianowniku w każdym przypadku.
 */
const NIEODMIENNE = new Set(
  ('IT AI 3D 2D UX UI QA SEO BHP HR IoT ML VR AR PR SAP ERP CNC GIS EEG USG RTG '
 + 'MRI NDT LEAN B2B SEM PPC CRM BI').split(' ')
);

/**
 * Rzeczowniki, które w nazwie stoją już w przypadku zależnym i nie odmieniają
 * się razem z głową: „Analityk Danych" → „Analityka Danych".
 *
 * Ta lista musi być jawna, bo formy dopełniacza i mianownika przymiotnika
 * bywają nieodróżnialne po samej końcówce: „Kultury" (dopełniacz rzeczownika)
 * wygląda jak „Celny" (przymiotnik) — obie kończą się samogłoską tematyczną.
 * Nowy zawód z taką przydawką trzeba tu dopisać; test migawkowy to wyłapie.
 */
const PRZYDAWKI_STALE = new Set([
  'Budowlanego', 'Budowy', 'Chorób', 'Cyberbezpieczeństwa', 'Danych', 'Firmy',
  'Hiperbarycznej', 'Jazdy', 'Języków', 'Kamery', 'Kuchni', 'Kultury',
  'Marketingu', 'Medycyny', 'Nadzoru', 'Nieruchomości', 'Nuklearnej', 'Ochrony',
  'Oprogramowania', 'Pracy', 'Radiologii', 'Ratunkowej', 'Rehabilitacji',
  'Restauracji', 'Rodzinnej', 'Sieci', 'Sportowej', 'Statku', 'Sądowej',
  'Tropikalnej', 'Wnętrz', 'Zakaźnych', 'Żywności', 'Zasobów', 'Ludzkich',
]);

/**
 * Angielskie rzeczowniki, które w polskim zdaniu przejmują rolę głowy frazy:
 * „Backend Developer" → „Backend Developera", nie „Backenda Developer".
 */
const GLOWY_ANGIELSKIE = new Set([
  'Analyst', 'Architect', 'Artist', 'Designer', 'Developer', 'Engineer',
  'Manager', 'Master', 'Officer', 'Scientist', 'Lead', 'Owner', 'Specialist',
  'Consultant', 'Tester', 'Writer',
]);

/**
 * Zawody, w których dwa rzeczowniki stoją w apozycji i odmieniają się OBA:
 * „Technik Elektroradiolog" → „Technika Elektroradiologa".
 */
const APOZYCJE = new Set(['Elektroradiolog']);

/* ── Wyjątki ─────────────────────────────────────────────────────────────── */

/** Pełne formy tam, gdzie reguła nie ma szans. Klucz: mianownik. */
export const WYJATKI = {
  'Sędzia':  w('sędziego', 'sędziemu', 'sędziego', 'sędzią', 'sędzi', 'sędziowie', 'sędziów'),
  'Coach':   w('coacha', 'coachowi', 'coacha', 'coachem', 'coachu', 'coachowie', 'coachów'),
  // Zapożyczenia, w których polska liczba mnoga zmienia pisownię rdzenia.
  'Architect': w('Architecta', 'Architectowi', 'Architecta', 'Architectem', 'Architekcie', 'Architekci', 'Architektów'),
  'Artist':    w('Artysty', 'Artyście', 'Artystę', 'Artystą', 'Artyście', 'Artyści', 'Artystów'),
};

/**
 * Rzeczowniki odprzymiotnikowe — wyglądają jak przymiotnik i tak się odmieniają,
 * mimo że w nazwie zawodu stoją same: „Księgowy" → „Księgowego", nie „Księgowya".
 */
export const ODPRZYMIOTNIKOWE = new Set(['Księgowy', 'Chorąży', 'Woźny']);

/** Zawody rodzaju żeńskiego — reszta jest traktowana jako męskoosobowa. */
export const ZENSKIE_ZAWODY = new Set([
  'Pielęgniarka', 'Położna', 'Kosmetyczka', 'Higienistka',
]);

/* ── Silnik ──────────────────────────────────────────────────────────────── */

function dopasuj(slowo, tabela, domyslny) {
  const s = slowo.toLowerCase();
  for (const [rx, forma] of tabela) {
    const m = s.match(rx);
    if (m) return { forma, dlugosc: m[0].length };
  }
  return domyslny ? { forma: domyslny, dlugosc: 0 } : null;
}

function wielkaJakOryginal(slowo, forma) {
  return slowo[0] === slowo[0].toUpperCase()
    ? forma[0].toUpperCase() + forma.slice(1)
    : forma;
}

/**
 * Odmienia pojedynczy wyraz.
 * @param {string} slowo
 * @param {string} forma  klucz z FORMY
 * @param {'rzeczownik'|'przymiotnik'} rola
 * @param {'m'|'z'} rodzaj
 */
function odmienSlowo(slowo, forma, rola, rodzaj) {
  if (NIEODMIENNE.has(slowo)) return slowo;

  const wyjatek = WYJATKI[slowo];
  if (wyjatek && wyjatek[forma]) return wielkaJakOryginal(slowo, wyjatek[forma]);

  // Człony złożone odmieniają się w ostatnim: „Szczękowo-Twarzowy".
  if (slowo.includes('-')) {
    const czesci = slowo.split('-');
    czesci[czesci.length - 1] = odmienSlowo(czesci.at(-1), forma, rola, rodzaj);
    return czesci.join('-');
  }

  const jakPrzymiotnik = rola === 'przymiotnik' || ODPRZYMIOTNIKOWE.has(slowo);
  const tabela = jakPrzymiotnik
    ? (rodzaj === ZENSKI ? PRZYM_Z : PRZYM_M)
    : (rodzaj === ZENSKI ? ZENSKIE : MESKIE);
  const domyslny = !jakPrzymiotnik && rodzaj === MESKI ? MESKI_DOMYSLNY : null;

  const wzorzec = dopasuj(slowo, tabela, domyslny);
  if (!wzorzec) return slowo;

  const koncowka = wzorzec.forma[forma];
  if (koncowka == null) return slowo;
  const rdzen = wzorzec.dlugosc === 0 ? slowo : slowo.slice(0, -wzorzec.dlugosc);
  return rdzen + koncowka;
}

/** Rodzaj gramatyczny nazwy — po głowie frazy. */
export function rodzaj(nazwa) {
  const glowa = nazwa.split(/\s+/)[0].replace(/[^\p{L}]/gu, '');
  return ZENSKIE_ZAWODY.has(glowa) ? ZENSKI : MESKI;
}

/** Indeks wyrazu będącego głową frazy. */
export function indeksGlowy(slowa) {
  if (slowa.length === 1) return 0;
  const ostatni = slowa.at(-1);
  return GLOWY_ANGIELSKIE.has(ostatni) ? slowa.length - 1 : 0;
}

/**
 * Odmienia całą nazwę zawodu.
 * @param {string} nazwa  nazwa w mianowniku, np. „Agent Celny"
 * @param {string} forma  klucz z FORMY
 */
export function odmien(nazwa, forma) {
  if (forma === 'mianownik') return nazwa;

  // „Youtuber / Twórca" — każdy człon odmienia się osobno.
  if (nazwa.includes(' / ')) {
    return nazwa.split(' / ').map((cz) => odmien(cz, forma)).join(' / ');
  }

  const r = rodzaj(nazwa);
  const slowa = nazwa.split(/\s+/);
  if (slowa.length === 1) return odmienSlowo(slowa[0], forma, 'rzeczownik', r);

  const glowa = indeksGlowy(slowa);

  return slowa.map((s, i) => {
    if (i === glowa) return odmienSlowo(s, forma, 'rzeczownik', r);
    if (i < glowa) return s;                    // przydawka obca przed głową
    if (NIEODMIENNE.has(s)) return s;
    if (PRZYDAWKI_STALE.has(s)) return s;       // stoi już w przypadku zależnym
    if (APOZYCJE.has(s)) return odmienSlowo(s, forma, 'rzeczownik', r);
    return odmienSlowo(s, forma, 'przymiotnik', r);
  }).join(' ');
}

/** Komplet form dla nazwy — to trafia do zawody.json. */
export function odmiana(nazwa) {
  const out = {};
  for (const f of FORMY) out[f] = odmien(nazwa, f);
  return out;
}
