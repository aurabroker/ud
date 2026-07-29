/**
 * health.js — sprawdzenia stanu aplikacji do tabeli w Ustawieniach.
 * status: 'ok' (zielony) | 'error' (czerwony) | 'warn' (pomarańczowy)
 */
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { APP_VERSION } from '$lib/version.js';

export async function runHealthChecks() {
  const checks = [];
  const add = (label, status, detail = '') => checks.push({ label, status, detail });

  const url = (pubEnv.PUBLIC_SUPABASE_URL || '').trim();
  const anon = (pubEnv.PUBLIC_SUPABASE_ANON_KEY || '').trim();
  const service = env.SUPABASE_SERVICE_ROLE_KEY;

  // --- Krytyczne ---
  add('Supabase URL', url ? 'ok' : 'error', url ? '' : 'Brak PUBLIC_SUPABASE_URL');
  add('Supabase klucz anon', anon ? 'ok' : 'error', anon ? '' : 'Brak PUBLIC_SUPABASE_ANON_KEY');
  add('Supabase service_role', service ? 'ok' : 'error', service ? '' : 'Brak SUPABASE_SERVICE_ROLE_KEY');
  add('Sekret PIN (cookie)', env.PIN_COOKIE_SECRET ? 'ok' : 'error', env.PIN_COOKIE_SECRET ? '' : 'Brak PIN_COOKIE_SECRET');

  // --- Adres aplikacji (linki) ---
  const appUrl = (pubEnv.PUBLIC_APP_URL || '').trim();
  if (!appUrl) add('Adres aplikacji', 'warn', 'Brak PUBLIC_APP_URL — linki użyją app.utratadochodu.pl');
  else if (/pages\.dev/i.test(appUrl)) add('Adres aplikacji', 'warn', `PUBLIC_APP_URL wskazuje na ${appUrl} — linki i tak użyją app.utratadochodu.pl`);
  else add('Adres aplikacji', 'ok', appUrl);

  // --- SMS (SMSPlanet) ---
  const smsTok = env.SMSPLANET_TOKEN || env.SMSTOKEN || env.SMS_TOKEN;
  const smsSnd = env.SMSPLANET_SENDER || env.SMSSENDER || env.SMS_SENDER;
  if (smsTok && smsSnd) add('SMS (SMSPlanet)', 'ok');
  else if (!smsTok && !smsSnd) add('SMS (SMSPlanet)', 'warn', 'Brak tokenu i nadawcy — SMS nie będą wysyłane');
  else if (smsTok && !smsSnd) add('SMS (SMSPlanet)', 'warn', 'Jest token, brak nazwy nadawcy (SMSSENDER)');
  else add('SMS (SMSPlanet)', 'warn', 'Jest nadawca, brak tokenu (SMSTOKEN)');

  // --- Email (Resend) ---
  const resend = env.RESEND_API_KEY || env.RESEND_API;
  add('Email (Resend)', resend ? 'ok' : 'warn', resend ? '' : 'Brak klucza — maile nie będą wysyłane');

  // --- PDF (PDFShift) ---
  const pdfshift = env.PDFSHIFT_API_KEY || env.PDFSHIFT_API;
  add('PDF podsumowania (PDFShift)', pdfshift ? 'ok' : 'warn', pdfshift ? '' : 'Brak klucza — PDF nie będzie generowany');

  // --- Runtime ---
  const webcrypto = typeof crypto?.subtle !== 'undefined';
  add('Runtime (Web Crypto / nodejs_compat)', webcrypto ? 'ok' : 'error', webcrypto ? '' : 'Brak Web Crypto — dodaj flagę nodejs_compat');

  // --- Połączenie z Supabase ---
  if (url && anon) {
    try {
      const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anon } });
      add('Połączenie z Supabase', res.ok ? 'ok' : 'error', res.ok ? '' : `HTTP ${res.status}`);
    } catch (e) {
      add('Połączenie z Supabase', 'error', e?.message || String(e));
    }
  } else {
    add('Połączenie z Supabase', 'warn', 'Pominięte — brak URL/klucza anon');
  }

  const summary = checks.some((c) => c.status === 'error')
    ? 'error'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'ok';

  return { version: APP_VERSION, summary, checks };
}
