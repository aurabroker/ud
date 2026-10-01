import { fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';

const OWU_BUCKET = 'ud-owu';

export async function load({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const sb = createAdminClient();
  const { data } = await sb
    .from('ud_owu_library')
    .select('*')
    .order('insurer_type')
    .order('created_at', { ascending: false });

  return { owu: data || [] };
}

export const actions = {
  upload: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');

    const form = await request.formData();
    const insurer_type = String(form.get('insurer_type') || '');
    const symbol = String(form.get('symbol') || '').trim();
    const title = String(form.get('title') || '').trim();
    const version = String(form.get('version') || '').trim();
    const file = form.get('file');

    if (!['leadenhall', 'ceu'].includes(insurer_type)) return fail(400, { error: 'Wybierz ubezpieczyciela.' });
    if (!symbol) return fail(400, { error: 'Podaj symbol OWU (klucz dopasowania).' });
    if (!title) return fail(400, { error: 'Podaj tytuł OWU.' });
    if (!file || typeof file !== 'object' || file.size === 0) return fail(400, { error: 'Dodaj plik PDF.' });

    const sb = createAdminClient();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = `${insurer_type}/${crypto.randomUUID()}.pdf`;

    const { error: upErr } = await sb.storage
      .from(OWU_BUCKET)
      .upload(path, bytes, { contentType: 'application/pdf', upsert: false });
    if (upErr) return fail(400, { error: 'Upload: ' + upErr.message });

    const { error: insErr } = await sb.from('ud_owu_library').insert({
      insurer_type,
      symbol,
      title,
      version: version || null,
      storage_bucket: OWU_BUCKET,
      storage_path: path,
      file_name: file.name,
      size_bytes: bytes.byteLength,
      active: true
    });
    if (insErr) {
      await sb.storage.from(OWU_BUCKET).remove([path]);
      return fail(400, { error: 'Zapis: ' + insErr.message });
    }

    return { ok: true };
  },

  toggle: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') || '');
    const active = String(form.get('active') || '') === 'true';
    const sb = createAdminClient();
    await sb.from('ud_owu_library').update({ active: !active }).eq('id', id);
    return { ok: true };
  },

  delete: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') || '');
    const sb = createAdminClient();
    const { data: row } = await sb.from('ud_owu_library').select('storage_bucket, storage_path').eq('id', id).maybeSingle();
    if (row) await sb.storage.from(row.storage_bucket).remove([row.storage_path]).catch(() => {});
    await sb.from('ud_owu_library').delete().eq('id', id);
    return { ok: true };
  }
};
