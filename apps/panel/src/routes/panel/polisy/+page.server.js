/**
 * Wykaz polis (decyzja właściciela z 05.10.2026): każda sprzedaż z numerem
 * polisy, okresem ochrony, datą sprzedaży i składkami. Kto co widzi, decyduje
 * SQL (ud_leady_polisy): administrator — wszystkich, agent — swoje sprzedaże.
 */
import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { BladApi, polisy } from '$lib/server/leady.js';

export async function load({ locals, url }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  try {
    return { w: await polisy(createAdminClient(), user.id, url.searchParams), blad: '', ja: user.id };
  } catch (e) {
    if (e instanceof BladApi && e.status === 403) throw error(403, e.message);
    console.error('[polisy] load:', e?.message || e);
    return { w: null, blad: 'Nie udało się wczytać wykazu polis. Odśwież stronę za chwilę.', ja: user.id };
  }
}
