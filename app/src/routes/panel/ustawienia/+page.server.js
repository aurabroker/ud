import { error, fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { getSettings } from '$lib/server/settings.js';

async function requireAdmin(locals) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  const sb = createAdminClient();
  const { data: me } = await sb.from('ud_user_profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') throw error(403, 'Tylko administrator.');
  return sb;
}

export async function load({ locals }) {
  await requireAdmin(locals);
  const settings = await getSettings();
  return { settings };
}

export const actions = {
  save: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const form = await request.formData();
    const keys = ['company_name', 'company_full', 'default_broker_message', 'exclusions_text'];
    const rows = keys.map((key) => ({
      key,
      value: String(form.get(key) ?? ''),
      updated_at: new Date().toISOString()
    }));
    const { error: e } = await sb.from('ud_settings').upsert(rows, { onConflict: 'key' });
    if (e) return fail(400, { error: 'Zapis: ' + e.message });
    return { ok: true };
  }
};
