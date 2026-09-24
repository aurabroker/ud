/**
 * owu.ts — publiczne adresy dokumentów OWU.
 *
 * Dokumenty leżą w prywatnym kubełku `ud-owu`, ale ich treść ma być
 * indeksowalna: klient szukający „warunki ubezpieczenia utraty dochodu"
 * powinien trafić na nasz plik, a nie na cudze streszczenie. Podpisany adres
 * ważny pięć minut tego nie daje — ani Google, ani robot modelu językowego
 * nie zdąży go użyć drugi raz, więc treść PDF-ów była dla nich niewidoczna.
 *
 * Stąd stały adres `/owu/<slug>.pdf` na naszej domenie, pod którym funkcja
 * brzegowa STRUMIENIUJE plik z kubełka. Nie przekierowanie: przekierowanie
 * oddaje adres końcowy domenie Supabase i to ona ląduje w indeksie.
 *
 * ── Dlaczego slug z TYTUŁU, a nie z symbolu ──────────────────────────────
 *
 * Symbol niesie numer wersji (`LW044/AD_D_TTD_PTD/PL/5`), więc adres zmieniałby
 * się przy każdej nowej wersji OWU i zaindeksowany odnośnik umierałby razem
 * z nią. Tytuł zostaje ten sam („Leadenhall Utrata Dochodu"), więc
 * `/owu/leadenhall-utrata-dochodu.pdf` zawsze podaje warunki OBOWIĄZUJĄCE.
 * Dla publicznej biblioteki to jest właściwe zachowanie: kto wchodzi pod ten
 * adres, chce wiedzieć, co kupuje dzisiaj. Numer wersji stoi na stronie
 * i w samym dokumencie.
 *
 * Skutek uboczny jest pożądany: gdyby w bibliotece zostały aktywne dwie wersje
 * tego samego OWU, dwa wiersze dałyby ten sam adres — a generator mapy
 * (`owu-adresy.json.ts`) wywala wtedy build z nazwami obu. To jest dokładnie
 * ta pomyłka, którą trzeba złapać przed wdrożeniem, a nie po.
 */

/** Polskie znaki diakrytyczne — `normalize('NFD')` nie rozkłada „ł". */
const ZNAKI: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
};

/** „Karta produktu — Leadenhall MEDICA" → „karta-produktu-leadenhall-medica". */
export function slugDokumentu(tytul: string): string {
  return String(tytul)
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (z) => ZNAKI[z] ?? z)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Publiczny adres dokumentu. */
export const adresDokumentu = (tytul: string): string => `/owu/${slugDokumentu(tytul)}.pdf`;
