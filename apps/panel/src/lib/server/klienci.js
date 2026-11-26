/**
 * Zakładka „Klienci" — lista z kolumnami „Świadczenie", „Akcja" (etap leada
 * klienta, src/lib/klienci/akcja.js, i stan najnowszej wysłanej oferty,
 * src/lib/klienci/oferta.js) i „Źródło" (src/lib/zrodlo.js), oraz karta
 * klienta ze strzałkami „Poprzedni / Następny klient". Bez importów ze
 * SvelteKita: test przeglądarkowy woła te same funkcje na prawdziwym SQL
 * (test/leady/serwer.mjs).
 */
import { synchronizuj } from './leady.js';
import { klienciWidoczni, klientWidoczny } from './widocznosc.js';
import { akcjaKlienta } from '../klienci/akcja.js';
import { porownajKlientow, sasiedzi, zapytanieListy } from '../klienci/lista.js';
import { najnowszaWyslana, stanOferty } from '../klienci/oferta.js';
import { kwotaZTekstu } from '../leady/model.js';
import { bezIdentyfikatorow, opisZrodla } from '../zrodlo.js';

/**
 * Zapytanie zawężone do klientów widocznych dla użytkownika (null = wszyscy,
 * administrator; [] = nikt — bez pytania bazy).
 * @param {string[] | null} widoczni
 */
const zawezenie = (widoczni) => (/** @type {any} */ zapytanie, /** @type {string} */ kolumna) =>
  widoczni === null ? zapytanie : widoczni.length ? zapytanie.in(kolumna, widoczni) : Promise.resolve({ data: [], error: null });

/**
 * @typedef {{ id: string, created_at: string | null, archiwum: boolean,
 *             zrodlo: ReturnType<typeof opisZrodla>, klient: any, lead: any }} WierszKlienta
 */

/**
 * Widoczni klienci w kolejności listy — JEDNA funkcja dla listy i dla strzałek
 * na karcie (sasiedziKlienta), żeby obie strony liczyły widok, źródło i
 * kolejność tak samo (src/lib/klienci/lista.js). Domyślnie czyta tylko to, co
 * o miejscu na liście decyduje; lista dokłada swoje kolumny w `kolumnyKlienta`
 * i `kolumnyLeada`.
 *
 * Wiersz: { id, created_at, archiwum, zrodlo, klient, lead }. `zrodlo` to opis
 * (bez identyfikatorów kliknięcia), `klient` — wiersz z bazy z surowym
 * `zrodlo` i kodem agenta: zostaje na serwerze.
 *
 * @param {any} sb @param {string[] | null} widoczni  z klienciWidoczni()
 * @param {{ kolumnyKlienta?: string[], kolumnyLeada?: string[] }} [opcje]
 * @returns {Promise<{ wiersze: WierszKlienta[], bledy: any[] }>}
 */
async function klienciWKolejnosci(sb, widoczni, { kolumnyKlienta = [], kolumnyLeada = [] } = {}) {
  const tylkoWidoczni = zawezenie(widoczni);
  // Źródło: tylko `form_data->zrodlo` (ścieżka JSON w PostgREST), nie całe
  // form_data — w nim jest cały wniosek z ankietą zdrowotną.
  const [{ data: klienci, error: eKlienci }, { data: leady, error: eLeady }] = await Promise.all([
    tylkoWidoczni(sb.from('ud_clients')
      .select(['id', 'created_at', 'full_name', 'affiliate_code_used', 'zrodlo:form_data->zrodlo', ...kolumnyKlienta].join(', '))
      .order('created_at', { ascending: false }).order('id', { ascending: false }), 'id'),
    tylkoWidoczni(sb.from('ud_leady').select(['klient_id', 'zarchiwizowano_at', ...kolumnyLeada].join(', ')), 'klient_id'),
  ]);
  const leadKlienta = new Map((leady || []).filter((/** @type {any} */ l) => l.klient_id).map((/** @type {any} */ l) => [l.klient_id, l]));
  /** @type {WierszKlienta[]} */
  const wiersze = (klienci || []).map((/** @type {any} */ k) => {
    const lead = leadKlienta.get(k.id) ?? null;
    return {
      id: k.id,
      created_at: k.created_at,
      // Lead w archiwum tablicy = klient w widoku „Archiwum" (decyzja z 05.10.2026).
      archiwum: Boolean(lead?.zarchiwizowano_at),
      zrodlo: opisZrodla({ zrodlo: k.zrodlo, affiliate_code_used: k.affiliate_code_used }),
      klient: k,
      lead,
    };
  });
  return { wiersze: wiersze.sort(porownajKlientow), bledy: [eKlienci, eLeady].filter(Boolean) };
}

