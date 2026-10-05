/**
 * POST /panel/statystyki/api/odczyt — „Dodaj polisę", krok 1: kwoty, numer
 * polisy i okres ochrony z pliku, zanim klient trafi do kartoteki. Treść to sam
 * PDF; hasło (4 ostatnie cyfry PESEL-u z pola formularza) w nagłówku x-haslo,
 * nazwa pliku w x-nazwa-pliku (numer awaryjnie z nazwy). Niczego nie zapisuje.
 */
import { obsluz } from '$lib/server/leady-http.js';
import { odczytajPoliseNowa } from '$lib/server/leady.js';
import { odczytajPdf as odczytaj } from '$lib/server/czytnik-polis.js';
import { nazwaZNaglowka } from '$lib/server/nazwa-pliku.js';

export const POST = (zdarzenie) =>
  obsluz(
    zdarzenie,
    ({ sb, userId, body }) => odczytajPoliseNowa(sb, userId, body, zdarzenie.request.headers.get('x-haslo'),
      { odczytaj, nazwa: nazwaZNaglowka(zdarzenie.request) }),
    { pdf: true },
  );
