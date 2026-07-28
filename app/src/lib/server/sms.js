/**
 * sms.js — wysyłka SMS przez SMSPlanet (https://smsplanet.pl).
 * Endpoint: POST https://api2.smsplanet.pl/sms
 * Auth: Authorization: Bearer <token>  |  params: from, to, msg
 * Env-gated: bez SMSPLANET_TOKEN działa w trybie stub (loguje, nie wysyła).
 */
import { env } from '$env/dynamic/private';

/**
 * @param {string} phone - numer (dowolny format; nie-cyfry są usuwane)
 * @param {string} message
 * @returns {Promise<{ sent: boolean, stub?: boolean, id?: string, error?: string }>}
 */
export async function sendSms(phone, message) {
  const token = env.SMSPLANET_TOKEN || env.SMSTOKEN;
  const sender = env.SMSPLANET_SENDER || env.SMSSENDER || 'Info';
  const to = String(phone).replace(/[^\d]/g, '');

  if (!token) {
    console.warn('[sms] SMSPLANET_TOKEN brak — tryb stub. Do:', to, 'msg:', message);
    return { sent: false, stub: true };
  }

  const body = new URLSearchParams({ from: sender, to, msg: message });
  if (env.SMSPLANET_TEST === '1') body.set('test', '1'); // tryb testowy SMSPlanet (nie wysyła realnie)

  let res, data;
  try {
    res = await fetch('https://api2.smsplanet.pl/sms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    data = await res.json().catch(() => null);
  } catch (e) {
    return { sent: false, error: 'SMSPlanet: ' + (e?.message || e) };
  }

  // Sukces: obecny messageId. Błąd: errorCode/errorMsg.
  if (!res.ok || (data && (data.errorCode || data.errorMsg))) {
    return { sent: false, error: data?.errorMsg || `SMSPlanet HTTP ${res.status}` };
  }
  const id = data?.messageId ?? (Array.isArray(data?.messageId) ? data.messageId[0] : undefined);
  return { sent: true, id: id != null ? String(id) : undefined };
}
