/**
 * extract.js — wyciąganie tekstu z PDF przy pomocy unpdf.
 * unpdf działa natywnie na Cloudflare Workers (bez Node API).
 * Obsługuje PDF zabezpieczone hasłem (np. Leadenhall — 4 cyfry).
 */
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * @param {ArrayBuffer|Uint8Array} data - zawartość pliku PDF
 * @param {string} [password] - hasło do zaszyfrowanego PDF (opcjonalne)
 * @returns {Promise<{ totalPages: number, text: string, pages: string[] }>}
 */
export async function extractPdfText(data, password) {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const options = password ? { password: String(password) } : undefined;
  const pdf = await getDocumentProxy(buf, options);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return {
    totalPages,
    pages,
    text: pages.join('\n')
  };
}
