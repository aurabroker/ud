/**
 * zus.ts — zasiłek chorobowy z ZUS, z którym porównujemy polisę.
 *
 * Do 21.10.2026 serwis pokazywał wszędzie „2 240 zł". To była płaca
 * minimalna z 2021 roku (2 800 zł), którą stary Calculator.js wypisywał jako
 * kwotę zasiłku, a portal pomnożył jeszcze raz przez 0,8. Błąd siedział na
 * 191 stronach zawodów, w ich plikach .md i llms.txt oraz w dwóch blokach FAQ
 * w danych strukturalnych — czyli dokładnie tam, skąd cytują modele językowe.
 *
 * Model (decyzja właściciela z 21.10.2026): przedsiębiorca na „dużym ZUS-ie"
 * z najniższą podstawą i z dobrowolnym ubezpieczeniem chorobowym. To
 * najczęstszy przypadek u klientów serwisu, a wariant z chorobowym — więc
 * porównanie nie jest ustawione pod polisę. Obok stoją dwie dopiski:
 * preferencyjny ZUS i brak chorobowego, bo dla części czytelników to one są
 * prawdą.
 *
 * Liczby zmieniają się co roku (płaca minimalna, prognoza przeciętnego
 * wynagrodzenia). `test/zus.spec.js` wywala się, gdy `ROK` jest starszy niż
 * bieżący. To test, a nie bramka w buildzie: zatrzymany build blokowałby
 * w styczniu każde inne wdrożenie, zanim ktoś zdąży sprawdzić nowe kwoty.
 */

/** Rok, dla którego policzone są kwoty. */
export const ROK = 2026;

/** Płaca minimalna w 2026 r. */
export const PLACA_MINIMALNA = 4806;

/** Prognozowane przeciętne wynagrodzenie na 2026 r. — podstawa „dużego ZUS-u". */
export const PRZECIETNE_PROGNOZA = 9420;

/**
 * Najniższe podstawy wymiaru składek przedsiębiorcy w 2026 r.:
 * standardowa = 60% prognozowanego przeciętnego wynagrodzenia,
 * preferencyjna (pierwsze 24 miesiące działalności) = 30% płacy minimalnej.
 */
export const PODSTAWA = {
  standardowa: 5652.0,
  preferencyjna: 1441.8,
} as const;

/** Od podstawy osoby niebędącej pracownikiem odlicza się 13,71% (art. 48 ustawy zasiłkowej). */
export const ODLICZENIE_SKLADEK = 0.1371;

/** Zasiłek chorobowy: 80% podstawy wymiaru zasiłku. */
export const STOPA_ZASILKU = 0.8;

/**
 * Dobrowolne chorobowe daje zasiłek po 90 dniach nieprzerwanego ubezpieczenia
 * (art. 4 ust. 1 pkt 2 ustawy zasiłkowej); wlicza się wcześniejsze okresy
 * ubezpieczenia chorobowego, np. z etatu, jeśli przerwa nie przekroczyła 30 dni
 * (art. 4 ust. 2).
 */
export const WYCZEKIWANIE_DOBROWOLNE_DNI = 90;

/** Najdłuższy okres zasiłkowy (poza gruźlicą i ciążą). */
export const OKRES_ZASILKOWY_DNI = 182;

/** Miesięczny zasiłek chorobowy brutto od danej podstawy, zaokrąglony do złotego. */
export function zasilek(podstawa: number): number {
  return Math.round(podstawa * (1 - ODLICZENIE_SKLADEK) * STOPA_ZASILKU);
}

/** Zasiłek przedsiębiorcy w trzech wariantach — 3 902 / 995 / 0 zł w 2026 r. */
export const ZASILEK_JDG = {
  duzy: zasilek(PODSTAWA.standardowa),
  preferencyjny: zasilek(PODSTAWA.preferencyjna),
  bezChorobowego: 0,
} as const;

const zl = (kwota: number) =>
  new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2, useGrouping: 'always' }).format(kwota) + ' zł';

/**
 * Zdania o ZUS-ie — jedno źródło dla kalkulatora, stron i plików llms.txt,
 * jak `OPIS_KALIBRACJI` w symulacja.ts. Poprawka w jednym miejscu idzie
 * wszędzie; przepisana kopia rozjechałaby się przy pierwszej zmianie kwot.
 */
export const ZUS_TEKST = {
  /** Kogo dotyczy kwota `ZASILEK_JDG.duzy`. */
  scenariusz: `przy dużym ZUS-ie z najniższej podstawy (${zl(PODSTAWA.standardowa)}) `
    + `i dobrowolnym chorobowym opłacanym od co najmniej ${WYCZEKIWANIE_DOBROWOLNE_DNI} dni`,
  /** Dopiska z pozostałymi dwoma wariantami. */
  dopiski: `na preferencyjnym ZUS-ie około ${zl(ZASILEK_JDG.preferencyjny)}, `
    + `bez chorobowego ${zl(ZASILEK_JDG.bezChorobowego)}`,
  /** Jak się go liczy. */
  wzor: '80% podstawy wymiaru składek po odliczeniu 13,71%',
  /** Zasiłek to kwota przed podatkiem — dochód w kalkulatorze jest netto. */
  brutto: 'Zasiłek to kwota przed podatkiem dochodowym.',
  /** Etat — opisem, bez kwot (decyzja właściciela z 21.10.2026: kalkulator tylko B2B). */
  etat: `Na umowie o pracę ZUS wypłaca co najmniej 80% pensji przez ${OKRES_ZASILKOWY_DNI} dni. `
    + 'Polisa chroni dochód przy dłuższej niezdolności.',
} as const;
