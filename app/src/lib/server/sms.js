/**
 * sms.js — wysyłka SMS przez SMSPlanet (https://smsplanet.pl).
 * Endpoint: POST https://api2.smsplanet.pl/sms
 * Auth: Authorization: Bearer <token>  |  params: from, to, msg
 * Env-gated: bez SMSPLANET_TOKEN działa w trybie stub (loguje, nie wysyła).
 */
import { env } from '$env/dynamic/private';

/** Konfiguracja wysyłki SMS do diagnostyki — bez ujawniania tokenu. */
export function smsConfig() {
  const token = env.SMSPLANET_TOKEN || env.SMSTOKEN || env.SMS_TOKEN;
  return {
    hasToken: !!token,
    tokenHint: token ? `${String(token).slice(0, 6)}…(${String(token).length} zn.)` : '',
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
  const token = env.SMSPLANET_TOKEN || env.SMSTOKEN || env.SMS_TOKEN;
  const sender = env.SMSPLANET_SENDER || env.SMSSENDER || env.SMS_SENDER || 'Info';
  const to = String(phone).replace(/[^\d]/g, '');

  if (!token) {
    console.warn('[sms] SMSPLANET_TOKEN brak — tryb stub. Do:', to, 'msg:', message);
    return { sent: false, stub: true };
  }

  const body = new URLSearchParams({ from: sender, to, msg: message });
  if (env.SMSPLANET_TEST === '1') body.set('test', '1'); // tryb testowy SMSPlanet (nie wysyła realnie)

  let res, raw, data;
  try {
    res = await fetch('https://api2.smsplanet.pl/sms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
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
