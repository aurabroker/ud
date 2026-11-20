/**
 * test-extras.mjs — testy wykrywania „Postanowień dodatkowych” i budowy wierszy tabeli.
 * Uruchom: node scripts/test-extras.mjs
 *
 * Próbki tekstu odwzorowują układ realnych ofert, ale bez danych osobowych.
 */
import { detectExtras } from '../src/lib/pdf/extras.js';
import { parseCEU } from '../src/lib/pdf/parseCEU.js';
import { comparisonRows, extraKeys, extraNotes } from '../src/lib/comparisonRows.js';
import { coversHivWzw, offerConditionsHtml } from '../src/lib/server/offerConditions.js';
import { conditionsContent } from '../src/lib/server/pdf/conditionsDoc.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(48)} = ${JSON.stringify(actual)}${ok ? '' : `  (oczekiwano ${JSON.stringify(expected)})`}`);
}

// --- Leadenhall: oferta Z postanowieniami dodatkowymi ---
const LH_Z = `
Świadczenia z tytułu ubezpieczenia na wypadek zakażeń
Świadczenia z tytułu zakażenia wirusem HIV i WZW nie są objęte ubezpieczeniem

Ryzyka aktywnego życia\tUmowa ubezpieczenia nie obejmuje żadnego z ryzyk aktywnego życia, o których mowa w § 12 Warunków ubezpieczenia

Postanowienia dodatkowe\tUmowa ubezpieczenia obejmuje klauzulę informacyjną (LW300) oraz następujące świadczenia dodatkowe:
Świadczenie szpitalne (LW140) z sumą ubezpieczenia 500 zł
Zwrot kosztów przystosowania do życia w niepełnosprawności (LW141) z sumą ubezpieczenia 100 000 zł
Zwrot kosztów leczenia i rehabilitacji (LW126) z sumą ubezpieczenia 5 000 zł
Tygodniowe świadczenie z tytułu utraty przytomności (LW121) z sumą ubezpieczenia 1 000 zł
Trwały uszczerbek na zdrowiu (LW143) z sumą ubezpieczenia 15 000 zł Ponadto zastosowanie znajdują postanowienia szczególne.

Płatność wynikająca z umowy
Składka 5 988 zł

Dzienne świadczenie z tytułu pobytu w szpitalu oraz rekonwalescencji w domu
Klauzula LW140
Jeżeli w następstwie zdarzenia objętego Umową Ubezpieczenia...
`;

// --- Leadenhall: oferta BEZ postanowień dodatkowych ---
const LH_BEZ = `
Świadczenia z tytułu zakażenia wirusem HIV i WZW nie są objęte ubezpieczeniem
Płatność wynikająca z umowy
Składka 2 760 zł
`;

// --- Leadenhall: HIV/WZW objęte ---
const LH_HIV = `
Świadczenia z tytułu ubezpieczenia na wypadek zakażeń
Świadczenie na wypadek zakażenia wirusem HIV oraz WZW jest objęte ubezpieczeniem na warunkach LW049
Płatność wynikająca z umowy
`;

// --- CEU: klauzule opcjonalne ---
const CEU = `
Klauzule opcjonalne
Dzienne świadczenie z tytułu pobytu w szpitalu Objęte ubezpieczeniem 300,00 zł/dzień
Zwrot kosztów pogrzebu Nie objęte ubezpieczeniem
Ryzyka aktywnego wypoczynku Nie objęte ubezpieczeniem
Łączna składka roczna 13 464,96 zł
`;

console.log('\n=== LEADENHALL — oferta ze wskazanymi postanowieniami ===');
const zList = detectExtras(LH_Z, 'leadenhall');
check('liczba pozycji', zList.length, 7);
check('klucze', zList.map((e) => e.key), [
  'hospital_daily', 'disability_adaptation', 'medical_costs',
  'unconsciousness_weekly', 'permanent_impairment', 'hiv_wzw', 'active_life'
]);
check('kwoty klauzul', zList.filter((e) => e.symbol).map((e) => e.amount), [500, 100000, 5000, 1000, 15000]);
check('klauzula informacyjna pominięta', zList.some((e) => e.symbol === 'LW300'), false);
check('HIV/WZW wyłączone', zList.find((e) => e.key === 'hiv_wzw').covered, false);
check('ryzyka aktywnego życia wyłączone', zList.find((e) => e.key === 'active_life').covered, false);

