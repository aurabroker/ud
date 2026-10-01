/**
 * lejek.js — z liczb „ostatni zaliczony krok → ile szkiców" robi lejek wniosku.
 *
 * Czysta funkcja bez zależności od SvelteKit, żeby dało się ją sprawdzić
 * skryptem (scripts/test-lejek.mjs).
 */
import { KROKI } from '@ud/wniosek';

/**
 * Z liczb „ostatni zaliczony krok → ile szkiców" robi lejek: ile osób zaliczyło
 * dany krok albo dalszy. Liczymy tu, a nie z widoku, bo krok bez żadnego szkicu
 * nie ma w widoku wiersza, a lejek ma pokazać go jako zero, nie pominąć.
 */
export function lejek(wiersze) {
  const idKrokow = KROKI.map((k) => k.id);
  const tygodnie = new Map();
  for (const w of wiersze) {
    const t = tygodnie.get(w.tydzien) ?? { tydzien: w.tydzien, naKroku: Object.fromEntries(idKrokow.map((i) => [i, 0])) };
    if (w.ostatni_krok in t.naKroku) t.naKroku[w.ostatni_krok] += w.szkicow;
    tygodnie.set(w.tydzien, t);
  }

  const dojscie = (naKroku) => {
    // Zaliczył krok k = jego ostatni zaliczony krok to k albo któryś późniejszy.
    let suma = 0;
    const out = {};
    for (const id of [...idKrokow].reverse()) {
      suma += naKroku[id];
      out[id] = suma;
    }
    return out;
  };

  const rzedy = [...tygodnie.values()]
    .sort((a, b) => (a.tydzien < b.tydzien ? 1 : -1))
    .map((t) => ({ tydzien: t.tydzien, doszlo: dojscie(t.naKroku) }));

  const razem = Object.fromEntries(idKrokow.map((i) => [i, 0]));
  for (const r of rzedy) for (const i of idKrokow) razem[i] += r.doszlo[i];

  // Największy spadek między sąsiednimi krokami — tu jest wąskie gardło.
  let gardlo = null;
  for (let i = 1; i < idKrokow.length; i += 1) {
    const spadek = razem[idKrokow[i - 1]] - razem[idKrokow[i]];
    if (spadek > 0 && (!gardlo || spadek > gardlo.spadek)) {
      gardlo = { z: idKrokow[i - 1], do: idKrokow[i], spadek };
    }
  }
  return { kroki: KROKI.map((k) => ({ id: k.id, tytul: k.tytul })), rzedy, razem, gardlo };
}
