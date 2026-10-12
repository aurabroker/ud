/**
 * Adapter SvelteKit dla endpointów tablicy leadów: sesja z locals, klient
 * serwisowy tworzony dopiero w obsłudze (brak zmiennych środowiskowych kończy
 * się 500 z komunikatem ogólnym, nie wywrotką trasy), odpowiedź bez cache.
 */
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { BladApi, POLISA_MAX_BAJTOW, przetworz } from '$lib/server/leady.js';

const BEZ_CACHE = { 'cache-control': 'no-store' };

/**
 * @param {{ locals: App.Locals, request: Request, url: URL }} zdarzenie
 * @param {(ctx: { userId: string, body: any, sb: any, userSb: any, url: URL }) => Promise<{ status: number, body: unknown }>} wykonaj
 * @param {{ odczyt?: boolean, pdf?: boolean }} [opcje] `pdf`: treść to sam plik
 *   (application/pdf, do 10 MB) — limit sprawdzany przed wczytaniem całości.
 */
export async function obsluz({ locals, request, url }, wykonaj, opcje = {}) {
  const { user } = await locals.safeGetSession();
  const wynik = await przetworz({
    user,
    odczyt: opcje.odczyt === true,
    oczekiwanyTyp: opcje.pdf ? 'application/pdf' : 'application/json',
    typTresci: request.headers.get('content-type'),
    czytajCialo: opcje.pdf ? () => czytajPdf(request) : () => request.json(),
    wykonaj: ({ userId, body }) =>
      wykonaj({ userId, body, sb: createAdminClient(), userSb: locals.supabase, url }),
  });
  return json(wynik.body, { status: wynik.status, headers: BEZ_CACHE });
}

const ZA_DUZY = () => new BladApi(413, { status: 'blad', komunikat: 'Plik jest za duży — limit to 10 MB.' });

/** Treść żądania jako bajty PDF, z limitem rozmiaru (nagłówek i faktyczna długość). */
async function czytajPdf(request) {
  const deklarowany = Number(request.headers.get('content-length') || 0);
  if (deklarowany > POLISA_MAX_BAJTOW) throw ZA_DUZY();
  const bajty = new Uint8Array(await request.arrayBuffer());
  if (bajty.length > POLISA_MAX_BAJTOW) throw ZA_DUZY();
  return bajty;
}
