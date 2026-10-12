/**
 * Kolumna „Akcja" w zakładce Klienci (decyzja właściciela z 05.10.2026:
 * zamiast „Zawód" — „Oferta wysłana, Klient zrezygnował, Klient ubezpieczony…").
 *
 * Źródłem jest etap leada klienta na tablicy (jeden lead na klienta), nie
 * statusy ofert: tablica to jedno miejsce, w którym agent prowadzi sprawę,
 * a synchronizacja i tak ustawia etap z ofert (wysłana → Oferta, wybrana →
 * Decyzja, kupiona → Wygrany). Dwa źródła pokazywałyby dwie prawdy.
 */

export const AKCJE = {
  nowy:      { etykieta: 'Do kontaktu', klasa: 'badge-draft' },
  kontakt:   { etykieta: 'W kontakcie', klasa: 'badge-draft' },
  oferta:    { etykieta: 'Oferta wysłana', klasa: 'badge-sent' },
  decyzja:   { etykieta: 'Czeka na decyzję klienta', klasa: 'badge-viewed' },
  wygrany:   { etykieta: 'Klient ubezpieczony', klasa: 'badge-bought' },
  wygasla:   { etykieta: 'Polisa wygasła', klasa: 'badge-viewed' },
  przegrany: { etykieta: 'Klient zrezygnował', klasa: 'badge-rejected' },
};

/**
 * @param {{ id: string, zarchiwizowano_at?: string|null, powod_utraty?: string|null, ochrona_do?: string|null } | null | undefined} lead
 * @param {{ klucz: string, rodzaj: string, nazwa: string } | null | undefined} etap
 * @param {string} dzis  RRRR-MM-DD w czasie polskim
 */
export function akcjaKlienta(lead, etap, dzis) {
  if (!lead || !etap) return { id: 'brak', etykieta: '—', klasa: '', tytul: null, link: null, archiwum: false };
  let id;
  if (etap.rodzaj === 'wygrany') id = lead.ochrona_do && lead.ochrona_do < dzis ? 'wygasla' : 'wygrany';
  else if (etap.rodzaj === 'przegrany') id = 'przegrany';
  else id = AKCJE[etap.klucz] ? etap.klucz : null;
  const a = id ? AKCJE[id] : { etykieta: etap.nazwa, klasa: 'badge-draft' };
  const archiwum = Boolean(lead.zarchiwizowano_at);
  return {
    id: id ?? etap.klucz,
    etykieta: a.etykieta,
    klasa: a.klasa,
    tytul: id === 'przegrany' && lead.powod_utraty ? `Powód: ${lead.powod_utraty}` : null,
    // Zarchiwizowanego leada nie ma na tablicy — odnośnik prowadziłby donikąd.
    link: archiwum ? null : `/panel/leady?lead=${lead.id}`,
    archiwum,
  };
}
