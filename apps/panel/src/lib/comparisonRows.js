/**
 * comparisonRows.js — jedno źródło wierszy tabeli porównania.
 * Używane zarówno przez widok HTML (OfferComparison.svelte), jak i przez PDF
 * rekomendacji (server/pdf/summaryDoc.js), żeby oba nie mogły się rozjechać.
 *
 * Zwraca opis niezależny od frameworka:
 *   { kind: 'row'|'section', key, label, cells: [{ text, green?, bold?, underline? }] }
 *
 * @typedef {{ text: string, green?: boolean, bold?: boolean, underline?: boolean }} Cell
 * @typedef {{ kind: 'row'|'section', key: string, label: string, premium?: boolean, cells: Cell[] }} Row
 */
import { money, yesNo, insurerRow, offerNoDisplay } from './format.js';
import { EXTRA_REGISTRY } from './pdf/extras.js';

export const EXTRAS_SECTION_LABEL = 'Postanowienia dodatkowe';

/**
 * Klauzule, których sama pozycja w tabeli nie wyczerpuje — ich treść musi być
 * wydrukowana pod tabelą porównania (prezentacja oferty i PDF rekomendacji).
 * @type {Record<string, { title: string, text: string }>}
 */
export const EXTRA_NOTES = {
  degenerative_limit: {
    title: 'Ograniczenie świadczenia z tytułu zwyrodnień — Klauzula LW144',
    text:
      'Świadczenie miesięczne z tytułu Całkowitej okresowej niezdolności do pracy spowodowanej ' +
      'lub do której przyczyniła się choroba zwyrodnieniowa kręgosłupa lub stawów, zapalenie stawów ' +
      'lub jakikolwiek inny proces zwyrodnieniowy dotyczący kręgosłupa, stawów, kości, mięśni, ' +
      'ścięgien lub więzadeł, ograniczone jest do 50% kwoty określonej w literze B pozycji 5 ' +
      'i należne jest przez okres nie dłuższy niż 24 miesiące.'
  }
};

/**
 * Klucze sprzed wpisania klauzuli do rejestru. Oferty sparsowane wcześniej mają
 * w bazie klucz techniczny — mapujemy go przy odczycie, żeby tabela i treść pod
 * nią były poprawne także bez ponownego przeczytania PDF-u.
 * @type {Record<string, string>}
 */
const LEGACY_EXTRA_KEYS = { lw_lw144: 'degenerative_limit' };

/** Wpisy rejestru klauzul po wspólnym kluczu (nie po symbolu). */
const REGISTRY_BY_KEY = Object.fromEntries(
  Object.values(EXTRA_REGISTRY)
    .filter((r) => r.key)
    .map((r) => [r.key, r])
);

/**
 * Okresowa niezdolność „z oferty”: gdy pokrycie faktycznie jest — TAK na zielono.
 * @param {any} d
 * @returns {Cell}
 */
function tempIncap(d) {
  const covered =
    d.temp_incapacity_covered === true || d.temp_monthly_benefit != null || d.temp_sum_insured != null;
  return covered ? { text: 'TAK', green: true } : { text: yesNo(d.temp_incapacity_covered) };
}

/**
 * Wiersze bazowe — zakres, który pokazujemy zawsze.
 * @type {Array<[string, string, (d: any) => Cell]>}
 */
const BASE = [
  ['insurer', 'Ubezpieczyciel', () => ({ text: insurerRow() })],
  ['offer_no', 'Numer oferty', (d) => ({ text: offerNoDisplay(d.offer_number) })],
  ['period', 'Okres ubezpieczenia', (d) => ({ text: d.insurance_period || '—' })],
  // Kwota z Pozycji A (parsed_raw); gdy ryzyko nieobjęte — Tak/Nie/—
  ['death', 'Śmierć / inwalidztwo (NW)', (d) => ({
    text: d.parsed_raw?.death_sum_insured != null ? money(d.parsed_raw.death_sum_insured) : yesNo(d.death_covered)
  })],
  ['temp', 'Okresowa niezdolność do pracy', tempIncap],
  ['temp_monthly', '— świadczenie miesięczne', (d) => ({ text: money(d.temp_monthly_benefit) })],
  // Kwota z Pozycji C; gdy oferta nie obejmuje tego ryzyka — Tak/Nie/—
  ['perm', 'Trwała niezdolność do pracy', (d) => ({
    text: d.perm_sum_insured != null ? money(d.perm_sum_insured) : yesNo(d.perm_incapacity_covered)
  })],
  ['indemnity', 'Okres odszkodowawczy', (d) => ({ text: d.indemnity_period || '—' })],
  ['wait_acc', 'Okres wyczekiwania (wypadek)', (d) => ({ text: d.wait_accident != null ? d.wait_accident + ' dni' : '—' })],
  ['wait_ill', 'Okres wyczekiwania (choroba)', (d) => ({ text: d.wait_illness != null ? d.wait_illness + ' dni' : '—' })]
];

