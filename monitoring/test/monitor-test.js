/* Testy monitora — chodzą w czystym node, bez sieci i bez Cloudflare.
   Uruchomienie: node test/monitor-test.js
*/
import { brakiWCsp, wykonaj } from '../src/runner.js';
import { decyduj, trescAlertu, PRZYPOMNIENIE_MIN } from '../src/alerts.js';
import { przebieg } from '../src/index.js';

let bledy = 0, zaliczone = 0;
const ok = (nazwa, warunek, szczegol) => {
  if (warunek) { zaliczone++; console.log('  OK   ' + nazwa); }
  else { bledy++; console.log('  BLAD ' + nazwa + (szczegol !== undefined ? '  -> ' + JSON.stringify(szczegol) : '')); }
};
const grupa = n => console.log('\n=== ' + n + ' ===');

/* ── atrapa odpowiedzi HTTP ─────────────────────────────── */
const odpowiedz = ({ status = 200, tresc = '', naglowki = {} }) => ({
  status,
  headers: { get: k => naglowki[k.toLowerCase()] ?? null },
  text: async () => tresc,
  json: async () => JSON.parse(tresc),
});

/* ── 1. analiza CSP ─────────────────────────────────────── */
grupa('CSP — wykrywanie brakujących domen');
{
  const wymagane = { 'script-src': ['https://challenges.cloudflare.com'], 'frame-src': ['https://challenges.cloudflare.com'] };

  ok('wykrywa brak Turnstile w script-src (to była nasza realna awaria)',
    brakiWCsp("default-src 'self'; script-src 'self' https://unpkg.com; frame-src https://challenges.cloudflare.com", wymagane)
      .join() === 'script-src: https://challenges.cloudflare.com');

  ok('przepuszcza poprawną politykę',
    brakiWCsp("script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com", wymagane).length === 0);

  ok('rozumie wildcard *.doubleclick.net',
    brakiWCsp('connect-src https://*.doubleclick.net', { 'connect-src': ['https://stats.g.doubleclick.net'] }).length === 0);

  ok('wie, że *.google.com NIE obejmuje gołego google.com',
    brakiWCsp('connect-src https://*.google.com', { 'connect-src': ['https://google.com'] }).length === 1);

  ok('korzysta z default-src, gdy brak konkretnej dyrektywy',
    brakiWCsp("default-src 'self' https://challenges.cloudflare.com", wymagane).length === 0);
}

/* ── 2. typy sprawdzeń ──────────────────────────────────── */
grupa('Sprawdzenia — zachowanie przy różnych odpowiedziach');
{
  const http200 = async () => odpowiedz({ tresc: '<form id="insurance-form">' });
  ok('http: 200 z oczekiwaną treścią = OK',
    (await wykonaj({ typ: 'http', url: 'x', zawiera: 'insurance-form' }, http200)).ok);

  ok('http: 200 bez oczekiwanej treści = awaria (strona wstała, ale pusta)',
    !(await wykonaj({ typ: 'http', url: 'x', zawiera: 'insurance-form' }, async () => odpowiedz({ tresc: 'nic' }))).ok);

  ok('http: 500 = awaria',
    !(await wykonaj({ typ: 'http', url: 'x' }, async () => odpowiedz({ status: 500 }))).ok);

  ok('http: brak połączenia = awaria, nie wyjątek',
    !(await wykonaj({ typ: 'http', url: 'x' }, async () => { throw new Error('ECONNREFUSED'); })).ok);

  const w = await wykonaj({ typ: 'csp', url: 'x', wymagane: { 'script-src': ['https://challenges.cloudflare.com'] } },
    async () => odpowiedz({ tresc: '<html>', naglowki: { 'content-security-policy': "script-src 'self'" } }));
  ok('csp: brakująca domena w nagłówku = awaria', !w.ok && /challenges/.test(w.blad), w.blad);

  const w2 = await wykonaj({ typ: 'csp', url: 'x', wymagane: { 'script-src': ['https://challenges.cloudflare.com'] } },
    async () => odpowiedz({
      tresc: `<meta http-equiv="Content-Security-Policy" content="script-src 'self'">`,
      naglowki: { 'content-security-policy': "script-src 'self' https://challenges.cloudflare.com" },
    }));
  ok('csp: nagłówek OK, ale <meta> za wąskie = awaria (przeglądarka bierze część wspólną)',
    !w2.ok && /meta/.test(w2.blad), w2.blad);

  ok('edge-function: 4xx z walidacji = funkcja żyje',
    (await wykonaj({ typ: 'edge-function', url: 'x' }, async () => odpowiedz({ status: 400 }))).ok);

  ok('edge-function: 500 = awaria',
    !(await wykonaj({ typ: 'edge-function', url: 'x' }, async () => odpowiedz({ status: 500 }))).ok);

  ok('http-wiele: plik JS zwrócony jako text/html (404 Pages) = awaria',
    !(await wykonaj({ typ: 'http-wiele', urle: ['https://x/style.js'] },
      async () => odpowiedz({ naglowki: { 'content-type': 'text/html' } }))).ok);
}

