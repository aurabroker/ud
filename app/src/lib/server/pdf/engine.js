/**
 * engine.js — generowanie PDF przez pdfmake (bez zewnętrznego API).
 * Fonty trafiają do wirtualnego systemu plików pdfmake, bo Worker nie ma dysku.
 */
import pdfmake from 'pdfmake';
import { ROBOTO_REGULAR_B64, ROBOTO_MEDIUM_B64 } from './fonts.js';
import { TABLE_LAYOUTS } from './summaryDoc.js';

let ready = false;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function init() {
  if (ready) return;
  pdfmake.virtualfs.writeFileSync('Roboto-Regular.ttf', b64ToBytes(ROBOTO_REGULAR_B64));
  pdfmake.virtualfs.writeFileSync('Roboto-Medium.ttf', b64ToBytes(ROBOTO_MEDIUM_B64));
  pdfmake.setFonts({
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Regular.ttf',
      bolditalics: 'Roboto-Medium.ttf'
    }
  });
  pdfmake.setTableLayouts(TABLE_LAYOUTS);
  pdfmake.setUrlAccessPolicy(() => false); // żadnych pobrań z sieci
  if (typeof pdfmake.setLocalAccessPolicy === 'function') pdfmake.setLocalAccessPolicy(() => false);
  ready = true;
}

/**
 * Pobiera logo z URL i zwraca postać nadającą się do osadzenia w PDF.
 * Błąd/nieobsługiwany format → null (dokument użyje napisu „UtrataDochodu").
 * @returns {Promise<{kind:'image'|'svg', data:string}|null>}
 */
export async function fetchLogo(url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('svg')) return { kind: 'svg', data: await res.text() };
    if (!/png|jpe?g/.test(type)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 1_500_000) return null; // nie pakujemy ogromnych plików do PDF
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const mime = type.includes('png') ? 'image/png' : 'image/jpeg';
    return { kind: 'image', data: `data:${mime};base64,${btoa(bin)}` };
  } catch {
    return null;
  }
}

/**
 * @param {object} docDefinition
 * @returns {Promise<{ ok: boolean, buffer?: ArrayBuffer, error?: string }>}
 */
export async function renderPdf(docDefinition) {
  try {
    init();
    const doc = pdfmake.createPdf(docDefinition);
    const buf = await doc.getBuffer();
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return { ok: true, buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  } catch (e) {
    return { ok: false, error: `pdfmake: ${e?.message || e}` };
  }
}
