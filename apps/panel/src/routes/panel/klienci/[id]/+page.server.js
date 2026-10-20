import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { klientWidoczny } from '$lib/server/widocznosc.js';

export async function load({ params, locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const sb = createAdminClient();
  // Cudzy klient wygląda dla agenta jak nieistniejący — bez zdradzania, że jest.
  if (!/^[0-9a-f-]{36}$/i.test(params.id) || !(await klientWidoczny(sb, user.id, params.id))) {
    throw error(404, 'Klient nie znaleziony');
  }
  const { data: client } = await sb.from('ud_clients').select('*').eq('id', params.id).maybeSingle();
  if (!client) throw error(404, 'Klient nie znaleziony');

  let owner_name = null;
  if (client.referred_by) {
    const { data: p } = await sb.from('ud_user_profiles').select('full_name').eq('id', client.referred_by).maybeSingle();
    owner_name = p?.full_name || 'nieznany user';
  }

  const { data: offers } = await sb
    .from('ud_offers')
    .select('id, name, offer_number, status, created_at, sent_at, client_choice, source')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false });

  // Warianty wybrane przez klienta — żeby karta mówiła, CO wybrał, nie tylko że wybrał.
  const ids = (offers || []).map((o) => o.client_choice?.document_id).filter(Boolean);
  const { data: wybrane } = ids.length
    ? await sb
        .from('ud_offer_documents')
        .select('id, offer_number, temp_monthly_benefit, indemnity_period, wait_accident, wait_illness, premium_total')
        .in('id', ids)
    : { data: [] };

  return { client, owner_name, offers: offers || [], wybrane: wybrane || [] };
}
