import type { ImageMetadata } from 'astro';

/**
 * Zdjęcia ilustracyjne: własne dla zawodu, wspólne dla kategorii.
 *
 * Zawód bierze swoje zdjęcie, jeśli je ma, a w przeciwnym razie zdjęcie swojej
 * kategorii. Dzięki temu zestaw można uzupełniać zawód po zawodzie, bez etapu,
 * w którym część podstron stoi pusta.
 *
 * W obie strony obowiązuje jedna zasada: **nazwa pliku to slug adresu**, który
 * ma go pokazać — `<slug-zawodu>.jpg` dla `/<slug>/`, `<slug-kategorii>.jpg`
 * dla `/zawody/<slug>/`. Wcześniej zdjęcie było polem w danych zawodu, a strona
 * kategorii brała je od pierwszego zawodu alfabetycznie: Budownictwo
 * ilustrował biurowiec (bo Architekt), a dwóch prawników i informatyk dostali
 * zdjęcie mężczyzny z niemowlęciem. Powiązanie nazwy pliku z adresem sprawia,
 * że taka pomyłka jest niewyrażalna.
 */
const KATEGORIE = import.meta.glob<{ default: ImageMetadata }>(
  '../obrazy/kategorie/*.jpg',
  { eager: true },
);

const ZAWODY = import.meta.glob<{ default: ImageMetadata }>(
  '../obrazy/zawody/*.jpg',
  { eager: true },
);

/** `null`, gdy zdjęcia nie ma — szablon po prostu nie renderuje pasa. */
export function obrazKategorii(slugKategorii: string): ImageMetadata | null {
  return KATEGORIE[`../obrazy/kategorie/${slugKategorii}.jpg`]?.default ?? null;
}

export function obrazZawodu(slugZawodu: string): ImageMetadata | null {
  return ZAWODY[`../obrazy/zawody/${slugZawodu}.jpg`]?.default ?? null;
}

/**
 * Zdjęcie podstrony zawodu wraz z opisem alternatywnym. Opis idzie za tym,
 * co widać: własne zdjęcie opisujemy zawodem, odziedziczone — branżą.
 */
export function zdjecieZawodu(
  slugZawodu: string,
  nazwaZawodu: string,
  slugKategorii: string,
  nazwaKategorii: string,
): { obraz: ImageMetadata; opis: string } | null {
  const wlasne = obrazZawodu(slugZawodu);
  if (wlasne) return { obraz: wlasne, opis: opisIlustracji(nazwaZawodu) };

  const kategoria = obrazKategorii(slugKategorii);
  return kategoria ? { obraz: kategoria, opis: opisIlustracji(nazwaKategorii) } : null;
}

export const opisIlustracji = (co: string) => `Zdjęcie ilustracyjne — ${co.toLowerCase()}`;

/** @deprecated Nazwa z czasów, gdy zdjęcia były wyłącznie kategorii. */
export const opisKategorii = opisIlustracji;
