import { redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { listaKlientow } from '$lib/server/klienci.js';

export async function load({ locals, url }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  // Klient, którego lead jest w archiwum tablicy, siedzi w widoku „Archiwum", nie na liście.
  return {
    clients: await listaKlientow(createAdminClient(), user.id),
    archiwum: url.searchParams.get('widok') === 'archiwum',
  };
}
