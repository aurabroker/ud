/**
 * email.js — wysyłka email przez Resend (https://resend.com).
 * Env-gated: bez RESEND_API_KEY działa w trybie stub.
 */
import { env } from '$env/dynamic/private';

/**
 * @param {{ to: string|string[], subject: string, html: string, replyTo?: string }} opts
 * @returns {Promise<{ sent: boolean, stub?: boolean, id?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, html, replyTo }) {
  const key = env.RESEND_API_KEY || env.RESEND_API;
  const from = env.RESEND_FROM || 'Utrata Dochodu <onboarding@resend.dev>';

  if (!key) {
    console.warn('[email] RESEND_API_KEY brak — tryb stub. Do:', to, 'temat:', subject);
    return { sent: false, stub: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { sent: false, error: data.message || `Resend ${res.status}` };
  return { sent: true, id: data.id };
}
