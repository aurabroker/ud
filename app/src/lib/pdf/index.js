/**
 * index.js — publiczne API parsera PDF.
 * detectInsurer() + parseOfferText() + parseOfferPdf().
 */
import { extractPdfText } from './extract.js';
import { parseLeadenhall } from './parseLeadenhall.js';
import { parseCEU } from './parseCEU.js';

/**
 * Wykrywa typ ubezpieczyciela po zawartości tekstu.
 * @param {string} text
 * @returns {'leadenhall'|'ceu'|null}
 */
export function detectInsurer(text) {
  if (/\bLOIP\//.test(text) || /LOI\s+PREMIUM/i.test(text) || /Coverholder\s+CEU/i.test(text)) {
    return 'ceu';
  }
  if (/\bLHQ\d/.test(text) || /Leadenhall\s+Insurance/i.test(text) || /Pozycja\s+[ABC]\s*-/i.test(text)) {
    return 'leadenhall';
  }
  return null;
}

/**
 * Parsuje ofertę z już wyekstrahowanego tekstu.
 * @param {string} text
 * @param {'leadenhall'|'ceu'} [forceType]
 * @returns {import('./model.js').NormalizedOffer}
 */
export function parseOfferText(text, forceType) {
  const type = forceType || detectInsurer(text);
  if (type === 'leadenhall') return parseLeadenhall(text);
  if (type === 'ceu') return parseCEU(text);
  throw new Error('Nie rozpoznano szablonu oferty (Leadenhall/CEU).');
}

/**
 * Pełny pipeline: PDF -> tekst -> znormalizowana oferta.
 * @param {ArrayBuffer|Uint8Array} data
 * @param {'leadenhall'|'ceu'} [forceType]
 * @returns {Promise<{ offer: import('./model.js').NormalizedOffer, totalPages: number, insurer_type: string }>}
 */
export async function parseOfferPdf(data, options = {}) {
  const { forceType, password } = typeof options === 'string' ? { forceType: options } : options;
  const { text, totalPages } = await extractPdfText(data, password);
  const type = forceType || detectInsurer(text);
  if (!type) throw new Error('Nie rozpoznano szablonu oferty (Leadenhall/CEU).');
  const offer = parseOfferText(text, type);
  return { offer, totalPages, insurer_type: type };
}

export { extractPdfText } from './extract.js';
