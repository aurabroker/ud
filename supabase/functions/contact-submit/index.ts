import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logError } from '../_shared/logger.ts';

/**
 * contact-submit — formularz „szybki kontakt" ze strony głównej.
 *
 * Powód istnienia: wcześniej app.js strzelał prosto do PostgREST i dokładał do
 * payloadu pole `cf-turnstile-response`. Tabela udochodu_contacts nie ma takiej
 * kolumny, więc PostgREST odrzucał każdy INSERT błędem PGRST204 — formularz był
 * martwy od 15.06.2026. Przy okazji token Turnstile nie miał kto zweryfikować:
 * PostgREST nie rozmawia z Cloudflare. Tutaj weryfikacja dzieje się serwerowo,
 * a do bazy trafiają wyłącznie kolumny, które w niej istnieją.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return true; // brak konfiguracji = nie blokuj wysyłki

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  return data.success === true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const ip = req.headers.get('CF-Connecting-IP') ?? '';
  let raw = '';

  try {
    // Czytamy jako tekst, żeby puste ciało dało zrozumiały komunikat,
    // a nie gołe SyntaxError bez śladu, co właściwie przyszło.
    raw = await req.text();
    if (!raw.trim()) {
      await logError('contact-submit', 'Puste ciało żądania', { contentLength: req.headers.get('content-length') }, ip);
      return json({ status: 'error', message: 'Brak danych formularza.' }, 400);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch (e) {
      await logError('contact-submit', `Niepoprawny JSON: ${e}`, { raw: raw.substring(0, 500) }, ip);
      return json({ status: 'error', message: 'Nieprawidłowy format danych.' }, 400);
    }

    const token = String(body['cf-turnstile-response'] ?? '').trim();
    if (!token || !(await verifyTurnstile(token, ip))) {
      return json({ status: 'error', message: 'Weryfikacja bezpieczeństwa nie powiodła się. Odśwież stronę i spróbuj ponownie.' }, 400);
    }

    const name  = String(body.name  ?? '').trim().substring(0, 100);
    const email = String(body.email ?? '').trim().substring(0, 150).toLowerCase();
    const phone = String(body.phone ?? '').trim().substring(0, 30);

    if (!name || !email || !phone) {
      return json({ status: 'error', message: 'Uzupełnij imię, e-mail i telefon.' }, 400);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      return json({ status: 'error', message: 'Nieprawidłowy adres e-mail.' }, 400);
    }
    // Telefon: co najmniej 9 cyfr po odrzuceniu spacji, myślników i prefiksu.
    if ((phone.match(/\d/g) ?? []).length < 9) {
      return json({ status: 'error', message: 'Nieprawidłowy numer telefonu.' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Tylko kolumny, które istnieją w udochodu_contacts.
    // Webhook ON INSERT odpala send-confirmation-email (e-mail + WhatsApp do doradcy).
    const { error } = await supabase
      .from('udochodu_contacts')
      .insert({ name, email, phone, rodo_consent: body.rodo_consent === true });

    if (error) {
      await logError('contact-submit', error.message, { code: error.code, details: error.details }, ip);
      return json({ status: 'error', message: 'Nie udało się zapisać zgłoszenia.' }, 500);
    }

    return json({ status: 'success' });
  } catch (e) {
    await logError('contact-submit', String(e), { raw: raw.substring(0, 500) }, ip);
    return json({ status: 'error', message: 'Nieoczekiwany błąd.' }, 500);
  }
});