/* ── 3. maszyna alertów ─────────────────────────────────── */
grupa('Alerty — kiedy krzyczeć, a kiedy siedzieć cicho');
{
  const t0 = new Date('2026-08-24T10:00:00Z');
  const min = n => new Date(t0.getTime() + n * 60000);
  const kryt = { id: 'a', nazwa: 'Formularz', krytyczny: true, progAwarii: 2 };
  const zwykly = { id: 'b', nazwa: 'Blog', krytyczny: false, progAwarii: 2 };
  const zle = { ok: false, blad: 'HTTP 500' };
  const dobrze = { ok: true, ms: 120 };

  let r = decyduj(kryt, null, zle, t0);
  ok('pierwsza porażka nie alarmuje (może to migotanie)', r.akcje.length === 0 && r.stan.pod === 1);

  r = decyduj(kryt, r.stan, zle, min(1));
  ok('druga porażka z rzędu = alert', r.akcje[0]?.rodzaj === 'awaria');
  ok('krytyczne wysyła e-mail I SMS', r.akcje[0].kanaly.join() === 'email,sms');

  let rz = decyduj(zwykly, decyduj(zwykly, null, zle, t0).stan, zle, min(1));
  ok('niekrytyczne wysyła tylko e-mail — bez budzenia SMS-em', rz.akcje[0].kanaly.join() === 'email');

  const poAwarii = r.stan;
  r = decyduj(kryt, poAwarii, zle, min(2));
  ok('kolejne porażki nie spamują', r.akcje.length === 0);

  r = decyduj(kryt, poAwarii, zle, min(PRZYPOMNIENIE_MIN + 1));
  ok(`po ${PRZYPOMNIENIE_MIN} min leci przypomnienie (mailem)`,
    r.akcje[0]?.rodzaj === 'przypomnienie' && r.akcje[0].kanaly.join() === 'email');

  r = decyduj(kryt, poAwarii, dobrze, min(5));
  ok('powrót do działania jest zgłaszany', r.akcje[0]?.rodzaj === 'powrot');
  ok('powrót idzie tym samym kanałem co awaria (SMS)', r.akcje[0].kanaly.join() === 'email,sms');
  ok('po powrocie stan wraca do "up"', r.stan.status === 'up' && r.stan.pod === 0);

  r = decyduj(kryt, r.stan, dobrze, min(6));
  ok('działająca usługa nie generuje żadnych powiadomień', r.akcje.length === 0);

  const tresc = trescAlertu(kryt, zle, 'awaria', poAwarii, t0);
  ok('temat alertu mówi, co padło', tresc.temat.includes('AWARIA') && tresc.temat.includes('Formularz'));
  ok('SMS mieści się w 160 znakach', tresc.sms.length <= 160, tresc.sms.length);
  ok('treść zawiera powód awarii', tresc.tekst.includes('HTTP 500'));
}

