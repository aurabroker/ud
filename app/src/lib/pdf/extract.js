/**
 * extract.js — wyciąganie tekstu z PDF przy pomocy unpdf.
 * unpdf działa natywnie na Cloudflare Workers (bez Node API).
 */
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * @param {ArrayBuffer|Uint8Array} data - zawartość pliku PDF
 * @returns {Promise<{ totalPages: number, text: string, pages: string[] }>}
 */
export async function extractPdfText(data) {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const pdf = await getDocumentProxy(buf);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return {
    totalPages,
    pages,
    text: pages.join('\n')
  };
}
