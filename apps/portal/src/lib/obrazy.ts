/**
 * obrazy.ts — zdjęcia kategorii zawodowych.
 *
 * Leżały w `public/`, skąd Astro kopiuje pliki bez zmian: pełne JPEG-i,
 * największy 553 kB. Były przy tym używane wyłącznie jako obrazek Open Graph
 * — na żadnej stronie serwisu nie renderował się ani jeden `<img>`.
 *
 * Po przeniesieniu do `src/` przechodzą przez sharpa: WebP i AVIF w kilku
 * szerokościach, z wymiarami w atrybutach, więc układ strony nie skacze
 * w trakcie wczytywania.
 */
import type { ImageMetadata } from 'astro';

const PLIKI = import.meta.glob<{ default: ImageMetadata }>(
  '../obrazy/kategorie/*.jpg',
  { eager: true },
);

/** Zdjęcie po nazwie pliku z zawody.json, np. „medycyna.jpg". */
export function obrazKategorii(nazwa: string): ImageMetadata | null {
  return PLIKI[`../obrazy/kategorie/${nazwa}`]?.default ?? null;
}

/**
 * Opis zdjęcia. Fotografie są ilustracyjne — pokazują scenerię branży,
 * a nie konkretną osobę — więc opis mówi, co widać, i nie udaje, że to
 * zdjęcie klienta.
 */
export const opisKategorii = (kategoria: string) =>
  `Zdjęcie ilustracyjne — ${kategoria.toLowerCase()}`;
