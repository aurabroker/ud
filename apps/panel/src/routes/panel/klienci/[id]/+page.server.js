import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';

export async function load({ params, locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const sb = createAdminClient();
  const { data: client } = await sb.from('ud_clients').select('*').eq('id', params.id).maybeSingle();
  if (!client) throw error(404, 'Klient nie znaleziony');

  let owner_name = null;
  if (client.referred_by) {
    const { data: p } = await sb.from('ud_user_profiles').select('full_name').eq('id', client.referred_by).maybeSingle();
    owner_name = p?.full_name || 'nieznany user';
  }

  const { data: offers } = await sb
    .from('ud_offers')
    .select('id, name, status, created_at, source')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false });

  return { client, owner_name, offers: offers || [] };
}
