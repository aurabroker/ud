import { redirect } from '@sveltejs/kit';

export async function POST({ locals }) {
  await locals.supabase.auth.signOut();
  throw redirect(303, '/login');
}
