/**
 * extras.js — „Postanowienia dodatkowe” oferty: klauzule dodatkowe i ryzyka,
 * które pojawiają się w ofercie tylko wtedy, gdy zostały wskazane przez Klienta.
 *
 * Wynik trafia do parsed_raw.extras (jsonb, bez zmian schematu bazy). Tabela
 * porównania pokazuje pozycję wyłącznie wtedy, gdy choć jedna z porównywanych
 * ofert faktycznie ją obejmuje — patrz $lib/comparisonRows.js.
 */
import { parseAmount } from './helpers.js';

/**
 * @typedef {Object} Extra
 * @property {string} key wspólny klucz pozycji (ten sam u obu ubezpieczycieli)
 * @property {string} label etykieta w tabeli porównania
 * @property {string|null} symbol symbol klauzuli z oferty (np. LW140)
 * @property {boolean|null} covered true = objęte, false = wprost wyłączone, null = brak wzmianki
 * @property {boolean} [limitation] klauzula ogranicza świadczenie (nie rozszerza zakresu)
 * @property {number|null} amount suma ubezpieczenia, gdy oferta ją podaje
 * @property {string|null} offer_label nazwa użyta w ofercie
 * @property {number} order kolejność w tabeli
 */

/**
 * Rejestr znanych klauzul. Symbol -> wspólny klucz, etykieta i kolejność w tabeli.
 * Dzięki wspólnym kluczom Leadenhall i CEU trafiają w ten sam wiersz, mimo innych
 * nazw w dokumentach. Klauzula spoza rejestru NIE ginie: dostaje klucz `lw_<symbol>`
 * i etykietę wprost z oferty (patrz pushExtra).
 */
/** @type {Record<string, { key?: string, label?: string, order?: number, informational?: boolean }>} */
export const EXTRA_REGISTRY = {
  LW140: { key: 'hospital_daily', label: 'Dzienne świadczenie szpitalne i rekonwalescencja', order: 10 },
  LW141: { key: 'disability_adaptation', label: 'Przystosowanie do życia w niepełnosprawności', order: 20 },
  LW126: { key: 'medical_costs', label: 'Zwrot kosztów leczenia i rehabilitacji', order: 30 },
  LW121: { key: 'unconsciousness_weekly', label: 'Tygodniowe świadczenie za utratę przytomności', order: 40 },
  LW143: { key: 'permanent_impairment', label: 'Trwały uszczerbek na zdrowiu', order: 50 },
  LW142: { key: 'funeral', label: 'Koszty pogrzebu', order: 60 },
  // Klauzula ograniczająca, nie świadczenie — stąd `limitation` (bez zielonego
  // „TAK" w tabeli) i treść drukowana pod tabelą (patrz EXTRA_NOTES).
  LW144: {
    key: 'degenerative_limit',
    label: 'Ograniczenie świadczenia z tytułu zwyrodnień',
    order: 85,
    limitation: true
  },
  // Klauzule informacyjne nie są ryzykiem — nie pokazujemy ich w porównaniu.
  LW300: { informational: true }
};

/** Kolejność pozycji spoza katalogu symboli (HIV/WZW, ryzyka aktywnego życia). */
/** @type {Record<string, number>} */
const KEY_ORDER = { hiv_wzw: 70, active_life: 80 };
const DEFAULT_ORDER = 90;

/** Etykiety dla pozycji nieopisanych symbolem klauzuli. */
/** @type {Record<string, string>} */
const KEY_LABEL = {
  hiv_wzw: 'Zakażenie HIV / WZW przy pracy',
  active_life: 'Ryzyka aktywnego życia',
  hospital_daily: 'Dzienne świadczenie szpitalne i rekonwalescencja'
};

/**
 * Nazwa klauzuli wyciągnięta z tekstu oferty. Dopasowanie łapie też zdanie
 * wprowadzające i poprzedni wiersz, więc zostawiamy tylko ostatni fragment
 * po dwukropku / nowej linii. Zbyt krótka resztka => brak nazwy.
 * @param {string} [raw]
 * @returns {string|null}
 */
