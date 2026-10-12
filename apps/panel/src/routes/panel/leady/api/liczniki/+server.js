import { obsluz } from '$lib/server/leady-http.js';
import { odpowiedzLicznikow } from '$lib/server/leady.js';

export const GET = (zdarzenie) =>
  obsluz(zdarzenie, ({ sb, userId, url }) => odpowiedzLicznikow(sb, userId, url.searchParams), { odczyt: true });
