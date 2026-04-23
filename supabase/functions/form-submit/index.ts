import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/* ── AES-256-GCM PESEL encryption ── */
async function encryptPesel(pesel: string): Promise<string> {
  const keyHex = Deno.env.get('PESEL_ENCRYPTION_KEY');
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('PESEL_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(pesel);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

/* ── Web3Forms notification (no PESEL) ── */
async function notifyWeb3Forms(data: Record<string, string>): Promise<boolean> {
  const key = Deno.env.get('WEB3FORMS_KEY');
  if (!key) return false;

  const safeData = { ...data };
  delete safeData.pesel;
  delete safeData.pesel_enc;

  const body = new FormData();
  body.append('access_key', key);
  for (const [k, v] of Object.entries(safeData)) body.append(k, String(v));

  const res = await fetch('https://api.web3forms.com/submit', { method: 'POST', body });
  return res.ok;
}

/* ── GetResponse contact sync ── */
async function syncGetResponse(data: Record<string, string>): Promise<boolean> {
  const apiKey = Deno.env.get('GETRESPONSE_API_KEY');
  const listId = Deno.env.get('GETRESPONSE_LIST_ID');
  if (!apiKey || !listId) return false;

  const [firstName, ...rest] = (data.fullName ?? '').split(' ');
  const payload = {
    name: firstName,
    email: data.email,
    campaign: { campaignId: listId },
    customFieldValues: rest.length ? [{ customFieldId: 'lastname', value: [rest.join(' ')] }] : [],
  };

  const res = await fetch('https://api.getresponse.com/v3/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': `api-key ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  return res.ok || res.status === 409;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();

    /* Validate required fields */
    const pesel: string = (body.pesel ?? '').trim();
    if (!/^\d{11}$/.test(pesel)) {
      return new Response(JSON.stringify({ status: 'error', message: 'Nieprawidłowy PESEL.' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    /* Encrypt PESEL before any storage */
    const peselEnc = await encryptPesel(pesel);

    /* Build safe record: PESEL replaced with ciphertext, never stored in plain */
    const record: Record<string, string> = { ...body };
    delete record.pesel;
    record.pesel_enc = peselEnc;

    /* Supabase insert */
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { error: dbError } = await supabase.from('ud_clients').insert([record]);

    /* Fan-out notifications in parallel — failures are non-fatal */
    const [web3ok, grOk] = await Promise.all([
      notifyWeb3Forms(record).catch(() => false),
      syncGetResponse(record).catch(() => false),
    ]);

    if (dbError) {
      console.error('DB insert error:', dbError.message);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Błąd zapisu. Spróbuj ponownie.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ status: 'success', supabase: 'ok', web3forms: web3ok, getresponse: grOk }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Unhandled error:', err);
    return new Response(
      JSON.stringify({ status: 'error', message: 'Nieoczekiwany błąd serwera.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