function cleanOfferLabel(raw) {
  const s = String(raw || '')
    .replace(/^[\s\S]*[::]\s*/, '')
    .replace(/^[\s\S]*[\n\t]/, '')
    .replace(/^(?:oraz|i|a\s+także|także|,|;|•|-|–)\s+/i, '')
    .replace(/^umow\w*\s+ubezpieczenia\s+(?:obejmuje|zawiera)\s*/i, '')
    .trim();
  // Samo zdanie wprowadzające („…obejmuje klauzulę") nazwą nie jest.
  if (/^klauzul[a-ząćęłńóśźż]*$/i.test(s)) return null;
  return s.length >= 3 ? s : null;
}

/**
 * Dokłada pozycję do listy, bez duplikatów po kluczu (pierwsze wystąpienie wygrywa).
 * @param {Extra[]} list
 * @param {Partial<Extra>} item
 */
function pushExtra(list, item) {
  if (!item || !item.key) return;
  if (list.some((x) => x.key === item.key)) return;
  const reg = item.symbol ? EXTRA_REGISTRY[item.symbol.toUpperCase()] : null;
  const symbol = item.symbol ? item.symbol.toUpperCase() : null;
  list.push({
    key: item.key,
    // Klucz techniczny (np. lw_lw144) nigdy nie może trafić do tabeli — gdy nazwy
    // nie znamy ani z rejestru, ani z oferty, pokazujemy sam symbol klauzuli.
    label:
      item.label ||
      reg?.label ||
      KEY_LABEL[item.key] ||
      item.offer_label ||
      (symbol ? `Klauzula ${symbol}` : item.key),
    symbol,
    covered: item.covered ?? null,
    amount: item.amount ?? null,
    offer_label: item.offer_label || null,
    order: reg?.order ?? KEY_ORDER[item.key] ?? DEFAULT_ORDER,
    ...(reg?.limitation ? { limitation: true } : {})
  });
}

/**
 * Fragment tekstu od kotwicy startowej do pierwszej z kotwic końcowych.
 * @param {string} text
 * @param {RegExp} startRe
 * @param {RegExp} [endRe]
 * @returns {string}
 */
function section(text, startRe, endRe) {
  const s = text.search(startRe);
  if (s < 0) return '';
  const rest = text.slice(s);
  const e = endRe ? rest.search(endRe) : -1;
  return e < 0 ? rest : rest.slice(0, e);
}

/**
 * Leadenhall: pozycja „Postanowienia dodatkowe” wylicza wykupione klauzule w formacie
 *   „Świadczenie szpitalne (LW140) z sumą ubezpieczenia 500 zł”.
 * Wzorzec z sumą jest na tyle jednoznaczny, że skanujemy nim cały tekst oferty —
 * definicje klauzul w OWU mają nagłówek „Klauzula LW140”, więc się nie łapią.
 * @param {string} text
 * @returns {Extra[]}
 */
