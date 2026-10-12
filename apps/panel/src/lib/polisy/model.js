/**
 * Wykaz polis — logika bez DOM-u (testy: scripts/test-leady-model.mjs).
 *
 * Polisa = sprzedaż z tablicy leadów (lead w „Wygrany"). Daty ochrony wpisuje
 * agent albo czytnik PDF polisy; „dziś" przychodzi z serwera w czasie polskim
 * (ud_leady_polisy.dzis), żeby status nie zależał od strefy czasowej przeglądarki.
 */

export const STATUSY = [
  { id: 'wszystkie', nazwa: 'Wszystkie' },
  { id: 'aktywne', nazwa: 'Aktywne' },
  { id: 'wygasa', nazwa: 'Wygasają w 30 dni' },
  { id: 'wygasla', nazwa: 'Wygasłe' },
  { id: 'bez_dat', nazwa: 'Bez dat ochrony' },
];

export const DNI_DO_WYGASNIECIA = 30;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const naDate = (s) => new Date(`${s}T00:00:00Z`);
const zDaty = (d) => d.toISOString().slice(0, 10);

/** „2026-10-05" → „05.10.2026" (puste → „—"). */
export function dataPL(s) {
  if (!s || !DATA.test(String(s).slice(0, 10))) return '—';
  const [r, m, d] = String(s).slice(0, 10).split('-');
  return `${d}.${m}.${r}`;
}

