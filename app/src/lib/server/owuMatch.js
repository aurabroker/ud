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

/** Znajduje OWU, którego symbol zawiera podany prefiks (np. "LW048"). */
export function findOwuBySymbol(candidates, sym) {
  const target = normSym(sym);
  if (!target) return null;
  return (
    candidates.find((c) => {
      const s = normSym(c.symbol);
      return s && (s === target || s.includes(target) || target.includes(s));
    }) || null
  );
}

/**
 * Zwraca ZESTAW OWU do podpięcia dla danego wariantu oferty.
 * Leadenhall: baza LW044/LW046/LW047 (z owu_base) + warunki HIV/WZW (LW048 lub LW049 –
 * wariant medyczny), tylko gdy oferta obejmuje HIV/WZW i baza to LW046/LW047
 * (LW044 nie przewiduje HIV/WZW). Symbol warunków HIV/WZW bierzemy z oferty (hiv_owu_symbol),
 * z fallbackiem do LW048.
 * CEU / brak bazy: pojedyncze dopasowanie po symbolu (jak dotąd).
 * @returns {Array} lista rekordów OWU (bez duplikatów)
 */
export function resolveOwus(candidates, doc) {
  if (!candidates || candidates.length === 0) return [];
  const raw = (doc && doc.parsed_raw) || {};
  const base = raw.owu_base || null;

  if (base) {
    const out = [];
    const baseOwu = findOwuBySymbol(candidates, base) || pickOwu(candidates, doc.owu_symbol);
    if (baseOwu) out.push(baseOwu);
    const baseAllowsRiders = /LW04[67]/i.test(base); // LW046 lub LW047
    if (raw.covers_hiv_wzw && baseAllowsRiders) {
      const riderSym = raw.hiv_owu_symbol || 'LW048';
      const rider = findOwuBySymbol(candidates, riderSym);
      if (rider && !out.includes(rider)) out.push(rider);
    }
    return out;
  }

  const one = pickOwu(candidates, doc && doc.owu_symbol);
  return one ? [one] : [];
}
