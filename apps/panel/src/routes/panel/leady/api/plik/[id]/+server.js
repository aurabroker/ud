/**
 * GET …/plik/<plikId> — przekierowanie na adres podpisany na minutę. Kto widzi
 * lead, ten pobiera jego plik; reszta dostaje 404 (SQL: ud_lead_plik).
 */
import { json, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { BladApi, adresPliku } from '$lib/server/leady.js';

export async function GET({ locals, params }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  let adres;
  try {
    adres = await adresPliku(createAdminClient(), user.id, params.id);
  } catch (e) {
    if (e instanceof BladApi) return json(e.body, { status: e.status, headers: { 'cache-control': 'no-store' } });
    console.error('[leady] pobranie pliku:', e?.message || e);
    return json({ status: 'blad', komunikat: 'Nie udało się pobrać pliku.' }, { status: 500 });
  }
  throw redirect(303, adres);
}
