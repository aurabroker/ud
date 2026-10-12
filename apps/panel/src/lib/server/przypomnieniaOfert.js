/**
 * przypomnieniaOfert.js — SMS do klientów, którzy dostali ofertę i milczą.
 *
 * Decyzja właściciela z 12.10.2026. Wołane co godzinę przez pg_cron
 * (ud_oferty_przypomnienia → POST /api/cron/przypomnienia-ofert).
 *
 * Kogo — wybiera baza (ud_oferty_do_przypomnienia, migracja
 * 20261012123157_oferty_przypomnienia_sms.sql): oferta wysłana albo obejrzana,
 * 3–30 dni po wysyłce, bez wyboru wariantu, bez pytania klienta, najnowsza
 * oferta klienta, lead niezamknięty, o tej wersji jeszcze nie przypominaliśmy.
 *
 * Tu — wysyłka, z czterema zabezpieczeniami:
 *  1. Oferta jest ZAJMOWANA warunkowym UPDATE-em przed wysłaniem SMS-a. Dwa
 *     nakładające się wywołania nie wyślą dwóch SMS-ów, bo drugie nie zajmie
 *     już zajętej wersji.
 *  2. Jeden numer — jeden SMS na 7 dni, także gdy ten sam telefon stoi przy
 *     ofertach dwóch różnych klientów (np. małżonków).
 *  3. Porażka SMSAPI ZWALNIA ofertę (spróbujemy za godzinę) i kończy
 *     wywołanie — przy braku punktów albo złym tokenie każda kolejna próba
 *     skończyłaby się tak samo. Tak samo brak tokenu (tryb stub). Wyjątek:
 *     błędny numer (kody 13 i 105) — tu ponowienie nic nie zmieni, więc
 *     oferta zostaje zajęta.
 *  4. Najwyżej PRZYPOMNIENIA_NA_RAZ SMS-ów na wywołanie.
 *
 * Zależności (baza, wysyłka SMS) są parametrami, żeby dało się to sprawdzić
 * bez bazy i bez SMSAPI (scripts/test-przypomnienia-ofert.mjs).
 */
import {
  SMS_PRZYPOMNIENIE, numerDoSms,
  PRZYPOMNIENIE_PO_DNIACH, PRZYPOMNIENIE_NAJWYZEJ_DNI, PRZYPOMNIENIA_NA_RAZ
} from './smsOferta.js';

export const KANAL_PRZYPOMNIENIA = 'sms_przypomnienie';

/** Błąd numeru odbiorcy w SMSAPI — ponowienie nic nie da. */
const BLAD_NUMERU = /SMSAPI błąd (13|105)\b/;

/**
 * @param {{ sb: any, sendSms: (numer: string, tresc: string) => Promise<any>, teraz?: Date }} deps
 * @returns {Promise<{ kandydatow: number, wyslano: number, pominieto: number, bledow: number, przerwano?: string }>}
 */
export async function wyslijPrzypomnienia({ sb, sendSms, teraz = new Date() }) {
  const { data: kandydaci, error } = await sb.rpc('ud_oferty_do_przypomnienia', {
    p_po_dniach: PRZYPOMNIENIE_PO_DNIACH,
    p_najwyzej_dni: PRZYPOMNIENIE_NAJWYZEJ_DNI
  });
  if (error) throw new Error('ud_oferty_do_przypomnienia: ' + error.message);

  const wynik = { kandydatow: (kandydaci || []).length, wyslano: 0, pominieto: 0, bledow: 0 };
  const tydzienTemu = new Date(teraz.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const numeryWTymWywolaniu = new Set();

  for (const k of kandydaci || []) {
    if (wynik.wyslano >= PRZYPOMNIENIA_NA_RAZ) break;

    // Zły numer przy ofercie nie zasłania dobrego z kartoteki (jak przy wysyłce oferty).
    const numer = numerDoSms(k.telefon_oferty) ?? numerDoSms(k.telefon_klienta);
    if (!numer || numeryWTymWywolaniu.has(numer)) { wynik.pominieto += 1; continue; }

    const { data: niedawno } = await sb
      .from('ud_send_log')
      .select('id')
      .eq('channel', KANAL_PRZYPOMNIENIA)
      .eq('recipient', numer)
      .eq('status', 'sent')
      .gte('created_at', tydzienTemu)
      .limit(1);
    if (niedawno?.length) { wynik.pominieto += 1; continue; }

    // Zajęcie: tylko gdy o tej wersji jeszcze nie przypominaliśmy.
    const { data: zajete } = await sb
      .from('ud_offers')
      .update({ przypomnienie_wersja: k.wersja, przypomnienie_sms_at: teraz.toISOString() })
      .eq('id', k.offer_id)
      .or(`przypomnienie_wersja.is.null,przypomnienie_wersja.lt.${Number(k.wersja)}`)
      .select('id, user_id');
    if (!zajete?.length) { wynik.pominieto += 1; continue; }
    numeryWTymWywolaniu.add(numer);

    const sms = await sendSms(numer, SMS_PRZYPOMNIENIE)
      .catch((e) => ({ sent: false, error: 'SMS: ' + (e?.message || e) }));

    await sb.from('ud_send_log').insert({
      offer_id: k.offer_id,
      user_id: zajete[0].user_id || null,
      channel: KANAL_PRZYPOMNIENIA,
      recipient: numer,
      status: sms?.sent ? 'sent' : sms?.stub ? 'stub' : 'error',
      wersja: k.wersja,
      provider_id: sms?.id || null,
      error: sms?.error || null
    }).then(() => {}, () => {});

    if (sms?.sent) { wynik.wyslano += 1; continue; }

    wynik.bledow += 1;
    if (BLAD_NUMERU.test(String(sms?.error || ''))) continue;   // numer zły na stałe

    // Zwolnienie, żeby następne wywołanie spróbowało jeszcze raz. Także w trybie
    // bez tokenu (stub): inaczej brak SMSAPI_TOKEN „zużyłby" przypomnienia
    // wszystkich klientów, choć żaden SMS nie wyszedł. Pusty znacznik wystarcza —
    // liczy się tylko to, czy przypomnieliśmy o NAJNOWSZEJ wersji.
    await sb
      .from('ud_offers')
      .update({ przypomnienie_wersja: null, przypomnienie_sms_at: null })
      .eq('id', k.offer_id)
      .eq('przypomnienie_wersja', k.wersja);
    wynik.przerwano = sms?.stub ? 'brak SMSAPI_TOKEN — tryb testowy, nic nie wyszło' : String(sms?.error || 'nieznany błąd SMS');
    break;
  }
  return wynik;
}
