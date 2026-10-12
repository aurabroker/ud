/**
 * POST /panel/statystyki/api/polisa — „Dodaj polisę", krok 2: klient spoza
 * formularza → kartoteka + lead w „Wygrany" (ud_lead_polisa_reczna). Plik
 * polisy przeglądarka wgrywa potem do nowego leada (…/leady/api/polisa/<id>).
 */
import { obsluz } from '$lib/server/leady-http.js';
import { dodajPolise } from '$lib/server/leady.js';

export const POST = (zdarzenie) => obsluz(zdarzenie, ({ sb, userId, body }) => dodajPolise(sb, userId, body));
