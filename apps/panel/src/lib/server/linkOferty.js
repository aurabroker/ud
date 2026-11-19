/**
 * Ważność linku do oferty (/offer/<share_token>).
 *
 * Kolumna ud_offers.share_expires_at (migracja 20261116170158_oferty_wygasanie_linku):
 * nowe oferty dostają w bazie 60 dni od utworzenia, wysyłka do klienta przedłuża
 * termin (waznoscPoWysylce). Od 19.11.2026 kolumna jest NOT NULL (migracja
 * …_oferty_waznosc_starych_linkow nadała termin linkom sprzed 13.11.2026), więc brak
 * daty — NULL albo brak pola w zapytaniu — znaczy „link nieważny”.
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
  // Brak daty (NULL — od 19.11.2026 baza go nie przyjmie — albo zapytanie bez kolumny)
  // to błąd, nie „bez terminu”: zamykamy, zamiast po cichu otwierać link.
  if (oferta.share_expires_at == null) return false;
  const koniec = new Date(oferta.share_expires_at);
  if (Number.isNaN(koniec.getTime())) return false;
  return koniec > teraz;
}

/**
 * Termin ważności linku po wysłaniu oferty klientowi (albo „Odnów link”): co najmniej
 * WAZNOSC_LINKU_DNI od teraz, nigdy krócej niż był. Brak albo zepsuta data obecna —
 * pełny termin od teraz.
 *
 * @param {string | null | undefined} obecny
 * @param {Date} [teraz]
 * @returns {string} ISO
 */
export function waznoscPoWysylce(obecny, teraz = new Date()) {
  const minimalny = new Date(teraz.getTime() + WAZNOSC_LINKU_DNI * 24 * 3600 * 1000);
  const dotychczasowy = obecny == null ? null : new Date(obecny);
  if (dotychczasowy && !Number.isNaN(dotychczasowy.getTime()) && dotychczasowy > minimalny) {
    return dotychczasowy.toISOString();
  }
  return minimalny.toISOString();
}
