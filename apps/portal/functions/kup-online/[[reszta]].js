/**
 * /kup-online — nasz krótki adres do strony sprzedaży Leadenhall, z licznikiem.
 *
 * Klient, który woli kupić sam, przez internet, trafia na stronę Leadenhall
 * z naszym kodem pośrednika (`employeeCode`) — po nim Leadenhall przypisuje
 * nam polisę. Leadenhall raportuje sprzedaż, ale nie wejścia; ten adres mówi,
 * ile osób w ogóle przeszło i z którego miejsca (`?z=kalkulator`, `?z=blog`,
 * `?z=mail`…), więc da się policzyć, ile kliknięć daje jedną polisę.
 *
 * Link Leadenhall idzie DOKŁADNIE taki, jaki dostaliśmy — `?z=` do niego nie
 * przechodzi. Ich strona czyta kod z adresu i zapisuje go w localStorage
 * (sprawdzone 11.11.2026), więc przekierowanie nie gubi przypisania.
 *
 * Dlaczego przekierowanie, a nie ramka na naszej stronie: kod pośrednika
 * żyje w localStorage, a w ramce z cudzej domeny przeglądarki trzymają go
 * osobno od zwykłej wizyty u Leadenhall. Klient, który wróci do nich
 * bezpośrednio (mail, inna karta, telefon), mógłby przyjść już bez naszego
 * kodu. Do tego wypełniałby ankietę zdrowotną i płacił pod naszym adresem.
 *
 * Co liczymy: kliknięcie człowieka. Nie liczymy HEAD, prefetchu przeglądarki,
 * robotów i podglądów linków (komunikatory pobierają adres, gdy ktoś go
 * wkleja) ani wejść na podglądzie `*.pages.dev`. Zapis idzie w tle
 * (`waitUntil`) — przekierowanie nigdy na niego nie czeka. Bez IP, User-Agenta
 * i ciasteczek: w bazie jest tylko czas, cel i źródło (tabela `ud_klikniecia`,
 * migracja `20261111101126_klikniecia.sql`).
 *
 * Od 20.11.2026 także: czy wejście przyszło z reklamy. Klient z kampanii
 * Google Ads może kupić online i nie złożyć wniosku — wtedy nie ma go ani
 * w `ud_clients`, ani w konwersjach Ads. public/zrodlo.js dokleja parametry
 * kampanii do odnośnika `/kup-online`, a tu zapisujemy z nich trzy rzeczy:
 * `platne` — wejście z reklamy według TEJ SAMEJ reguły, co „Google Ads"
 * w panelu (apps/panel/src/lib/zrodlo.js, `rodzajZrodla`): w adresie był
 * poprawny gclid, gbraid, wbraid albo gad_source, ALBO utm_source ads/google
 * przy utm_medium cpc/internet/paid (kampania UD_2026 bez identyfikatora, np.
 * gdy Safari go wycięło). Inaczej „z reklamy" na Niedokończonych i „Google Ads"
 * w Statystykach liczyłyby dwie różne rzeczy, a właściciel je porównuje.
 * Do tego `utm_campaign` i `gad_campaignid` — tylko poprawne, inaczej pomijane.
 * SAMEGO IDENTYFIKATORA KLIKNIĘCIA NIE ZAPISUJEMY: tu nie znamy zgody na
 * marketing, a bez niej klient odmówił pomiaru skuteczności reklam.
 * Reguły wartości to kopia packages/wniosek/src/zrodlo.js (funkcje Pages nie
 * importują pakietów workspace'u) i CHECK-ów migracji
 * `20261120100000_klikniecia_zrodlo_reklamy.sql`; zgodność pilnuje
 * test/zrodlo.spec.js. Parametry kampanii do Leadenhall NIE przechodzą —
 * przekierowanie idzie na CEL bez zmian.
 *
 * Zmienne (te same, co w functions/owu): SUPABASE_SERVICE_ROLE_KEY — bez niej
 * przekierowanie działa, tylko nic się nie liczy; PUBLIC_SUPABASE_URL —
 * opcjonalna.
 */

/** Link sprzedażowy Leadenhall z naszym kodem pośrednika — od właściciela, 11.11.2026. */
export const CEL = 'https://utratadochodu.leadenhall.com/?employeeCode=CVRZSKkHi7';