console.log('\n=== LEADENHALL — oferta bez postanowień ===');
const bezList = detectExtras(LH_BEZ, 'leadenhall');
check('brak klauzul z symbolem', bezList.filter((e) => e.symbol).length, 0);
check('nic nie jest objęte', bezList.filter((e) => e.covered === true).length, 0);

console.log('\n=== LEADENHALL — HIV/WZW objęte ===');
check('HIV/WZW objęte', detectExtras(LH_HIV, 'leadenhall').find((e) => e.key === 'hiv_wzw').covered, true);

console.log('\n=== CEU — klauzule opcjonalne ===');
const ceuList = detectExtras(CEU, 'ceu');
check('szpital objęty', ceuList.find((e) => e.key === 'hospital_daily')?.covered, true);
check('kwota szpitalna', ceuList.find((e) => e.key === 'hospital_daily')?.amount, 300);
check('pogrzeb nieobjęty', ceuList.find((e) => /pogrzeb/.test(e.key))?.covered, false);

// --- CEU LOI PREMIUM: układ prawdziwej oferty z 20.11.2026 (dane zmyślone) ---
// Nazwa klauzuli i status w osobnych liniach, punktor „l ", jeden okres
// oczekiwania dla wypadku i choroby, wypłata od 1. dnia zdaniem w pozycji 12.
const CEU_LOIP = `Oferta nr LOIP/2026/009999 Strona 1 z 2
Oferta nr LOIP/2026/009999
z dnia 20-11-2026 ważna do 19-12-2026
UBEZPIECZENIE LOI PREMIUM
dla osób niezatrudniających pracowników
2. Coverholder CEU sp. z o.o. z siedzibą w Warszawie
3. Ubezpieczający Będzie określony w polisie
4. Ubezpieczony Jan Testowy
,
Data urodzenia: 01-01-1990
Polska
Zawód: Architekt danych
Rodzaj zatrudnienia: Samozatrudnienie, umowa cywilnoprawna, działalność gospodarcza,
kontrakt menadżerski
5. Okres Ubezpieczenia 12 miesięcy
6. Świadczenia l Czasowa całkowita niezdolność do pracy w wyniku Zachorowania lub Nieszczęśliwego wypadku
Objęta ubezpieczeniem
Maksymalne świadczenie miesięczne 20 000,00 zł
nie może przekroczyć 80% kwoty stanowiącej 1/12 Ubezpieczonego przychodu za okres 12
miesięcy bezpośrednio poprzedzających zawarcie Umowy ubezpieczenia oraz 5 000 PLN/dzień
Suma ubezpieczenia 480 000,00 zł
Okres świadczeń 24 miesiące
Okres oczekiwania 30 dni
l Trwała całkowita niezdolność do pracy w wyniku Zachorowania lub Nieszczęślwiego wypadku
Objęta ubezpieczeniem
Suma ubezpieczenia 500 000,00 zł
nie może przekroczyć 10-krotności Ubezpieczonego przychodu za okres 12 miesięcy bezpośrednio
poprzedzających zawarcie Umowy ubezpieczenia
Okres oczekiwania 24 miesiące
7. Klauzule opcjonalne l Dzienne świadczenie z tytułu pobytu w szpitalu
Nie objęte ubezpieczeniem
l Zakażenie HIV/WZW
Nie objęte ubezpieczeniem
8. Ryzyka aktywnego
życia Umowa ubezpieczenia nie obejmuje żadnego z ryzyk aktywnego życia, o których mowa w § 14
warunków ubezpieczenia z dnia 01.04.2026 (wersja 1.2).
=== STRONA 2 ===
9. Składka Łączna składka roczna 4 608,48 zł
Składka miesięczna, 12 rat po 384,04 zł
10. OWU i Załączniki Ogólne Warunki Ubezpieczenia "LOI PREMIUM" (z dnia 01.04.2026 (wersja 1.2))
12. Komentarze/
Informacje dodatkowe Średnie miesięczne przychody za okres 12 miesięcy bezpośrednio poprzedzających zawarcie
Umowy ubezpieczenia, tj. za okres od 01-10-2025 do 30-10-2026 wynoszą 25000,00 PLN.
Klauzula wypłaty od 1-ego dnia włączona do ubezpieczenia.
Warszawa, 20-11-2026`;

