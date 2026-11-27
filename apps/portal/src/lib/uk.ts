/**
 * uk.ts — drobne stałe wspólne dla stron ukraińskich.
 */
import {
  ZASILEK_JDG, PODSTAWA, WYCZEKIWANIE_DOBROWOLNE_DNI, OKRES_ZASILKOWY_DNI,
  ODLICZENIE_SKLADEK, STOPA_ZASILKU,
} from './zus';
import { LIMIT, MIESIECY_WYPLATY, zl } from './symulacja';

const procent = (ulamek: number, miejsc = 0) =>
  (ulamek * 100).toFixed(miejsc).replace('.', ',') + '%';

/**
 * Zdania o ZUS-ie po ukraińsku — przekład `ZUS_TEKST` z `zus.ts`, pole w pole.
 *
 * Kwoty i liczby dni idą z tych samych stałych co po polsku, więc styczniowa
 * zmiana w `zus.ts` zmienia obie wersje naraz. Przekładu zdań to nie dotyczy:
 * poprawiasz zdanie w `ZUS_TEKST` — popraw jego odpowiednik tutaj
 * (`test/uk.spec.js` pilnuje, że oba obiekty mają te same pola).
 * „ZUS", „duży ZUS" i „umowa o pracę" zostają po polsku: pod tymi nazwami
 * czytelnik znajdzie je w ZUS-ie i u księgowej.
 */
export const ZUS_TEKST_UK = {
  scenariusz: `за повних внесків ZUS (duży ZUS) з найнижчої бази (${zl(PODSTAWA.standardowa)}) `
    + `і добровільного страхування на випадок хвороби, внески на яке сплачують щонайменше `
    + `${WYCZEKIWANIE_DOBROWOLNE_DNI} днів`,
  dopiski: `на пільговому ZUS (preferencyjny ZUS) — близько ${zl(ZASILEK_JDG.preferencyjny)}, `
    + `без страхування на випадок хвороби — ${zl(ZASILEK_JDG.bezChorobowego)}`,
  wzor: `${procent(STOPA_ZASILKU)} бази нарахування внесків після відрахування ${procent(ODLICZENIE_SKLADEK, 2)}`,
  brutto: 'Допомога ZUS — це сума до вирахування податку на доходи.',
  etat: `За трудовим договором (umowa o pracę) ZUS виплачує щонайменше 80% зарплати протягом `
    + `${OKRES_ZASILKOWY_DNI} днів. Поліс захищає дохід у разі тривалішої непрацездатності.`,
} as const;

/** Przekład `OPIS_KALIBRACJI` z `symulacja.ts` — skąd bierze się przedział składki. */
export const OPIS_KALIBRACJI_UK =
  'з пропозицій, виставлених за останні 12 місяців, у варіанті, порівнянному з калькулятором: '
  + `лише щомісячна виплата, виплата щонайдовше протягом ${MIESIECY_WYPLATY} місяців, `
  + 'період очікування до 21 дня, внесок частинами';

/** Przekład `LIMIT_CEU_ZDANIE` — w CEU „Utrata dochodu" niższy limit także na B2B. */
export const LIMIT_CEU_ZDANIE_UK = `У страхуванні CEU «Utrata dochodu» ліміт становить `
  + `${Math.round(LIMIT.ceu * 100)}% також для самозайнятих і контракту B2B.`;

/**
 * Wiek, w którym można złożyć wniosek.
 *
 * Źródłem jest `sprawdzKrok()` w `packages/wniosek/src/schemat.js`, gdzie te
 * dwie liczby stoją w warunku i w komunikacie („od 18 do 65 lat"). Pakietu
 * wniosku nie ruszamy przy pracy nad tłumaczeniem — to jedyna ścieżka, którą
 * wpływają pieniądze — więc liczby są tu powtórzone, a `test/uk.spec.js`
 * porównuje je ze źródłem schematu. Zmiana granicy tam bez zmiany tutaj
 * wywali test, zamiast zostawić stronę ukraińską z nieaktualnym wiekiem.
 */
export const GRANICE_WIEKU = { od: 18, do: 65 } as const;

/** Nazwa strony głównej w okruszkach. */
export const GLOWNA_UK = { nazwa: 'Головна', url: '/uk/' } as const;

/**
 * Kroki wniosku po ukraińsku, po identyfikatorze kroku z `KROKI`
 * (`@ud/wniosek/schemat`). `opis` to przekład opisu z tamtej listy.
 *
 * Sam kreator zostaje po polsku: zgody mają numer wersji i treść zatwierdzoną
 * przez prawnika, zapisaną także w funkcji brzegowej, a odpowiedzi w ankiecie
 * medycznej są oświadczeniem, za które odpowiada klient. Ta mapa służy tylko
 * do OBJAŚNIENIA kroków na `/uk/wniosek/` i `/uk/jak-to-dziala/`.
 * `test/uk.spec.js` sprawdza, że każdy krok z `KROKI` ma tu wpis.
 */
export const KROKI_UK: Record<string, { tytul: string; opis: string }> = {
  kontakt: {
    tytul: 'Контакт',
    opis: 'ім’я та прізвище, адреса e-mail, номер телефону та згода на контакт щодо заявки, '
      + 'якщо ви її позначите',
  },
  dane: {
    tytul: 'Основні дані',
    opis: 'PESEL, професія, форма зайнятості та оподаткування, розмір доходу',
  },
  zakres: {
    tytul: 'Обсяг захисту',
    opis: 'обрані ризики, страхові суми та період виплати',
  },
  zdrowie: {
    tytul: 'Стан здоров’я',
    opis: 'медична анкета — дані особливої категорії, які обробляють лише за явної згоди',
  },
  zgody: {
    tytul: 'Згоди',
    opis: 'позначені згоди та підтвердження',
  },
};

/**
 * Liczebnik z rzeczownikiem w zgodnej formie: `liczebnikUk(188, ['група', 'групи', 'груп'])`
 * → „188 груп". Formy: po 1 (ale nie 11), po 2–4 (ale nie 12–14), pozostałe.
 */
export function liczebnikUk(n: number, formy: [string, string, string]): string {
  const jednosci = n % 10;
  const nastki = n % 100 >= 11 && n % 100 <= 14;
  if (jednosci === 1 && !nastki) return `${n} ${formy[0]}`;
  if (jednosci >= 2 && jednosci <= 4 && !nastki) return `${n} ${formy[1]}`;
  return `${n} ${formy[2]}`;
}

/** „5 кроків", „3 кроки" — liczebnik cyfrą, rzeczownik w zgodnej formie. */
export function krokiUk(n: number): string {
  return liczebnikUk(n, ['крок', 'кроки', 'кроків']);
}
