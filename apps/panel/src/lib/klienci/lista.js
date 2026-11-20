/**
 * Kolejność i filtry listy „Klienci" — JEDNO miejsce, z którego biorą lista
 * (src/routes/panel/klienci/+page.svelte) i strzałki „Poprzedni / Następny
 * klient" na karcie (sasiedziKlienta w src/lib/server/klienci.js). Gdyby każde
 * liczyło po swojemu, strzałki na karcie prowadziłyby w innej kolejności niż
 * lista, z której agent przyszedł.
 *
 * Wiersz: { id, created_at, archiwum: boolean, zrodlo: { klucz } } — oba
 * miejsca budują go tą samą funkcją serwera (klienciWKolejnosci).
 *
 * Filtry żyją w adresie (?widok=archiwum, ?zrodlo=ads|agent|inne|brak), żeby
 * dało się je zapisać w zakładce, sprawdzić w SSR i przenieść z listy na kartę
 * i z powrotem. Szukanie z pola „Szukaj" jest stanem strony i strzałek nie
 * dotyczy.
 */
import { KLUCZE_ZRODLA } from '../zrodlo.js';

/**
 * Filtry z adresu. Nieznana wartość = bez filtra (stary albo zepsuty link nie chowa listy).
 * @param {URLSearchParams | null | undefined} parametry
 * @returns {{ archiwum: boolean, zrodlo: import('../zrodlo.js').KluczZrodla | null }}
 */
export function filtryListy(parametry) {
  const zrodlo = parametry?.get('zrodlo') ?? null;
  return {
    archiwum: parametry?.get('widok') === 'archiwum',
    zrodlo: KLUCZE_ZRODLA.find((k) => k === zrodlo) ?? null,
  };
}

/**
 * Zapytanie do doklejenia do adresu listy albo karty: '' albo '?widok=archiwum&zrodlo=ads'.
 * @param {{ archiwum?: boolean, zrodlo?: string | null }} filtry
 */
export function zapytanieListy({ archiwum = false, zrodlo = null } = {}) {
  const p = new URLSearchParams();
  if (archiwum) p.set('widok', 'archiwum');
  if (zrodlo) p.set('zrodlo', zrodlo);
  const t = p.toString();
  return t ? `?${t}` : '';
}

/** @param {{ created_at?: string | null } | null | undefined} w */
const chwila = (w) => {
  const t = Date.parse(w?.created_at ?? '');
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * Najnowsi u góry; przy tej samej chwili (z dokładnością do milisekundy) —
 * identyfikator malejąco. Bez drugiego klucza dwóch klientów dodanych naraz
 * (import, ta sama transakcja) mogłoby zamieniać się miejscami między listą
 * a kartą. Klient bez daty — na końcu.
 * @param {{ id?: string, created_at?: string | null }} a
 * @param {{ id?: string, created_at?: string | null }} b
 */
export function porownajKlientow(a, b) {
  const ta = chwila(a);
  const tb = chwila(b);
  if (ta !== tb) return tb > ta ? 1 : -1;
  const ia = String(a?.id ?? '');
  const ib = String(b?.id ?? '');
  return ia === ib ? 0 : ia < ib ? 1 : -1;
}

/**
 * Klienci jednego widoku: „Klienci" (archiwum = false) albo „Archiwum" — lead
 * zarchiwizowany na tablicy (decyzja właściciela z 05.10.2026).
 * @template {{ archiwum?: boolean }} T
 * @param {T[] | null | undefined} wiersze @param {boolean} archiwum
 * @returns {T[]}
 */
export const wWidoku = (wiersze, archiwum) => (wiersze ?? []).filter((w) => Boolean(w?.archiwum) === Boolean(archiwum));

/**
 * Lista dokładnie taka, jak na stronie: widok, źródło, kolejność.
 * @template {{ id?: string, created_at?: string | null, archiwum?: boolean, zrodlo?: { klucz?: string } | null }} T
 * @param {T[] | null | undefined} wiersze
 * @param {{ archiwum?: boolean, zrodlo?: string | null }} filtry
 * @returns {T[]}
 */
export function listaWidoku(wiersze, filtry) {
  return wWidoku(wiersze, Boolean(filtry?.archiwum))
    .filter((w) => !filtry?.zrodlo || w?.zrodlo?.klucz === filtry.zrodlo)
    .sort(porownajKlientow);
}

/**
 * Sąsiedzi klienta na liście z tymi filtrami: poprzedni = wiersz wyżej,
 * następny = wiersz niżej. Liczeni z porządku, nie z numeru wiersza — klient,
 * który do widoku już nie pasuje (np. lead zarchiwizowano, gdy karta była
 * otwarta), dostaje sąsiadów z miejsca, w którym by stał. `pozycja` (od 1)
 * tylko wtedy, gdy klient na tej liście jest.
 *
 * @template {{ id?: string, created_at?: string | null, archiwum?: boolean, zrodlo?: { klucz?: string } | null }} T
 * @param {T[] | null | undefined} wiersze  WYŁĄCZNIE klienci widoczni dla użytkownika
 * @param {T} biezacy
 * @param {{ archiwum?: boolean, zrodlo?: string | null }} filtry
 * @returns {{ poprzedni: T | null, nastepny: T | null, pozycja: number | null, razem: number }}
 */
export function sasiedzi(wiersze, biezacy, filtry) {
  const lista = listaWidoku(wiersze, filtry);
  const indeks = lista.findIndex((w) => w.id === biezacy.id);
  /** @type {T | null} */ let poprzedni = null;
  /** @type {T | null} */ let nastepny = null;
  for (const w of lista) {
    if (w.id === biezacy.id) continue;
    if (porownajKlientow(w, biezacy) < 0) poprzedni = w;
    else { nastepny = w; break; }
  }
  return { poprzedni, nastepny, pozycja: indeks >= 0 ? indeks + 1 : null, razem: lista.length };
}
