/**
 * POST /panel/statystyki/api/odczyt — „Dodaj polisę", krok 1: kwoty z pliku
 * polisy, zanim klient trafi do kartoteki. Treść to sam PDF; hasło (4 ostatnie
 * cyfry PESEL-u z pola formularza) w nagłówku x-haslo. Niczego nie zapisuje.
 */
import { obsluz } from '$lib/server/leady-http.js';
import { odczytajPoliseNowa } from '$lib/server/leady.js';
import { odczytajPdf as odczytaj } from '$lib/server/czytnik-polis.js';

export const POST = (zdarzenie) =>
  obsluz(
    zdarzenie,
    ({ sb, userId, body }) => odczytajPoliseNowa(sb, userId, body, zdarzenie.request.headers.get('x-haslo'), { odczytaj }),
    { pdf: true },
  );
