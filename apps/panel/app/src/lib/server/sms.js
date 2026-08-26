/**
 * sms.js — wysyłka SMS przez SMSAPI (https://smsapi.pl).
 * Uwierzytelnianie: token OAuth w nagłówku `Authorization: Bearer <token>`.
 * Wysyłka:    POST {base}/sms.do  (form-urlencoded: to, from, message, format, encoding)
 * Diagnostyka: GET {base}/profile          — stan konta (punkty)
 *              GET {base}/sms/sendernames  — zatwierdzone nazwy nadawcy
 * Bez tokenu działa w trybie stub (loguje, nie wysyła).
 *
 * Poprzedni dostawca (SMSPlanet) został usunięty: jego API stoi za Cloudflare,
 * a ruch z Workerów wychodzi adresem z puli Cloudflare, który mieli na stałe
 * zablokowanym („IP banned and reported") — bez możliwości obejścia po naszej stronie.
 */
import { env } from '$env/dynamic/private';

/** Workers nie wysyłają User-Agent domyślnie; część filtrów odrzuca takie żądania. */
const UA = 'UtrataDochodu/1.0 (+https://app.utratadochodu.pl)';

const trim = (v) => String(v || '').trim();

/** Adres API: konta polskie — api.smsapi.pl, międzynarodowe — api.smsapi.com. */
function baseUrl() {
  return (trim(env.SMSAPI_BASE) || 'https://api.smsapi.pl').replace(/\/+$/, '');
}

function token() {
  // Sekrety wklejane w panelu Cloudflare bywają z końcową spacją lub nowym
  // wierszem — bez przycięcia poświadczenie jest ciche i błędne.
  return trim(env.SMSAPI_TOKEN) || trim(env.SMSAPI_ACCESS_TOKEN);
}

function senderName() {
  return trim(env.SMSAPI_SENDER) || trim(env.SMS_SENDER) || 'Info';
}

/** Konfiguracja wysyłki SMS do diagnostyki — bez ujawniania poświadczeń. */
export function smsConfig() {
  const t = token();
  return {
    provider: 'SMSAPI',
    base: baseUrl(),
    authMode: t ? 'bearer' : 'brak',
    hasToken: !!t,
    tokenHint: t ? `${t.slice(0, 6)}…(${t.length} zn.)` : '',
    sender: senderName(),
    senderIsDefault: !(env.SMSAPI_SENDER || env.SMS_SENDER),
    testMode: env.SMSAPI_TEST === '1'
  };
}

/**
 * Wspólne wywołanie API SMSAPI.
 * @returns {Promise<{ ok: boolean, status: number, raw: string, data: any, error?: string }>}
 */
async function call(path, { method = 'GET', params = null } = {}) {
  const t = token();
  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: 'application/json',
        'User-Agent': UA,
        ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
      },
      ...(params ? { body: new URLSearchParams(params) } : {})
    });
  } catch (e) {
    return { ok: false, status: 0, raw: '', data: null, error: 'SMSAPI: ' + (e?.message || e) };
  }

  // Czytamy jako tekst — przy błędach bramy odpowiedź bywa HTML-em, a sam kod
  // HTTP nie mówi, czy to zły token, czy np. brak środków na koncie.
  const raw = await res.text().catch(() => '');
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, raw, data };
}

/**
 * SMSAPI sygnalizuje błąd polem `error` w JSON-ie, nawet przy HTTP 200.
 * Kod 101 = zła autoryzacja, 103 = brak punktów, 104 = nieistniejąca nazwa nadawcy.
 */
