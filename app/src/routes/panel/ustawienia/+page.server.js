import { error, fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { getSettings } from '$lib/server/settings.js';

const PUBLIC_BUCKET = 'ud-public';

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

async function setSetting(sb, key, value) {
  await sb.from('ud_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

export const actions = {
  save: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const form = await request.formData();
    const keys = ['company_name', 'company_full', 'default_broker_message', 'exclusions_text', 'pdf_footer'];
    const rows = keys.map((key) => ({ key, value: String(form.get(key) ?? ''), updated_at: new Date().toISOString() }));
    const { error: e } = await sb.from('ud_settings').upsert(rows, { onConflict: 'key' });
    if (e) return fail(400, { error: 'Zapis: ' + e.message });
    return { ok: true };
  },

  uploadLogo: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const form = await request.formData();
    const file = form.get('logo');
    if (!file || typeof file !== 'object' || file.size === 0) return fail(400, { error: 'Wybierz plik logo.' });
    if (!/^image\//.test(file.type || '') && !/\.(png|jpe?g|svg|webp)$/i.test(file.name)) {
      return fail(400, { error: 'Logo musi być obrazem (PNG/JPG/SVG/WEBP).' });
    }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = `logo-${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage
      .from(PUBLIC_BUCKET)
      .upload(path, bytes, { contentType: file.type || 'image/png', upsert: true });
    if (upErr) return fail(400, { error: 'Upload: ' + upErr.message });

    const { data: pub } = sb.storage.from(PUBLIC_BUCKET).getPublicUrl(path);
    await setSetting(sb, 'logo_url', pub.publicUrl);
    await setSetting(sb, 'logo_path', path);
    return { ok: true };
  },

  removeLogo: async ({ locals }) => {
    const sb = await requireAdmin(locals);
    const settings = await getSettings();
    if (settings.logo_path) await sb.storage.from(PUBLIC_BUCKET).remove([settings.logo_path]).catch(() => {});
    await setSetting(sb, 'logo_url', '');
    await setSetting(sb, 'logo_path', '');
    return { ok: true };
  }
};