/**
 * Kwota świadczenia z okresowej niezdolności (zł/mies.). Kolumna
 * `temp_incapacity_sum` jest tekstowa (na produkcji 20.11.2026: 73 wiersze
 * z samymi cyframi, 10 pustych, żadnego nieczytelnego) — czytamy ją jak SQL
 * (ud_kwota, tu: kwotaZTekstu): 8000, „8 000 zł", „8000,50". Liczba (gdyby
 * kolumna kiedyś zmieniła typ) przechodzi, jeśli jest skończona i nieujemna.
 * Cokolwiek innego → null, czyli „—" na liście, nigdy NaN.
 * @param {unknown} v
 */
export const swiadczenieZKolumny = (v) => (typeof v === 'number' ? (Number.isFinite(v) && v >= 0 ? v : null)
  : typeof v === 'string' ? kwotaZTekstu(v) : null);

/** @param {any} sb @param {string} userId */
export async function listaKlientow(sb, userId) {
  // Ta sama synchronizacja co przy otwarciu tablicy: nowy klient od razu ma
  // lead i etap. Awaria jej nie blokuje listy — „Akcja" pokaże wtedy „—".
  await synchronizuj(sb);
  // Agent widzi tylko klientów swoich leadów (null = administrator, wszyscy).
  const widoczni = await klienciWidoczni(sb, userId);
  const [{ wiersze }, { data: profiles }, { data: etapy }, { data: oferty }] = await Promise.all([
    klienciWKolejnosci(sb, widoczni, {
      kolumnyKlienta: ['email', 'phone', 'employment_type', 'referred_by', 'source', 'temp_incapacity_sum'],
      kolumnyLeada: ['id', 'etap_id', 'powod_utraty', 'ochrona_do'],
    }),
    sb.from('ud_user_profiles').select('id, full_name'),
    sb.from('ud_leady_etap').select('id, klucz, rodzaj, nazwa'),
    // Tylko wysłane oferty — także z archiwum (najnowsza wysłana mówi o kliencie,
    // nawet gdy agent ją zarchiwizował; klienci/oferta.js) — i tylko daty:
    // z client_choice same chwile wyboru i rezygnacji, nie cały wybór.
    zawezenie(widoczni)(sb.from('ud_offers')
      .select('id, client_id, offer_number, status, sent_at, viewed_at, wersja, decided_at, archived_at, '
        + 'wybrano_at:client_choice->>chosen_at, rezygnacja_at:client_choice->>rejected_at')
      .not('sent_at', 'is', null), 'client_id'),
  ]);

  /** @type {Record<string, string>} */
  const owners = {};
  for (const p of profiles || []) owners[p.id] = p.full_name || '—';
  const etapPo = new Map((etapy || []).map((/** @type {any} */ e) => [e.id, e]));
  /** @type {Map<string, any[]>} */
  const ofertyKlienta = new Map();
  for (const o of oferty || []) {
    if (!o.client_id) continue;
    if (!ofertyKlienta.has(o.client_id)) ofertyKlienta.set(o.client_id, []);
    ofertyKlienta.get(o.client_id)?.push(o);
  }
  const dzis = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());

  // Surowe `zrodlo`, kod agenta i tekst kwoty zostają tutaj: do przeglądarki
  // idzie tylko opis źródła (rodzaj, kampania, słowo) — identyfikator
  // kliknięcia nigdy — i kwota świadczenia jako liczba.
  return wiersze.map(({ archiwum, zrodlo, klient, lead }) => {
    const { zrodlo: _surowe, affiliate_code_used: _kod, temp_incapacity_sum, ...c } = klient;
    return {
      ...c,
      owner_name: c.referred_by ? (owners[c.referred_by] || 'nieznany user') : null,
      akcja: akcjaKlienta(lead, lead ? etapPo.get(lead.etap_id) : null, dzis),
      archiwum,
      zrodlo,
      swiadczenie: swiadczenieZKolumny(temp_incapacity_sum),
      oferta: stanOferty(najnowszaWyslana(ofertyKlienta.get(c.id))),
    };
  });
}

