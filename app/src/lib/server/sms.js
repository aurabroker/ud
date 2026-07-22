/**
 * sms.js — wysyłka SMS przez SMSAPI (https://ssl.smsapi.pl).
 * Env-gated: bez SMSAPI_TOKEN działa w trybie stub (loguje, nie wysyła).
 */
import { env } from '$env/dynamic/private';

/**
 * @param {string} phone - numer w formacie 48XXXXXXXXX lub +48...
 * @param {string} message
 * @returns {Promise<{ sent: boolean, stub?: boolean, id?: string, error?: string }>}
 */
export async function sendSms(phone, message) {
  const token = env.SMSAPI_TOKEN;
  const sender = env.SMSAPI_SENDER || 'Info';
  const to = String(phone).replace(/[^\d]/g, '');

  if (!token) {
    console.warn('[sms] SMSAPI_TOKEN brak — tryb stub. Do:', to, 'msg:', message);
    return { sent: false, stub: true };
  }

  const body = new URLSearchParams({
    to,
    message,
    from: sender,
    format: 'json',
    encoding: 'utf-8'
  });

  const res = await fetch('https://api.smsapi.pl/sms.do', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    return { sent: false, error: data.message || `SMSAPI ${res.status}` };
  }
  return { sent: true, id: data.list?.[0]?.id };
}
