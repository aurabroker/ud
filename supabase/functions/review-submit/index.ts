import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return true;

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

  try {
    const body = await req.json();

    const token = String(body['cf-turnstile-response'] ?? '').trim();
    const ip    = req.headers.get('CF-Connecting-IP') ?? '';
    if (!token || !(await verifyTurnstile(token, ip))) {
      return json({ status: 'error', message: 'Weryfikacja bezpieczeństwa nie powiodła się.' }, 400);
    }

    const name    = String(body.name    ?? '').trim().substring(0, 100);
    const city    = String(body.city    ?? '').trim().substring(0, 100);
    const zawod   = body.zawod   ? String(body.zawod).trim().substring(0, 100)   : null;
    const comment = body.comment ? String(body.comment).trim().substring(0, 2000) : null;
    const rating  = parseInt(String(body.rating));

    if (!name || !city || isNaN(rating) || rating < 1 || rating > 5) {
      return json({ status: 'error', message: 'Nieprawidłowe dane.' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await supabase.from('ud_review').insert({ name, city, zawod, rating, comment });
    if (error) {
      console.error('DB error:', error.message);
      return json({ status: 'error', message: 'Błąd zapisu.' }, 500);
    }

    return json({ status: 'success' });
  } catch (e) {
    console.error('Unhandled:', e);
    return json({ status: 'error', message: 'Nieoczekiwany błąd.' }, 500);
  }
});
