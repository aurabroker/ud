import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
  const { user } = await locals.safeGetSession();
  throw redirect(303, user ? '/panel' : '/login');
}
