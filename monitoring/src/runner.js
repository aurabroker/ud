/* Wykonanie pojedynczego sprawdzenia.

   Funkcje są czyste w tym sensie, że fetch wstrzykuje się z zewnątrz —
   dzięki temu testy chodzą bez sieci (patrz test/monitor-test.js).

   Każde sprawdzenie zwraca:
     { ok, ms, opis, blad }
   gdzie `opis` trafia na status page, a `blad` do treści alertu.
*/

const TIMEOUT_MS = 15000;

async function pobierz(fetchImpl, url, opcje = {}) {
  const start = Date.now();
  const ctrl = new AbortController();
  const stoper = setTimeout(() => ctrl.abort(), opcje.timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...opcje, signal: ctrl.signal });
    return { res, ms: Date.now() - start };
  } finally {
    clearTimeout(stoper);
  }
}

/* ── typ: http — zwykłe GET, opcjonalnie z szukaniem tekstu w treści ── */
async function http(def, fetchImpl) {
  let res, ms;
  try {
    ({ res, ms } = await pobierz(fetchImpl, def.url, { redirect: 'follow' }));
  } catch (e) {
    return { ok: false, ms: 0, blad: `brak połączenia: ${e.name === 'AbortError' ? 'przekroczony czas' : e.message}` };
  }

  const oczekiwane = def.oczekiwaneStatusy || [200];
  if (!oczekiwane.includes(res.status)) {
    return { ok: false, ms, blad: `HTTP ${res.status} (oczekiwano ${oczekiwane.join('/')})` };
  }
  if (def.zawiera) {
    const tresc = await res.text();
    if (!tresc.includes(def.zawiera)) {
      return { ok: false, ms, blad: `strona odpowiada, ale brakuje w niej "${def.zawiera}" — może być uszkodzona` };
    }
  }
  if (def.maxMs && ms > def.maxMs) {
    return { ok: false, ms, blad: `odpowiedź po ${ms} ms (limit ${def.maxMs} ms)` };
  }
  return { ok: true, ms, opis: `HTTP ${res.status}` };
}

/* ── typ: http-wiele — komplet plików musi być dostępny ── */
async function httpWiele(def, fetchImpl) {
  const wyniki = [];
  let sumaMs = 0;
  for (const url of def.urle) {
    try {
      const { res, ms } = await pobierz(fetchImpl, url);
      sumaMs += ms;
      if (res.status !== 200) wyniki.push(`${sciezka(url)}: HTTP ${res.status}`);
      else if ((res.headers.get('content-type') || '').includes('text/html')) {
        /* 404 na Cloudflare Pages zwraca stronę HTML — plik JS, który
           przyszedł jako text/html, na pewno nie jest tym plikiem. */
        wyniki.push(`${sciezka(url)}: dostał HTML zamiast pliku (404?)`);
      }
    } catch (e) {
      wyniki.push(`${sciezka(url)}: brak połączenia`);
    }
  }
  return wyniki.length
    ? { ok: false, ms: sumaMs, blad: wyniki.join('; ') }
    : { ok: true, ms: sumaMs, opis: `${def.urle.length} plików OK` };
}

const sciezka = u => { try { return new URL(u).pathname; } catch { return u; } };

/* ── typ: csp — czy polityka nadal przepuszcza to, czego strona potrzebuje ──
   Dokładnie ta awaria, której zwykły monitor uptime nie widzi: strona
   zwraca 200, a formularz jest martwy, bo captcha jest zablokowana. */
function pasujeZrodlo(wzorzec, wymagana) {
  if (wzorzec === wymagana) return true;
  if (!wzorzec.startsWith('https://*.')) return false;
  const przyrostek = wzorzec.slice(9);                 // "*.doubleclick.net" -> ".doubleclick.net"
  return wymagana.startsWith('https://') && wymagana.slice(8).endsWith(przyrostek);
}

export function brakiWCsp(polityka, wymagane) {
  const dyrektywy = {};
  for (const czesc of String(polityka || '').split(';')) {
    const tokeny = czesc.trim().split(/\s+/).filter(Boolean);
    if (tokeny.length) dyrektywy[tokeny[0]] = tokeny.slice(1);
  }
  const braki = [];
  for (const [dyrektywa, zrodla] of Object.entries(wymagane)) {
    const dostepne = dyrektywy[dyrektywa] || dyrektywy['default-src'];
    for (const z of zrodla) {
      if (!dostepne || !dostepne.some(w => pasujeZrodlo(w, z))) braki.push(`${dyrektywa}: ${z}`);
    }
  }
  return braki;
}

