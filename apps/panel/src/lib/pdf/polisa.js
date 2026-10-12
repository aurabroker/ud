/**
 * polisa.js — dane POLISY (nie oferty) z tekstu PDF: numer polisy, okres
 * ubezpieczenia i świadczenie miesięczne z polisy „Beauty", której czytnik
 * ofert nie zna. Kwoty (składka, opłata, raty, sumy) czyta parseLeadenhall —
 * na polisach działa tak samo jak na ofertach.
 *
 * Zmapowane 05.10.2026 na pięciu polisach Leadenhall z produkcji
 * (LW044/AD_D_TTD_PTD, LW047/MEDICARE, LW050/TTD/UNIPRO „Beauty"):
 *
 *   Polisa nr LHC3100906
 *   4. Okres ubezpieczenia 5 lutego 2026 - 4 lutego 2027     (Beauty: pozycja 3)
 *   Świadczenie 7 000 zł miesięcznie                         (tylko Beauty)
 *
 * Polisy CEU nie widzieliśmy (w bibliotece są tylko oferty LOIP/…) — wzorce są
 * ogólne: „Polisa nr / Numer polisy", „od … do …", daty DD-MM-RRRR i DD.MM.RRRR.
 * Czego nie znajdą, zostaje puste i agent wpisuje to ręcznie. Lepiej puste pole
 * niż zgadnięta data końca ochrony — to przegapione wznowienie.
 */
import { parseAmount, parseDateISO } from './helpers.js';

const MIESIACE = 'stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia';
const DATA = `(?:\\d{1,2}\\s+(?:${MIESIACE})\\s+\\d{4}|\\d{1,2}[.\\-/]\\d{1,2}[.\\-/]\\d{4}|\\d{4}-\\d{2}-\\d{2})`;

const WZORY_NUMERU = [
  /\bPolisa\s+(?:nr|numer)\.?\s*:?\s*([A-Z0-9][A-Z0-9/-]{4,40})/,
  /\bNumer\s+polisy\s*:?\s*([A-Z0-9][A-Z0-9/-]{4,40})/i,
  /\bNr\.?\s+polisy\s*:?\s*([A-Z0-9][A-Z0-9/-]{4,40})/i,
];

const OKRES = new RegExp(
  `Okres\\s+(?:ubezpieczenia|ochrony(?:\\s+ubezpieczeniowej)?)\\s*:?\\s*(?:od\\s+(?:dnia\\s+)?)?(${DATA})(?:\\s*r\\.)?`
  + `\\s*(?:-|–|—|do(?:\\s+dnia)?)\\s*(${DATA})`,
  'i'
);

const SWIADCZENIE_MIESIECZNE = /Świadczenie\s+(\d[\d\s ]*(?:,\d{1,2})?)\s*zł\s+miesięcznie/i;

/** Data z polisy → RRRR-MM-DD; nieistniejący dzień (31.02) → null. */
export function dataZPolisy(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : parseDateISO(String(raw).toLowerCase());
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [r, mi, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(r, mi - 1, d));
  return t.getUTCFullYear() === r && t.getUTCMonth() === mi - 1 && t.getUTCDate() === d ? iso : null;
}

/** Numer polisy Leadenhall z nazwy pliku (np. „Szubka_LHC3100906_8347.pdf"). */
export function numerZNazwy(nazwa) {
  const m = String(nazwa ?? '').match(/(?:^|[^A-Za-z0-9])(LHC\d{6,8})(?!\d)/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * @param {string} text tekst PDF (extractPdfText)
 * @returns {{ polisa_numer: string|null, ochrona_od: string|null, ochrona_do: string|null, swiadczenie_okresowa: number|null }}
 */
export function daneZPolisy(text) {
  const t = String(text ?? '');
  let numer = null;
  for (const wzor of WZORY_NUMERU) {
    const m = t.match(wzor);
    const kandydat = m?.[1]?.replace(/[/-]+$/, '');
    if (kandydat && /\d/.test(kandydat)) { numer = kandydat; break; }
  }

  let od = null;
  let doo = null;
  const okres = t.match(OKRES);
  if (okres) {
    od = dataZPolisy(okres[1].replace(/\s+/g, ' '));
    doo = dataZPolisy(okres[2].replace(/\s+/g, ' '));
    // Jedna data bez drugiej albo koniec przed początkiem — nic nie wpisujemy.
    if (!od || !doo || doo < od) { od = null; doo = null; }
  }

  const sw = t.match(SWIADCZENIE_MIESIECZNE);
  const swiadczenie = sw ? parseAmount(sw[1]) : null;

  return {
    polisa_numer: numer,
    ochrona_od: od,
    ochrona_do: doo,
    swiadczenie_okresowa: swiadczenie > 0 ? swiadczenie : null,
  };
}
