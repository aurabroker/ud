import { redirect } from '@sveltejs/kit';

export async function load({ locals, url }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const channel = url.searchParams.get('kanal') || '';
  const status = url.searchParams.get('status') || '';

  // locals.supabase działa w kontekście zalogowanego użytkownika, więc RLS
  // sam ogranicza wynik: agent widzi wysyłki swoich ofert, admin wszystkie.
  let q = locals.supabase
    .from('ud_send_log')
    .select('id, created_at, channel, recipient, status, provider_id, error, offer_id, ud_offers(offer_number, client_name)')
    .order('created_at', { ascending: false })
    .limit(300);

  if (channel) q = q.eq('channel', channel);
  if (status) q = q.eq('status', status);

  const { data: logs, error } = await q;

  return {
    logs: logs || [],
    loadError: error?.message || '',
    filters: { channel, status }
  };
}