/**
 * Lista postanowień dodatkowych danego wariantu (pusta, gdy oferta ich nie wskazuje).
 * @param {any} d
 * @returns {Array<any>}
 */
function extrasOf(d) {
  const list = d?.parsed_raw?.extras;
  if (!Array.isArray(list)) return [];
  return list.map((e) => {
    const key = LEGACY_EXTRA_KEYS[e?.key];
    if (!key) return e;
    const reg = REGISTRY_BY_KEY[key] || {};
    return { ...e, key, label: reg.label || e.label, order: reg.order ?? e.order, limitation: !!reg.limitation };
  });
}

/**
 * Postanowienia dodatkowe wspólne dla porównania — wyłącznie te, które
 * PRZYNAJMNIEJ JEDNA z ofert faktycznie obejmuje. Gdy żadna oferta nie wskazuje
 * danej pozycji, nie ma jej w tabeli w ogóle.
 * @param {Array<any>} documents
 * @returns {Array<any>}
 */
export function extraKeys(documents) {
  /** @type {Map<string, any>} */
  const byKey = new Map();
  for (const d of documents || []) {
    for (const e of extrasOf(d)) {
      if (e?.covered !== true) continue;
      const prev = byKey.get(e.key);
      if (!prev || (e.order ?? 90) < (prev.order ?? 90)) byKey.set(e.key, e);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => (a.order ?? 90) - (b.order ?? 90) || String(a.label).localeCompare(String(b.label), 'pl')
  );
}

/**
 * Komórka postanowienia dodatkowego dla jednej oferty.
 * @param {any} d
 * @param {string} key
 * @returns {Cell}
 */
function extraCell(d, key) {
  const e = extrasOf(d).find((x) => x.key === key);
  if (!e || e.covered == null) return { text: '—' };
  if (e.covered === false) return { text: 'Nie' };
  if (e.amount != null) return { text: money(e.amount) };
  // Zielone „TAK" znaczy korzyść — klauzula ograniczająca dostaje neutralne.
  return e.limitation ? { text: 'TAK' } : { text: 'TAK', green: true };
}

/**
 * Treści klauzul do wydrukowania pod tabelą — tylko dla tych, które obejmuje
 * co najmniej jedna z porównywanych ofert.
 * @param {Array<any>} documents
 * @returns {Array<{ key: string, title: string, text: string }>}
 */
export function extraNotes(documents) {
  return extraKeys(documents)
    .filter((e) => EXTRA_NOTES[e.key])
    .map((e) => ({ key: e.key, ...EXTRA_NOTES[e.key] }));
}

/**
 * Buduje komplet wierszy tabeli porównania.
 * @param {Array<any>} documents warianty oferty (ud_offer_documents)
 * @returns {Row[]}
 */
export function comparisonRows(documents) {
  const docs = documents || [];
  /** @type {Row[]} */
  const rows = BASE.map(([key, label, fn]) => ({
    kind: 'row',
    key,
    label,
    cells: docs.map((d) => fn(d))
  }));

  const extras = extraKeys(docs);
  if (extras.length) {
    rows.push({ kind: 'section', key: 'extras', label: EXTRAS_SECTION_LABEL, cells: docs.map(() => ({ text: '' })) });
    for (const e of extras) {
      rows.push({ kind: 'row', key: `extra:${e.key}`, label: e.label, cells: docs.map((d) => extraCell(d, e.key)) });
    }
  }

  rows.push({
    kind: 'row',
    key: 'premium_total',
    label: 'Składka roczna (łącznie)',
    premium: true,
    cells: docs.map((d) => ({ text: money(d.premium_total), bold: true }))
  });
  rows.push({
    kind: 'row',
    key: 'premium_monthly',
    label: 'Rata miesięczna',
    premium: true,
    cells: docs.map((d) =>
      d.premium_monthly != null ? { text: money(d.premium_monthly), bold: true, underline: true } : { text: '—' }
    )
  });

  return rows;
}
