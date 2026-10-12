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
 *
 * SMSAPI_TEST=1: SMSAPI odpowiada wtedy jak przy prawdziwej wysyłce, więc
 * każde wywołanie „zużyłoby" przypomnienia klientów bez jednego SMS-a.
 * Przypomnienia w tym trybie stoją.
 *
 * Odpowiedź crona czyta tylko pg_net (net._http_response, kilka godzin), więc
 * każda awaria i każde przerwanie wysyłki zostawia wpis w ud_errors — inaczej
 * przypomnienia mogłyby nie działać tygodniami i nikt by tego nie zauważył.
 * Wyjątek: zły token (patrz niżej).
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createAdminClient } from '$lib/server/supabase.js';
import { sendSms } from '$lib/server/sms.js';
import { wOknieWysylki } from '$lib/server/smsOferta.js';
import { wyslijPrzypomnienia } from '$lib/server/przypomnieniaOfert.js';

const ZRODLO = 'przypomnienia-ofert';

/** Wpis w ud_errors; sam nigdy nie rzuca. */
async function zapiszBlad(sb, message, context, ip) {
  await sb
    .from('ud_errors')
    .insert({ source: ZRODLO, level: 'error', message: String(message).slice(0, 500), context: context ?? null, ip: ip || null })
    .then(() => {}, () => {});
}

export async function POST({ request, getClientAddress }) {
  const token = request.headers.get('x-cron-token') || '';
  if (!token) return json({ ok: false, error: 'brak tokenu' }, { status: 401 });

  let ip = '';
  try { ip = request.headers.get('cf-connecting-ip') || getClientAddress(); } catch { /* bez adresu */ }

  let sb;
  try {
    sb = createAdminClient();
  } catch (e) {
    // Bez klienta bazy nie ma gdzie zapisać błędu — zostaje dziennik workera.
    console.error(`[${ZRODLO}] brak konfiguracji Supabase`, e);
    return json({ ok: false, error: 'brak konfiguracji' }, { status: 503 });
  }

  const { data: zgodny, error: bladTokenu } = await sb.rpc('edge_cron_token_matches', { token });
  if (bladTokenu) {
    await zapiszBlad(sb, 'Przypomnienia ofert: nie da się sprawdzić tokenu crona', { blad: bladTokenu.message }, ip);
    return json({ ok: false, error: 'nie da się sprawdzić tokenu' }, { status: 503 });
  }
  if (zgodny !== true) {
    // Bez wpisu w ud_errors: cron bierze token z tego samego Vaulta, z którym
    // go porównujemy, więc zły token to zawsze ktoś z zewnątrz — a wpis za
    // każde jego żądanie pozwoliłby mu zapchać dziennik błędów.
    console.warn(`[${ZRODLO}] zły token crona`, ip);
    return json({ ok: false, error: 'zły token' }, { status: 401 });
  }

  if (env.SMSAPI_TEST === '1') {
    return json({ ok: true, pominieto: 'SMSAPI_TEST=1 — tryb testowy SMSAPI, przypomnienia wstrzymane' });
  }

  if (!wOknieWysylki()) return json({ ok: true, pominieto: 'poza godzinami wysyłki' });

  try {
    const wynik = await wyslijPrzypomnienia({ sb, sendSms });
    if (wynik.przerwano) {
      await zapiszBlad(sb, 'Przypomnienia ofert przerwane: ' + wynik.przerwano, wynik, null);
    }
    return json({ ok: true, ...wynik });
  } catch (e) {
    console.error(`[${ZRODLO}]`, e);
    await zapiszBlad(sb, 'Przypomnienia ofert: ' + String(e?.message || e), null, null);
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export function GET() {
  return json({ ok: false, error: 'tylko POST' }, { status: 405 });
}
