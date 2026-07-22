/**
 * owuMatch.js — czysta logika dopasowania OWU do oferty (bez zależności).
 * Leadenhall ma 3 OWU, CEU 2 — oferta wskazuje swój symbol (owu_symbol).
 */

/** Normalizacja symbolu OWU do porównania. */
export function normSym(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Wybiera OWU z listy kandydatów najlepiej pasujący do symbolu z oferty.
 * Kolejność: dokładny match → zawieranie → jedyny kandydat → null.
 * @param {Array<{symbol?: string}>} candidates
 * @param {string} offerSymbol
 */
export function pickOwu(candidates, offerSymbol) {
  if (!candidates || candidates.length === 0) return null;
  const target = normSym(offerSymbol);
  if (target) {
    const exact = candidates.find((c) => normSym(c.symbol) === target);
    if (exact) return exact;
    const contains = candidates.find((c) => {
      const s = normSym(c.symbol);
      return s && (target.includes(s) || s.includes(target));
    });
    if (contains) return contains;
  }
  return candidates.length === 1 ? candidates[0] : null;
}