function detectLeadenhall(text) {
  /** @type {Extra[]} */
  const out = [];

  const withSum = /([^\n\t(]{3,120}?)[ ]*\((LW\d{3})\)\s*z\s+sumą\s+ubezpieczenia\s+([\d  ]+(?:,\d{2})?)\s*zł/gi;
  let m;
  while ((m = withSum.exec(text))) {
    const symbol = m[2].toUpperCase();
    const reg = EXTRA_REGISTRY[symbol];
    if (reg?.informational) continue;
    // Nazwa bywa poprzedzona zdaniem wprowadzającym („…oraz następujące świadczenia dodatkowe:”).
    pushExtra(out, {
      key: reg?.key || `lw_${symbol.toLowerCase()}`,
      symbol,
      covered: true,
      amount: parseAmount(m[3]),
      offer_label: cleanOfferLabel(m[1])
    });
  }

  // Klauzule wymienione bez sumy ubezpieczenia — tylko w obrębie pozycji „Postanowienia dodatkowe”.
  const sec = section(
    text,
    /Postanowienia\s+dodatkowe/i,
    /Płatność\s+wynikająca|Osoby\s+uprawnione|Załączniki\s+do\s+polisy/i
  );
  // Nazwa klauzuli stoi przed symbolem — bez jej odczytania w tabeli zostawał
  // sam klucz techniczny (np. lw_lw144).
  const bare = /([^\n\t(]{0,120}?)[ ]*\((LW\d{3})\)/g;
  while ((m = bare.exec(sec))) {
    const symbol = m[2].toUpperCase();
    const reg = EXTRA_REGISTRY[symbol];
    if (reg?.informational) continue;
    pushExtra(out, {
      key: reg?.key || `lw_${symbol.toLowerCase()}`,
      symbol,
      covered: true,
      amount: null,
      offer_label: cleanOfferLabel(m[1])
    });
  }

  // HIV/WZW — oferta stwierdza status wprost, w obie strony.
  const hivExcluded = /(?:HIV|WZW)[^.\n]{0,60}nie\s+(?:są|sa|jest)\s+objęt|(?:HIV|WZW)[^.\n]{0,60}nie\s+obejmuj/i.test(text);
  const hivCovered =
    /zakażeni\w*\s+wirus\w+\s+(?:HIV|WZW)\s+(?:jest|są)\s+objęt/i.test(text) ||
    /(?:HIV|WZW)[^.\n]{0,60}(?:jest|są)\s+objęt\w*\s+ubezpieczeni/i.test(text);
  if (hivExcluded || hivCovered) {
    pushExtra(out, { key: 'hiv_wzw', covered: hivCovered && !hivExcluded, amount: null });
  }

  // Ryzyka aktywnego życia — objęte tylko, gdy oferta je wylicza.
  const alSec = section(text, /Ryzyka\s+aktywnego\s+życia/i, /\n\s*\n|Postanowienia\s+dodatkowe/);
  if (alSec) {
    const none = /nie\s+obejmuje\s+żadnego|nie\s+są\s+objęt|nie\s+obejmuj/i.test(alSec);
    pushExtra(out, { key: 'active_life', covered: !none, amount: null });
  }

  return out;
}

/**
 * CEU: pozycja „Klauzule opcjonalne”. Każda klauzula ma własny status
 * („Objęta ubezpieczeniem” / „Nie objęta ubezpieczeniem”) i opcjonalną kwotę.
 * @param {string} text
 * @returns {Extra[]}
 */
function detectCEU(text) {
  /** @type {Extra[]} */
  const out = [];
  const sec = section(
    text,
    /Klauzule\s+opcjonalne/i,
    /Ryzyka\s+aktywnego|Składka|Łączna\s+składka|Ogólne\s+Warunki/i
  );

  const line = /([A-ZŁŚŻŹĆŃ][^\n]{5,120}?)\s+(Nie\s+objęt\w+|Objęt\w+)\s+ubezpieczeniem([^\n]*)/gi;
  let m;
  while ((m = line.exec(sec))) {
    const offerLabel = m[1].trim();
    const covered = !/^Nie/i.test(m[2]);
    const amount = parseAmount((m[3].match(/([\d  ]+(?:,\d{2})?)\s*(?:zł|PLN)/i) || [])[1]);
    const key = /szpital/i.test(offerLabel) ? 'hospital_daily' : `ceu_${slug(offerLabel)}`;
    pushExtra(out, { key, covered, amount, offer_label: offerLabel });
  }

  // Ryzyka aktywnego wypoczynku / życia — osobna pozycja oferty.
  const alSec = section(text, /Ryzyka\s+aktywnego/i, /\n\s*\n/);
  if (alSec) {
    const none = /nie\s+obejmuje|nie\s+są\s+objęt|Nie\s+objęt/i.test(alSec);
    pushExtra(out, { key: 'active_life', covered: !none, amount: null });
  }

  return out;
}

/**
 * Klucz techniczny z nazwy klauzuli (dla pozycji spoza rejestru).
 * @param {string} s
 */
function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

/**
 * Wykrywa postanowienia dodatkowe w tekście oferty.
 * @param {string} text
 * @param {'leadenhall'|'ceu'} insurerType
 * @returns {Extra[]}
 */
export function detectExtras(text, insurerType) {
  if (!text) return [];
  const list = insurerType === 'ceu' ? detectCEU(text) : detectLeadenhall(text);
  return list.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pl'));
}
