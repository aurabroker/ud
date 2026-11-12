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

/**
 * Czy ramka stoi na stronie. Włączamy po akceptacji tekstu przez prawnika
 * (asystent/przed-uruchomieniem.md, punkt A5: kto przy sprzedaży online
 * z naszym kodem robi analizę potrzeb i obowiązki informacyjne agenta).
 * Pilnuje tego test/kup-online.spec.js — przy `false` link nie może
 * pojawić się w buildzie, przy `true` sprawdza ramkę w całości.
 */
export const KUP_ONLINE_NA_STRONIE = false;

/** Miejsce w liczniku kliknięć (`?z=`) — przechodzi białą listę funkcji. */
export const KUP_ONLINE_MIEJSCE = 'wniosek';

export const KUP_ONLINE = {
  etykieta: 'Zakup online',
  naglowek: 'Wolisz kupić sam, przez internet?',
  opis: `${FIRMA.coverholderzyWg.leadenhall}, przedstawiciel (coverholder) Lloyd’s, sprzedaje `
    + 'online własne warianty ubezpieczenia utraty dochodu. To inne warunki niż w ofercie, '
    + 'którą przygotujemy po wniosku, i bez porównania z CEU.',
  odnosnik: 'Kup online w Leadenhall',
  dopisek: 'Strona Leadenhall otworzy się w nowej karcie, a ten wniosek zostanie otwarty. '
    + 'Ankietę zdrowotną wypełnisz u nich.',
  adres: `/kup-online?z=${KUP_ONLINE_MIEJSCE}`,
} as const;
