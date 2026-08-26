import { json, error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { outboundIp } from '$lib/server/netinfo.js';

/**
 * Adres wyjściowy aplikacji — do zgłoszeń u dostawców filtrujących ruch po IP.
 * Każde wywołanie pyta na nowo: Cloudflare korzysta z puli adresów.
 */
export async function GET({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  const sb = createAdminClient();
  const { data: me } = await sb.from('ud_user_profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') throw error(403, 'Tylko administrator.');

  const net = await outboundIp();
  return json({ ip: net.ip, source: net.source, error: net.error || null, sprawdzono: new Date().toISOString() });
}
