/**
 * /health — diagnostyka konfiguracji (bez ujawniania wartości).
 * Pokazuje które zmienne środowiskowe są ustawione + czy Supabase odpowiada.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';

export async function GET() {
  const present = (v) => (v ? 'set' : 'MISSING');

  const config = {
    PUBLIC_SUPABASE_URL: present(pubEnv.PUBLIC_SUPABASE_URL),
    PUBLIC_SUPABASE_ANON_KEY: present(pubEnv.PUBLIC_SUPABASE_ANON_KEY),
    PUBLIC_APP_URL: present(pubEnv.PUBLIC_APP_URL),
    SUPABASE_SERVICE_ROLE_KEY: present(env.SUPABASE_SERVICE_ROLE_KEY),
    PIN_COOKIE_SECRET: present(env.PIN_COOKIE_SECRET),
    SMSAPI_TOKEN: present(env.SMSAPI_TOKEN),
    RESEND_API_KEY: present(env.RESEND_API_KEY),
    PDFSHIFT_API_KEY: present(env.PDFSHIFT_API_KEY)
  };

  // Test połączenia z Supabase (jeśli mamy URL+anon)
  let supabase = 'skipped';
  if (pubEnv.PUBLIC_SUPABASE_URL && pubEnv.PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const res = await fetch(`${pubEnv.PUBLIC_SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: pubEnv.PUBLIC_SUPABASE_ANON_KEY }
      });
      supabase = res.ok ? 'ok' : `http ${res.status}`;
    } catch (e) {
      supabase = 'error: ' + (e?.message || e);
    }
  }

  const missingCritical = ['PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
    .filter((k) => config[k] === 'MISSING');

  return json({
    ok: missingCritical.length === 0,
    missingCritical,
    config,
    supabase,
    runtime: typeof crypto?.subtle !== 'undefined' ? 'webcrypto-ok' : 'webcrypto-MISSING'
  });
}
