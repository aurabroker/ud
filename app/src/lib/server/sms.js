/**
 * sms.js — wysyłka SMS przez SMSPlanet (https://smsplanet.pl).
 * Endpoint: POST https://api2.smsplanet.pl/<metoda> (form-urlencoded)
 * Uwierzytelnianie zgodne z oficjalną biblioteką smsplanet-java-lib:
 *   parametry `key` + `password`. Wariant `Authorization: Bearer <token>`
 *   pozostaje jako zapasowy, gdy skonfigurowano wyłącznie token.
 * Parametry wiadomości: from, to, msg.
 * Bez poświadczeń działa w trybie stub (loguje, nie wysyła).
 */
import { env } from '$env/dynamic/private';

const API = 'https://api2.smsplanet.pl';

/**
 * Workers domyślnie nie wysyłają nagłówka User-Agent, a filtry WAF potrafią
 * odrzucać takie żądania generycznym 403. Podajemy się jawnie.
 */
const UA = 'UtrataDochodu/1.0 (+https://app.utratadochodu.pl)';

/** Poświadczenia: oficjalna biblioteka SMSPlanet używa pary key+password. */
function credentials() {
  // Sekrety wklejane w panelu Cloudflare bywają z końcową spacją lub nowym
  // wierszem — bez przycięcia poświadczenie jest ciche i błędne.
  const t = (v) => String(v || '').trim();
  const key = t(env.SMSPLANET_KEY) || t(env.SMSPLANET_API_KEY);
  const password = t(env.SMSPLANET_PASSWORD);
  const token = t(env.SMSPLANET_TOKEN) || t(env.SMSTOKEN) || t(env.SMS_TOKEN);
  return { key, password, token, mode: key && password ? 'key+password' : token ? 'bearer' : 'brak' };
}

/** Nazwa nadawcy (pole nadawcy zatwierdzone u operatora). */
function senderName() {
  const t = (v) => String(v || '').trim();
  return t(env.SMSPLANET_SENDER) || t(env.SMSSENDER) || t(env.SMS_SENDER) || 'Info';
}

/** Konfiguracja wysyłki SMS do diagnostyki — bez ujawniania poświadczeń. */
export function smsConfig() {
  const c = credentials();
  const secret = c.mode === 'key+password' ? c.key : c.token;
  return {
    authMode: c.mode,
    hasToken: c.mode !== 'brak',
    tokenHint: secret ? `${String(secret).slice(0, 6)}…(${String(secret).length} zn.)` : '',
    sender: senderName(),
    senderIsDefault: !(env.SMSPLANET_SENDER || env.SMSSENDER || env.SMS_SENDER),
    testMode: env.SMSPLANET_TEST === '1'
  };
}

/**
 * Wspólne wywołanie API SMSPlanet.
 * @returns {Promise<{ ok: boolean, status: number, raw: string, data: any, error?: string }>}
 */
async function call(path, params) {
  const cred = credentials();
  const body = new URLSearchParams(params);
  if (cred.mode === 'key+password') {
    body.set('key', cred.key);
    body.set('password', cred.password);
  }

  let res, raw;
  try {
    res = await fetch(`${API}/${path}`, {
      method: 'POST',
      headers: {
        ...(cred.mode === 'bearer' ? { Authorization: `Bearer ${cred.token}` } : {}),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': UA
      },
      body
    });
  } catch (e) {
    return { ok: false, status: 0, raw: '', data: null, error: 'SMSPlanet: ' + (e?.message || e) };
  }

  // Czytamy jako tekst — SMSPlanet przy błędach potrafi zwrócić HTML/plain,
  // a sam kod HTTP nie mówi, czy to zły token, czy np. brak środków.
  raw = await res.text().catch(() => '');
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, raw, data };
}

/** Czytelny opis błędu z odpowiedzi API. */
function describeError(r) {
  if (r.error) return r.error;
  const detail = r.data?.errorMsg
    || String(r.raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const code = r.data?.errorCode ? ` (kod ${r.data.errorCode})` : '';
  const hint = r.status === 403
    ? ' — 403 zwykle oznacza odrzucone uwierzytelnienie (zły/wygasły token, nieautoryzowany nadawca lub IP), a nie wyczerpany limit'
    : '';
  return `SMSPlanet HTTP ${r.status}${code}${detail ? `: ${detail}` : ''}${hint}`;
}

/**
 * @param {string} phone - numer (dowolny format; nie-cyfry są usuwane)
 * @param {string} message
 * @returns {Promise<{ sent: boolean, stub?: boolean, id?: string, error?: string }>}
 */
export async function sendSms(phone, message) {
  const cred = credentials();
  const to = String(phone).replace(/[^\d]/g, '');

  if (cred.mode === 'brak') {
    console.warn('[sms] Brak poświadczeń SMSPlanet — tryb stub. Do:', to, 'msg:', message);
    return { sent: false, stub: true };
  }

  const params = { from: senderName(), to, msg: message };
  if (env.SMSPLANET_TEST === '1') params.test = '1'; // tryb testowy SMSPlanet (nie wysyła realnie)

  const r = await call('sms', params);
  // Sukces: obecny messageId. Błąd: errorCode/errorMsg albo treść odpowiedzi.
  if (!r.ok || r.error || (r.data && (r.data.errorCode || r.data.errorMsg))) {
    return { sent: false, error: describeError(r) };
  }
  const id = r.data?.messageId ?? (Array.isArray(r.data?.messageId) ? r.data.messageId[0] : undefined);
  return { sent: true, id: id != null ? String(id) : undefined };
}

/**
 * Diagnostyka bez wysyłania wiadomości. Odpytuje dwie metody z oficjalnej
 * biblioteki — żadna nic nie wysyła i nie kosztuje:
 *  - getBalance      → te same poświadczenia, inna ścieżka. Gdy i tu jest 403,
 *                      blokada jest na warstwie HTTP (IP/WAF), nie na koncie.
 *  - getSenderFields → lista zatwierdzonych pól nadawcy na koncie.
 */
export async function smsDiagnostics() {
  const cred = credentials();
  if (cred.mode === 'brak') return { configured: false };

  const [bal, snd] = await Promise.all([
    call('getBalance', { product: 'SMS' }),
    call('getSenderFields', { product: 'SMS' })
  ]);

  const balanceOk = bal.ok && !bal.error && !(bal.data?.errorCode || bal.data?.errorMsg);
  const sendersOk = snd.ok && !snd.error && !(snd.data?.errorCode || snd.data?.errorMsg);

  const list = String(snd.data?.senderFields || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sender = senderName();

  return {
    configured: true,
    sender,
    balance: {
      ok: balanceOk,
      status: bal.status,
      value: balanceOk ? (bal.data?.balance ?? null) : null,
      error: balanceOk ? '' : describeError(bal)
    },
    senders: {
      ok: sendersOk,
      status: snd.status,
      list,
      matches: list.some((s) => s.toLowerCase() === sender.toLowerCase()),
      error: sendersOk ? '' : describeError(snd)
    }
  };
}
