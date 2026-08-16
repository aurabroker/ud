/**
 * pdfshift.js — generowanie PDF z HTML przez PDFShift (https://pdfshift.io).
 * Env-gated: bez PDFSHIFT_API_KEY zwraca stub (null).
 */
import { env } from '$env/dynamic/private';

/**
 * @param {string} html - kompletny dokument HTML
 * @returns {Promise<{ ok: boolean, stub?: boolean, buffer?: ArrayBuffer, error?: string }>}
 */
const TIMEOUT_MS = 20000;

export async function htmlToPdf(html) {
  const key = env.PDFSHIFT_API_KEY || env.PDFSHIFT_API;
  if (!key) {
    console.warn('[pdfshift] PDFSHIFT_API_KEY brak — tryb stub (PDF nie wygenerowany).');
    return { ok: false, stub: true };
  }

  // Twardy limit czasu: bez niego zawieszone żądanie blokuje Workera aż do jego
  // ubicia przez Cloudflare (błąd 503 na akcjach panelu).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa('api:' + key)}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ source: html, format: 'A4', margin: '15px' }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `PDFShift ${res.status} ${t}` };
    }
    return { ok: true, buffer: await res.arrayBuffer() };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return { ok: false, error: aborted ? `PDFShift: przekroczono ${TIMEOUT_MS / 1000}s` : `PDFShift: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}
