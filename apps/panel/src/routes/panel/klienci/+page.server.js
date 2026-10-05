import { redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { listaKlientow } from '$lib/server/klienci.js';

export async function load({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  return { clients: await listaKlientow(createAdminClient(), user.id) };
}