/** Data sprzedaży (timestamptz) jako dzień w Polsce: „2026-10-04". */
export function dzienPL(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Roczna ochrona od danego dnia: 2026-10-05 → 2027-10-04 (29 lutego → 28 lutego). */
export function rokOchrony(od) {
  if (!od || !DATA.test(od)) return null;
  const d = naDate(od);
  const r = d.getUTCFullYear() + 1;
  const koniec = new Date(Date.UTC(r, d.getUTCMonth(), d.getUTCDate()));
  // 29.02 + rok = 1.03 — rok ochrony kończy się wtedy 28.02, nie 29.02.
  if (koniec.getUTCMonth() !== d.getUTCMonth()) koniec.setUTCDate(0);
  else koniec.setUTCDate(koniec.getUTCDate() - 1);
  return zDaty(koniec);
}

/** Dzień przesunięty o n dni: 2026-02-05, −1 → 2026-02-04. Zła data → null. */
export function przesunDzien(dzien, n) {
  if (!dzien || !DATA.test(dzien)) return null;
  const d = naDate(dzien);
  if (Number.isNaN(d.getTime()) || zDaty(d) !== dzien) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return zDaty(d);
}

/**
 * Data sprzedaży = dzień przed początkiem ochrony (decyzja właściciela
 * z 05.10.2026). Ta sama reguła stoi w SQL (ud_data_sprzedazy) — tu tylko
 * do pokazania w formularzu, zapisuje baza.
 */
export const dataSprzedazyZOchrony = (ochronaOd) => przesunDzien(ochronaOd, -1);

function dniMiedzy(od, doo) {
  return Math.round((naDate(doo) - naDate(od)) / 86_400_000);
}

/**
 * Status polisy na dany dzień: bez_dat (brak końca ochrony), wygasla,
 * przyszla (ochrona jeszcze się nie zaczęła), wygasa (do końca ≤ 30 dni),
 * aktywna.
 */
export function statusPolisy(p, dzis) {
  if (!p.ochrona_do) return { id: 'bez_dat', etykieta: 'Bez dat ochrony' };
  if (p.ochrona_do < dzis) return { id: 'wygasla', etykieta: 'Wygasła' };
  if (p.ochrona_od && p.ochrona_od > dzis) return { id: 'przyszla', etykieta: `Od ${dataPL(p.ochrona_od)}` };
  const dni = dniMiedzy(dzis, p.ochrona_do);
  if (dni <= DNI_DO_WYGASNIECIA) {
    return { id: 'wygasa', etykieta: dni === 0 ? 'Wygasa dziś' : dni === 1 ? 'Wygasa jutro' : `Wygasa za ${dni} dni`, dni };
  }
  return { id: 'aktywna', etykieta: 'Aktywna' };
}

/** Czy polisa pasuje do filtra statusu (chipy nad tabelą). */
export function pasujeStatus(status, filtr) {
  if (!filtr || filtr === 'wszystkie') return true;
  if (filtr === 'aktywne') return ['aktywna', 'wygasa', 'przyszla'].includes(status.id);
  return status.id === filtr;
}

/** Szukanie po kliencie i numerze polisy, bez wielkości liter i polskich znaków. */
const bezOgonkow = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
export function pasujeSzukanie(p, q) {
  const t = bezOgonkow(q).trim();
  if (!t) return true;
  return bezOgonkow(p.klient).includes(t) || bezOgonkow(p.numer).includes(t);
}

export const SORTY = {
  sprzedano: { nazwa: 'Data sprzedaży', klucz: (p) => p.sprzedano ?? '', domyslnie: 'malejaco' },
  ochrona_do: { nazwa: 'Koniec ochrony', klucz: (p) => p.ochrona_do ?? '9999', domyslnie: 'rosnaco' },
  klient: { nazwa: 'Klient', klucz: (p) => bezOgonkow(p.klient), domyslnie: 'rosnaco' },
  skladka_mies: { nazwa: 'Składka miesięczna', klucz: (p) => Number(p.skladka_mies ?? -1), domyslnie: 'malejaco' },
};

export function sortuj(polisy, klucz = 'sprzedano', kierunek) {
  const s = SORTY[klucz] ?? SORTY.sprzedano;
  const k = kierunek ?? s.domyslnie;
  const znak = k === 'rosnaco' ? 1 : -1;
  return [...polisy].sort((a, b) => {
    const x = s.klucz(a);
    const y = s.klucz(b);
    if (x < y) return -znak;
    if (x > y) return znak;
    return String(a.lead_id).localeCompare(String(b.lead_id));
  });
}

/** Sumy widocznych wierszy (tabela ładuje cały wykaz, więc to są sumy zbioru po filtrze). */
export function sumy(polisy) {
  const suma = (pole) => Math.round(polisy.reduce((s, p) => s + (Number(p[pole]) || 0), 0) * 100) / 100;
  return {
    liczba: polisy.length,
    mies: suma('skladka_mies'),
    roczna: suma('skladka_roczna'),
    prowizja: suma('prowizja'),
    wyliczonych: polisy.filter((p) => p.mies_wyliczona).length,
  };
}

/**
 * Pola polisy z formularza → do danych sprzedaży. Puste pole = brak.
 * Daty w formacie z <input type="date"> (YYYY-MM-DD); koniec nie przed
 * początkiem (ta sama reguła w SQL).
 */
export function danePolisyZFormularza({ numer, od, do: doo }) {
  const polisa = {};
  const bledy = {};
  const n = String(numer ?? '').trim().replace(/\s+/g, ' ');
  if (n.length > 60) bledy.polisa_numer = 'Numer polisy może mieć najwyżej 60 znaków.';
  else if (n) polisa.polisa_numer = n;
  for (const [pole, v] of [['ochrona_od', od], ['ochrona_do', doo]]) {
    const t = String(v ?? '').trim();
    if (!t) continue;
    if (!DATA.test(t) || Number.isNaN(naDate(t).getTime()) || zDaty(naDate(t)) !== t) bledy[pole] = 'Wpisz datę.';
    else polisa[pole] = t;
  }
  if (polisa.ochrona_od && polisa.ochrona_do && polisa.ochrona_do < polisa.ochrona_od) {
    bledy.ochrona_do = 'Koniec ochrony nie może być przed jej początkiem.';
  }
  return { polisa, bledy };
}

// ── CSV (Excel w polskich ustawieniach: średnik, przecinek dziesiętny, BOM) ──

const liczbaCsv = (n) => (n == null || n === '' ? '' : String(Number(n)).replace('.', ','));
function poleCsv(v) {
  let s = String(v ?? '');
  // Formuła podrzucona w nazwie klienta („=HYPERLINK…") nie może wykonać się w arkuszu.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function doCsv(polisy, { admin = false, dzis }) {
  const naglowek = ['Klient', 'Numer polisy', 'Ochrona od', 'Ochrona do', 'Status', 'Data sprzedaży',
    'Składka miesięczna', 'Składka roczna', 'Prowizja', ...(admin ? ['Agent'] : [])];
  const wiersze = polisy.map((p) => [
    p.klient, p.numer ?? '', p.ochrona_od ?? '', p.ochrona_do ?? '', statusPolisy(p, dzis).etykieta,
    dzienPL(p.sprzedano) ?? '', liczbaCsv(p.skladka_mies), liczbaCsv(p.skladka_roczna), liczbaCsv(p.prowizja),
    ...(admin ? [p.agent ?? 'Bez opiekuna'] : []),
  ]);
  return '﻿' + [naglowek, ...wiersze].map((w) => w.map(poleCsv).join(';')).join('\r\n') + '\r\n';
}
