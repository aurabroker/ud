/**
 * supabaseBrowser.js — klient Supabase w przeglądarce (panel agenta).
 * Współdzieli sesję cookie z SSR przez @supabase/ssr.
 */
import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';

let client;

export function getSupabaseBrowser() {
  if (!client) {
    client = createBrowserClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY);
  }
  return client;
}
