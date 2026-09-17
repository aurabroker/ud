/**
 * symulacja.ts — szacowanie składki.
 *
 * WAŻNE, i to musi zostać w kodzie, nie tylko w rozmowie: to jest SYMULACJA,
 * nie oferta i nie stawka z tabeli ubezpieczyciela. Realną składkę wylicza
 * system ubezpieczyciela po ocenie ryzyka. Każde miejsce, które pokazuje wynik
 * tej funkcji, musi to napisać wprost — inaczej wchodzimy w spór z ustawą
 * o dystrybucji ubezpieczeń, która zakazuje przedstawiania szacunku jak oferty.
 *
 * Kształt wzoru pochodzi z Calculator.js starego serwisu. Stawka — nie:
 * tamta (1,5%) nie była niczym poparta i leżała poniżej najtańszej oferty,
 * jaką realnie wystawiliśmy. Liczby w `kalibracja.json` są policzone na
 * ofertach z `ud_offer_documents`; metoda, dane źródłowe i to, czego z nich
 * policzyć się NIE da (klasa ryzyka, wiek, okresy 48 i 60 miesięcy) —
 * w MODEL-SKLADKI.md.
 */
import kalibracja from './kalibracja.json';

/** Najniższa podstawa wymiaru składek ZUS — z niej liczy się zasiłek na B2B. */
export const ZUS_MIESIECZNIE = 2800;

/** Maksymalny udział dochodu, jaki obejmuje polisa. */
export const LIMIT = {
  b2b: 0.8,
  etat: 0.65,
} as const;

export type Zatrudnienie = keyof typeof LIMIT;

/**
 * Stawka miesięczna jako udział świadczenia, wariant 24-miesięczny.
 *
 * `dol` i `gora` to najtańsza i najdroższa zaobserwowana oferta, nie margines
 * dopisany na oko. Rozrzut jest prawdziwy: składka zależy od wieku, klasy
 * ryzyka i karencji, o które kalkulator nie pyta — więc jedna liczba udawałaby
 * precyzję, której tu nie ma.
 */
export const STAWKA = kalibracja.stawka;

/** Ile ofert stoi za tymi stawkami — do podpisu pod kwotą. */
export const KALIBRACJA = { ...kalibracja.zrodlo, policzono: kalibracja.policzono };

/**
 * Klauzula HIV/WZW podnosi stawkę o 20%.
 *
 * To jedyna liczba w tym pliku, której nie potwierdzają dane: relacja
 * 1,8% / 1,5% pochodzi ze starego Calculator.js, a w ofertach z bazy klauzuli
 * nie ma wcale. Zostaje do czasu sprawdzenia w tabeli.
 */
export const MNOZNIK_HIV_WZW = 1.2;

/**
 * Okresy wypłaty świadczenia dostępne w ofercie, w miesiącach.
 *
 * Kalkulator miał tu przełącznik „Wypłata przez 24 miesiące zamiast 12"
 * z dopłatą 10% i stał domyślnie na 12. Wariantu 12-miesięcznego nie ma
 * w ofercie — najkrótszy jest 24-miesięczny — więc przełącznik proponował
 * okres, którego nikt nie może kupić.
 *
 * Symulacja liczy dla najkrótszego okresu i pisze to wprost. Mnożnik dla
 * 36 miesięcy jest policzony (1,25, sześć par ofert), ale dla 48 i 60 nie ma
 * ani jednej obserwacji — dopóki ich nie będzie, wybór okresu w kalkulatorze
 * oznaczałby cenę wariantu 24-miesięcznego pod etykietą 60-miesięcznego.
 * Stąd lista jest informacją, nie przełącznikiem.
 */
export const OKRESY = [24, 36, 48, 60] as const;

/** Najkrótszy okres z oferty — dla niego liczona jest symulacja. */
export const MIESIECY_WYPLATY = OKRESY[0];

/** Mnożniki stawki dla okresów, które udało się policzyć z ofert. */
export const MNOZNIK_OKRESU: Record<number, number> = kalibracja.okresy;

export interface Zalozenia {
  /** Miesięczny dochód netto w złotych. */
  dochod: number;
  zatrudnienie: Zatrudnienie;
  /** Klauzula HIV/WZW podnosi stawkę. */
  hivWzw?: boolean;
}

export interface Wynik {
  /** Miesięczna suma świadczenia z polisy. */
  swiadczenie: number;
  /** Środek przedziału — tam, gdzie musi paść jedna liczba. */
  skladka: number;
  /** Składka przy stawce z najtańszej zaobserwowanej oferty. */
  skladkaOd: number;
  /** Składka przy stawce z najdroższej zaobserwowanej oferty. */
  skladkaDo: number;
  /** Zasiłek ZUS przy najniższej podstawie. */
  zus: number;
  /** Ile realnie brakuje bez polisy. */
  luka: number;
  limit: number;
}

export function symuluj({ dochod, zatrudnienie, hivWzw = false }: Zalozenia): Wynik {
  const limit = LIMIT[zatrudnienie];
  const swiadczenie = Math.round(dochod * limit);
  const klauzula = hivWzw ? MNOZNIK_HIV_WZW : 1;
  const skladka = (stawka: number) => Math.round(swiadczenie * stawka * klauzula);

  return {
    swiadczenie,
    skladka: skladka(STAWKA.srodek),
    skladkaOd: skladka(STAWKA.dol),
    skladkaDo: skladka(STAWKA.gora),
    zus: Math.round(ZUS_MIESIECZNIE * 0.8),
    luka: Math.max(0, dochod - ZUS_MIESIECZNIE * 0.8),
    limit,
  };
}

/**
 * Formatowanie kwot — spacja jako separator tysięcy, tak jak w polskiej normie.
 *
 * useGrouping: 'always' jest tu konieczne. Domyślne 'auto' nie grupuje liczb
 * czterocyfrowych, więc obok „14 400 zł" stawało „2240 zł" — w jednej tabeli,
 * jedno pod drugim.
 */
const liczba = (kwota: number) =>
  new Intl.NumberFormat('pl-PL', {
    maximumFractionDigits: 0,
    useGrouping: 'always',
  }).format(kwota);

export function zl(kwota: number): string {
  return liczba(kwota) + ' zł';
}

/** „291–351 zł" — jedno „zł" na koniec, półpauza bez spacji, jak w zakresach liczb. */
export function zlZakres(od: number, do_: number): string {
  return od === do_ ? zl(od) : `${liczba(od)}–${liczba(do_)} zł`;
}
