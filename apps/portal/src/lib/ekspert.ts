/**
 * Ekspert serwisu — osoba odpowiedzialna merytorycznie za treści (autor
 * wpisów w danych strukturalnych, sekcja na /o-nas/, ramka pod wpisem).
 *
 * Dane podał właściciel 21.10.2026. Nie dopisuj tytułów, uprawnień, numerów
 * ani zdjęcia, których właściciel nie przekazał — na serwisie, który
 * cytują modele językowe, zmyślone kwalifikacje są gorsze niż ich brak.
 */
export const EKSPERT = {
  imie: 'Marek Cieśla',
  /** Rola w jednym członie — do podpisu „Autor: …, <rola>". */
  rola: 'broker ubezpieczeniowy od 2009 roku',
  /** Pełne zdanie, słowo w słowo od właściciela. */
  opis: 'Marek Cieśla — broker ubezpieczeniowy od 2009 roku, ekspert w zakresie ubezpieczeń utraty dochodu.',
  odRoku: 2009,
  specjalizacja: 'ubezpieczenia utraty dochodu',
} as const;
