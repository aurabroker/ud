/**
 * Tablica leadów (Kanban). Dane czyta wyłącznie klucz serwisowy — tabele nie
 * mają polityk RLS — więc dostęp sprawdzamy sami: sesja agenta + aktywny profil
 * (wczytajPlan). Szczegóły, zmiany i kolejne strony idą przez /panel/leady/api/*.
 */
import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { BladApi, wczytajTablice } from '$lib/server/leady.js';

export async function load({ locals, url }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  try {
    const tablica = await wczytajTablice(createAdminClient(), locals.supabase, user.id, url.searchParams);
    return { tablica, blad: '' };
  } catch (e) {
    if (e instanceof BladApi && e.status === 403) throw error(403, e.message);
    console.error('[leady] load:', e?.message || e);
    return { tablica: null, blad: 'Nie udało się wczytać tablicy leadów. Odśwież stronę za chwilę.' };
  }
}