function failure(r) {
  if (r.error) return r.error;
  const code = r.data?.error;
  if (code == null && r.ok) return null;

  const msg = r.data?.message
    || String(r.raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const hints = {
    101: 'zły lub wygasły token OAuth',
    103: 'brak punktów na koncie',
    104: 'nazwa nadawcy nie istnieje lub nie jest zatwierdzona',
    105: 'błędny numer odbiorcy',
    203: 'zbyt wiele żądań w krótkim czasie',
    // 401 „Access forbidden" przy poprawnym tokenie oznacza brak zakresu
    // uprawnień dla tej metody — token wystawiono bez dostępu do niej.
    401: 'token nie ma uprawnienia (zakresu) do tej metody — uzupełnij zakresy tokenu w panelu SMSAPI'
  };
  const hint = code != null && hints[code] ? ` — ${hints[code]}` : '';
  return `SMSAPI${code != null ? ` błąd ${code}` : ` HTTP ${r.status}`}${msg ? `: ${msg}` : ''}${hint}`;
}

/**
 * @param {string} phone - numer (dowolny format; nie-cyfry są usuwane)
 * @param {string} message
 * @returns {Promise<{ sent: boolean, stub?: boolean, id?: string, error?: string }>}
 */
export async function sendSms(phone, message) {
  const to = String(phone).replace(/[^\d]/g, '');

  if (!token()) {
    console.warn('[sms] Brak SMSAPI_TOKEN — tryb stub. Do:', to, 'msg:', message);
    return { sent: false, stub: true };
  }

  const params = {
    to,
    from: senderName(),
    message,
    format: 'json',
    encoding: 'utf-8'
  };
  if (env.SMSAPI_TEST === '1') params.test = '1'; // tryb testowy SMSAPI (nie wysyła realnie)

  const r = await call('/sms.do', { method: 'POST', params });
  const err = failure(r);
  if (err) return { sent: false, error: err };

  const first = Array.isArray(r.data?.list) ? r.data.list[0] : null;
  return { sent: true, id: first?.id != null ? String(first.id) : undefined };
}

/**
 * Diagnostyka bez wysyłania wiadomości — sprawdza token i nazwy nadawcy.
 * Żadne z wywołań nic nie wysyła i nie kosztuje punktów.
 */
export async function smsDiagnostics() {
  if (!token()) return { configured: false };

  // Lista nadawców: najpierw ścieżka REST, a gdy konto jej nie udostępnia —
  // starsze `sender.do`, które zwraca to samo w innym formacie. Przy 401/403
  // nie ponawiamy: to brak uprawnienia tokenu, więc druga próba tylko dołoży
  // wpis do dziennika błędów SMSAPI, nic nie zmieniając.
  const [prof, sndRest] = await Promise.all([call('/profile'), call('/sms/sendernames')]);
  const restErr = failure(sndRest);
  const restDenied = sndRest.status === 401 || sndRest.status === 403 || sndRest.data?.error === 401;
  const snd = restErr && !restDenied ? await call('/sender.do?list=1&format=json') : sndRest;

  const profErr = failure(prof);
  const sndErr = failure(snd);
  const sendersDenied = snd.status === 401 || snd.status === 403 || snd.data?.error === 401;

  const list = [];
  const push = (v) => { const s = trim(v); if (s && !list.includes(s)) list.push(s); };
  const collection = Array.isArray(snd.data)
    ? snd.data
    : Array.isArray(snd.data?.collection)
      ? snd.data.collection
      : Array.isArray(snd.data?.list)
        ? snd.data.list
        : [];
  for (const item of collection) push(typeof item === 'string' ? item : item?.sender || item?.name);

  const sender = senderName();
  const points = prof.data?.points ?? prof.data?.credits ?? null;

  return {
    configured: true,
    sender,
    balance: {
      ok: !profErr,
      denied: !!profErr && (prof.status === 401 || prof.status === 403 || prof.data?.error === 401),
      status: prof.status,
      value: profErr ? null : points,
      error: profErr || ''
    },
    senders: {
      ok: !sndErr,
      // Brak zakresu uprawnień to nie awaria integracji — wysyłka może działać,
      // tylko nie da się odczytać listy nadawców do porównania.
      denied: !!sndErr && sendersDenied,
      status: snd.status,
      list,
      matches: list.some((s) => s.toLowerCase() === sender.toLowerCase()),
      error: sndErr || ''
    }
  };
}
