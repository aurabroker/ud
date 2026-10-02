import { redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { liczNiedokonczone } from '$lib/server/niedokonczone.js';

export async function load({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const [{ data: profile }, niedokonczone] = await Promise.all([
    locals.supabase
      .from('ud_user_profiles')
      .select('id, full_name, role')
      .eq('id', user.id)
      .maybeSingle(),
    // Awaria licznika (także brak klucza serwisowego) nie może zablokować panelu:
    // null = „nie wiadomo", zakładka nie miga.
    Promise.resolve().then(() => liczNiedokonczone(createAdminClient())).catch(() => null),
  ]);

  return { user: { id: user.id, email: user.email }, profile, niedokonczone };
}
