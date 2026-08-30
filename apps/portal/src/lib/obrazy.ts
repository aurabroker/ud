import type { ImageMetadata } from 'astro';

/**
 * Zdjęcie kategorii zawodowej.
 *
 * Jedno zdjęcie na kategorię, nazwane jej slugiem — tym samym, który stoi
 * w adresie `/zawody/<slug>/`. Wcześniej zdjęcie wisiało przy każdym zawodzie
 * z osobna, a strona kategorii brała je od pierwszego zawodu alfabetycznie.
 * Dlatego Budownictwo ilustrował biurowiec (Architekt), Transport — też
 * biurowiec (Agent Celny), a dwóch prawników i informatyk dostali zdjęcie
 * mężczyzny z niemowlęciem. Powiązanie ze slugiem kategorii wyklucza taką
 * pomyłkę: nazwa pliku jest tym samym, co adres strony.
 */
const PLIKI = import.meta.glob<{ default: ImageMetadata }>(
  '../obrazy/kategorie/*.jpg',
  { eager: true },
);

/** `null`, gdy zdjęcia jeszcze nie ma — szablon po prostu go nie renderuje. */
export function obrazKategorii(slugKategorii: string): ImageMetadata | null {
  return PLIKI[`../obrazy/kategorie/${slugKategorii}.jpg`]?.default ?? null;
}

export const opisKategorii = (kategoria: string) =>
  `Zdjęcie ilustracyjne — ${kategoria.toLowerCase()}`;
