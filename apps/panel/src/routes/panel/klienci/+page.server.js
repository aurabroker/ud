import { redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';

export async function load({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const sb = createAdminClient();
  const [{ data: clients }, { data: profiles }] = await Promise.all([
    sb.from('ud_clients')
      .select('id, full_name, email, phone, profession, employment_type, referred_by, created_at, source')
      .order('created_at', { ascending: false }),
    sb.from('ud_user_profiles').select('id, full_name')
  ]);

  const owners = {};
  for (const p of profiles || []) owners[p.id] = p.full_name || '—';

  const rows = (clients || []).map((c) => ({
    ...c,
    owner_name: c.referred_by ? (owners[c.referred_by] || 'nieznany user') : null
  }));

  return { clients: rows };
}
