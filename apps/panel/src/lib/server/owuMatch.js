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

/** Znajduje WSZYSTKIE dokumenty biblioteczne pasujące do symbolu (OWU + Karta produktowa dzielą symbol). */
export function findOwusBySymbol(candidates, sym) {
  const target = normSym(sym);
  if (!target) return [];
  return candidates.filter((c) => {
    const s = normSym(c.symbol);
    return s && (s === target || s.includes(target) || target.includes(s));
  });
}

/** Pierwszy pasujący dokument (zgodność wstecz). */
export function findOwuBySymbol(candidates, sym) {
  return findOwusBySymbol(candidates, sym)[0] || null;
}

/** Prefiks bazowy (LW044/LW046/LW047) z symbolu oferty. */
export function baseFromSymbol(sym) {
  const m = String(sym || '').match(/LW0\d{2}/i);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Mapa baza → zbiór symboli, które oferta ma JUŻ podpięte.
 *
 * Dlaczego baza i symbol osobno, a nie sama baza: OWU i karta produktu tej
 * samej wersji mają w bibliotece IDENTYCZNY symbol (oba LW046/MEDICA/PL/4),
 * a kolejna wersja tego samego OWU różni się ostatnim członem (…/PL/5).
 * Po samej bazie te dwa przypadki wyglądają tak samo, a rozróżnić je trzeba:
 * kartę produktu do już podpiętego OWU wolno dołożyć, nowej wersji OWU nie.
 */
export function pokryteBazy(symbole) {
  const m = new Map();
  for (const s of symbole || []) {
    const b = baseFromSymbol(s);
    if (!b) continue;
    if (!m.has(b)) m.set(b, new Set());
    m.get(b).add(normSym(s));
  }
  return m;
}

/**
 * Odsiewa dokumenty będące INNĄ WERSJĄ bazy, którą oferta już ma podpiętą.
 *
 * Oferta trzyma wskaźnik na konkretny plik i to ten plik obowiązuje polisę
 * zawartą na jego warunkach. Gdy ubezpieczyciel wyda nowe OWU, stare jest
 * w bibliotece dezaktywowane — ale odświeżanie dokumentów czyta wyłącznie
 * pozycje aktywne i dopasowuje po samej bazie (LW044), więc bez tego filtra
 * dokleiłoby klientowi obok jego wersji tę, która jego umowy nie dotyczy.
 * Nic by przy tym nie zginęło i żaden błąd by się nie zapalił — klient
 * dostałby po prostu dwa OWU i sam musiałby zgadnąć, które czytać.
 */
export function bezInnychWersji(kandydaci, pokryte) {
  if (!pokryte || pokryte.size === 0) return kandydaci || [];
  return (kandydaci || []).filter((c) => {
    const b = baseFromSymbol(c && c.symbol);
    if (!b || !pokryte.has(b)) return true;
    return pokryte.get(b).has(normSym(c && c.symbol));
  });
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
  // owu_base z parsera; dla starszych ofert (bez flagi) wyprowadzamy z owu_symbol.
  const base = raw.owu_base || baseFromSymbol(doc && doc.owu_symbol);

  if (base) {
    const out = [];
    const push = (r) => { if (r && !out.some((x) => x.storage_path === r.storage_path)) out.push(r); };

    // Baza: WSZYSTKIE dokumenty pasujące do symbolu bazowego (OWU + Karta produktowa).
    let baseMatches = findOwusBySymbol(candidates, base);
    if (baseMatches.length === 0) { const one = pickOwu(candidates, doc.owu_symbol); if (one) baseMatches = [one]; }
    baseMatches.forEach(push);

    // HIV/WZW: rider (LW048/LW049) tylko gdy oferta obejmuje ryzyko i baza to LW046/LW047.
    const baseAllowsRiders = /LW04[67]/i.test(base);
    if (raw.covers_hiv_wzw && baseAllowsRiders) {
      findOwusBySymbol(candidates, raw.hiv_owu_symbol || 'LW048').forEach(push);
    }
    return out;
  }

  const one = pickOwu(candidates, doc && doc.owu_symbol);
  return one ? [one] : [];
}
