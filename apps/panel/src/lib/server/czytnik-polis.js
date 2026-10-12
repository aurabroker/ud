/**
 * Czytnik PDF polis i ofert (Leadenhall/CEU) dla tras serwera. Wynik ma te same
 * pola co wiersz ud_offer_documents (offer_number, premium_total,
 * distribution_fee…) plus `polisa` — numer i okres ochrony (src/lib/pdf/polisa.js).
 * Osobno od leady.js, który nie importuje niczego spoza Node — testy podstawiają
 * tam własny czytnik.
 *
 * Tekst wyciągamy raz: z niego idą i kwoty (czytnik ofert), i dane polisy.
 * Dokument, którego czytnik ofert nie rozpozna, nadal oddaje numer i daty.
 */
import { extractPdfText } from '$lib/pdf/extract.js';
import { detectInsurer, parseOfferText } from '$lib/pdf/index.js';
import { daneZPolisy } from '$lib/pdf/polisa.js';

export async function odczytajPdf(bajty, haslo) {
  const { text } = await extractPdfText(bajty, haslo);
  const polisa = daneZPolisy(text);
  let dokument = {};
  const typ = detectInsurer(text);
  if (typ) {
    try {
      dokument = parseOfferText(text, typ);
    } catch (e) {
      console.error('[polisy] czytnik kwot:', e?.message || e);
    }
  }
  // Polisa „Beauty" (LW050) podaje świadczenie zdaniem, którego czytnik ofert nie zna.
  if (dokument.temp_monthly_benefit == null && polisa.swiadczenie_okresowa) {
    dokument = { ...dokument, temp_monthly_benefit: polisa.swiadczenie_okresowa };
  }
  return { ...dokument, polisa };
}
