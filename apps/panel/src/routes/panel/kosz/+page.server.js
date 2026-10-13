/**
 * /panel/kosz — usunięte oferty, do przywrócenia przez 30 dni.
 *
 * Widoczność i uprawnienia decyduje SQL (ud_kosz_ofert_lista,
 * ud_oferta_z_kosza): właściciel oferty, administrator i osoba, która ofertę
 * usunęła. Tożsamość z sesji, nigdy z formularza.
 */
import { fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { listaKosza, przywrocZKosza, KOSZ_DNI } from '$lib/server/kosz.js';

export async function load({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  try {
    return { wpisy: await listaKosza(createAdminClient(), user.id), dni: KOSZ_DNI, blad: '' };
  } catch (e) {
    return { wpisy: [], dni: KOSZ_DNI, blad: e?.message || 'Nie udało się wczytać kosza' };
  }
}

export const actions = {
  przywroc: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');
    const id = String((await request.formData()).get('id') || '');
    let offerId;
    try {
      ({ offerId } = await przywrocZKosza(createAdminClient(), id, user.id));
    } catch (e) {
      return fail(400, { error: e?.message || 'Nie udało się przywrócić oferty' });
    }
    throw redirect(303, `/panel/offer/${offerId}`);
  }
};
