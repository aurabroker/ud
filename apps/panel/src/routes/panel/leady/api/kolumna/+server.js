import { obsluz } from '$lib/server/leady-http.js';
import { odpowiedzKolumny } from '$lib/server/leady.js';

/** Kolejna strona kart jednego etapu + świeże liczniki całego pipeline'u. */
export const GET = (zdarzenie) =>
  obsluz(zdarzenie, ({ sb, userId, url }) => odpowiedzKolumny(sb, userId, url.searchParams), { odczyt: true });
