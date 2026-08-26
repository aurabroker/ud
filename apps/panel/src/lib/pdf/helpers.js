/**
 * helpers.js — narzędzia do parsowania polskich kwot/dat z tekstu PDF.
 */

/** Usuwa wszystkie rodzaje spacji (zwykłe, NBSP, wąskie) */
export function stripSpaces(s) {
  return String(s).replace(/[\s  ]/g, '');
}

/**
 * "2 760 zł" -> 2760 | "13 464,96" -> 13464.96 | "392 450,00" -> 392450
 * @returns {number|null}
 */
export function parseAmount(raw) {
  if (raw == null) return null;
  const cleaned = stripSpaces(raw).replace(/zł|PLN/gi, '').replace(',', '.');
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Pierwsza grupa dopasowania regex lub null */
export function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** Liczba całkowita z pierwszej grupy lub null */
export function matchInt(text, re) {
  const v = firstMatch(text, re);
  if (v == null) return null;
  const n = parseInt(stripSpaces(v), 10);
  return Number.isFinite(n) ? n : null;
}

/** Kwota z pierwszej grupy lub null */
export function matchAmount(text, re) {
  const m = text.match(re);
  return m ? parseAmount(m[1]) : null;
}

const PL_MONTHS = {
  stycznia: '01', lutego: '02', marca: '03', kwietnia: '04', maja: '05', czerwca: '06',
  lipca: '07', sierpnia: '08', września: '09', wrzesnia: '09', października: '10',
  pazdziernika: '10', listopada: '11', grudnia: '12'
};

/**
 * Normalizuje datę do ISO (YYYY-MM-DD).
 * Obsługuje "28 maja 2026" oraz "01-06-2026".
 * @returns {string|null}
 */
export function parseDateISO(raw) {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i);
  if (m) {
    const mo = PL_MONTHS[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** true jeśli w danym fragmencie jest "Objęt..." a nie "Nie objęt..." */
export function isCovered(fragment) {
  if (!fragment) return null;
  if (/Nie\s+objęt/i.test(fragment)) return false;
  if (/objęt/i.test(fragment)) return true;
  return null;
}
