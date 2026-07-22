/**
 * pdfshift.js — generowanie PDF z HTML przez PDFShift (https://pdfshift.io).
 * Env-gated: bez PDFSHIFT_API_KEY zwraca stub (null).
 */
import { env } from '$env/dynamic/private';

/**
 * @param {string} html - kompletny dokument HTML
 * @returns {Promise<{ ok: boolean, stub?: boolean, buffer?: ArrayBuffer, error?: string }>}
 */
export async function htmlToPdf(html) {
  const key = env.PDFSHIFT_API_KEY;
  if (!key) {
    console.warn('[pdfshift] PDFSHIFT_API_KEY brak — tryb stub (PDF nie wygenerowany).');
    return { ok: false, stub: true };
  }

  const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa('api:' + key)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ source: html, format: 'A4', margin: '15px' })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `PDFShift ${res.status} ${t}` };
  }
  return { ok: true, buffer: await res.arrayBuffer() };
}
