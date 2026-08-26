/**
 * @ud/zawody — jedno źródło prawdy o zawodach obsługiwanych przez serwis.
 *
 * Dane leżą w data/zawody.json i są tam kompletne: nazwa, kategoria, ryzyka
 * zawodowe, wysokość świadczenia i pełna odmiana. Portal buduje z tego 228
 * podstron, nie generując niczego w locie.
 */
import wszystkie from '../data/zawody.json' with { type: 'json' };

export { odmien, odmiana, rodzaj, FORMY, MESKI, ZENSKI } from './odmiana.js';
export { TRESCI, tresc, pokrycieTresci } from './tresc.js';

/** @typedef {typeof wszystkie[number]} Zawod */

/**
 * Zawody, dla których serwis ma podstronę.
 *
 * Rekordy wycofane zostają w pliku, a nie są z niego kasowane — inaczej nie
 * dałoby się wygenerować przekierowań, a każdy usunięty adres zwracałby 404
 * i kasował pozycję wypracowaną przez tę podstronę.
 */
export const ZAWODY = wszystkie.filter((z) => !z.wycofany);

/** Zawody wycofane z serwisu — wyłącznie do przekierowań. */
export const WYCOFANE = wszystkie.filter((z) => z.wycofany);

/** Zawód po slugu adresu. */
export function zawod(slug) {
  return ZAWODY.find((z) => z.slug === slug) ?? null;
}

/** Wszystkie slugi — do generowania ścieżek statycznych. */
export function slugi() {
  return ZAWODY.map((z) => z.slug);
}

/** Nazwy kategorii w kolejności malejącej liczby zawodów. */
export function kategorie() {
  const licznik = new Map();
  for (const z of ZAWODY) licznik.set(z.kategoria, (licznik.get(z.kategoria) ?? 0) + 1);
  return [...licznik.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'))
    .map(([nazwa, liczba]) => ({ nazwa, liczba, slug: slugKategorii(nazwa) }));
}

/** Zawody z jednej kategorii, alfabetycznie. */
export function wKategorii(nazwa) {
  return ZAWODY
    .filter((z) => z.kategoria === nazwa)
    .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'));
}

/**
 * Zawody pokrewne — z tej samej kategorii, bez bieżącego.
 * Kolejność alfabetyczna, żeby linkowanie wewnętrzne było stabilne między
 * buildami: zmienny zestaw linków wygląda dla robota na manipulację.
 */
export function pokrewne(slug, ile = 8) {
  const z = zawod(slug);
  if (!z) return [];
  return wKategorii(z.kategoria).filter((i) => i.slug !== slug).slice(0, ile);
}

/** Slug kategorii do adresu — bez polskich znaków i spacji. */
export function slugKategorii(nazwa) {
  return nazwa
    .toLowerCase()
    .replaceAll('ą', 'a').replaceAll('ć', 'c').replaceAll('ę', 'e')
    .replaceAll('ł', 'l').replaceAll('ń', 'n').replaceAll('ó', 'o')
    .replaceAll('ś', 's').replaceAll('ź', 'z').replaceAll('ż', 'z')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Adresy, które zmieniły się względem starego serwisu i wymagają 301.
 * Bez tego link z indeksu Google trafia w 404, a razem z nim znika cała
 * wypracowana pozycja podstrony.
 */
export function przekierowania() {
  return [
    // Zmiana samego adresu — treść dalej istnieje.
    ...ZAWODY
      .filter((z) => z.staryAdres)
      .map((z) => ({ z: `/${z.staryAdres}/`, na: `/${z.slug}/` })),
    // Zawód wycofany — kierujemy na kategorię, czyli najbliższą sensowną stronę.
    ...WYCOFANE.map((z) => ({ z: `/${z.slug}/`, na: z.przekierowanieNa })),
  ];
}
