import { fail, redirect } from '@sveltejs/kit';

export async function load({ locals }) {
  const { user } = await locals.safeGetSession();
  if (user) throw redirect(303, '/panel');
  return {};
}

export const actions = {
  default: async ({ request, locals }) => {
    const form = await request.formData();
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    if (!email || !password) return fail(400, { error: 'Podaj email i hasło.' });

    const { error } = await locals.supabase.auth.signInWithPassword({ email, password });
    if (error) return fail(400, { error: 'Błędny email lub hasło.', email });

    throw redirect(303, '/panel');
  }
};