console.log('\n=== CEU LOI PREMIUM — układ z 20.11.2026 ===');
const loip = parseCEU(CEU_LOIP);
check('ubezpieczony (pozycja 4, osobna linia)', loip.insured_name, 'Jan Testowy');
check('okres oczekiwania — wypadek', loip.wait_accident, 30);
check('okres oczekiwania — choroba', loip.wait_illness, 30);
check('okres oczekiwania trwałej (nie do dni)', loip.perm_wait, '24 miesiące');
check('świadczenie / suma / okres', [loip.temp_monthly_benefit, loip.temp_sum_insured, loip.indemnity_period], [20000, 480000, '24 miesiące']);
check('trwała', [loip.perm_incapacity_covered, loip.perm_sum_insured], [true, 500000]);
check('składka roczna / rata / raty', [loip.premium_total, loip.premium_monthly, loip.installments], [4608.48, 384.04, 12]);
check('przychód / OWU', [loip.avg_monthly_income, loip.owu_symbol], [25000, 'LOI PREMIUM']);
const loipEx = loip.parsed_raw.extras;
check('klucze klauzul (bez punktora i nagłówka)', loipEx.map((e) => e.key), ['first_day', 'hiv_wzw', 'active_life', 'hospital_daily']);
check('wypłata od 1. dnia objęta', loipEx.find((e) => e.key === 'first_day')?.covered, true);
check('klauzula i próg z OWU LOI PREMIUM', [loipEx[0].klauzula, loipEx[0].prog_przychodu], ['Klauzula 2 OWU LOI PREMIUM', 20000]);
check('HIV/WZW — wspólny klucz, nieobjęte', loipEx.find((e) => e.key === 'hiv_wzw')?.covered, false);
check('szpital nieobjęty, nazwa bez nagłówka', [loipEx.find((e) => e.key === 'hospital_daily')?.covered, loipEx.find((e) => e.key === 'hospital_daily')?.offer_label], [false, 'Dzienne świadczenie z tytułu pobytu w szpitalu']);
check('żaden klucz techniczny z punktora', loipEx.some((e) => /^ceu_l_|klauzule_opcjonalne/.test(e.key)), false);
check('HIV z CEU nie zapala pozycji w warunkach', coversHivWzw([{ parsed_raw: loip.parsed_raw }]), false);
const nieWlaczona = detectExtras(CEU_LOIP.replace('od 1-ego dnia włączona', 'od 1-ego dnia nie została włączona'), 'ceu');
check('klauzula „nie została włączona" → Nie', nieWlaczona.find((e) => e.key === 'first_day')?.covered, false);
check('bez zdania o klauzuli — brak pozycji', detectExtras(CEU_LOIP.replace(/Klauzula wypłaty[^\n]*\n/, ''), 'ceu').some((e) => e.key === 'first_day'), false);
const ceuHiv = detectExtras(CEU_LOIP.replace('l Zakażenie HIV/WZW\nNie objęte', 'l Zakażenie HIV/WZW\nObjęte'), 'ceu');
check('HIV/WZW objęte w CEU → pozycja w warunkach', coversHivWzw([{ parsed_raw: { extras: ceuHiv } }]), true);
const udEx = detectExtras(CEU_LOIP.replace(/LOI PREMIUM/g, 'Utrata Dochodu'), 'ceu').find((e) => e.key === 'first_day');
check('Utrata Dochodu — klauzula 13, próg 15 000', [udEx?.klauzula, udEx?.prog_przychodu], ['Klauzula 13 OWU Utrata Dochodu', 15000]);
const zatrEx = detectExtras(CEU_LOIP.replace(/LOI PREMIUM/g, 'Utrata Dochodu').replace('niezatrudniających', 'zatrudniających'), 'ceu').find((e) => e.key === 'first_day');
check('dla zatrudniających — bez progu (nie sprawdzone)', [zatrEx?.klauzula ?? null, zatrEx?.prog_przychodu ?? null], [null, null]);
check('bez progu — warunek z klauzuli słowami', /kwotę określoną w klauzuli/.test(extraNotes([{ parsed_raw: { extras: [zatrEx] } }])[0]?.text || ''), true);

