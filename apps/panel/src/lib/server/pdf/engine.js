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

function bytesToBase64(buf) {
  let bin = '';
  const CHUNK = 8192; // porcjami, żeby nie przepełnić stosu przy większych plikach
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Wczytuje logo do postaci osadzalnej w PDF.
 * Najpierw ze storage (pewniejsze niż publiczny URL), potem z URL jako zapas.
 * Błąd/nieobsługiwany format → null (dokument użyje napisu „UtrataDochodu").
 * @param {object} sb - klient Supabase (service_role)
 * @param {{logo_path?: string, logo_url?: string}} settings
 * @returns {Promise<{kind:'image'|'svg', data:string}|null>}
 */
export async function loadLogo(sb, settings) {
  const path = settings?.logo_path || '';
  const url = settings?.logo_url || '';

  // Limit jest zabezpieczeniem przed wklejaniem ogromnych plików do każdego PDF.
  // Uwaga: logo tej wielkości powiększa dokument — w Ustawieniach jest o tym podpowiedź.
  const MAX_LOGO_BYTES = 4_000_000;

  const fromBytes = (buf, hint) => {
    if (!buf?.byteLength || buf.byteLength > MAX_LOGO_BYTES) return null;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50; // sygnatura PNG
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8; // sygnatura JPEG
    if (!isPng && !isJpg) {
      if (/svg/i.test(hint || '')) {
        try { return { kind: 'svg', data: new TextDecoder().decode(buf) }; } catch { return null; }
      }
      return null;
    }
    return { kind: 'image', data: `data:image/${isPng ? 'png' : 'jpeg'};base64,${bytesToBase64(buf)}` };
  };

  if (sb && path) {
    try {
      const { data: blob, error } = await sb.storage.from('ud-public').download(path);
      if (!error && blob) {
        const out = fromBytes(new Uint8Array(await blob.arrayBuffer()), path);
        if (out) return out;
      }
    } catch { /* spróbujemy przez URL */ }
  }

  if (url) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (res.ok) return fromBytes(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || url);
    } catch { /* brak logo — napis zastępczy */ }
  }
  return null;
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
