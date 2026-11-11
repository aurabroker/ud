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
  let powod;
  try {
    const odp = await fetch(`${url}/rest/v1/ud_klikniecia`, {
      method: 'POST', headers: naglowki, body: JSON.stringify(wiersz), signal: AbortSignal.timeout(CZAS_MS),
    });
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
    const zapis = zapisz(env, { cel: 'leadenhall', zrodlo: zrodlo(adres.searchParams.get('z')) });
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
