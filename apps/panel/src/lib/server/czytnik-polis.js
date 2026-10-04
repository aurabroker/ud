/**
 * Czytnik PDF polis i ofert (Leadenhall/CEU) dla tras serwera. Wynik ma te same
 * pola co wiersz ud_offer_documents (offer_number, premium_total,
 * distribution_fee…). Osobno od leady.js, który nie importuje niczego spoza
 * Node — testy podstawiają tam własny czytnik.
 */
import { parseOfferPdf } from '$lib/pdf/index.js';

export const odczytajPdf = async (bajty, haslo) => (await parseOfferPdf(bajty, { password: haslo })).offer;
