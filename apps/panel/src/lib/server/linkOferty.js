/**
 * Ważność linku do oferty (/offer/<share_token>).
 *
 * Kolumna ud_offers.share_expires_at (migracja 20261116170158_oferty_wygasanie_linku):
 * nowe oferty dostają w bazie 60 dni od utworzenia, wysyłka do klienta przedłuża
 * termin (waznoscPoWysylce). Linki sprzed 13.11.2026 mają NULL — datę ustali
 * właściciel (supabase/pending/20261113000004_…); do tego czasu działają bez terminu.
 *
 * Każda trasa pod /offer/[token] pobiera ofertę po share_token i MUSI sprawdzić
 * linkOfertyAktywny — pilnuje tego scripts/test-link-oferty.mjs.
 */

/** Ile dni od wysyłki link pozostaje ważny (to samo co domyślna wartość kolumny). */
export const WAZNOSC_LINKU_DNI = 60;

/** Kolumna, którą trzeba dobrać do każdego zapytania o ofertę po share_token. */
export const KOLUMNA_WAZNOSCI = 'share_expires_at';

/**
 * @param {{ share_expires_at?: string | null } | null | undefined} oferta
 * @param {Date} [teraz]
 * @returns {boolean}
 */
export function linkOfertyAktywny(oferta, teraz = new Date()) {
  if (!oferta) return false;
  // NULL = link sprzed wprowadzenia terminów; decyzja właściciela jeszcze nie zapadła.
  if (oferta.share_expires_at == null) return true;
  const koniec = new Date(oferta.share_expires_at);
  if (Number.isNaN(koniec.getTime())) return false;
  return koniec > teraz;
}

/**
 * Termin ważności linku po wysłaniu oferty klientowi: co najmniej WAZNOSC_LINKU_DNI
 * od teraz, nigdy krócej niż był. Dla linku bez terminu (sprzed 13.11.2026) zwraca
 * null — wysyłka nie podejmuje za właściciela decyzji o starych linkach.
 *
 * @param {string | null | undefined} obecny
 * @param {Date} [teraz]
 * @returns {string | null} ISO albo null (nie zmieniać kolumny)
 */
export function waznoscPoWysylce(obecny, teraz = new Date()) {
  if (obecny == null) return null;
  const minimalny = new Date(teraz.getTime() + WAZNOSC_LINKU_DNI * 24 * 3600 * 1000);
  const dotychczasowy = new Date(obecny);
  if (!Number.isNaN(dotychczasowy.getTime()) && dotychczasowy > minimalny) return dotychczasowy.toISOString();
  return minimalny.toISOString();
}