/**
 * Sąsiedzi klienta na liście z tymi filtrami — strzałki „Poprzedni / Następny
 * klient" na karcie. Lekko: bez synchronizacji tablicy, bez ofert i profili,
 * tylko to, co decyduje o miejscu na liście (klienciWKolejnosci). Wyłącznie
 * spośród klientów widocznych dla użytkownika — cudzy klient nie wyjdzie ani
 * jako sąsiad, ani w liczbie „N z M".
 * @param {any} sb @param {string} userId @param {string} klientId
 * @param {{ archiwum: boolean, zrodlo: string | null }} filtry
 */
export async function sasiedziKlienta(sb, userId, klientId, filtry) {
  const { wiersze, bledy } = await klienciWKolejnosci(sb, await klienciWidoczni(sb, userId));
  if (bledy.length) throw new Error('Kolejność klientów: ' + bledy.map((/** @type {any} */ b) => b.message).join('; '));
  const biezacy = wiersze.find((w) => w.id === klientId);
  if (!biezacy) return { poprzedni: null, nastepny: null, pozycja: null, razem: null };
  const s = sasiedzi(wiersze, biezacy, filtry);
  const krotko = (/** @type {any} */ w) => (w ? { id: w.id, full_name: w.klient.full_name ?? null } : null);
  return { poprzedni: krotko(s.poprzedni), nastepny: krotko(s.nastepny), pozycja: s.pozycja, razem: s.razem };
}

/**
 * Karta klienta (/panel/klienci/<id>). `null` = nie ma albo użytkownik go nie
 * widzi — strona odpowiada wtedy 404, bez zdradzania, że klient istnieje.
 *
 * `form_data` idzie do przeglądarki bez identyfikatorów kliknięcia
 * (gclid/gbraid/wbraid); źródło jako opis z src/lib/zrodlo.js.
 *
 * `nawigacja` — strzałki „Poprzedni / Następny klient" po liście z filtrami,
 * z którymi agent przyszedł (`filtry` z adresu karty, src/lib/klienci/lista.js),
 * i adres powrotu na tę listę. Awaria ich wyliczenia nie zasłania karty:
 * strzałki są wtedy nieaktywne.
 * @param {any} sb @param {string} userId @param {unknown} klientId
 * @param {{ archiwum: boolean, zrodlo: string | null }} [filtry]
 */
export async function kartaKlienta(sb, userId, klientId, filtry = { archiwum: false, zrodlo: null }) {
  if (typeof klientId !== 'string' || !/^[0-9a-f-]{36}$/i.test(klientId)) return null;
  // Cudzy klient wygląda dla agenta jak nieistniejący.
  if (!(await klientWidoczny(sb, userId, klientId))) return null;
  // Cały wiersz: karta pokazuje każdą kolumnę („Pozostałe pola" łapią nowe).
  const [{ data: client }, sasiedztwo] = await Promise.all([
    sb.from('ud_clients').select('*').eq('id', klientId).maybeSingle(),
    sasiedziKlienta(sb, userId, klientId, filtry).catch(() => null),
  ]);
  if (!client) return null;

  let owner_name = null;
  if (client.referred_by) {
    const { data: p } = await sb.from('ud_user_profiles').select('full_name').eq('id', client.referred_by).maybeSingle();
    owner_name = p?.full_name || 'nieznany user';
  }

  const { data: offers } = await sb
    .from('ud_offers')
    .select('id, name, offer_number, status, created_at, sent_at, client_choice, source')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false });

  // Warianty wybrane przez klienta — żeby karta mówiła, CO wybrał, nie tylko że wybrał.
  const ids = (offers || []).map((/** @type {any} */ o) => o.client_choice?.document_id).filter(Boolean);
  const { data: wybrane } = ids.length
    ? await sb
        .from('ud_offer_documents')
        .select('id, offer_number, temp_monthly_benefit, indemnity_period, wait_accident, wait_illness, premium_total')
        .in('id', ids)
    : { data: [] };

  return {
    client: { ...client, form_data: bezIdentyfikatorow(client.form_data) },
    zrodlo: opisZrodla({ form_data: client.form_data, affiliate_code_used: client.affiliate_code_used }),
    owner_name,
    offers: offers || [],
    wybrane: wybrane || [],
    nawigacja: {
      poprzedni: sasiedztwo?.poprzedni ?? null,
      nastepny: sasiedztwo?.nastepny ?? null,
      pozycja: sasiedztwo?.pozycja ?? null,
      razem: sasiedztwo?.razem ?? null,
      zapytanie: zapytanieListy(filtry),
    },
  };
}
