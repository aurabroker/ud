/**
 * POST /api/cron/kosz-ofert — usuwa na dobre oferty, które leżą w koszu
 * dłużej niż 30 dni (pliki z kubełka + wpis). Woła pg_cron raz dziennie przez
 * ud_kosz_ofert_czyszczenie() (migracja …_oferty_kosz.sql).
 *
 * Bramka jak w /api/cron/przypomnienia-ofert: nagłówek x-cron-token sprawdzany
 * przez edge_cron_token_matches() PRZED pierwszym odczytem. Awaria i
 * przerwanie zostawiają wpis w ud_errors — odpowiedź crona czyta tylko pg_net.
 */
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { wyczyscKosz } from '$lib/server/kosz.js';

const ZRODLO = 'kosz-ofert';

async function zapiszBlad(sb, message, context) {
  await sb
    .from('ud_errors')
    .insert({ source: ZRODLO, level: 'error', message: String(message).slice(0, 500), context: context ?? null })
    .then(() => {}, () => {});
}

export async function POST({ request }) {
  const token = request.headers.get('x-cron-token') || '';
  if (!token) return json({ ok: false, error: 'brak tokenu' }, { status: 401 });

  let sb;
  try {
    sb = createAdminClient();
  } catch (e) {
    console.error(`[${ZRODLO}] brak konfiguracji Supabase`, e);
    return json({ ok: false, error: 'brak konfiguracji' }, { status: 503 });
  }

  const { data: zgodny, error: bladTokenu } = await sb.rpc('edge_cron_token_matches', { token });
  if (bladTokenu) {
    await zapiszBlad(sb, 'Kosz ofert: nie da się sprawdzić tokenu crona', { blad: bladTokenu.message });
    return json({ ok: false, error: 'nie da się sprawdzić tokenu' }, { status: 503 });
  }
  // Zły token bez wpisu w ud_errors — patrz przypomnienia-ofert.
  if (zgodny !== true) return json({ ok: false, error: 'zły token' }, { status: 401 });

  try {
    const wynik = await wyczyscKosz({ sb });
    if (wynik.przerwano) await zapiszBlad(sb, 'Kosz ofert: czyszczenie przerwane: ' + wynik.przerwano, wynik);
    return json({ ok: true, ...wynik });
  } catch (e) {
    console.error(`[${ZRODLO}]`, e);
    await zapiszBlad(sb, 'Kosz ofert: ' + String(e?.message || e));
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export function GET() {
  return json({ ok: false, error: 'tylko POST' }, { status: 405 });
}
