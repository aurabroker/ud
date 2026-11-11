/**
 * klikniecia.js — z wierszy „tydzień × miejsce → ile kliknięć" (widok
 * `ud_klikniecia_tydzien`) robi tabelę do strony Niedokończone.
 *
 * Kliknięcia to wejścia przez https://utratadochodu.pl/kup-online?z=<miejsce>
 * na stronę sprzedaży Leadenhall (portal: functions/kup-online). Czysta
 * funkcja bez SvelteKit — sprawdza ją scripts/test-klikniecia.mjs.
 *
 * Miejsce (`?z=`) wpisuje ktokolwiek, kto ma link, więc różnych miejsc może
 * być dowolnie dużo. Kolumn jest najwyżej `MIEJSC`: te z największą liczbą
 * kliknięć w całym okresie, reszta trafia do „pozostałe" — inaczej jeden
 * link z literówką albo cudzy żart w adresie rozpychałby tabelę.
 */

export const MIEJSC = 6;
export const TYGODNI = 12;
/** Kolumna zbiorcza dla miejsc spoza pierwszej szóstki. */
export const POZOSTALE = '__pozostale';

/** Jak miejsca nazywa funkcja portalu, gdy `?z=` brak albo jest nieczytelne. */
const ETYKIETY = {
  bezposrednio: 'bez oznaczenia',
  inne: 'nieczytelne',
  [POZOSTALE]: 'pozostałe',
};

export const etykietaMiejsca = (zrodlo) => ETYKIETY[zrodlo] ?? zrodlo;

/**
 * Poniedziałek tygodnia sprzed `tygodni - 1` tygodni, jako „RRRR-MM-DD" —
 * od niego czytamy widok. `dzis` to „RRRR-MM-DD" w czasie polskim (podaje go
 * serwer; zegar przeglądarki może się mylić).
 */
export function odTygodnia(dzis, tygodni = TYGODNI) {
  const d = new Date(`${dzis}T12:00:00Z`);
  const dzienTyg = (d.getUTCDay() + 6) % 7; // poniedziałek = 0
  d.setUTCDate(d.getUTCDate() - dzienTyg - 7 * (tygodni - 1));
  return d.toISOString().slice(0, 10);
}

/** Dzisiejsza data w czasie polskim, „RRRR-MM-DD". */
export function dzisWPolsce(teraz = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(teraz);
}

export function klikniecia(wiersze) {
  const zaMiejsce = new Map();
  for (const w of wiersze) zaMiejsce.set(w.zrodlo, (zaMiejsce.get(w.zrodlo) ?? 0) + w.klikniec);

  // Kolejność kolumn: najwięcej kliknięć pierwsze, przy remisie alfabetycznie —
  // żeby tabela nie skakała między odświeżeniami.
  const wgLiczby = [...zaMiejsce.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const glowne = wgLiczby.slice(0, MIEJSC).map(([z]) => z);
  const sa = new Set(glowne);
  const kolumny = wgLiczby.length > MIEJSC ? [...glowne, POZOSTALE] : glowne;
  const kolumna = (z) => (sa.has(z) ? z : POZOSTALE);

  const pusty = () => Object.fromEntries(kolumny.map((k) => [k, 0]));
  const tygodnie = new Map();
  for (const w of wiersze) {
    const t = tygodnie.get(w.tydzien) ?? { tydzien: w.tydzien, liczby: pusty(), razem: 0 };
    t.liczby[kolumna(w.zrodlo)] += w.klikniec;
    t.razem += w.klikniec;
    tygodnie.set(w.tydzien, t);
  }

  const rzedy = [...tygodnie.values()].sort((a, b) => (a.tydzien < b.tydzien ? 1 : -1));
  const razem = pusty();
  for (const r of rzedy) for (const k of kolumny) razem[k] += r.liczby[k];
  const wszystkie = rzedy.reduce((s, r) => s + r.razem, 0);

  return { kolumny, rzedy, razem, wszystkie, miejscWszystkich: zaMiejsce.size };
}
