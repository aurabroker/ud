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

export interface Zalozenia {
  /** Miesięczny dochód netto w złotych. */
  dochod: number;
  zatrudnienie: Zatrudnienie;
  /** Klauzula HIV/WZW podnosi stawkę. */
  hivWzw?: boolean;
  /** Wariant 24-miesięczny jest o 10% droższy niż 12-miesięczny. */
  miesiecy?: 12 | 24;
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

export function symuluj({ dochod, zatrudnienie, hivWzw = false, miesiecy = 12 }: Zalozenia): Wynik {
  const limit = LIMIT[zatrudnienie];
  const swiadczenie = Math.round(dochod * limit);

  let stawka = hivWzw ? 0.018 : 0.015;
  if (miesiecy === 24) stawka *= 1.1;

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