/* ── 4. pełny przebieg z atrapą bazy ────────────────────── */
grupa('Przebieg końca-do-końca (atrapa D1 + atrapa sieci)');
{
  const baza = { stan: new Map(), historia: [], zdarzenia: [] };
  const zapytanie = (sql, args = []) => ({
    bind: (...a) => zapytanie(sql, a),
    first: async () => (sql.includes('FROM stan WHERE id') ? baza.stan.get(args[0]) || null : null),
    all: async () => ({ results: sql.includes('FROM stan') ? [...baza.stan.values()] : [] }),
    run: async () => { wykonajSql(sql, args); return { success: true }; },
    __sql: sql, __args: args,
  });
  const wykonajSql = (sql, args) => {
    if (sql.includes('INTO stan')) baza.stan.set(args[0], { id: args[0], status: args[1], od_kiedy: args[2], pod: args[3], ostatni_alert: args[4], sms_wyslany: args[5] });
    else if (sql.includes('INTO historia')) baza.historia.push(args);
    else if (sql.includes('INTO zdarzenia')) baza.zdarzenia.push(args);
  };
  const DB = {
    prepare: sql => zapytanie(sql),
    batch: async zapytania => { zapytania.forEach(z => wykonajSql(z.__sql, z.__args)); return []; },
  };

  const wyslane = [];
  const oryginalnyFetch = globalThis.fetch;
  let stronaPada = false;
  globalThis.fetch = async (url, opcje = {}) => {
    const u = String(url);
    if (u.includes('api.resend.com')) { wyslane.push({ kanal: 'email', tresc: JSON.parse(opcje.body) }); return odpowiedz({ status: 200, tresc: '{}' }); }
    if (u.includes('api.smsapi.pl'))  { wyslane.push({ kanal: 'sms', tresc: opcje.body }); return odpowiedz({ status: 200, tresc: '{"count":1}' }); }
    if (u.includes('utratadochodu.pl') && stronaPada) return odpowiedz({ status: 503 });
    if (u.includes('utratadochodu.pl')) return odpowiedz({
      tresc: '<form id="insurance-form">',
      naglowki: {
        'content-security-policy': "script-src 'self' https://challenges.cloudflare.com https://connect.facebook.net; frame-src https://challenges.cloudflare.com; connect-src https://kukvgsjrmrqtzhkszzum.supabase.co https://challenges.cloudflare.com",
        'content-type': 'text/javascript',
      },
    });
    if (u.includes('challenges.cloudflare.com')) return odpowiedz({ tresc: '/* turnstile */' });
    return odpowiedz({ status: 400 });     // edge functions: walidacja = żywe
  };

  const env = { DB, RESEND_API_KEY: 'x', ALERT_EMAIL: 'info@utratadochodu.pl', SMSAPI_TOKEN: 'x', ALERT_SMS: '48504400901' };
  const t = new Date('2026-08-24T10:00:00Z');

  let raport = await przebieg(env, t);
  ok('przy sprawnych aplikacjach nic nie wychodzi', wyslane.length === 0);
  ok('wszystkie sprawdzenia przeszły', raport.every(r => r.ok), raport.filter(r => !r.ok));
  ok('wyniki trafiły do historii', baza.historia.length === raport.length);

  stronaPada = true;
  await przebieg(env, new Date(t.getTime() + 60000));
  ok('pierwsza porażka: cisza (ochrona przed migotaniem)', wyslane.length === 0);

  await przebieg(env, new Date(t.getTime() + 120000));
  ok('druga porażka: poszedł e-mail', wyslane.some(w => w.kanal === 'email'));
  ok('druga porażka: poszedł SMS (strona jest krytyczna)', wyslane.some(w => w.kanal === 'sms'));
  ok('e-mail trafia na właściwy adres', wyslane.find(w => w.kanal === 'email')?.tresc.to?.[0] === 'info@utratadochodu.pl');
  ok('awaria zapisana w zdarzeniach', baza.zdarzenia.some(z => z[1] === 'awaria'));

  const ileDoTej = wyslane.length;
  stronaPada = false;
  await przebieg(env, new Date(t.getTime() + 180000));
  ok('po naprawie idzie informacja o powrocie', wyslane.length > ileDoTej &&
    JSON.stringify(wyslane[wyslane.length - 1]).includes('OK'));

  globalThis.fetch = oryginalnyFetch;
}

console.log(`\n================ PODSUMOWANIE ================`);
console.log(`${zaliczone} zaliczonych, ${bledy} błędów`);
console.log(bledy === 0 ? 'WYNIK: OK' : 'WYNIK: BLEDY');
process.exit(bledy ? 1 : 0);
