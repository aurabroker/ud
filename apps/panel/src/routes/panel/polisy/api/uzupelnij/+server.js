/**
 * POST /panel/polisy/api/uzupelnij { leadId } — wykaz polis, „Uzupełnij
 * z plików PDF": najnowsza polisa wgrana przy leadzie uzupełnia puste pola
 * sprzedaży (numer, okres ochrony) operacją `sprzedaz`. Jeden lead na żądanie.
 */
import { obsluz } from '$lib/server/leady-http.js';
import { uzupelnijZPolisy } from '$lib/server/leady.js';
import { odczytajPdf as odczytaj } from '$lib/server/czytnik-polis.js';

export const POST = (zdarzenie) =>
  obsluz(zdarzenie, ({ sb, userId, body }) => uzupelnijZPolisy(sb, userId, body?.leadId, { odczytaj }));
