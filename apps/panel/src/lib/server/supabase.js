/**
 * supabase.js — serwerowi klienci Supabase.
 * - createAdminClient(): service_role, omija RLS. TYLKO na serwerze.
 *   Używany do dostępu klienta (po tokenie+PIN) i operacji storage.
 */
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';

/** @returns {import('@supabase/supabase-js').SupabaseClient} */
export function createAdminClient() {
  const url = pubEnv.PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Brak PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
