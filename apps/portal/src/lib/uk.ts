/**
 * uk.ts — drobne stałe wspólne dla stron ukraińskich.
 */

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
    opis: 'ім’я та прізвище, адреса e-mail, номер телефону та — якщо ви її позначите — згода '
      + 'на контакт щодо заявки',
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
    opis: 'медична анкета — дані особливої категорії, які обробляють лише за чіткої згоди',
  },
  zgody: {
    tytul: 'Згоди',
    opis: 'позначені згоди та підтвердження',
  },
};

/** „5 кроків", „3 кроки" — liczebnik cyfrą, rzeczownik w zgodnej formie. */
export function krokiUk(n: number): string {
  const jednosci = n % 10;
  const nastki = n % 100 >= 11 && n % 100 <= 14;
  if (jednosci === 1 && !nastki) return `${n} крок`;
  if (jednosci >= 2 && jednosci <= 4 && !nastki) return `${n} кроки`;
  return `${n} кроків`;
}
