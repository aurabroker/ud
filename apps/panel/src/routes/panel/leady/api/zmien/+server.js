import { obsluz } from '$lib/server/leady-http.js';
import { zmien } from '$lib/server/leady.js';

/** Jedna ścieżka zmiany stanu leada: przeciąganie, menu, szczegóły. */
export const POST = (zdarzenie) => obsluz(zdarzenie, ({ sb, userId, body }) => zmien(sb, userId, body));
