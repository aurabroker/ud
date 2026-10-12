/**
 * POST …/polisa/<leadId> — treść żądania to sam plik PDF (application/pdf),
 * nazwa w nagłówku x-nazwa-pliku (zakodowana encodeURIComponent). Nie
 * multipart: typ „prosty" przeszedłby z cudzej strony bez preflightu CORS.
 */
import { obsluz } from '$lib/server/leady-http.js';
import { wgrajPolise } from '$lib/server/leady.js';
import { odczytajPdf as odczytaj } from '$lib/server/czytnik-polis.js';
import { nazwaZNaglowka } from '$lib/server/nazwa-pliku.js';

export const POST = (zdarzenie) =>
  obsluz(
    zdarzenie,
    ({ sb, userId, body }) =>
      wgrajPolise(sb, userId, zdarzenie.params.id, { nazwa: nazwaZNaglowka(zdarzenie.request), bajty: body }, { odczytaj }),
    { pdf: true },
  );