const tabLoip = comparisonRows([{ ...loip }, docBezDodatkow()]);
const rowFd = tabLoip.find((r) => r.key === 'extra:first_day');
check('tabela: wiersz wypłaty od 1. dnia', rowFd?.cells.map((c) => c.text), ['TAK', '—']);
check('tabela: wyczekiwanie 30 dni', tabLoip.filter((r) => r.key.startsWith('wait_')).map((r) => r.cells[0].text), ['30 dni', '30 dni']);
const notatki = extraNotes([{ ...loip }]);
check('pod tabelą: warunki klauzuli', notatki.map((n) => n.title), ['Wypłata świadczenia od 1. dnia — Klauzula 2 OWU LOI PREMIUM']);
check('warunki: 30 dni, próg i kręgosłup', [/co najmniej 30 dni/.test(notatki[0].text), /20\s000 zł/.test(notatki[0].text), /kręgosłupa/.test(notatki[0].text)], [true, true, true]);

function docBezDodatkow() {
  return { parsed_raw: { extras: [] }, premium_total: 3036, premium_monthly: 253 };
}

console.log('\n=== TABELA PORÓWNANIA ===');
const docA = { parsed_raw: { extras: zList }, premium_total: 6576, premium_monthly: 548 };
const docB = { parsed_raw: { extras: bezList }, premium_total: 3036, premium_monthly: 253 };

const same = comparisonRows([docB, docB]);
check('bez wskazań — brak sekcji', same.some((r) => r.kind === 'section'), false);
check('bez wskazań — brak wierszy extra', same.some((r) => r.key.startsWith('extra:')), false);

const mixed = comparisonRows([docA, docB]);
check('ze wskazaniami — jest sekcja', mixed.filter((r) => r.kind === 'section').length, 1);
check('ze wskazaniami — wiersze extra', mixed.filter((r) => r.key.startsWith('extra:')).map((r) => r.key), [
  'extra:hospital_daily', 'extra:disability_adaptation', 'extra:medical_costs',
  'extra:unconsciousness_weekly', 'extra:permanent_impairment'
]);
const hosp = mixed.find((r) => r.key === 'extra:hospital_daily');
check('kolumna z klauzulą', hosp.cells[0].text, '500 zł');
check('kolumna bez klauzuli', hosp.cells[1].text, '—');
check('wiersze wyłączone nie tworzą sekcji', mixed.some((r) => r.key === 'extra:hiv_wzw'), false);
check('składki na końcu', mixed.slice(-2).map((r) => r.key), ['premium_total', 'premium_monthly']);
check('klucze bazowe bez zmian', mixed.filter((r) => r.kind === 'row' && !r.key.startsWith('extra:') && !r.premium).map((r) => r.key), [
  'insurer', 'offer_no', 'period', 'death', 'temp', 'temp_monthly', 'perm', 'indemnity', 'wait_acc', 'wait_ill'
]);

// --- Leadenhall: klauzula spoza rejestru (np. LW199) ---
// Regresja: w tabeli pokazywał się goły klucz techniczny („lw_lw199").
const LH_NIEZNANA = `
Postanowienia dodatkowe\tUmowa ubezpieczenia obejmuje klauzulę informacyjną (LW300) oraz następujące świadczenia dodatkowe:
Klauzula pracy fizycznej (LW199)

Osoby uprawnione
`;
const LH_NIEZNANA_BEZ_NAZWY = `
Postanowienia dodatkowe\tUmowa ubezpieczenia obejmuje klauzulę (LW199)

Osoby uprawnione
`;

console.log('\n=== LEADENHALL — klauzula spoza rejestru ===');
const nieznana = detectExtras(LH_NIEZNANA, 'leadenhall').find((e) => e.symbol === 'LW199');
check('klucz techniczny', nieznana?.key, 'lw_lw199');
check('etykieta z oferty', nieznana?.label, 'Klauzula pracy fizycznej');
const bezNazwy = detectExtras(LH_NIEZNANA_BEZ_NAZWY, 'leadenhall').find((e) => e.symbol === 'LW199');
check('etykieta awaryjna = symbol', bezNazwy?.label, 'Klauzula LW199');
check('nazwa kolumny oferty nie jest etykietą', bezNazwy?.label.includes('Postanowienia'), false);

// --- Leadenhall: klauzula LW144 (ograniczenie z tytułu zwyrodnień) ---
// Ma własną nazwę w tabeli, neutralne „TAK" (to ograniczenie, nie korzyść)
// i treść drukowaną pod tabelą.
const LH_LW144 = `
Postanowienia dodatkowe\tUmowa ubezpieczenia obejmuje klauzulę informacyjną (LW300) oraz następujące świadczenia dodatkowe:
Świadczenie szpitalne (LW140) z sumą ubezpieczenia 500 zł
Ograniczenie świadczenia z tytułu zwyrodnień (LW144)

Osoby uprawnione
`;

