/**
 * Ramka „Zakup online” na /wniosek/ — link do sprzedaży online Leadenhall.
 *
 * Wariant A (decyzja właściciela z 12.11.2026): statyczna ramka w bocznej
 * kolumnie strony, POZA kreatorem. Nie w kroku kontakt i nie „dopiero po
 * e-mailu i telefonie” — bez zaznaczonej zgody kontakt i tak nie jest
 * zapisywany (ok. 45% szkiców), a zgoda nie może odblokowywać linku
 * (RODO art. 7 ust. 4). Kreator, szkic i przypomnienia zostają bez zmian.
 *
 * Adres idzie przez nasz licznik `/kup-online?z=wniosek`
 * (functions/kup-online), który przekierowuje na stronę Leadenhall z naszym
 * kodem pośrednika; kliknięcia widać w panelu (Niedokończone → „Kup online
 * u Leadenhall — kliknięcia”, miejsce „wniosek”). Nazwy podmiotów z firma.ts
 * — test/podmioty.spec.js pilnuje, żeby Leadenhall nie został nazwany
 * ubezpieczycielem. Online Leadenhall sprzedaje LW050/LW051, nie LW044
 * z naszych ofert — stąd „inne warunki niż w ofercie”.
 */
import { FIRMA } from './firma';
import { RYZYKA } from '@ud/wniosek/schemat';

/** Ryzyko z kreatora — nazwy w ramce są te same co we wniosku. */
function ryzyko(klucz: string) {
  const r = RYZYKA.find((x) => x.klucz === klucz);
  if (!r) throw new Error(`kupOnline.ts: brak ryzyka ${klucz} w @ud/wniosek`);
  return r;
}
const zMalej = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const OKRESOWA = ryzyko('riskTempIncapacity');

/**
 * Czy ramka stoi na stronie. WŁĄCZONA 12.11.2026 decyzją właściciela
 * („włącz”). `false` zdejmuje ją przy następnym wdrożeniu bez ruszania
 * czegokolwiek innego. Zmiana tekstu — przez prawnika (punkt A5
 * w asystent/przed-uruchomieniem.md). Pilnuje tego test/kup-online.spec.js —
 * przy `false` link nie może pojawić się w buildzie, przy `true` sprawdza
 * ramkę w całości.
 */
export const KUP_ONLINE_NA_STRONIE = true;

/** Miejsce w liczniku kliknięć (`?z=`) — przechodzi białą listę funkcji. */
export const KUP_ONLINE_MIEJSCE = 'wniosek';

export const KUP_ONLINE = {
  etykieta: 'Zakup online',
  naglowek: 'Wolisz kupić sam, przez internet?',
  /**
   * Zakres — wyróżniony w ramce. Online jest wyłącznie okresowa niezdolność
   * do pracy (OWU LW050 TTD UNIPRO i LW051 TTD MULTIPRO; potwierdzenie
   * właściciela 12.11.2026). Trwała niezdolność i NW są tylko we wniosku.
   */
  zakres: {
    online: `tylko ${zMalej(OKRESOWA.etykieta)} (${zMalej(OKRESOWA.rodzaj)})`,
    tylkoWOfercie: ['riskPermIncapacity', 'riskDeathInvalidity']
      .map((k) => zMalej(ryzyko(k).etykieta)).join(', '),
  },
  /* „Mogą się różnić”, nie „inne”: LW050 („Beauty”) bywa też w naszych polisach. */
  opis: `Ten zakres sprzedaje online ${FIRMA.coverholderzyWg.leadenhall}, przedstawiciel (coverholder) `
    + 'Lloyd’s, na własnych warunkach. Mogą się różnić od wariantów z oferty, którą '
    + 'przygotujemy po wniosku, a porównania z CEU tam nie dostaniesz.',
  odnosnik: 'Kup online u Leadenhall',
  /** Dla czytnika ekranu w nazwie odnośnika (WCAG G201). */
  nowaKarta: '(otworzy się w nowej karcie)',
  /* Bez obietnicy, że wniosek „zostanie otwarty”: przeglądarki wbudowane
     w aplikacje (Facebook, Instagram) otwierają link w tym samym widoku,
     a stan kreatora żyje tylko w pamięci. */
  dopisek: 'Strona Leadenhall otworzy się w nowej karcie. Ankietę zdrowotną wypełnisz u nich.',
  adres: `/kup-online?z=${KUP_ONLINE_MIEJSCE}`,
} as const;
