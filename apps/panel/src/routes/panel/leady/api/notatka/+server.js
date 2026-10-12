import { obsluz } from '$lib/server/leady-http.js';
import { notatka } from '$lib/server/leady.js';

export const POST = (zdarzenie) => obsluz(zdarzenie, ({ sb, userId, body }) => notatka(sb, userId, body));
