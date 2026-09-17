/**
 * symulacja.ts — wzór z Calculator.js starego serwisu, przeniesiony bez zmian.
 *
 * WAŻNE, i to musi zostać w kodzie, nie tylko w rozmowie: to jest SYMULACJA,
 * nie oferta i nie stawka z tabeli ubezpieczyciela. Realną składkę wylicza
 * system ubezpieczyciela po ocenie ryzyka. Każde miejsce, które pokazuje wynik
 * tej funkcji, musi to napisać wprost — inaczej wchodzimy w spór z ustawą
 * o dystrybucji ubezpieczeń, która zakazuje przedstawiania szacunku jak oferty.
 */

/** Najniższa podstawa wymiaru składek ZUS — z niej liczy się zasiłek na B2B. */
export const ZUS_MIESIECZNIE = 2800;

/** Maksymalny udział dochodu, jaki obejmuje polisa. */
export const LIMIT = {
  b2b: 0.8,
  etat: 0.65,
} as const;

export type Zatrudnienie = keyof typeof LIMIT;

/**
 * Okresy wypłaty świadczenia dostępne w ofercie, w miesiącach.
 *
 * Kalkulator miał tu przełącznik „Wypłata przez 24 miesiące zamiast 12"
 * z dopłatą 10% i stał domyślnie na 12. Wariantu 12-miesięcznego nie ma
 * w ofercie — najkrótszy jest 24-miesięczny — więc przełącznik proponował
 * okres, którego nikt nie może kupić.
 *
 * Symulacja liczy dla najkrótszego okresu i pisze to wprost. Dłuższe warianty
 * są droższe, ale współczynników z tabeli ubezpieczyciela jeszcze nie mamy;
 * dopóki ich nie ma, wybór okresu w kalkulatorze byłby obietnicą ceny,
 * której nikt nie policzył. Stąd lista jest informacją, nie przełącznikiem.
 *
 * Gdy współczynniki się pojawią: wracają tu jako mapa okres → mnożnik stawki,
 * a `symuluj()` bierze `okres` w założeniach. Stawka bazowa (1,5%, z klauzulą
 * HIV/WZW 1,8%) odnosi się wtedy do wariantu 24-miesięcznego.
 */
export const OKRESY = [24, 36, 48, 60] as const;

/** Najkrótszy okres z oferty — dla niego liczona jest symulacja. */
export const MIESIECY_WYPLATY = OKRESY[0];

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
  /** Szacowana miesięczna składka. */
  skladka: number;
  /** Zasiłek ZUS przy najniższej podstawie. */
  zus: number;
  /** Ile realnie brakuje bez polisy. */
  luka: number;
  limit: number;
}

export function symuluj({ dochod, zatrudnienie, hivWzw = false }: Zalozenia): Wynik {
  const limit = LIMIT[zatrudnienie];
  const swiadczenie = Math.round(dochod * limit);

  const stawka = hivWzw ? 0.018 : 0.015;

  const zus = Math.round(ZUS_MIESIECZNIE * 0.8);

  return {
    swiadczenie,
    skladka: Math.round(swiadczenie * stawka),
    zus,
    luka: Math.max(0, dochod - zus),
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
export function zl(kwota: number): string {
  return new Intl.NumberFormat('pl-PL', {
    maximumFractionDigits: 0,
    useGrouping: 'always',
  }).format(kwota) + ' zł';
}
