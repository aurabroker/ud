/**
 * Statystyki sprzedaży z tablicy leadów (etap „Wygrany"). Kto co widzi,
 * rozstrzyga SQL (ud_leady_statystyki): administrator — wszystkich i każdego
 * z osobna, agent — wyłącznie swoje, niezależnie od parametrów adresu.
 */
import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { BladApi, statystyki } from '$lib/server/leady.js';

export async function load({ locals, url }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  try {
    return { st: await statystyki(createAdminClient(), user.id, url.searchParams), blad: '', ja: user.id };
  } catch (e) {
    if (e instanceof BladApi && e.status === 403) throw error(403, e.message);
    console.error('[statystyki] load:', e?.message || e);
    return { st: null, blad: 'Nie udało się wczytać statystyk. Odśwież stronę za chwilę.', ja: user.id };
  }
}
