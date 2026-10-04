/**
 * POST …/polisa/<leadId> — treść żądania to sam plik PDF (application/pdf),
 * nazwa w nagłówku x-nazwa-pliku (zakodowana encodeURIComponent). Nie
 * multipart: typ „prosty" przeszedłby z cudzej strony bez preflightu CORS.
 */
import { obsluz } from '$lib/server/leady-http.js';
import { wgrajPolise } from '$lib/server/leady.js';
import { parseOfferPdf } from '$lib/pdf/index.js';

/** Czytnik ofert Leadenhall/CEU; wynik ma te same pola co wiersz ud_offer_documents. */
const odczytaj = async (bajty, haslo) => (await parseOfferPdf(bajty, { password: haslo })).offer;

function nazwaZNaglowka(request) {
  const surowa = request.headers.get('x-nazwa-pliku') || '';
  try {
    return decodeURIComponent(surowa);
  } catch {
    return surowa;
  }
}

export const POST = (zdarzenie) =>
  obsluz(
    zdarzenie,
    ({ sb, userId, body }) =>
      wgrajPolise(sb, userId, zdarzenie.params.id, { nazwa: nazwaZNaglowka(zdarzenie.request), bajty: body }, { odczytaj }),
    { pdf: true },
  );
