/**
 * jezyki.ts — wersje językowe portalu.
 *
 * Serwis jest polski, a część stron ma odpowiednik po ukraińsku pod `/uk/`.
 * Kod języka to „uk" (ISO 639-1); „ua" jest kodem kraju i jako `lang` albo
 * `hreflang` jest błędny — wyszukiwarka takiego znacznika nie rozumie.
 *
 * Wersja ukraińska to podkatalog, nie osobna domena: klienci prowadzą firmy
 * w Polsce, a końcówka `.ua` kierowałaby wyszukiwarkę na Ukrainę i zaczynała
 * od zera, bez dorobku domeny głównej.
 *
 * ── Para to dwie strony o TEJ SAMEJ treści ───────────────────────────────
 *
 * `hreflang` mówi wyszukiwarce „to jest ta sama strona w innym języku". Dlatego
 * w `PARY` stoją wyłącznie strony przetłumaczone w całości. `/uk/wniosek/` tu
 * nie ma: to przewodnik po polskim formularzu, a nie jego przekład — formularz
 * ze zgodami i ankietą medyczną zostaje po polsku (patrz CLAUDE.md, „Wersja
 * ukraińska").
 */
import { ZAWODY_UK } from '../dane/uk/zawody';

export type Jezyk = 'pl' | 'uk';

/** Prefiks adresów wersji ukraińskiej. */
export const PREFIKS_UK = '/uk';

/** Strona główna danej wersji językowej. */
export const GLOWNA: Record<Jezyk, string> = { pl: '/', uk: `${PREFIKS_UK}/` };

/** Ścieżka polska → ścieżka ukraińska. Jedyne miejsce, w którym stoi ta lista. */
export const PARY: Record<string, string> = {
  '/': `${PREFIKS_UK}/`,
  '/jak-to-dziala/': `${PREFIKS_UK}/jak-to-dziala/`,
  '/wylaczenia/': `${PREFIKS_UK}/wylaczenia/`,
  ...Object.fromEntries(ZAWODY_UK.map((z) => [`/${z.slug}/`, `${PREFIKS_UK}/${z.slug}/`])),
};

const ODWROTNE: Record<string, string> = Object.fromEntries(
  Object.entries(PARY).map(([pl, uk]) => [uk, pl]),
);

/** Ta sama strona w drugim języku albo `null`, gdy przekładu nie ma. */
export function odpowiednik(sciezka: string, jezyk: Jezyk): string | null {
  return (jezyk === 'pl' ? PARY[sciezka] : ODWROTNE[sciezka]) ?? null;
}

/**
 * Komplet odnośników `hreflang` dla strony albo pusta lista, gdy strona nie ma
 * pary. Każda strona z pary wymienia obie wersje i siebie samą — bez wzajemności
 * Google ignoruje cały zestaw. `x-default` wskazuje wersję polską: to ona ma
 * komplet podstron i ją powinien dostać ktoś, kto nie pasuje do żadnego języka.
 */
export function hreflangi(sciezka: string, jezyk: Jezyk): { hreflang: string; sciezka: string }[] {
  const druga = odpowiednik(sciezka, jezyk);
  if (!druga) return [];
  const pl = jezyk === 'pl' ? sciezka : druga;
  const uk = jezyk === 'uk' ? sciezka : druga;
  return [
    { hreflang: 'pl', sciezka: pl },
    { hreflang: 'uk', sciezka: uk },
    { hreflang: 'x-default', sciezka: pl },
  ];
}
