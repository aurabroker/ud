/**
 * hooks.server.js — sesja agenta (Supabase SSR) w event.locals.
 * Klient panel = zalogowany agent (auth.users + ud_user_profiles).
 * Widok oferty klienta NIE używa tej sesji (idzie przez service_role + PIN).
 *
 * Odporne na brak env: zamiast twardego 500 na każdej trasie, brak
 * konfiguracji jest sygnalizowany przez locals.configError (+ /health).
 */
import { createServerClient } from '@supabase/ssr';
import { env as pubEnv } from '$env/dynamic/public';

export async function handle({ event, resolve }) {
  const url = pubEnv.PUBLIC_SUPABASE_URL;
  const anon = pubEnv.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    event.locals.supabase = null;
    event.locals.configError = 'Brak PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY';
    event.locals.safeGetSession = async () => ({ session: null, user: null });
  } else {
    event.locals.supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => event.cookies.getAll(),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) {
            event.cookies.set(name, value, { ...options, path: '/' });
          }
        }
      }
    });

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
  }

  return resolve(event, {
    filterSerializedResponseHeaders: (name) => name === 'content-range' || name === 'x-supabase-api-version'
  });
}
