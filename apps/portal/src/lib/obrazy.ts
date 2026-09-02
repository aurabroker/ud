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
  '../obrazy/kategorie/*.{jpg,jpeg,png,webp}',
  { eager: true },
);

const ZAWODY = import.meta.glob<{ default: ImageMetadata }>(
  '../obrazy/zawody/*.{jpg,jpeg,png,webp}',
  { eager: true },
);

/**
 * Rozszerzenie pliku nie ma znaczenia — liczy się nazwa. Zestaw zdjęć powstaje
 * w różnych narzędziach, jedne oddają JPEG, inne PNG, i wymuszanie konwersji
 * przed wrzuceniem do repo kończyłoby się plikiem, którego strona nie widzi.
 * Build i tak serwuje WebP niezależnie od formatu źródła.
 */
const ROZSZERZENIA = ['jpg', 'jpeg', 'png', 'webp'];

function znajdz(
  zbior: Record<string, { default: ImageMetadata }>,
  katalog: string,
  slug: string,
): ImageMetadata | null {
  for (const rozszerzenie of ROZSZERZENIA) {
    const trafienie = zbior[`../obrazy/${katalog}/${slug}.${rozszerzenie}`];
    if (trafienie) return trafienie.default;
  }
  return null;
}

/** `null`, gdy zdjęcia nie ma — szablon po prostu nie renderuje pasa. */
export function obrazKategorii(slugKategorii: string): ImageMetadata | null {
  return znajdz(KATEGORIE, 'kategorie', slugKategorii);
}

export function obrazZawodu(slugZawodu: string): ImageMetadata | null {
  return znajdz(ZAWODY, 'zawody', slugZawodu);
}

/**
 * Zdjęcie nagłówka strony głównej: `src/obrazy/hero.<ext>`.
 *
 * Osobny plik, a nie pożyczone zdjęcie kategorii — strona główna obsługuje
 * 188 zawodów, więc jeden gabinet lekarski na wejściu zawęża ofertę do jednej
 * branży. Póki pliku nie ma, nagłówek zostaje na samym gradiencie.
 */
const HERO = import.meta.glob<{ default: ImageMetadata }>(
  '../obrazy/hero.{jpg,jpeg,png,webp}',
  { eager: true },
);

export function obrazHero(): ImageMetadata | null {
  for (const rozszerzenie of ROZSZERZENIA) {
    const trafienie = HERO[`../obrazy/hero.${rozszerzenie}`];
    if (trafienie) return trafienie.default;
  }
  return null;
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
