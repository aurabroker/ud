import { error, fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';

async function requireAdmin(locals) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  const sb = createAdminClient();
  const { data: me } = await sb.from('ud_user_profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') throw error(403, 'Tylko administrator.');
  return sb;
}

export async function load({ locals }) {
  const sb = await requireAdmin(locals);

  const { data: profiles } = await sb
    .from('ud_user_profiles')
    .select('id, full_name, role, active, leader_id, created_at')
    .order('created_at', { ascending: false });

  // e-maile z auth.users
  const emails = {};
  try {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of data?.users || []) emails[u.id] = u.email;
  } catch (e) {
    // brak dostępu do listy — pomiń e-maile
  }

  const users = (profiles || []).map((p) => ({ ...p, email: emails[p.id] || null }));
  return { users };
}

export const actions = {
  create: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const form = await request.formData();
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    const fullName = String(form.get('fullName') || '').trim();
    const role = String(form.get('role') || 'user');
    if (!email || password.length < 6) return fail(400, { error: 'Podaj email i hasło (min. 6 znaków).' });

    const { data: created, error: cErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (cErr) return fail(400, { error: 'Tworzenie konta: ' + cErr.message });

    const { error: pErr } = await sb.from('ud_user_profiles').insert({
      id: created.user.id,
      full_name: fullName || email,
      role: role === 'admin' ? 'admin' : 'user',
      active: true
    });
    if (pErr) return fail(400, { error: 'Profil: ' + pErr.message });
    return { ok: true };
  },

  update: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') || '');
    const patch = {};
    if (form.has('role')) patch.role = String(form.get('role')) === 'admin' ? 'admin' : 'user';
    if (form.has('active')) patch.active = String(form.get('active')) === 'true';
    if (form.has('fullName')) patch.full_name = String(form.get('fullName')).trim() || null;
    await sb.from('ud_user_profiles').update(patch).eq('id', id);
    return { ok: true };
  },

  setPassword: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') || '');
    const password = String(form.get('password') || '');
    if (password.length < 6) return fail(400, { error: 'Hasło min. 6 znaków.' });
    const { error: e } = await sb.auth.admin.updateUserById(id, { password });
    if (e) return fail(400, { error: 'Zmiana hasła: ' + e.message });
    return { ok: true };
  }
};