async function csp(def, fetchImpl) {
  let res, ms;
  try {
    ({ res, ms } = await pobierz(fetchImpl, def.url));
  } catch (e) {
    return { ok: false, ms: 0, blad: `brak połączenia: ${e.message}` };
  }
  if (res.status !== 200) return { ok: false, ms, blad: `HTTP ${res.status}` };

  const naglowek = res.headers.get('content-security-policy');
  const tresc = await res.text();
  const meta = (tresc.match(/http-equiv=["']Content-Security-Policy["']\s+content=["']([^"']*)["']/i) || [])[1];

  if (!naglowek && !meta) return { ok: false, ms, blad: 'brak polityki CSP — ani w nagłówku, ani w <meta>' };

  /* Przeglądarka egzekwuje część wspólną obu polityk, więc braku w jednej
     z nich nie wolno wybaczyć. */
  const braki = [];
  if (naglowek) braki.push(...brakiWCsp(naglowek, def.wymagane).map(b => `nagłówek → ${b}`));
  if (meta)     braki.push(...brakiWCsp(meta,     def.wymagane).map(b => `<meta> → ${b}`));

  return braki.length
    ? { ok: false, ms, blad: `CSP blokuje: ${braki.join(', ')}` }
    : { ok: true, ms, opis: naglowek && meta ? 'nagłówek + <meta> OK' : 'polityka OK' };
}

/* ── typ: edge-function — czy funkcja żyje ──
   Wysyłamy celowo niekompletne dane. Żywa funkcja odrzuci je walidacją,
   padnięta zwróci 5xx albo nie odpowie. Nic nie zapisujemy do bazy. */
async function edgeFunction(def, fetchImpl) {
  let res, ms;
  try {
    ({ res, ms } = await pobierz(fetchImpl, def.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(def.telo || { __monitor: true }),
      timeoutMs: (def.maxMs || 8000) + 4000,
    }));
  } catch (e) {
    return { ok: false, ms: 0, blad: `funkcja nie odpowiada: ${e.name === 'AbortError' ? 'przekroczony czas' : e.message}` };
  }
  const oczekiwane = def.oczekiwaneStatusy || [400, 401, 403, 422];
  if (res.status >= 500) return { ok: false, ms, blad: `funkcja zwraca błąd serwera: HTTP ${res.status}` };
  if (!oczekiwane.includes(res.status) && res.status !== 200) {
    return { ok: false, ms, blad: `nieoczekiwany status HTTP ${res.status}` };
  }
  if (def.maxMs && ms > def.maxMs) return { ok: false, ms, blad: `odpowiedź po ${ms} ms (limit ${def.maxMs} ms)` };
  return { ok: true, ms, opis: `żywa (HTTP ${res.status})` };
}

/* ── typ: supabase-rest ── */
async function supabaseRest(def, fetchImpl, env) {
  const klucz = env && env.SUPABASE_ANON_KEY;
  if (!klucz) return { ok: true, ms: 0, opis: 'pominięte — brak SUPABASE_ANON_KEY' };
  let res, ms;
  try {
    ({ res, ms } = await pobierz(fetchImpl, def.url, {
      headers: { apikey: klucz, Accept: 'application/json' },
      timeoutMs: (def.maxMs || 8000) + 4000,
    }));
  } catch (e) {
    return { ok: false, ms: 0, blad: `baza nie odpowiada: ${e.message}` };
  }
  if (res.status !== 200) return { ok: false, ms, blad: `HTTP ${res.status} z REST API` };
  try {
    const dane = await res.json();
    if (!Array.isArray(dane)) return { ok: false, ms, blad: 'REST API zwróciło coś innego niż listę' };
  } catch {
    return { ok: false, ms, blad: 'REST API zwróciło niepoprawny JSON' };
  }
  if (def.maxMs && ms > def.maxMs) return { ok: false, ms, blad: `odpowiedź po ${ms} ms (limit ${def.maxMs} ms)` };
  return { ok: true, ms, opis: 'REST OK' };
}

const TYPY = {
  'http': http,
  'http-wiele': httpWiele,
  'csp': csp,
  'edge-function': edgeFunction,
  'supabase-rest': supabaseRest,
};

export async function wykonaj(def, fetchImpl, env) {
  const handler = TYPY[def.typ];
  if (!handler) return { ok: false, ms: 0, blad: `nieznany typ sprawdzenia: ${def.typ}` };
  try {
    return await handler(def, fetchImpl, env);
  } catch (e) {
    return { ok: false, ms: 0, blad: `błąd monitora: ${e.message}` };
  }
}
