import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const { data: profile } = await locals.supabase
    .from('ud_user_profiles')
    .select('id, full_name, role')
    .eq('id', user.id)
    .maybeSingle();

  return { user: { id: user.id, email: user.email }, profile };
}
