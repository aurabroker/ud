import { obsluz } from '$lib/server/leady-http.js';
import { zwin } from '$lib/server/leady.js';

/** Osobisty stan zwinięcia etapów (per użytkownik i pipeline). */
export const POST = (zdarzenie) => obsluz(zdarzenie, ({ sb, userId, body }) => zwin(sb, userId, body));
