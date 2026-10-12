/**
 * przypomnieniaOfert.js — SMS do klientów, którzy dostali ofertę i milczą.
 *
 * Decyzja właściciela z 12.10.2026. Wołane co godzinę przez pg_cron
 * (ud_oferty_przypomnienia → POST /api/cron/przypomnienia-ofert).
 *
 * Kogo — wybiera baza (ud_oferty_do_przypomnienia, migracje
 * 20261012123157_oferty_przypomnienia_sms.sql i …162649_…_2.sql): oferta
 * wysłana albo obejrzana, 3–30 dni po wysyłce, bez wyboru wariantu, bez pytania
 * klienta, najnowsza oferta klienta, klient nic nie kupił ani nie wybrał w innej
 * ofercie, lead niezamknięty i niezarchiwizowany, o tej wersji jeszcze nie
 * przypominaliśmy.
 *
 * Tu — wysyłka. Zasada nadrzędna: DWA SMS-y SĄ GORSZE NIŻ ŻADEN. Gdy nie
 * wiadomo, czy SMS wyszedł, oferta zostaje zajęta i nikt nie próbuje drugi raz.
 *
 *  1. Oferta jest ZAJMOWANA warunkowym UPDATE-em przed wysłaniem. Dwa
 *     nakładające się wywołania nie wyślą dwóch SMS-ów, bo drugie nie zajmie
 *     już zajętej wersji.
 *  2. Przed wysłaniem w ud_send_log staje wpis „pending". Nie da się go
 *     zapisać — SMS nie wychodzi (bez śladu nie wiedzielibyśmy, że poszedł).
 *     Wywołanie, które padnie po wysłaniu, zostawia „pending", a ten blokuje
 *     ponowienie i liczy się do limitu na numer. Zajęcie bez żadnego wpisu
 *     (padło przed nim) baza po godzinie oddaje do puli.
 *  3. Jeden numer — jeden SMS na 7 dni, także gdy ten sam telefon stoi przy
 *     ofertach dwóch różnych klientów (np. małżonków). Nie da się sprawdzić
 *     dziennika — wywołanie się kończy.
 *  4. Porażka SMSAPI z odpowiedzią (brak punktów, zły token, filtr IP) ZWALNIA
 *     ofertę i kończy wywołanie — każda kolejna próba skończyłaby się tak samo.
 *     Tak samo brak tokenu (tryb stub): inaczej „zużyłby" przypomnienia
 *     wszystkich klientów bez jednego SMS-a.
 *     Wyjątki: odrzucony numer (kod 13) — oferta zostaje zajęta, idziemy dalej;
 *     brak odpowiedzi (limit czasu, zerwane połączenie) — nie wiadomo, czy SMS
 *     wyszedł, więc oferta zostaje zajęta, a wywołanie się kończy.
 *  5. Limity jednego wywołania: PRZYPOMNIENIA_NA_RAZ prób, BUDZET_ZAPYTAN
 *     zapytań (darmowy plan Workers przerywa wywołanie po 50) i CZAS_MS
 *     (pg_net czeka 30 s). Reszta kandydatów czeka na następną godzinę.
 *
 * Zależności (baza, wysyłka SMS, zegar) są parametrami, żeby dało się to
 * sprawdzić bez bazy i bez SMSAPI (scripts/test-przypomnienia-ofert.mjs).
 */
import {
  SMS_PRZYPOMNIENIE, numerDoSms,
  PRZYPOMNIENIE_PO_DNIACH, PRZYPOMNIENIE_NAJWYZEJ_DNI, PRZYPOMNIENIA_NA_RAZ
} from './smsOferta.js';

export const KANAL_PRZYPOMNIENIA = 'sms_przypomnienie';

/** SMSAPI 13 — brak prawidłowego numeru (błędny, stacjonarny, na czarnej liście). Ponowienie nic nie da. */
const BLAD_NUMERU = /^SMSAPI błąd 13\b/;

/** Wyjątek z fetch w sms.js (limit czasu, zerwane połączenie): odpowiedzi nie było, wynik nieznany. */
const BEZ_ODPOWIEDZI = /^SMSAPI: /;

