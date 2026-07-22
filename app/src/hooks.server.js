/**
 * hooks.server.js — sesja agenta (Supabase SSR) w event.locals.
 * Klient panel = zalogowany agent (auth.users + ud_user_profiles).
 * Widok oferty klienta NIE używa tej sesji (idzie przez service_role + PIN).
 */
import { createServerClient } from '@supabase/ssr';
import { env as pubEnv } from '$env/dynamic/public';

export async function handle({ event, resolve }) {
  event.locals.supabase = createServerClient(
    pubEnv.PUBLIC_SUPABASE_URL,
    pubEnv.PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => event.cookies.getAll(),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) {
            event.cookies.set(name, value, { ...options, path: '/' });
          }
        }
      }
    }
  );

  /** Zwraca zweryfikowaną sesję (getUser waliduje JWT po stronie Auth). */
  event.locals.safeGetSession = async () => {
    const {
      data: { user },
      error
    } = await event.locals.supabase.auth.getUser();
    if (error || !user) return { session: null, user: null };
    const {
      data: { session }
    } = await event.locals.supabase.auth.getSession();
    return { session, user };
  };

  return resolve(event, {
    filterSerializedResponseHeaders: (name) => name === 'content-range' || name === 'x-supabase-api-version'
  });
}
