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
 * ofertach z `ud_offer_documents` (metoda „osoby-v1", funkcja SQL
 * `ud_kalibracja_stawek()`); metoda, dane źródłowe i to, czego z nich
 * policzyć się NIE da (klasa ryzyka, wiek, okresy 48 i 60 miesięcy) —
 * w MODEL-SKLADKI.md.
 *
 * Plik przepisuje kalibrator (`supabase/functions/kalibrator`) pull requestem,
 * który scala właściciel. Dlatego plik jest sprawdzany przy imporcie —
 * patrz `sprawdzKalibracje()` niżej.
 */
import kalibracja from './kalibracja.json' with { type: 'json' };
// Nic więcej nie importuj: test/kalibrator.spec.js ładuje ten plik jako
// samodzielny moduł (data: URL), w którym działa tylko import kalibracja.json.
// Zasiłek ZUS jest w zus.ts, granice wniosku — w granice.ts.

/**
 * Okresy wypłaty świadczenia dostępne w ofercie, w miesiącach.
 *
 * Kalkulator miał tu przełącznik „Wypłata przez 24 miesiące zamiast 12"
 * z dopłatą 10% i stał domyślnie na 12. Wariantu 12-miesięcznego nie ma
 * w ofercie — najkrótszy jest 24-miesięczny — więc przełącznik proponował
 * okres, którego nikt nie może kupić.
 *
 * Symulacja liczy dla najkrótszego okresu i pisze to wprost. Mnożnik dla
 * 36 miesięcy jest policzony z par ofert (ten sam wariant w 24 i 36
 * miesiącach), ale dla 48 i 60 nie ma ani jednej obserwacji — dopóki ich nie
 * będzie, wybór okresu w kalkulatorze oznaczałby cenę wariantu
 * 24-miesięcznego pod etykietą 60-miesięcznego. Stąd lista jest informacją,
 * nie przełącznikiem.
 */
export const OKRESY = [24, 36, 48, 60] as const;

/** Najkrótszy okres z oferty — dla niego liczona jest symulacja. */
export const MIESIECY_WYPLATY = OKRESY[0];

/**
 * Najdłuższy okres wypłaty w ofercie. Przy świadczeniu piszemy „najdłużej przez
 * 60 miesięcy" (decyzja właściciela z 21.10.2026) — do tego dnia kalkulator
 * pisał „minimum przez 24 miesiące", a okres odszkodowawczy to czas najdłuższy.
 * Składka i tak dotyczy wariantu `MIESIECY_WYPLATY` i strona mówi to przy niej.
 */
export const MIESIECY_MAX = OKRESY[OKRESY.length - 1];

/** Granice stawki miesięcznej (udział świadczenia), poza którymi plik jest błędny. */
const STAWKA_MIN = 0.01;
const STAWKA_MAX = 0.05;
/** Granice mnożnika okresu wypłaty. */
const MNOZNIK_MIN = 1;
const MNOZNIK_MAX = 2;

export interface Kalibracja {
  /** Dzień przeliczenia stawek, RRRR-MM-DD. */
  policzono: string;
  /** Metryczka: metoda, okno, ile osób i ofert. Do dokumentacji, nie na stronę. */
  zrodlo: Record<string, unknown>;
  stawka: { dol: number; srodek: number; gora: number };
  /** Mnożnik stawki względem wariantu 24-miesięcznego, klucz = okres w miesiącach. */
  okresy: Record<string, number>;
}

const obiekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const liczbaSkonczona = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function dataPoprawna(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Błędy pliku kalibracji; pusta lista = plik poprawny.
 *
 * Ta sama reguła stoi w funkcji brzegowej kalibratora (`bledyKalibracji()`
 * w `supabase/functions/kalibrator/index.ts`) — zduplikowana świadomie, bo
 * Deno nie importuje z portalu. `test/kalibrator.spec.js` porównuje oba
 * walidatory na tych samych przypadkach; zmiana reguły = oba pliki naraz.
 */
export function bledyKalibracji(k: unknown): string[] {
  if (!obiekt(k)) return ['plik nie jest obiektem JSON'];
  const bledy: string[] = [];

  if (!dataPoprawna(k.policzono)) bledy.push('policzono: wymagana data RRRR-MM-DD');
  if (!obiekt(k.zrodlo)) bledy.push('zrodlo: brak obiektu');

  const stawka = k.stawka;
  if (!obiekt(stawka)) {
    bledy.push('stawka: brak obiektu');
  } else {
    const braki = ['dol', 'srodek', 'gora'].filter((p) => !liczbaSkonczona(stawka[p]));
    for (const p of braki) bledy.push(`stawka.${p}: wymagana skończona liczba`);
    if (braki.length === 0) {
      const { dol, srodek, gora } = stawka as Kalibracja['stawka'];
      if (!(STAWKA_MIN <= dol && dol <= srodek && srodek <= gora && gora <= STAWKA_MAX)) {
        bledy.push(`stawka: wymagane 0,01 ≤ dół ≤ środek ≤ góra ≤ 0,05 (jest ${dol} / ${srodek} / ${gora})`);
      }
    }
  }

  const okresy = k.okresy;
  if (!obiekt(okresy)) {
    bledy.push('okresy: brak obiektu');
  } else {
    const dozwolone = OKRESY.map(String);
    const przedOkresami = bledy.length;
    for (const [klucz, v] of Object.entries(okresy)) {
      if (!dozwolone.includes(klucz)) {
        bledy.push(`okresy: niedozwolony klucz „${klucz}" (dozwolone: ${dozwolone.join(', ')})`);
      } else if (!liczbaSkonczona(v) || v < MNOZNIK_MIN || v > MNOZNIK_MAX) {
        bledy.push(`okresy.${klucz}: wymagana liczba z przedziału [1; 2]`);
      }
    }
    if (okresy['24'] !== 1) bledy.push('okresy["24"]: musi wynosić 1');
    if (bledy.length === przedOkresami) {
      // Dłuższa wypłata nie może kosztować mniej ani tyle samo co krótsza.
      const wartosci = dozwolone.filter((o) => o in okresy).map((o) => okresy[o] as number);
      if (wartosci.some((v, i) => i > 0 && !(v > wartosci[i - 1]))) {
        bledy.push('okresy: mnożniki muszą rosnąć razem z okresem');
      }
    }
  }

  return bledy;
}

/**
 * Sprawdza plik kalibracji i zwraca go z typem — albo rzuca.
 *
 * Rzut przy imporcie zatrzymuje build portalu, a Cloudflare Pages zostawia
 * wtedy poprzednie wdrożenie. To jest celowe: lepiej, żeby strona pokazywała
 * wczorajsze stawki, niż żeby po scaleniu błędnej propozycji kalkulatora
 * obiecywał składkę 0 zł albo NaN.
 */
export function sprawdzKalibracje(k: unknown): Kalibracja {
  const bledy = bledyKalibracji(k);
  if (bledy.length > 0) {
    throw new Error(`kalibracja.json jest niepoprawny — build zatrzymany:\n- ${bledy.join('\n- ')}`);
  }
  return k as Kalibracja;
}

const KALIBRACJA = sprawdzKalibracje(kalibracja);

/**
 * Maksymalny udział dochodu, jaki obejmuje polisa.
 *
 * Symulacja liczy wyłącznie B2B (decyzja właściciela z 21.10.2026): na etacie
 * zasiłek zależy od pensji i nie ma jednej kwoty do pokazania obok suwaka.
 * Limit dla etatu zostaje, bo stoi w tekstach.
 */
export const LIMIT = {
  b2b: 0.8,
  etat: 0.65,
} as const;

/**
 * Zakres suwaka w kalkulatorze. Stoi tutaj, bo opis strony /kalkulator/ podaje
 * go słowami — przy osobnych liczbach opis obiecywał „od 5 000 do 100 000 zł",
 * a suwak kończył się na 60 000.
 */
export const ZAKRES_DOCHODU = { min: 3000, max: 60000, krok: 500 } as const;

/**
 * Stawka miesięczna jako udział świadczenia, wariant 24-miesięczny.
 *
 * `dol` i `gora` to najniższa i najwyższa stawka osoby z ofert wystawionych
 * w ostatnich 12 miesiącach, w wariancie porównywalnym z kalkulatorem: samo
 * świadczenie okresowe, wypłata najdłużej przez 24 miesiące, okres wyczekiwania do
 * 21 dni, składka w ratach, bez klauzuli HIV/WZW i bez płatnych dodatków.
 * Stawka osoby to mediana jej wariantów z jej najnowszej oferty — klient,
 * któremu wystawiliśmy pięć wariantów, nie waży pięć razy więcej niż ten
 * z jednym. To nie jest margines dopisany na oko. Rozrzut jest prawdziwy:
 * składka zależy od wieku, klasy ryzyka i okresu wyczekiwania, o które
 * kalkulator nie pyta — więc jedna liczba udawałaby precyzję, której tu nie ma.
 */
export const STAWKA = KALIBRACJA.stawka;

/**
 * Skąd przedział — jedno sformułowanie dla kalkulatora, strony zawodu i jej
 * llms.txt, żeby trzy miejsca nie rozjechały się przy pierwszej poprawce.
 *
 * Opis METODY, nie metryczka: bez liczby ofert ani wariantów. Konkretna liczba
 * zestarzałaby się przy pierwszej nowej ofercie, a kalibrator przepisuje
 * wyłącznie stawki w kalibracja.json, nie treść strony. 12 miesięcy i 21 dni
 * to filtry `ud_kalibracja_stawek()` — zmiana tam = zmiana tutaj.
 */
export const OPIS_KALIBRACJI =
  'z ofert wystawionych w ostatnich 12 miesiącach, w wariancie porównywalnym z kalkulatorem: '
  + `samo świadczenie miesięczne, wypłata najdłużej przez ${MIESIECY_WYPLATY} miesiące, `
  + 'okres wyczekiwania do 21 dni, składka w ratach';

/**
 * Klauzula HIV/WZW podnosi stawkę o 7%.
 *
 * Z jedynej czystej pary w ofertach z bazy: ten sam wariant (MEDICARE,
 * 5 000 zł miesięcznie, 36 miesięcy, 14/21 dni) z klauzulą LW049 i bez niej —
 * składka bazowa 1500 zł wobec 1404 zł, czyli ×1,068. Druga oferta z klauzulą
 * nie rozstrzyga: jej dwa warianty bez klauzuli mają przy tych samych
 * widocznych parametrach różne ceny, więc dopłata wychodzi +3% albo +13%.
 * 1,07 zamiast górnej granicy 1,13 — decyzja właściciela z 28.09.2026.
 *
 * Wcześniej stało tu 1,2 — relacja 1,8% / 1,5% ze starego Calculator.js,
 * niczym niepotwierdzona. Liczba siedzi tutaj, a nie w kalibracja.json, bo
 * jedna para to za mało na przeliczanie maszynowe (MODEL-SKLADKI.md).
 * Warianty z klauzulą nie wchodzą do stawek w kalibracja.json (decyzja
 * właściciela z 14.10.2026) — klauzulę niesie wyłącznie ten mnożnik, więc
 * nie liczy się dwa razy.
 */
export const MNOZNIK_HIV_WZW = 1.07;

/** Mnożniki stawki dla okresów, które udało się policzyć z ofert. */
export const MNOZNIK_OKRESU: Record<number, number> = KALIBRACJA.okresy;

export interface Zalozenia {
  /** Miesięczny dochód netto w złotych, działalność albo kontrakt B2B. */
  dochod: number;
  /** Klauzula HIV/WZW podnosi stawkę. */
  hivWzw?: boolean;
}

export interface Wynik {
  /** Miesięczna suma świadczenia z polisy. */
  swiadczenie: number;
  /** Środek przedziału — tam, gdzie musi paść jedna liczba. */
  skladka: number;
  /** Składka przy najniższej stawce osoby z kalibracji (`STAWKA.dol`). */
  skladkaOd: number;
  /** Składka przy najwyższej stawce osoby z kalibracji (`STAWKA.gora`). */
  skladkaDo: number;
  limit: number;
}

export function symuluj({ dochod, hivWzw = false }: Zalozenia): Wynik {
  const limit = LIMIT.b2b;
  const swiadczenie = Math.round(dochod * limit);
  const klauzula = hivWzw ? MNOZNIK_HIV_WZW : 1;
  const skladka = (stawka: number) => Math.round(swiadczenie * stawka * klauzula);

  return {
    swiadczenie,
    skladka: skladka(STAWKA.srodek),
    skladkaOd: skladka(STAWKA.dol),
    skladkaDo: skladka(STAWKA.gora),
    limit,
  };
}

/**
 * Formatowanie kwot — spacja jako separator tysięcy, tak jak w polskiej normie.
 *
 * useGrouping: 'always' jest tu konieczne. Domyślne 'auto' nie grupuje liczb
 * czterocyfrowych, więc obok „14 400 zł" stawało „3902 zł" — w jednej tabeli,
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

/** „291–464 zł" — jedno „zł" na koniec, półpauza bez spacji, jak w zakresach liczb. */
export function zlZakres(od: number, do_: number): string {
  return od === do_ ? zl(od) : `${liczba(od)}–${liczba(do_)} zł`;
}
