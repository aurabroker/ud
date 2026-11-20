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
 *
 * Zwija już baza (`ud_klikniecia_tabela`, wiersze z `zrodlo = POZOSTALE`):
 * zwijanie tutaj działałoby dopiero po limicie 1000 wierszy PostgREST, więc
 * zalew różnych `?z=` wypychałby prawdziwe tygodnie. Funkcja zwija też sama,
 * gdyby dostała wiersze niezwinięte.
 *
 * „w tym z reklamy" (panel v.0.80): od migracji 20261120100000 wiersz ma też
 * `z_reklamy` — ile z tych kliknięć przyszło z reklamy Google Ads (portal
 * zapisuje `platne`, bez identyfikatora kliknięcia) — i `zmierzonych`: ile
 * kliknięć w ogóle sprawdzono pod tym kątem. Kliknięcia sprzed pomiaru mają
 * w bazie `platne` NULL; tydzień z samymi takimi kliknięciami to „—", a nie 0,
 * tydzień zmierzony częściowo — „≥ N" (wśród niezmierzonych też mogły być
 * reklamy). Panel może wyjść PRZED migracją: wtedy wiersze nie mają tych kolumn
 * i strona nie pokazuje nic o reklamie. Za każdym razem ta sama zasada: zera
 * wyglądałyby jak „reklama nic nie dała", a tego nie wiemy.
 */

export const MIEJSC = 6;
export const TYGODNI = 12;
/** Kolumna zbiorcza dla miejsc spoza pierwszej szóstki. */
export const POZOSTALE = '__pozostale';

/**
 * Jak miejsca nazywa funkcja portalu, gdy `?z=` brak albo jest nieczytelne.
 * „inne" da się też wpisać w link świadomie, stąd etykieta bez rozstrzygania.
 */
const ETYKIETY = {
  bezposrednio: 'bez oznaczenia',
  inne: 'inne lub nieczytelne',
  [POZOSTALE]: 'pozostałe',
};

// Tylko własne klucze: `?z=constructor` przechodzi białą listę, a zwykłe
// ETYKIETY['constructor'] oddałoby funkcję Object z prototypu.
export const etykietaMiejsca = (zrodlo) => (Object.hasOwn(ETYKIETY, zrodlo) ? ETYKIETY[zrodlo] : zrodlo);

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

/** Liczba z bazy jako liczba całkowita ≥ 0 albo null (brak kolumny, śmieci). @param {unknown} v */
const liczbaReklamy = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * Komórka „w tym z reklamy": „—" gdy żadne kliknięcie nie było zmierzone,
 * „≥ N" gdy tylko część, samo N gdy wszystkie. Nigdy samo 0 za niezmierzone.
 * @param {number} zReklamy @param {number} zmierzonych @param {number} klikniec
 */
export function opisReklamy(zReklamy, zmierzonych, klikniec) {
  if (klikniec > 0 && zmierzonych <= 0) return '—';
  return zmierzonych < klikniec ? `≥ ${zReklamy}` : String(zReklamy);
}

export function klikniecia(wiersze) {
  // Kolumnę pokazujemy tylko wtedy, gdy KAŻDY wiersz ma obie liczby: panel
  // przed migracją (albo mieszanka po częściowym wdrożeniu) nie udaje zer.
  const reklamy = wiersze.length > 0 && wiersze.every((/** @type {any} */ w) => liczbaReklamy(w.z_reklamy) !== null
    && liczbaReklamy(w.zmierzonych) !== null);
  const zaMiejsce = new Map();
  let zwinieteWBazie = false;
  let miejscZBazy = 0;
  for (const w of wiersze) {
    miejscZBazy = Math.max(miejscZBazy, w.miejsc_wszystkich ?? 0);
    // „pozostałe" z bazy nie konkuruje o kolumnę — zawsze stoi na końcu.
    if (w.zrodlo === POZOSTALE) { zwinieteWBazie = true; continue; }
    zaMiejsce.set(w.zrodlo, (zaMiejsce.get(w.zrodlo) ?? 0) + w.klikniec);
  }

  // Kolejność kolumn: najwięcej kliknięć pierwsze, przy remisie po nazwie
  // (porządek bajtów, jak collate "C" w bazie) — żeby tabela nie skakała.
  const wgLiczby = [...zaMiejsce.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const glowne = wgLiczby.slice(0, MIEJSC).map(([z]) => z);
  const sa = new Set(glowne);
  const kolumny = zwinieteWBazie || wgLiczby.length > MIEJSC ? [...glowne, POZOSTALE] : glowne;
  const kolumna = (z) => (sa.has(z) ? z : POZOSTALE);

  const pusty = () => Object.fromEntries(kolumny.map((k) => [k, 0]));
  const tygodnie = new Map();
  for (const w of wiersze) {
    const t = tygodnie.get(w.tydzien)
      ?? { tydzien: w.tydzien, liczby: pusty(), razem: 0, ...(reklamy ? { zReklamy: 0, zmierzonych: 0 } : {}) };
    t.liczby[kolumna(w.zrodlo)] += w.klikniec;
    t.razem += w.klikniec;
    if (reklamy) { t.zReklamy += w.z_reklamy; t.zmierzonych += w.zmierzonych; }
    tygodnie.set(w.tydzien, t);
  }
  if (reklamy) for (const t of tygodnie.values()) t.reklamy = opisReklamy(t.zReklamy, t.zmierzonych, t.razem);

  const rzedy = [...tygodnie.values()].sort((a, b) => (a.tydzien < b.tydzien ? 1 : -1));
  const razem = pusty();
  for (const r of rzedy) for (const k of kolumny) razem[k] += r.liczby[k];
  const wszystkie = rzedy.reduce((s, r) => s + r.razem, 0);
  const zReklamy = reklamy ? rzedy.reduce((s, r) => s + r.zReklamy, 0) : null;
  const zmierzonych = reklamy ? rzedy.reduce((s, r) => s + r.zmierzonych, 0) : null;

  return {
    kolumny, rzedy, razem, wszystkie, miejscWszystkich: Math.max(miejscZBazy, zaMiejsce.size),
    // null = baza nie podaje (panel przed migracją) — strona milczy o reklamie.
    zReklamy,
    zmierzonych,
    reklamy: reklamy ? opisReklamy(/** @type {number} */ (zReklamy), /** @type {number} */ (zmierzonych), wszystkie) : null,
    // Czy w oknie są kliknięcia sprzed pomiaru — wtedy strona tłumaczy „—" i „≥".
    niezmierzone: reklamy ? /** @type {number} */ (zmierzonych) < wszystkie : false,
  };
}
