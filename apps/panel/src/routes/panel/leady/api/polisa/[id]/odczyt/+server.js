/**
 * POST …/polisa/<leadId>/odczyt { plikId } — kwoty z polisy już wgranej przy
 * leadzie (np. sprzedaż zapisana ze składką z doliczoną opłatą dystrybucyjną).
 * Niczego nie zapisuje; kwoty wracają do okna „Dane sprzedaży".
 */
import { obsluz } from '$lib/server/leady-http.js';
import { odczytajWgranaPolise } from '$lib/server/leady.js';
import { odczytajPdf as odczytaj } from '$lib/server/czytnik-polis.js';

export const POST = (zdarzenie) =>
  obsluz(zdarzenie, ({ sb, userId, body }) =>
    odczytajWgranaPolise(sb, userId, zdarzenie.params.id, body?.plikId, { odczytaj }));