const DOMYSLNY_URL = 'https://kukvgsjrmrqtzhkszzum.supabase.co';
const CZAS_MS = 5_000;

/**
 * Źródło z `?z=`: małe litery, cyfry i myślnik, do 32 znaków — reszta to
 * „inne". Ta sama reguła stoi w CHECK tabeli, więc do bazy nie wejdzie
 * dowolny tekst z adresu.
 */
export function zrodlo(wartosc) {
  if (wartosc === null || wartosc === '') return 'bezposrednio';
  const z = wartosc.trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(z) ? z : 'inne';
}

/*
 * Reklama — kopia reguł z packages/wniosek/src/zrodlo.js, tylko to, co
 * zapisujemy. Wartość po trim; liczy się pierwsze wystąpienie (`get`).
 */
const PLATNE = ['gclid', 'gbraid', 'wbraid', 'gad_source'];
const IDENTYFIKATOR = /^[A-Za-z0-9_-]{1,200}$/;
const GAD = /^[A-Za-z0-9_-]{1,32}$/;
const UTM_MAKS = 100;
// eslint-disable-next-line no-control-regex
const STERUJACY = /[\u0000-\u001F\u007F]/;
// Kopia ZRODLA_REKLAMY / MEDIA_REKLAMY z apps/panel/src/lib/zrodlo.js — tamten
// plik jest regułą; test/zrodlo.spec.js porównuje obie zachowaniem.
const ZRODLA_REKLAMY = ['ads', 'google'];
const MEDIA_REKLAMY = ['cpc', 'internet', 'paid'];

/** Wartość parametru po trim albo null, gdy go nie ma albo jest niepoprawna. */
function poprawnaWartosc(parametry, klucz) {
  const surowa = parametry.get(klucz);
  if (surowa === null) return null;
  const v = surowa.trim();
  if (klucz.startsWith('utm_')) return v.length >= 1 && v.length <= UTM_MAKS && !STERUJACY.test(v) ? v : null;
  if (klucz === 'gad_source' || klucz === 'gad_campaignid') return GAD.test(v) ? v : null;
  return IDENTYFIKATOR.test(v) ? v : null;
}

/** utm_source ads/google przy utm_medium cpc/internet/paid — jak reguła a) w panelu. */
function oznaczenieReklamy(parametry) {
  const zrodloUtm = (poprawnaWartosc(parametry, 'utm_source') ?? '').toLowerCase();
  const medium = (poprawnaWartosc(parametry, 'utm_medium') ?? '').toLowerCase();
  return ZRODLA_REKLAMY.includes(zrodloUtm) && MEDIA_REKLAMY.includes(medium);
}

/**
 * Część wiersza `ud_klikniecia` o reklamie: `platne` zawsze (true albo false —
 * NULL w tabeli znaczy „kliknięcie sprzed pomiaru"), `utm_campaign`
 * i `gad_campaignid` tylko poprawne. Bez identyfikatora kliknięcia. Nie rzuca —
 * licznik nie może zatrzymać przekierowania.
 * @param {URLSearchParams} parametry
 * @returns {{ platne: boolean, utm_campaign?: string, gad_campaignid?: string }}
 */
export function reklama(parametry) {
  try {
    const wynik = {
      platne: PLATNE.some((k) => poprawnaWartosc(parametry, k) !== null) || oznaczenieReklamy(parametry),
    };
    for (const k of ['utm_campaign', 'gad_campaignid']) {
      const v = poprawnaWartosc(parametry, k);
      if (v !== null) wynik[k] = v;
    }
    return wynik;
  } catch {
    return { platne: false };
  }
}

/**
 * Roboty, podglądy linków i narzędzia. Komunikatory (WhatsApp, Messenger,
 * Slack, Telegram) pobierają adres, gdy ktoś go tylko wkleja — to nie jest
 * kliknięcie klienta. Pusty User-Agent też nie.
 */
const ROBOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|linkedin|embedly|curl|wget|python|httpclient|okhttp|headless|lighthouse|monitor|scan/i;

