/**
 * test-extras.mjs — testy wykrywania „Postanowień dodatkowych” i budowy wierszy tabeli.
 * Uruchom: node scripts/test-extras.mjs
 *
 * Próbki tekstu odwzorowują układ realnych ofert, ale bez danych osobowych.
 */
import { detectExtras } from '../src/lib/pdf/extras.js';
import { comparisonRows, extraKeys, extraNotes } from '../src/lib/comparisonRows.js';

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

console.log(`\n${failures === 0 ? '✅ WSZYSTKIE ASERCJE OK' : `❌ ${failures} ASERCJI NIE PRZESZŁO`}`);
process.exit(failures === 0 ? 0 : 1);