console.log('\n=== LEADENHALL — klauzula LW144 ===');
const lw144 = detectExtras(LH_LW144, 'leadenhall');
const degen = lw144.find((e) => e.symbol === 'LW144');
check('wspólny klucz', degen?.key, 'degenerative_limit');
check('etykieta z rejestru', degen?.label, 'Ograniczenie świadczenia z tytułu zwyrodnień');
check('oznaczona jako ograniczenie', degen?.limitation, true);

const docLw144 = { parsed_raw: { extras: lw144 }, premium_total: 3036, premium_monthly: 253 };
const rowsLw144 = comparisonRows([docLw144]);
const degenRow = rowsLw144.find((r) => r.key === 'extra:degenerative_limit');
check('wiersz w tabeli', degenRow?.label, 'Ograniczenie świadczenia z tytułu zwyrodnień');
check('TAK bez zielonego', degenRow?.cells[0], { text: 'TAK' });
const hospRow = rowsLw144.find((r) => r.key === 'extra:hospital_daily');
check('korzyść nadal na zielono', hospRow?.cells[0].text, '500 zł');

const notes = extraNotes([docLw144]);
check('treść pod tabelą — jedna pozycja', notes.length, 1);
check('tytuł treści', notes[0]?.title, 'Ograniczenie świadczenia z tytułu zwyrodnień — Klauzula LW144');
check('treść zawiera limit 50%', /ograniczone jest do 50% kwoty/.test(notes[0]?.text || ''), true);
check('bez klauzuli — brak treści', extraNotes([{ parsed_raw: { extras: [] } }]).length, 0);

// Stare oferty mają w bazie jeszcze klucz techniczny — po odczycie musi działać tak samo.
const stary = { parsed_raw: { extras: [{ key: 'lw_lw144', label: 'lw_lw144', symbol: 'LW144', covered: true, amount: null, order: 90 }] } };
const rowsStary = comparisonRows([stary]);
check('stary klucz → nazwa z rejestru', rowsStary.find((r) => r.key === 'extra:degenerative_limit')?.label,
  'Ograniczenie świadczenia z tytułu zwyrodnień');
check('stary klucz → treść pod tabelą', extraNotes([stary]).length, 1);

// --- Warunki oferty: pozycja HIV/WZW tylko przy ofercie z LW048/LW049 ---
// OWU bazowe zakażenia nie wyłączają, ale osobnego świadczenia za nie nie dają.
// Stały wpis w „zakresie ochrony" obiecywał je w każdej ofercie, także bez klauzuli.
const bezHiv = { parsed_raw: { covers_hiv_wzw: false, extras: bezList } };
const zHiv = { parsed_raw: { covers_hiv_wzw: true, hiv_owu_symbol: 'LW049' } };
const zHivPostanowienia = { parsed_raw: { extras: detectExtras(LH_HIV, 'leadenhall') } };
const reczna = { parsed_raw: null };

console.log('\n=== WARUNKI OFERTY — pozycja HIV/WZW ===');
check('bez klauzuli — nie obejmuje', coversHivWzw([bezHiv, reczna]), false);
check('flaga z parsera', coversHivWzw([bezHiv, zHiv]), true);
check('pozycja z postanowień dodatkowych', coversHivWzw([zHivPostanowienia]), true);
check('wyłączone w postanowieniach', coversHivWzw([docA]), false);
check('HTML bez klauzuli — bez HIV', /HIV/.test(offerConditionsHtml([bezHiv])), false);
check('HTML z klauzulą — jest HIV', /zakażenia wirusem HIV lub WZW podczas pracy/.test(offerConditionsHtml([bezHiv, zHiv])), true);
const zakres = (hiv) => conditionsContent('', hiv)[1].table.body[0][0].stack[2].ul;
check('PDF bez klauzuli — ostatnia pozycja', zakres(false).at(-1), 'śmierci i inwalidztwa wskutek nieszczęśliwego wypadku.');
check('PDF z klauzulą — ostatnia pozycja', zakres(true).at(-1), 'zakażenia wirusem HIV lub WZW podczas pracy.');

console.log(`\n${failures === 0 ? '✅ WSZYSTKIE ASERCJE OK' : `❌ ${failures} ASERCJI NIE PRZESZŁO`}`);
process.exit(failures === 0 ? 0 : 1);
