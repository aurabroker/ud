/** Licznik do migającej zakładki „Niedokończone" (menu odpytuje co minutę). */
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { liczNiedokonczone } from '$lib/server/niedokonczone.js';

export async function GET({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) return json({ ile: null }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const ile = await liczNiedokonczone(createAdminClient());
  return json({ ile }, { headers: { 'cache-control': 'no-store' } });
}