/**
 * Zapytania na jednego kandydata najwyżej: dziennik 7 dni, zajęcie, wpis
 * „pending", SMSAPI, wynik, zwolnienie.
 */
const ZAPYTAN_NA_KANDYDATA = 6;

/**
 * Zapytań w jednym wywołaniu. Workers na darmowym planie przerywają wywołanie
 * po 50 podżądaniach — a przerwanie w środku wysyłki zostawia wynik nieznany.
 * Zapas na sprawdzenie tokenu i wpis w ud_errors w punkcie wejścia.
 */
export const BUDZET_ZAPYTAN = 40;

/**
 * Nowego kandydata nie zaczynamy po tylu ms. pg_net czeka na odpowiedź 30 s,
 * a jedno wywołanie SMSAPI może trwać do 8 s (limit w sms.js).
 */
export const CZAS_MS = 15_000;

/** Zajęcie bez wpisu w dzienniku starsze niż to — osierocone (patrz migracja …_2). */
const OSIEROCONE_PO_MS = 3600 * 1000;

/**
 * @param {{
 *   sb: any,
 *   sendSms: (numer: string, tresc: string) => Promise<any>,
 *   teraz?: Date,
 *   zegar?: () => number,
 *   budzetZapytan?: number
 * }} deps
 * @returns {Promise<{ kandydatow: number, wyslano: number, pominieto: number, bledow: number, zostalo: number, przerwano?: string }>}
 */
