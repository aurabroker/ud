/**
 * sms.js — wysyłka SMS przez SMSPlanet (https://smsplanet.pl).
 * Endpoint: POST https://api2.smsplanet.pl/sms (form-urlencoded)
 * Uwierzytelnianie zgodne z oficjalną biblioteką smsplanet-java-lib:
 *   parametry `key` + `password`. Wariant `Authorization: Bearer <token>`
 *   pozostaje jako zapasowy, gdy skonfigurowano wyłącznie token.
 * Parametry wiadomości: from, to, msg.
 * Bez poświadczeń działa w trybie stub (loguje, nie wysyła).
 */
import { env } from '$env/dynamic/private';

/** Poświadczenia: oficjalna biblioteka SMSPlanet używa pary key+password. */
function credentials() {
  const key = env.SMSPLANET_KEY || env.SMSPLANET_API_KEY || '';
  const password = env.SMSPLANET_PASSWORD || '';
  const token = env.SMSPLANET_TOKEN || env.SMSTOKEN || env.SMS_TOKEN || '';
  return { key, password, token, mode: key && password ? 'key+password' : token ? 'bearer' : 'brak' };
}

/** Konfiguracja wysyłki SMS do diagnostyki — bez ujawniania poświadczeń. */
export function smsConfig() {
  const c = credentials();
  const secret = c.mode === 'key+password' ? c.key : c.token;
  return {
    authMode: c.mode,
    hasToken: c.mode !== 'brak',
    tokenHint: secret ? `${String(secret).slice(0, 6)}…(${String(secret).length} zn.)` : '',
    sender: env.SMSPLANET_SENDER || env.SMSSENDER || env.SMS_SENDER || 'Info',
    senderIsDefault: !(env.SMSPLANET_SENDER || env.SMSSENDER || env.SMS_SENDER),
    testMode: env.SMSPLANET_TEST === '1'
  };
}

/**
 * @param {string} phone - numer (dowolny format; nie-cyfry są usuwane)
 * @param {string} message
 * @returns {Promise<{ sent: boolean, stub?: boolean, id?: string, error?: string }>}
 */
export async function sendSms(phone, message) {
  const cred = credentials();
  const sender = env.SMSPLANET_SENDER || env.SMSSENDER || env.SMS_SENDER || 'Info';
  const to = String(phone).replace(/[^\d]/g, '');

  if (cred.mode === 'brak') {
    console.warn('[sms] Brak poświadczeń SMSPlanet — tryb stub. Do:', to, 'msg:', message);
    return { sent: false, stub: true };
  }

  // Oficjalna biblioteka SMSPlanet przesyła key i password jako parametry formularza.
  // Wariant z nagłówkiem Bearer zostaje jako zapasowy, gdy skonfigurowano sam token.
  const body = new URLSearchParams({ from: sender, to, msg: message });
  if (cred.mode === 'key+password') {
    body.set('key', cred.key);
    body.set('password', cred.password);
  }
  if (env.SMSPLANET_TEST === '1') body.set('test', '1'); // tryb testowy SMSPlanet (nie wysyła realnie)

  let res, raw, data;
  try {
    res = await fetch('https://api2.smsplanet.pl/sms', {
      method: 'POST',
      headers: {
        ...(cred.mode === 'bearer' ? { Authorization: `Bearer ${cred.token}` } : {}),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    // Czytamy jako tekst — SMSPlanet przy błędach potrafi zwrócić HTML/plain,
    // a sam kod HTTP nie mówi, czy to zły token, czy np. brak środków.
    raw = await res.text().catch(() => '');
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  } catch (e) {
    return { sent: false, error: 'SMSPlanet: ' + (e?.message || e) };
  }

  // Sukces: obecny messageId. Błąd: errorCode/errorMsg albo treść odpowiedzi.
  if (!res.ok || (data && (data.errorCode || data.errorMsg))) {
    const detail = data?.errorMsg
      || String(raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    const code = data?.errorCode ? ` (kod ${data.errorCode})` : '';
    const hint = res.status === 403
      ? ' — 403 zwykle oznacza odrzucone uwierzytelnienie (zły/wygasły token, nieautoryzowany nadawca lub IP), a nie wyczerpany limit'
      : '';
    return {
      sent: false,
      error: `SMSPlanet HTTP ${res.status}${code}${detail ? `: ${detail}` : ''}${hint}`
    };
  }
  const id = data?.messageId ?? (Array.isArray(data?.messageId) ? data.messageId[0] : undefined);
  return { sent: true, id: id != null ? String(id) : undefined };
}
