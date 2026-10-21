/**
 * Dane spółki — jedno miejsce, z którego bierze je stopka, klauzula RODO,
 * schema.org i informacja o dystrybutorze. Wpisane z odpisu KRS.
 */

/**
 * Coverholderzy Lloyd’s, z których warunków składamy ofertę.
 *
 * To NIE są ubezpieczyciele. OWU LW044 § 1 ust. 3: „Leadenhall Insurance S.A.
 * działa w Polsce jako Lloyd’s coverholder i jest przedstawicielem
 * Ubezpieczyciela w sprawach związanych z zawarciem i wykonaniem Umowy
 * ubezpieczenia". OWU CEU § 1: „CEU posiada uprawnienia coverholdera Lloyd’s
 * i działa w oparciu o pełnomocnictwo określonego w Polisie Ubezpieczyciela".
 * Do 21.10.2026 serwis nazywał ich ubezpieczycielami — także w klauzuli RODO.
 *
 * Klucz odpowiada kolumnie `insurer_type` w ud_owu_library — dzięki temu
 * strona dokumentów nie musi trzymać własnej mapy nazw. Nazwa prawna jest
 * tu raz i tylko raz: wcześniej żyła w trzech miejscach i zdążyła się
 * rozjechać.
 */
const COVERHOLDERZY_WG = {
  leadenhall: 'Leadenhall Insurance S.A.',
  ceu: 'CEU sp. z o.o.',
} as const;

export const FIRMA = {
  nazwa: 'Aura Expert sp. z o.o.',
  nazwaPelna: 'Aura Expert spółka z ograniczoną odpowiedzialnością',
  marka: 'UtrataDochodu.pl',

  adres: {
    ulica: 'ul. Bolkowska 2A lok. 28',
    kod: '01-466',
    miasto: 'Warszawa',
    kraj: 'PL',
  },

  krs: '0000599840',
  nip: '5242793544',
  sad: 'Sąd Rejonowy dla m.st. Warszawy, XII Wydział Gospodarczy Krajowego Rejestru Sądowego',
  regon: '363673048',
  kapital: '5 000 zł',

  /** Numer wpisu do Rejestru Pośredników Ubezpieczeniowych KNF. */
  rpu: '11229690/A',
  rejestrUrl: 'https://rpu.knf.gov.pl/',

  telefon: '+48504400901',
  telefonWyswietlany: '504 400 901',
  email: 'biuro@utratadochodu.com',

  /**
   * Ubezpieczyciel — zakład ubezpieczeń, który udziela ochrony we wszystkich
   * produktach z oferty, Leadenhall i CEU. Skąd to wiadomo (sprawdzone
   * 21.10.2026 na plikach z /dokumenty/):
   *
   * - karty produktu (IPID) Leadenhall LW044, LW046, LW047 i CEU —
   *   „Przedsiębiorstwo: Lloyd’s Insurance Company S.A., … Bruksela, Belgia",
   * - OWU CEU Utrata dochodu § 1 — umowa „z określonym w Polisie Lloyd’s
   *   Insurance Company SA, zwanym dalej »Ubezpieczycielem«",
   * - OWU LW044 § 15 pkt 19 — „Ubezpieczyciel określony jest w pozycji 1
   *   Polisy", a pozycja 1 polisy Leadenhall brzmi „Ochrona ubezpieczeniowa
   *   w ramach polisy udzielana jest przez Lloyd's Insurance Company S.A."
   *   (fragment polisy w apps/panel/scripts/test-leady-model.mjs).
   */
  ubezpieczyciel: 'Lloyd’s Insurance Company S.A.',
  ubezpieczycielSiedziba: 'Bruksela, Belgia',

  /** Przedstawiciele ubezpieczyciela (coverholderzy Lloyd’s) — patrz wyżej. */
  coverholderzyWg: COVERHOLDERZY_WG,

  /**
   * @deprecated Stara, BŁĘDNA nazwa: Leadenhall i CEU to coverholderzy, nie
   * ubezpieczyciele. Ta sama mapa co `coverholderzyWg`; zostaje, dopóki
   * importują ją pliki spoza pakietu poprawek z 21.10.2026. Nie używaj
   * w nowym kodzie.
   */
  ubezpieczycieleWg: COVERHOLDERZY_WG,
} as const;

/** Nazwy coverholderów do użycia w zdaniach: „Leadenhall Insurance S.A. oraz CEU sp. z o.o.". */
export const COVERHOLDERZY: readonly string[] = Object.values(FIRMA.coverholderzyWg);

/**
 * @deprecated Stara, BŁĘDNA nazwa — lista zawiera coverholderów, nie
 * ubezpieczycieli. Zostaje jako alias `COVERHOLDERZY`, dopóki importują ją
 * strony spoza pakietu poprawek z 21.10.2026 (`jak-to-dziala`, `llms.txt`).
 * Nie używaj w nowym kodzie, a w zdaniu nie nazywaj tej listy ubezpieczycielami.
 */
export const UBEZPIECZYCIELE = COVERHOLDERZY;

/**
 * Kto jest kim — jedno zdanie do stron, które muszą to powiedzieć wprost
 * (o nas, dokumenty, llms.txt). Brzmienie ról idzie za OWU: coverholder jest
 * „przedstawicielem Ubezpieczyciela w sprawach związanych z zawarciem
 * i wykonaniem Umowy ubezpieczenia" (LW044 § 1 ust. 3).
 */
export const OPIS_PODMIOTOW =
  `Ubezpieczycielem jest ${FIRMA.ubezpieczyciel} z siedzibą w Brukseli; `
  + `${COVERHOLDERZY.join(' i ')} to coverholderzy Lloyd’s, czyli przedstawiciele `
  + 'ubezpieczyciela w sprawach zawarcia i wykonania umowy; '
  + `${FIRMA.nazwa} jest agentem ubezpieczeniowym wpisanym do Rejestru Pośredników `
  + `Ubezpieczeniowych KNF pod numerem ${FIRMA.rpu}.`;

export const SERWIS = {
  url: 'https://utratadochodu.pl',
  nazwa: 'UtrataDochodu.pl',
  jezyk: 'pl-PL',
} as const;
