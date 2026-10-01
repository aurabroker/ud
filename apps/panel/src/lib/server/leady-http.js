/**
 * Adapter SvelteKit dla endpointów tablicy leadów: sesja z locals, klient
 * serwisowy tworzony dopiero w obsłudze (brak zmiennych środowiskowych kończy
 * się 500 z komunikatem ogólnym, nie wywrotką trasy), odpowiedź bez cache.
 */
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { przetworz } from '$lib/server/leady.js';

const BEZ_CACHE = { 'cache-control': 'no-store' };

/**
 * @param {{ locals: App.Locals, request: Request, url: URL }} zdarzenie
 * @param {(ctx: { userId: string, body: any, sb: any, userSb: any, url: URL }) => Promise<{ status: number, body: unknown }>} wykonaj
 * @param {{ odczyt?: boolean }} [opcje]
 */
export async function obsluz({ locals, request, url }, wykonaj, opcje = {}) {
  const { user } = await locals.safeGetSession();
  const wynik = await przetworz({
    user,
    odczyt: opcje.odczyt === true,
    typTresci: request.headers.get('content-type'),
    czytajCialo: () => request.json(),
    wykonaj: ({ userId, body }) =>
      wykonaj({ userId, body, sb: createAdminClient(), userSb: locals.supabase, url }),
  });
  return json(wynik.body, { status: wynik.status, headers: BEZ_CACHE });
}
