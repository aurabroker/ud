/**
 * POST /api/cron/przypomnienia-ofert — przypomnienie SMS o ofercie bez
 * odpowiedzi. Woła pg_cron co godzinę przez ud_oferty_przypomnienia()
 * (migracja 20261012123157_oferty_przypomnienia_sms.sql).
 *
 * Bramka: nagłówek x-cron-token sprawdzany przez edge_cron_token_matches()
 * PRZED pierwszym odczytem — ta sama wartość z Vaulta, co przy funkcjach
 * brzegowych wołanych przez cron. Bez sesji agenta, więc bez niej każdy, kto
 * zna adres, mógłby rozsyłać SMS-y naszym nadawcą.
 *
 * Godziny: dni robocze 9–18 czasu polskiego (wOknieWysylki). Poza nimi
 * wywołanie kończy się bez odczytu kandydatów.
 */
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { sendSms } from '$lib/server/sms.js';
import { wOknieWysylki } from '$lib/server/smsOferta.js';
import { wyslijPrzypomnienia } from '$lib/server/przypomnieniaOfert.js';

export async function POST({ request }) {
  const token = request.headers.get('x-cron-token') || '';
  if (!token) return json({ ok: false, error: 'brak tokenu' }, { status: 401 });

  let sb;
  try {
    sb = createAdminClient();
  } catch (e) {
    return json({ ok: false, error: 'brak konfiguracji' }, { status: 503 });
  }

  const { data: zgodny, error: bladTokenu } = await sb.rpc('edge_cron_token_matches', { token });
  if (bladTokenu) return json({ ok: false, error: 'nie da się sprawdzić tokenu' }, { status: 503 });
  if (zgodny !== true) return json({ ok: false, error: 'zły token' }, { status: 401 });

  if (!wOknieWysylki()) return json({ ok: true, pominieto: 'poza godzinami wysyłki' });

  try {
    const wynik = await wyslijPrzypomnienia({ sb, sendSms });
    return json({ ok: true, ...wynik });
  } catch (e) {
    console.error('[przypomnienia-ofert]', e);
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export function GET() {
  return json({ ok: false, error: 'tylko POST' }, { status: 405 });
}