export async function wyslijPrzypomnienia({ sb, sendSms, teraz = new Date(), zegar = () => Date.now(), budzetZapytan = BUDZET_ZAPYTAN }) {
  const start = zegar();
  let zapytan = 1;
  const { data: kandydaci, error } = await sb.rpc('ud_oferty_do_przypomnienia', {
    p_po_dniach: PRZYPOMNIENIE_PO_DNIACH,
    p_najwyzej_dni: PRZYPOMNIENIE_NAJWYZEJ_DNI
  });
  if (error) throw new Error('ud_oferty_do_przypomnienia: ' + error.message);

  const lista = kandydaci || [];
  const wynik = { kandydatow: lista.length, wyslano: 0, pominieto: 0, bledow: 0, zostalo: 0 };
  const tydzienTemu = new Date(teraz.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const osieroconePrzed = new Date(teraz.getTime() - OSIEROCONE_PO_MS).toISOString();
  const numeryWTymWywolaniu = new Set();

  const zwolnij = async (k) => {
    zapytan += 1;
    await sb
      .from('ud_offers')
      .update({ przypomnienie_wersja: null, przypomnienie_sms_at: null })
      .eq('id', k.offer_id)
      .eq('przypomnienie_wersja', k.wersja)
      .then(() => {}, () => {});
  };

  for (let i = 0; i < lista.length; i++) {
    const k = lista[i];
    if (wynik.wyslano + wynik.bledow >= PRZYPOMNIENIA_NA_RAZ
      || zapytan + ZAPYTAN_NA_KANDYDATA > budzetZapytan
      || zegar() - start > CZAS_MS) {
      wynik.zostalo = lista.length - i;
      break;
    }

    // Zły numer przy ofercie nie zasłania dobrego z kartoteki (jak przy wysyłce oferty).
    const numer = numerDoSms(k.telefon_oferty) ?? numerDoSms(k.telefon_klienta);
    if (!numer || numeryWTymWywolaniu.has(numer)) { wynik.pominieto += 1; continue; }

    // „pending" liczy się jak wysłany: wywołanie padło w trakcie, SMS mógł wyjść.
    zapytan += 1;
    const { data: niedawno, error: bladDziennika } = await sb
      .from('ud_send_log')
      .select('id')
      .eq('channel', KANAL_PRZYPOMNIENIA)
      .eq('recipient', numer)
      .in('status', ['sent', 'pending'])
      .gte('created_at', tydzienTemu)
      .limit(1);
    if (bladDziennika) { wynik.przerwano = 'nie da się sprawdzić dziennika wysyłek: ' + bladDziennika.message; break; }
    if (niedawno?.length) { wynik.pominieto += 1; continue; }

    // Zajęcie: o tej wersji jeszcze nie przypominaliśmy albo zajęcie jest
    // osierocone (baza zwróciła ofertę, bo dziennik nie ma o niej wpisu, a od
    // zajęcia minęła godzina). Warunek na czas zajęcia sprawia, że osierocone
    // przejmie tylko jedno z nakładających się wywołań.
    const w = Number(k.wersja);
    zapytan += 1;
    const { data: zajete, error: bladZajecia } = await sb
      .from('ud_offers')
      .update({ przypomnienie_wersja: k.wersja, przypomnienie_sms_at: teraz.toISOString() })
      .eq('id', k.offer_id)
      .or(`przypomnienie_wersja.is.null,przypomnienie_wersja.lt.${w},and(przypomnienie_wersja.eq.${w},przypomnienie_sms_at.lt.${osieroconePrzed})`)
      .select('id, user_id');
    if (bladZajecia) { wynik.przerwano = 'nie da się zająć oferty: ' + bladZajecia.message; break; }
    if (!zajete?.length) { wynik.pominieto += 1; continue; }
    numeryWTymWywolaniu.add(numer);

    // Ślad PRZED wysyłką. Bez niego SMS nie wychodzi.
    zapytan += 1;
    const { data: wpis, error: bladWpisu } = await sb
      .from('ud_send_log')
      .insert({
        offer_id: k.offer_id,
        user_id: zajete[0].user_id || null,
        channel: KANAL_PRZYPOMNIENIA,
        recipient: numer,
        status: 'pending',
        wersja: k.wersja
      })
      .select('id')
      .then((r) => r, (e) => ({ data: null, error: e }));
    const idWpisu = wpis?.[0]?.id;
    if (bladWpisu || !idWpisu) {
      await zwolnij(k);
      wynik.przerwano = 'nie da się zapisać w dzienniku wysyłek — SMS niewysłany' + (bladWpisu?.message ? ': ' + bladWpisu.message : '');
      break;
    }

    zapytan += 1;
    const sms = await sendSms(numer, SMS_PRZYPOMNIENIE)
      .catch((e) => ({ sent: false, wyjatek: true, error: 'SMS: ' + (e?.message || e) }));
    const bezOdpowiedzi = !sms?.sent && !sms?.stub && !sms?.wyjatek && BEZ_ODPOWIEDZI.test(String(sms?.error || ''));

    // Wynik do wpisu. Nieudany zapis zostawia „pending" — to blokuje ponowienie,
    // czyli działa w bezpieczną stronę.
    zapytan += 1;
    await sb
      .from('ud_send_log')
      .update({
        status: sms?.sent ? 'sent' : sms?.stub ? 'stub' : 'error',
        provider_id: sms?.id || null,
        error: sms?.sent ? null
          : bezOdpowiedzi ? `${sms.error} — brak odpowiedzi, nie wiadomo, czy SMS wyszedł; bez ponowienia`
          : (sms?.error || null)
      })
      .eq('id', idWpisu)
      .then(() => {}, () => {});

    if (sms?.sent) { wynik.wyslano += 1; continue; }

    wynik.bledow += 1;
    if (BLAD_NUMERU.test(String(sms?.error || ''))) continue;   // numer odrzucony na stałe

    if (bezOdpowiedzi) {
      wynik.przerwano = 'SMSAPI nie odpowiedziało — oferta zostaje zajęta (SMS mógł wyjść): ' + sms.error;
      break;
    }

    // Odpowiedź była i mówi „nie wysłano" — zwalniamy, następne wywołanie
    // spróbuje jeszcze raz. Wpis „error"/„stub" zostaje w dzienniku jako ślad,
    // ale nie blokuje ponowienia: limit na numer liczy tylko sent i pending.
    await zwolnij(k);
    wynik.przerwano = sms?.stub ? 'brak SMSAPI_TOKEN — tryb testowy, nic nie wyszło' : String(sms?.error || 'nieznany błąd SMS');
    break;
  }
  return wynik;
}