export function czlowiek(request) {
  if (request.method.toUpperCase() !== 'GET') return false;
  const ua = request.headers.get('user-agent') ?? '';
  if (!ua.trim() || ROBOT.test(ua)) return false;
  // X-Purpose: preview — aplikacja Facebooka na Androidzie pobiera stronę,
  // gdy post tylko pojawi się na ekranie (z x-fb-http-engine: Liger), a nie
  // gdy ktoś w niego stuknie. Bez tego każde przewinięcie posta liczyłoby się
  // jak kliknięcie.
  const cel = ['sec-purpose', 'purpose', 'x-purpose'].map((n) => request.headers.get(n) ?? '').join(' ');
  return !/prefetch|prerender|preview/i.test(cel);
}

/**
 * PostgREST nie zna którejś kolumny z ciała (PGRST204) — tak odpowiada baza
 * sprzed migracji 20261120100000 na `platne`, `utm_campaign`, `gad_campaignid`.
 */
async function brakKolumny(odp) {
  if (odp.status !== 400) return false;
  try {
    return (await odp.json())?.code === 'PGRST204';
  } catch {
    return false;
  }
}

async function zapisz(env, wiersz) {
  const klucz = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!klucz) return;
  const url = env.PUBLIC_SUPABASE_URL ?? DOMYSLNY_URL;
  const naglowki = {
    apikey: klucz,
    Authorization: `Bearer ${klucz}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  const wstaw = (w) => fetch(`${url}/rest/v1/ud_klikniecia`, {
    method: 'POST', headers: naglowki, body: JSON.stringify(w), signal: AbortSignal.timeout(CZAS_MS),
  });
  let powod;
  try {
    let odp = await wstaw(wiersz);
    // Portal wyszedł przed migracją 20261120100000 (push wdraża go od razu, jak
    // panel v.0.70 przed koszem ofert): baza nie zna nowych kolumn i odrzuca
    // CAŁY wiersz. Wtedy jeszcze raz samym celem i źródłem, jak przed zmianą —
    // licznik liczy dalej, ginie tylko informacja o reklamie (po migracji takie
    // wiersze mają `platne` NULL = „sprzed pomiaru", panel nie udaje zer).
    // Bez wpisu w ud_errors: byłby jeden na każde kliknięcie, a brak kolumny
    // „z reklamy" w panelu i tak to widać.
    if (await brakKolumny(odp)) odp = await wstaw({ cel: wiersz.cel, zrodlo: wiersz.zrodlo });
    if (odp.ok) return;
    powod = `HTTP ${odp.status}`;
  } catch (e) {
    powod = e?.name === 'TimeoutError' ? 'brak odpowiedzi' : String(e?.message ?? e);
  }
  // Licznik, który po cichu przestaje liczyć, wygląda jak brak zainteresowania.
  await fetch(`${url}/rest/v1/ud_errors`, {
    method: 'POST',
    headers: naglowki,
    body: JSON.stringify({ source: 'kup-online', level: 'error', message: `Kliknięcie nie zapisane: ${powod}` }),
    signal: AbortSignal.timeout(CZAS_MS),
  }).catch(() => {});
}

const tekst = (tresc, status, dodatkowe = {}) => new Response(tresc, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...dodatkowe },
});

export async function onRequest({ request, params, env, waitUntil }) {
  const metoda = request.method.toUpperCase();
  if (metoda !== 'GET' && metoda !== 'HEAD') return tekst('Metoda niedozwolona.', 405, { Allow: 'GET, HEAD' });

  // Tylko /kup-online i /kup-online/ — dalsze człony to nie nasz adres.
  const reszta = [params?.reszta ?? []].flat().filter(Boolean);
  if (reszta.length > 0) return tekst('Nie znaleziono.', 404);

  const adres = new URL(request.url);
  if (czlowiek(request) && !adres.hostname.endsWith('.pages.dev')) {
    const zapis = zapisz(env, {
      cel: 'leadenhall', zrodlo: zrodlo(adres.searchParams.get('z')), ...reklama(adres.searchParams),
    });
    if (typeof waitUntil === 'function') waitUntil(zapis);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: CEL,
      // Każde kliknięcie ma przejść przez funkcję: przekierowanie zapisane
      // w przeglądarce albo w buforze nie zostawiłoby śladu w liczniku.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
