/**
 * tresc.js — dostęp do treści redakcyjnej podstron zawodów.
 *
 * Treść leży osobno od zawody.json, bo to dwie różne rzeczy: tam są dane
 * (slug, kategoria, odmiana, kwoty), tu teksty pisane ręcznie dla każdego
 * zawodu z osobna. Rozdzielenie oznacza, że dane da się przeliczyć skryptem,
 * a treści nikt przypadkiem nie nadpisze generatorem.
 *
 * Zawód bez wpisanej treści dostaje null i szablon renderuje wersję ogólną.
 * To celowe: 188 tekstów nie powstaje jednego dnia, a strona ma działać
 * w trakcie ich dopisywania.
 */
import tresci from '../data/tresci.json' with { type: 'json' };

/** @typedef {typeof tresci[string]} Tresc */

export const TRESCI = tresci;

/** Treść redakcyjna dla zawodu albo null, jeśli jeszcze nie napisana. */
export function tresc(slug) {
  return tresci[slug] ?? null;
}

/** Ile zawodów ma już własną treść. */
export function pokrycieTresci(slugi) {
  const napisane = slugi.filter((s) => tresci[s]);
  return { napisane: napisane.length, wszystkie: slugi.length, brakujace: slugi.filter((s) => !tresci[s]) };
}
