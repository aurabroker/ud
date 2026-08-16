/**
 * /health — diagnostyka konfiguracji (bez ujawniania wartości).
 * Odporny: wszystko w try/catch, więc sam nigdy nie zwraca 500.
 */
import { json } from '@sveltejs/kit';
import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { APP_VERSION } from '$lib/version.js';

const VERSION = APP_VERSION;

export async function GET({ cookies }) {
  const out = { version: VERSION, ok: false };
  try {
    const present = (v) => (v ? 'set' : 'MISSING');
    out.config = {
      PUBLIC_SUPABASE_URL: present(pubEnv.PUBLIC_SUPABASE_URL),
      PUBLIC_SUPABASE_ANON_KEY: present(pubEnv.PUBLIC_SUPABASE_ANON_KEY),
      PUBLIC_APP_URL: present(pubEnv.PUBLIC_APP_URL),
      SUPABASE_SERVICE_ROLE_KEY: present(env.SUPABASE_SERVICE_ROLE_KEY),
      PIN_COOKIE_SECRET: present(env.PIN_COOKIE_SECRET),
      SMS_TOKEN: present(env.SMSPLANET_TOKEN || env.SMSTOKEN || env.SMS_TOKEN),
      SMS_SENDER: present(env.SMSPLANET_SENDER || env.SMSSENDER || env.SMS_SENDER),
      RESEND: present(env.RESEND_API_KEY || env.RESEND_API)
    };
    // pokaż początek URL, by wykryć literówki/spacje (bez pełnej wartości)
    out.urlPreview = (pubEnv.PUBLIC_SUPABASE_URL || '').slice(0, 34);
    out.runtime = typeof crypto?.subtle !== 'undefined' ? 'webcrypto-ok' : 'webcrypto-MISSING';

    // Test 1: surowy fetch do Supabase Auth
    if (pubEnv.PUBLIC_SUPABASE_URL && pubEnv.PUBLIC_SUPABASE_ANON_KEY) {
      try {
        const res = await fetch(`${pubEnv.PUBLIC_SUPABASE_URL}/auth/v1/health`, {
          headers: { apikey: pubEnv.PUBLIC_SUPABASE_ANON_KEY }
        });
        out.supabaseFetch = res.ok ? 'ok' : `http ${res.status}`;
      } catch (e) {
        out.supabaseFetch = 'error: ' + (e?.message || e);
      }

      // Test 2: dokładnie to co robi strona główna (createServerClient + getUser)
      try {
        const sb = createServerClient(pubEnv.PUBLIC_SUPABASE_URL, pubEnv.PUBLIC_SUPABASE_ANON_KEY, {
          cookies: { getAll: () => cookies.getAll(), setAll: () => {} }
        });
        const { error } = await sb.auth.getUser();
        out.authGetUser = error ? 'error: ' + error.message : 'ok (brak sesji lub sesja)';
      } catch (e) {
        out.authGetUser = 'THROW: ' + (e?.message || e);
      }
    } else {
      out.supabaseFetch = 'skipped';
      out.authGetUser = 'skipped';
    }

    out.ok =
      out.config.PUBLIC_SUPABASE_URL === 'set' &&
      out.config.PUBLIC_SUPABASE_ANON_KEY === 'set' &&
      out.config.SUPABASE_SERVICE_ROLE_KEY === 'set';
  } catch (e) {
    out.fatal = (e?.message || String(e)) + ' | ' + (e?.stack || '');
  }
  return json(out);
}
