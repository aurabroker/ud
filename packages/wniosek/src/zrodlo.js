/**
 * Źródło wizyty — skąd przyszedł klient, który składa wniosek.
 *
 * Kampania Google Ads kieruje na stronę główną z UTM-ami, a Google dokleja
 * identyfikator kliknięcia (`gclid`, czasem `gbraid` / `wbraid`) i `gad_*`.
 * Do 20.11.2026 te parametry ginęły przy pierwszym kliknięciu w odnośnik
 * i w `ud_clients` nie było śladu, ile wniosków dała reklama.
 *
 * Parametry jadą między podstronami W ADRESIE (public/zrodlo.js dokleja je do
 * odnośników w chwili kliknięcia), a nie w urządzeniu: bez ciasteczek,
 * localStorage i sessionStorage — ta sama zasada co przy linku agenta
 * (zapis w urządzeniu wymagałby zgody, art. 399 PKE). Kreator czyta je
 * z `location.search` w chwili wysyłki.
 *
 * Do wniosku idą w polu `zrodlo`; form-submit kopiuje całe ciało żądania do
 * `ud_clients.form_data`, więc źródło żyje w `form_data.zrodlo`, nie
 * w kolumnie. Kształt:
 *
 *   { utm_source?, utm_medium?, utm_campaign?, utm_term?, utm_content?,
 *     gad_source?, gad_campaignid?,
 *     platne: boolean,            // w adresie był poprawny gclid / gbraid / wbraid / gad_source
 *     zgoda_marketing: boolean,
 *     gclid? / gbraid? / wbraid?  // WYŁĄCZNIE przy zgoda_marketing === true }
 *
 * Dlaczego identyfikator kliknięcia tylko przy zgodzie na marketing: osoba,
 * która cookies marketingowe odrzuciła, wyraźnie odmówiła pomiaru
 * skuteczności reklam, a `gclid` to dokładnie klucz, po którym Google łączy
 * kliknięcie z konwersją. Bez zgody zostaje sama flaga `platne` — „przyszedł
 * z płatnego kliknięcia", bez identyfikatora.
 *
 * TE SAME REGUŁY stoją w trzech miejscach, których nie da się połączyć
 * importem: tutaj, w apps/portal/public/zrodlo.js (samodzielny skrypt bez
 * importów) i w funkcji Pages licznika kliknięć (funkcje Pages nie importują
 * pakietów workspace'u). Do tego CHECK-i tabeli `ud_klikniecia` w migracji
 * 20261120100000. Zgodność całej czwórki pilnuje apps/portal/test/zrodlo.spec.js
 * — zmiana reguły tutaj bez zmiany tam robi go czerwonym.
 */

/** Biała lista parametrów źródła — nic poza nią nie jest przenoszone ani zapisywane. */
export const PARAMETRY_ZRODLA = Object.freeze([
  'gclid', 'gbraid', 'wbraid',
  'gad_source', 'gad_campaignid',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
]);

/** Identyfikatory kliknięcia Google — zapisywane tylko przy zgodzie na marketing. */
export const IDENTYFIKATORY_KLIKNIECIA = Object.freeze(['gclid', 'gbraid', 'wbraid']);

/** Parametry, których poprawna obecność znaczy „płatne kliknięcie”. */
export const PARAMETRY_PLATNE = Object.freeze(['gclid', 'gbraid', 'wbraid', 'gad_source']);

const IDENTYFIKATOR = /^[A-Za-z0-9_-]{1,200}$/;
const GAD = /^[A-Za-z0-9_-]{1,32}$/;
const UTM_MAKS = 100;
// eslint-disable-next-line no-control-regex
const ZNAK_STERUJACY = /[\u0000-\u001F\u007F]/;

/**
 * Czy wartość (już po `trim`) jest poprawna dla danego parametru.
 * Identyfikatory: znaki base64url, do 200; `gad_*`: te same znaki, do 32
 * (Google wpisuje tam cyfry albo krótkie tokeny); `utm_*`: 1–100 znaków bez
 * znaków sterujących. Parametr spoza białej listy — zawsze `false`.
 * @param {string} klucz
 * @param {string} wartosc
 * @returns {boolean}
 */
export function wartoscZrodlaPoprawna(klucz, wartosc) {
  if (typeof wartosc !== 'string' || !PARAMETRY_ZRODLA.includes(klucz)) return false;
  if (IDENTYFIKATORY_KLIKNIECIA.includes(klucz)) return IDENTYFIKATOR.test(wartosc);
  if (klucz === 'gad_source' || klucz === 'gad_campaignid') return GAD.test(wartosc);
  // Zostają utm_*. Długość w jednostkach UTF-16 — nigdy nie więcej znaków niż
  // liczy char_length() w Postgresie, więc CHECK tabeli zawsze przepuści.
  return wartosc.length >= 1 && wartosc.length <= UTM_MAKS && !ZNAK_STERUJACY.test(wartosc);
}

/**
 * Poprawne parametry źródła z adresu, w kolejności PARAMETRY_ZRODLA, jako
 * pary [klucz, wartość po trim]. Liczy się PIERWSZE wystąpienie
 * (`URLSearchParams.get`) — gdy ono jest niepoprawne, parametru nie ma,
 * nawet jeśli dalej stoi poprawny duplikat. Nigdy nie rzuca.
 * @param {string} search location.search (z „?” albo bez)
 * @returns {[string, string][]}
 */
export function parametryZrodla(search) {
  try {
    if (typeof search !== 'string' || search === '') return [];
    const p = new URLSearchParams(search);
    const wynik = [];
    for (const klucz of PARAMETRY_ZRODLA) {
      const surowa = p.get(klucz);
      if (surowa === null) continue;
      const wartosc = surowa.trim();
      if (wartoscZrodlaPoprawna(klucz, wartosc)) wynik.push([klucz, wartosc]);
    }
    return wynik;
  } catch {
    return [];
  }
}

/**
 * Źródło wizyty do wniosku: `{ zrodlo: {...} }` albo `{}`, gdy w adresie nie
 * ma żadnego poprawnego parametru z białej listy (także przy samym ?agent=).
 * Nigdy nie rzuca — źródło nie może zatrzymać wniosku.
 * @param {string} search location.search
 * @param {boolean} zgodaMarketing zgoda na cookies marketingowe w chwili wysyłki
 * @returns {{ zrodlo?: Record<string, string | boolean> }}
 */
export function zrodloZAdresu(search, zgodaMarketing) {
  try {
    const pary = parametryZrodla(search);
    if (pary.length === 0) return {};
    const zgoda = zgodaMarketing === true;
    const zrodlo = {};
    // Najpierw kampania, potem flagi, na końcu identyfikator — kolejność tylko
    // dla czytelności form_data w panelu; JSON jej nie wymaga.
    for (const [k, v] of pary) if (!IDENTYFIKATORY_KLIKNIECIA.includes(k)) zrodlo[k] = v;
    zrodlo.platne = pary.some(([k]) => PARAMETRY_PLATNE.includes(k));
    zrodlo.zgoda_marketing = zgoda;
    if (zgoda) for (const [k, v] of pary) if (IDENTYFIKATORY_KLIKNIECIA.includes(k)) zrodlo[k] = v;
    return { zrodlo };
  } catch {
    return {};
  }
}
