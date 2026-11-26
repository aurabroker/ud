import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { czytaj, kodFunkcji, bezTypow, AsyncFunction } from './pomocnicy-funkcji.js';

/**
 * Kalibrator stawek (`supabase/functions/kalibrator`) — funkcja brzegowa,
 * która porównuje stawki wyliczone z ofert z plikiem `kalibracja.json`
 * i proponuje zmianę pull requestem. Zmienia ceny pokazywane konsumentom,
 * więc pilnujemy przede wszystkim tego, czego NIE robi:
 *
 *  • nie pisze na gałąź produkcyjną — jedyny zapis to plik kalibracji na
 *    gałęzi `kalibrator/propozycja`, a scala człowiek;
 *  • w trybie „na sucho" nie pisze do GitHuba nic;
 *  • nie dopisuje do pliku nowych okresów (48, 60);
 *  • nie wypuszcza na publiczne repozytorium niczego z danych klientów;
 *  • nie wysyła tego samego maila codziennie.
 *
 * Test ładuje prawdziwe źródło funkcji (bez typów, importy jako parametry —
 * jak przypomnienie.spec.js) i uruchamia je z atrapami Supabase, GitHuba,
 * Resend i strony. Metodę liczenia stawek sprawdzają testy SQL
 * (`supabase/tests/kalibracja.sql`); tu wynik SQL jest wejściem.
 */

const ZRODLO = 'functions/kalibrator/index.ts';
const TOKEN_CRONA = 'token-z-vaulta';
const TOKEN_GH = 'github_pat_testowy';
const GALAZ = 'claude/portal-rebuild-seo-llm-yz2x4t';
const BOT = 'kalibrator/propozycja';
const PLIK = 'apps/portal/src/lib/kalibracja.json';
const API = 'https://api.github.com/repos/aurabroker/ud';
const STRONA = 'https://utratadochodu.pages.dev/kalkulator/index.md';
const DZIEN = 86_400_000;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PESEL = /(?<!\w)\d{11}(?!\w)/;

const dniTemu = (d) => new Date(Date.now() - d * DZIEN).toISOString();
const dzisWarszawa = () => {
  const c = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const p = (t) => c.find((x) => x.type === t).value;
  return `${p('year')}-${p('month')}-${p('day')}`;
};

/** Plik w starym kształcie, jak na gałęzi produkcyjnej przed kalibratorem. */
const plikJson = (nadpisz = {}) => JSON.stringify({
  policzono: '2026-09-17',
  zrodlo: { ofert: 15, wariantow: 48, obserwacji: 10, ubezpieczyciel: 'Leadenhall' },
  stawka: { dol: 0.0202, srodek: 0.022, gora: 0.0244 },
  okresy: { 24: 1, 36: 1.25 },
  ...nadpisz,
}, null, 2) + '\n';
const PLIK_OBECNY = plikJson();
/** Te same stawki i okresy co WYNIK_OK — inne tylko policzono i zrodlo. */
const PLIK_ZGODNY = plikJson({ policzono: '2026-10-01', stawka: { dol: 0.0202, srodek: 0.022, gora: 0.0322 } });

const ZRODLO_SQL = {
  metoda: 'osoby-v1', ubezpieczyciel: 'Leadenhall',
  okno: { od: '2025-10-14', do: '2026-10-12' },
  osob: 10, ofert: 10, wariantow: 17, par: { 36: 6 },
};

const RAPORT = {
  surowe: { min: 0.0202, mediana: 0.021442, srednia: 0.022815, max: 0.03217, p10: 0.02031, p90: 0.02655 },
  okresy_kandydaci: { 36: { osob: 6, mediana: 1.2442, min: 1.2353, max: 1.2521 }, 48: { osob: 0 }, 60: { osob: 0 } },
  pominiete: { hiv: 3, dodatki: 2, wyczekiwanie: 4, jednorazowe: 5, trwala_lub_smierc: 20, inny_ubezpieczyciel: 6, poza_oknem: 1 },
  anomalie: [],
};

/** Wynik `ud_kalibracja_stawek()` w kształcie z kontraktu. */
const wynikOk = ({ stawka, okresy, zrodlo, raport, ...reszta } = {}) => ({
  status: 'ok',
  metoda: 'osoby-v1',
  na_dzien: '2026-10-14T05:40:00Z',
  stawka: { dol: 0.0202, srodek: 0.022, gora: 0.0322, ...stawka },
  okresy: okresy ?? { 24: 1, 36: 1.25 },
  zrodlo: { ...ZRODLO_SQL, ...zrodlo },
  raport: { ...RAPORT, ...raport },
  ...reszta,
});

/** Atrapa PostgREST nad dwiema tabelami kalibracji + rpc. */
function atrapaSupabase({ ustawienia, historia, wynik, bladSql, bladTokenu }) {
  const tabele = {
    ud_kalibracja_ustawienia: ustawienia ? [{ id: true, ...ustawienia }] : [],
    ud_kalibracja_przebiegi: historia.map((h, i) => ({ id: `wpis-${i}`, mail_wyslany: false, na_stronie: null, powod: null, ...h })),
  };
  const rpc = [];
  const odczyty = [];
  let licznik = 0;

  const klient = {
    from(tabela) {
      if (!(tabela in tabele)) throw new Error(`nieoczekiwana tabela: ${tabela}`);
      const st = { op: 'select', filtry: [], porzadek: null, limit: null, pojedynczy: false, wiersz: null };
      const b = {
        select() { return b; },
        insert(w) { st.op = 'insert'; st.wiersz = w; return b; },
        eq(k, v) { st.filtry.push((r) => r[k] === v); return b; },
        gte(k, v) { st.filtry.push((r) => r[k] >= v); return b; },
        order(k, { ascending = true } = {}) { st.porzadek = [k, ascending]; return b; },
        limit(n) { st.limit = n; return b; },
        maybeSingle() { st.pojedynczy = true; return b; },
        then(ok, blad) {
          return Promise.resolve().then(() => {
            const wiersze = tabele[tabela];
            if (st.op === 'insert') {
              // Kolejne wpisy dostają ściśle rosnący czas — inaczej dwa przebiegi
              // w tej samej milisekundzie miałyby nieokreśloną kolejność.
              const ostatni = wiersze.reduce((m, r) => (r.uruchomiono > m ? r.uruchomiono : m), '');
              let czas = new Date().toISOString();
              if (czas <= ostatni) czas = new Date(new Date(ostatni).getTime() + 1).toISOString();
              licznik += 1;
              wiersze.push({ id: `nowy-${licznik}`, uruchomiono: czas, mail_wyslany: false, na_stronie: null, powod: null, ...st.wiersz });
              return { data: null, error: null };
            }
            odczyty.push(tabela);
            let wynikZapytania = wiersze.filter((r) => st.filtry.every((f) => f(r)));
            if (st.porzadek) {
              const [k, rosnaco] = st.porzadek;
              wynikZapytania = [...wynikZapytania].sort((a, c) => (a[k] < c[k] ? -1 : a[k] > c[k] ? 1 : 0) * (rosnaco ? 1 : -1));
            }
            if (st.limit !== null) wynikZapytania = wynikZapytania.slice(0, st.limit);
            if (st.pojedynczy) return { data: wynikZapytania[0] ?? null, error: null };
            return { data: wynikZapytania, error: null };
          }).then(ok, blad);
        },
      };
      return b;
    },
    async rpc(nazwa, argumenty) {
      rpc.push({ nazwa, argumenty });
      if (nazwa === 'edge_cron_token_matches') {
        if (bladTokenu) return { data: null, error: { message: 'connection refused' } };
        return { data: argumenty.token === TOKEN_CRONA, error: null };
      }
      if (nazwa === 'ud_kalibracja_stawek') {
        if (bladSql) return { data: null, error: bladSql };
        return { data: typeof wynik === 'function' ? wynik() : structuredClone(wynik), error: null };
      }
      throw new Error(`nieoczekiwane rpc: ${nazwa}`);
    },
  };
  return { klient, rpc, odczyty, przebiegi: tabele.ud_kalibracja_przebiegi };
}

/** Atrapa API GitHuba: gałęzie, commity, plik kalibracji, pull requesty. */
function atrapaGitHuba({ plik, botIstnieje, prs, wygasa, limitBezTokenu, awaria, awariaPr = null }) {
  let n = 0;
  const commity = new Map();
  const drzewa = new Map();
  const drzewoCommitu = new Map();
  const rodzic = new Map();
  const galezie = new Map();
  /** Każde ustawienie gałęzi bota (sha) — test sprawdza, że nigdy nie był to HEAD produkcyjnej. */
  const ustawieniaBota = [];
  const noweDrzewo = (tresc) => {
    n += 1;
    const sha = createHash('sha1').update(`tree-${n}`).digest('hex');
    drzewa.set(sha, tresc);
    return sha;
  };
  const commit = (tresc, drzewo = noweDrzewo(tresc), przodek = null) => {
    n += 1;
    const sha = createHash('sha1').update(`commit-${n}`).digest('hex');
    commity.set(sha, tresc);
    drzewoCommitu.set(sha, drzewo);
    rodzic.set(sha, przodek);
    return sha;
  };
  const REPO_PR = { full_name: 'aurabroker/ud' };
  /**
   * Zachowanie GitHuba: gdy gałąź otwartego PR wskaże commit, który już jest
   * w gałęzi bazowej, PR zostaje uznany za scalony — choć niczego nie scalono.
   */
  const ustawGalaz = (nazwa, sha) => {
    galezie.set(nazwa, sha);
    if (nazwa !== BOT) return;
    ustawieniaBota.push(sha);
    for (const pr of pulls) {
      if (pr.state === 'open' && pr.head.ref === BOT && galezie.get(pr.base.ref) === sha) {
        pr.state = 'closed';
        pr.merged_at = new Date().toISOString();
      }
    }
  };
  const blob = (tresc) => createHash('sha1').update(`blob ${tresc}`).digest('hex');
  galezie.set(GALAZ, commit(plik));
  if (botIstnieje) galezie.set(BOT, commit('{"stara": "propozycja"}\n'));
  const pulls = prs.map((p) => ({ title: 'Kalibracja stawek', head: { ref: BOT, repo: REPO_PR }, base: { ref: GALAZ }, merged_at: null, ...p }));
  const zadania = [];
  /**
   * Awarie sterowane z testu: PATCH /pulls od n-tego wywołania (z prZastosuj —
   * GitHub zapisuje zmianę, a odpowiedź i tak jest błędem), przestawienie
   * gałęzi, budowa drzewa.
   */
  const awarie = { pr: awariaPr, prOd: 1, prZastosuj: false, ref: null, drzewo: null };
  let patchPr = 0;

  const odp = (status, dane, naglowki = {}) =>
    new Response(JSON.stringify(dane), { status, headers: { 'content-type': 'application/json', ...naglowki } });

  async function obsluz(url, opcje = {}) {
    const metoda = opcje.method ?? 'GET';
    const cialo = opcje.body ? JSON.parse(opcje.body) : undefined;
    const u = new URL(url);
    const auth = opcje.headers?.Authorization ?? null;
    zadania.push({ metoda, url, sciezka: u.pathname, ref: u.searchParams.get('ref'), cialo, auth });

    if (u.hostname === 'raw.githubusercontent.com') {
      const galaz = decodeURIComponent(u.pathname.replace('/aurabroker/ud/', '').replace(`/${PLIK}`, ''));
      return galezie.has(galaz) ? new Response(commity.get(galezie.get(galaz))) : new Response('404', { status: 404 });
    }

    const extra = wygasa && auth ? { 'github-authentication-token-expiration': wygasa } : {};
    if (awaria) return odp(awaria, { message: 'Server Error' }, extra);
    if (limitBezTokenu && !auth) return odp(403, { message: 'API rate limit exceeded for 10.0.0.1' });
    const p = u.pathname.replace('/repos/aurabroker/ud', '');

    if (p === `/contents/${PLIK}` && metoda === 'GET') {
      const ref = u.searchParams.get('ref');
      const sha = galezie.get(ref) ?? (commity.has(ref) ? ref : null);
      if (!sha) return odp(404, { message: 'No commit found for the ref' }, extra);
      const tresc = commity.get(sha);
      const b64 = Buffer.from(tresc).toString('base64').replace(/.{60}/g, '$&\n');
      return odp(200, { type: 'file', encoding: 'base64', path: PLIK, content: b64, sha: blob(tresc) }, extra);
    }
    if (p.startsWith('/git/ref/heads/') && metoda === 'GET') {
      const nazwa = decodeURIComponent(p.slice('/git/ref/heads/'.length));
      return galezie.has(nazwa)
        ? odp(200, { ref: `refs/heads/${nazwa}`, object: { type: 'commit', sha: galezie.get(nazwa) } }, extra)
        : odp(404, { message: 'Not Found' }, extra);
    }
    const mc = p.match(/^\/git\/commits\/([0-9a-f]{40})$/);
    if (mc && metoda === 'GET') {
      return commity.has(mc[1])
        ? odp(200, { sha: mc[1], tree: { sha: drzewoCommitu.get(mc[1]) }, parents: rodzic.get(mc[1]) ? [{ sha: rodzic.get(mc[1]) }] : [] }, extra)
        : odp(404, { message: 'Not Found' }, extra);
    }
    if (p === '/git/trees' && metoda === 'POST') {
      if (awarie.drzewo) return odp(awarie.drzewo, { message: 'Server Error' }, extra);
      if (!drzewa.has(cialo.base_tree)) return odp(422, { message: 'base_tree does not exist' }, extra);
      // Atrapa trzyma w drzewie tylko plik kalibracji — każdy inny wpis to błąd testu.
      if (cialo.tree.length !== 1 || cialo.tree[0].path !== PLIK) return odp(422, { message: 'atrapa: inne pliki w drzewie' }, extra);
      return odp(201, { sha: noweDrzewo(cialo.tree[0].content) }, extra);
    }
    if (p === '/git/commits' && metoda === 'POST') {
      if (!drzewa.has(cialo.tree)) return odp(422, { message: 'tree does not exist' }, extra);
      if (!commity.has(cialo.parents[0])) return odp(422, { message: 'parent does not exist' }, extra);
      const nowy = commit(drzewa.get(cialo.tree), cialo.tree, cialo.parents[0]);
      return odp(201, { sha: nowy, tree: { sha: cialo.tree }, message: cialo.message }, extra);
    }
    if (p === '/git/refs' && metoda === 'POST') {
      const nazwa = cialo.ref.replace('refs/heads/', '');
      if (galezie.has(nazwa)) return odp(422, { message: 'Reference already exists' }, extra);
      if (!commity.has(cialo.sha)) return odp(422, { message: 'Object does not exist' }, extra);
      ustawGalaz(nazwa, cialo.sha);
      return odp(201, { ref: cialo.ref, object: { sha: cialo.sha } }, extra);
    }
    if (p.startsWith('/git/refs/heads/') && metoda === 'PATCH') {
      if (awarie.ref) return odp(awarie.ref, { message: 'Server Error' }, extra);
      const nazwa = decodeURIComponent(p.slice('/git/refs/heads/'.length));
      if (!galezie.has(nazwa)) return odp(422, { message: 'Reference does not exist' }, extra);
      if (!commity.has(cialo.sha)) return odp(422, { message: 'Object does not exist' }, extra);
      ustawGalaz(nazwa, cialo.sha);
      return odp(200, { ref: `refs/heads/${nazwa}`, object: { sha: cialo.sha } }, extra);
    }
    if (p === '/pulls' && metoda === 'GET') {
      const stan = u.searchParams.get('state') ?? 'open';
      const head = u.searchParams.get('head');
      return odp(200, pulls.filter((pr) => (stan === 'all' || pr.state === stan) && (!head || head === `aurabroker:${pr.head.ref}`)), extra);
    }
    if (p === '/pulls' && metoda === 'POST') {
      if (pulls.some((pr) => pr.state === 'open' && pr.head.ref === cialo.head && pr.head.repo?.full_name === REPO_PR.full_name &&
        pr.base.ref === cialo.base)) {
        return odp(422, { message: 'A pull request already exists' }, extra);
      }
      const numer = 41 + pulls.length;
      const pr = {
        number: numer, state: 'open', merged_at: null, title: cialo.title, body: cialo.body,
        head: { ref: cialo.head, repo: REPO_PR }, base: { ref: cialo.base }, html_url: `https://github.com/aurabroker/ud/pull/${numer}`,
      };
      pulls.push(pr);
      return odp(201, pr, extra);
    }
    const m = p.match(/^\/pulls\/(\d+)$/);
    if (m && metoda === 'PATCH') {
      patchPr += 1;
      const pr = pulls.find((x) => x.number === Number(m[1]));
      if (awarie.pr && patchPr >= awarie.prOd) {
        if (awarie.prZastosuj && pr) Object.assign(pr, cialo);
        return odp(awarie.pr, { message: 'Server Error' }, extra);
      }
      if (!pr) return odp(404, { message: 'Not Found' }, extra);
      Object.assign(pr, cialo);
      return odp(200, pr, extra);
    }
    return odp(404, { message: `atrapa nie zna ${metoda} ${p}` });
  }

  return {
    obsluz,
    zadania,
    pulls,
    galezie,
    rodzic,
    ustawieniaBota,
    awarie,
    patchPr: () => patchPr,
    trescNa: (galaz) => commity.get(galezie.get(galaz)),
    zapisy: () => zadania.filter((z) => z.metoda !== 'GET'),
  };
}

/** Treść `kalkulator/index.md` zgodna z plikiem na gałęzi produkcyjnej. */
function stronaZPliku(tresc) {
  const { stawka } = JSON.parse(tresc);
  const od = Math.round(14400 * stawka.dol);
  const do_ = Math.round(14400 * stawka.gora);
  return `**Świadczenie z polisy**\n\n14 400 zł\n\n**Szacowana składka miesięczna**\n\n${od}–${do_} zł\n`;
}

async function zaladuj({
  tryb = 'na_sucho',
  ustawienia = {},
  historia = [],
  wynik = wynikOk(),
  bladSql = null,
  bladTokenu = false,
  env = {},
  plik = PLIK_OBECNY,
  prs = [],
  botIstnieje = false,
  wygasa = null,
  limitBezTokenu = false,
  awaria = null,
  awariaPr = null,
  strona = null,
  resend = () => ({ ok: true, status: 200 }),
} = {}) {
  const baza = atrapaSupabase({
    ustawienia: ustawienia === null ? null : { tryb, galaz: GALAZ, odbiorca: 'biuro@utratadochodu.com', dane_od: null, ...ustawienia },
    historia, wynik, bladSql, bladTokenu,
  });
  const gh = atrapaGitHuba({ plik, botIstnieje, prs, wygasa, limitBezTokenu, awaria, awariaPr });
  const logi = [];
  const maile = [];
  const strony = [];
  let handler = null;

  const zmienne = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'klucz', RESEND2_API_KEY: 're_glowny', ...env,
  };
  const Deno = { env: { get: (k) => zmienne[k] }, serve: (h) => { handler = h; } };

  const fetchAtrapa = async (url, opcje = {}) => {
    const adres = String(url);
    if (adres.startsWith('https://api.github.com/') || adres.startsWith('https://raw.githubusercontent.com/')) {
      return gh.obsluz(adres, opcje);
    }
    if (adres === 'https://api.resend.com/emails') {
      const cialo = JSON.parse(String(opcje.body));
      maile.push({ naglowki: opcje.headers, cialo });
      const w = resend(cialo, maile.length);
      return new Response(w.tresc ?? '{"id":"mail-1"}', { status: w.status });
    }
    if (adres === STRONA) {
      strony.push(adres);
      const tresc = typeof strona === 'function' ? strona() : strona ?? stronaZPliku(gh.trescNa(GALAZ));
      return new Response(tresc, { status: 200 });
    }
    throw new Error(`nieoczekiwany adres: ${adres}`);
  };

  await new AsyncFunction('createClient', 'logError', 'Deno', 'fetch', kodFunkcji(ZRODLO))(
    () => baza.klient,
    async (zrodlo, wiadomosc, kontekst) => { logi.push({ zrodlo, wiadomosc, kontekst }); },
    Deno,
    fetchAtrapa,
  );

  const wywolaj = async ({ metoda = 'POST', token = TOKEN_CRONA } = {}) => {
    const res = await handler(new Request('https://x.supabase.co/functions/v1/kalibrator', {
      method: metoda,
      headers: token === null ? {} : { 'x-cron-token': token },
      body: metoda === 'GET' ? undefined : '{}',
    }));
    const tresc = await res.text();
    let dane = null;
    try { dane = JSON.parse(tresc); } catch { dane = null; }
    return { status: res.status, tresc, dane };
  };

  return { ...baza, gh, logi, maile, strony, wywolaj };
}

/** Wnętrze funkcji (walidator, lista zapisów) — to samo źródło, z dopisanym `return`. */
async function wnetrze(fetchAtrapa = async () => { throw new Error('bez sieci'); }) {
  const Deno = { env: { get: () => undefined }, serve: () => {} };
  return new AsyncFunction('createClient', 'logError', 'Deno', 'fetch',
    `${kodFunkcji(ZRODLO)}\nreturn { bledyKalibracji, zapisDozwolony, ocen, procent, zakres, sprawdzStrone };`)(
    () => ({}), async () => {}, Deno, fetchAtrapa,
  );
}

/**
 * sprawdzKalibracje() z portalu jako funkcja „czy plik przechodzi" — prawdziwe
 * źródło symulacja.ts bez typów, z kalibracja.json wstawionym w miejsce importu.
 * null, dopóki portal tej funkcji nie eksportuje.
 */
async function walidatorPortalu() {
  const zrodlo = readFileSync(new URL('../src/lib/symulacja.ts', import.meta.url), 'utf8');
  if (!/export\s+(async\s+)?(function|const|let)\s+sprawdzKalibracje\b/.test(zrodlo)) return null;
  const plik = readFileSync(new URL('../src/lib/kalibracja.json', import.meta.url), 'utf8');
  const kod = bezTypow(zrodlo).replace(
    /^import\s+(\w+)\s+from\s+['"]\.\/kalibracja\.json['"][^;\n]*;?$/m,
    (_, nazwa) => `const ${nazwa} = ${plik};`,
  );
  const { sprawdzKalibracje } = await import(`data:text/javascript;base64,${Buffer.from(kod).toString('base64')}`);
  return (k) => {
    try {
      const w = sprawdzKalibracje(structuredClone(k));
      if (Array.isArray(w)) return w.length === 0;
      if (typeof w === 'boolean') return w;
      return true;
    } catch {
      return false;
    }
  };
}

const ostatni = (f) => f.przebiegi[f.przebiegi.length - 1];
const trescMaila = (m) => `${m.cialo.subject}\n${m.cialo.text}\n${m.cialo.html}`;
const ostatniMail = (f) => f.maile[f.maile.length - 1];
/** Mail z ostatnich kilku dni — bez niego tryb propozycji wysłałby comiesięczne potwierdzenie. */
const NIEDAWNY_MAIL = { uruchomiono: dniTemu(3), wynik: 'na_sucho', powod: 'na sucho: bez zmian', mail_wyslany: true, na_stronie: true };

/** Plik, który kalibrator powinien zaproponować dla WYNIK_OK. */
const oczekiwanyPlik = (policzono) => `{
  "policzono": "${policzono}",
  "zrodlo": {
    "metoda": "osoby-v1",
    "ubezpieczyciel": "Leadenhall",
    "okno": {
      "od": "2025-10-14",
      "do": "2026-10-12"
    },
    "osob": 10,
    "ofert": 10,
    "wariantow": 17,
    "par": {
      "36": 6
    }
  },
  "stawka": {
    "dol": 0.0202,
    "srodek": 0.022,
    "gora": 0.0322
  },
  "okresy": {
    "24": 1,
    "36": 1.25
  }
}
`;

/** Skrót propozycji liczony niezależnie od funkcji: sha256 z JSON-a o posortowanych kluczach. */
const skrotPropozycji = (stawka, okresy) => {
  const sortuj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return createHash('sha256').update(JSON.stringify({ okresy: sortuj(okresy), stawka: sortuj(stawka) })).digest('hex');
};

test.describe('kalibrator: bramka', () => {
  test('GET → 405, brak nagłówka → 401; nic nie jest czytane', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env: { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH } });
    expect((await f.wywolaj({ metoda: 'GET' })).status).toBe(405);
    expect((await f.wywolaj({ token: null })).status).toBe(401);
    expect(f.rpc).toEqual([]);
    expect(f.odczyty).toEqual([]);
    expect(f.gh.zadania).toEqual([]);
    expect(f.maile).toHaveLength(0);
    expect(f.przebiegi).toHaveLength(0);
  });

  test('zły token: 401, bez odczytu, GitHuba, maila i wpisu w ud_errors', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env: { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH } });
    expect((await f.wywolaj({ token: 'zgadniety' })).status).toBe(401);
    expect(f.rpc.map((r) => r.nazwa)).toEqual(['edge_cron_token_matches']);
    expect(f.odczyty).toEqual([]);
    expect(f.gh.zadania).toEqual([]);
    expect(f.strony).toEqual([]);
    expect(f.maile).toHaveLength(0);
    expect(f.logi).toHaveLength(0);
  });

  test('błąd sprawdzania tokenu: 503 i wpis w ud_errors ze źródłem kalibrator', async () => {
    const f = await zaladuj({ bladTokenu: true });
    expect((await f.wywolaj()).status).toBe(503);
    expect(f.logi).toHaveLength(1);
    expect(f.logi[0].zrodlo).toBe('kalibrator');
    expect(f.odczyty).toEqual([]);
    expect(f.gh.zadania).toEqual([]);
  });
});

test.describe('kalibrator: tryby', () => {
  test('wylaczony: wpis w dzienniku i koniec — bez SQL, GitHuba, strony i maila', async () => {
    const f = await zaladuj({ tryb: 'wylaczony' });
    const r = await f.wywolaj();
    expect(r.status).toBe(200);
    expect(f.rpc.map((x) => x.nazwa)).toEqual(['edge_cron_token_matches']);
    expect(f.gh.zadania).toEqual([]);
    expect(f.strony).toEqual([]);
    expect(f.maile).toHaveLength(0);
    expect(f.przebiegi).toHaveLength(1);
    expect(ostatni(f)).toMatchObject({ tryb: 'wylaczony', wynik: 'wylaczony', mail_wyslany: false });
  });

  test('na_sucho ze zmianą: mail zawsze, zero zapisów do GitHuba', async () => {
    const f = await zaladuj({ tryb: 'na_sucho', env: { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH } });
    const r = await f.wywolaj();
    expect(r.status).toBe(200);
    expect(f.gh.zapisy(), 'na sucho nie wolno pisać do GitHuba').toEqual([]);
    expect(f.gh.zadania.map((z) => z.metoda)).toEqual(['GET']);
    expect(f.gh.trescNa(GALAZ)).toBe(PLIK_OBECNY);

    expect(f.maile).toHaveLength(1);
    const m = f.maile[0];
    expect(m.cialo.subject).toContain('Kalibracja — przebieg na sucho');
    expect(m.cialo.from).toBe('UtrataDochodu.pl <noreply@utratadochodu.com>');
    expect(m.cialo.to).toEqual(['biuro@utratadochodu.com']);
    expect(m.naglowki.Authorization).toBe('Bearer re_glowny');
    const t = m.cialo.text;
    expect(t).toContain('powstałby pull request');
    // 14 400 zł: 291–351 zł w pliku, 291–464 zł z wyliczonych; 11 700 zł: 236–285 → 236–377.
    expect(t).toContain('291–351 zł');
    expect(t).toContain('291–464 zł');
    expect(t).toContain('236–285 zł');
    expect(t).toContain('236–377 zł');
    expect(t).toMatch(/14\s400 zł/);
    expect(t).toMatch(/11\s700 zł/);
    // Raport: mediana, średnia, p10/p90, liczba osób, pary, pominięte, kandydaci.
    for (const fraza of ['2,1442%', '2,2815%', '2,031%', '2,655%', 'Osób', '36 mies. — 6', 'klauzula HIV/WZW', '1,2442']) {
      expect(t, fraza).toContain(fraza);
    }
    expect(ostatni(f)).toMatchObject({ tryb: 'na_sucho', wynik: 'na_sucho', mail_wyslany: true, na_stronie: true, pr_numer: null });
  });

  test('dane_od z ustawień idzie do funkcji SQL (dolna granica danych po zmianie taryfy)', async () => {
    for (const daneOd of [null, '2026-10-01']) {
      const f = await zaladuj({ tryb: 'na_sucho', ustawienia: { dane_od: daneOd } });
      await f.wywolaj();
      expect(f.rpc.find((r) => r.nazwa === 'ud_kalibracja_stawek').argumenty).toEqual({ p_dane_od: daneOd });
    }
  });

  test('na_sucho bez zmian: mail też idzie, z informacją „bez zmian"', async () => {
    const f = await zaladuj({ tryb: 'na_sucho', plik: PLIK_ZGODNY });
    await f.wywolaj();
    await f.wywolaj();
    expect(f.maile, 'na sucho mail idzie przy każdym przebiegu').toHaveLength(2);
    expect(f.maile[0].cialo.text).toContain('Bez zmian');
    expect(f.gh.zapisy()).toEqual([]);
    expect(f.przebiegi.map((p) => p.wynik)).toEqual(['na_sucho', 'na_sucho']);
  });
});

test.describe('kalibrator: propozycja', () => {
  const env = { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH };

  test('bez zmian: brak PUT i brak maila', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL] });
    const r = await f.wywolaj();
    expect(r.status).toBe(200);
    expect(f.gh.zapisy()).toEqual([]);
    expect(f.maile).toHaveLength(0);
    expect(ostatni(f)).toMatchObject({ wynik: 'bez_zmian', mail_wyslany: false, pr_numer: null, propozycja_hash: null });
  });

  test('bez zmian, ostatni mail ponad 30 dni temu: comiesięczne potwierdzenie', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, plik: PLIK_ZGODNY,
      historia: [
        { uruchomiono: dniTemu(1), wynik: 'bez_zmian', powod: 'bez zmian', mail_wyslany: false, na_stronie: true },
        { uruchomiono: dniTemu(30.5), wynik: 'bez_zmian', powod: 'bez zmian — comiesięczne potwierdzenie', mail_wyslany: true, na_stronie: true },
      ],
    });
    await f.wywolaj();
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.subject).toBe('Kalibracja: kalibrator działa, bez zmian');
    expect(ostatni(f)).toMatchObject({ wynik: 'bez_zmian', mail_wyslany: true });
    // Następny przebieg: mail sprzed chwili się liczy — cisza.
    await f.wywolaj();
    expect(f.maile).toHaveLength(1);
    expect(f.gh.zapisy()).toEqual([]);
  });

  test('zmiana: commit z jednym plikiem na HEAD produkcyjnej, gałąź bota ustawiona raz, pull request; produkcyjna nietknięta', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env });
    const head = f.gh.galezie.get(GALAZ);
    const r = await f.wywolaj();
    expect(r.status).toBe(200);

    const zapisy = f.gh.zapisy();
    expect(zapisy.map((z) => `${z.metoda} ${z.sciezka}`)).toEqual([
      'POST /repos/aurabroker/ud/git/trees',
      'POST /repos/aurabroker/ud/git/commits',
      'POST /repos/aurabroker/ud/git/refs',
      'POST /repos/aurabroker/ud/pulls',
    ]);
    const [drzewo, commit, ref, pr] = zapisy;
    expect(drzewo.cialo.tree).toEqual([{ path: PLIK, mode: '100644', type: 'blob', content: oczekiwanyPlik(dzisWarszawa()) }]);
    expect(commit.cialo.parents).toEqual([head]);
    expect(ref.cialo).toEqual({ ref: `refs/heads/${BOT}`, sha: f.gh.galezie.get(BOT) });
    expect(ref.cialo.sha).not.toBe(head);
    expect(f.gh.rodzic.get(f.gh.galezie.get(BOT))).toBe(head);
    expect(pr.cialo).toMatchObject({ head: BOT, base: GALAZ });
    for (const z of zapisy) expect(z.auth).toBe(`Bearer ${TOKEN_GH}`);

    // Gałąź produkcyjna bez zmian; na gałęzi bota — dokładnie nowy plik.
    expect(f.gh.trescNa(GALAZ)).toBe(PLIK_OBECNY);
    expect(f.gh.trescNa(BOT)).toBe(oczekiwanyPlik(dzisWarszawa()));
    expect(zapisy.some((z) => JSON.stringify(z.cialo ?? {}).includes(`"branch":"${GALAZ}"`))).toBe(false);

    expect(f.gh.pulls).toHaveLength(1);
    expect(f.gh.pulls[0].body).toContain(skrotPropozycji({ dol: 0.0202, srodek: 0.022, gora: 0.0322 }, { 24: 1, 36: 1.25 }));
    expect(f.gh.pulls[0].body).toContain('https://kalibrator-propozycja.utratadochodu.pages.dev/kalkulator/');

    expect(f.maile).toHaveLength(1);
    const m = f.maile[0].cialo;
    expect(m.subject).toBe('Kalibracja: propozycja zmiany stawek');
    expect(m.text).toContain('https://github.com/aurabroker/ud/pull/41');
    expect(m.text).toContain('https://kalibrator-propozycja.utratadochodu.pages.dev/kalkulator/');
    expect(m.text).toContain('291–464 zł');
    // Pełna poprzednia treść pliku — do wklejenia przy cofaniu.
    expect(m.text).toContain(PLIK_OBECNY.trim());
    expect(m.html).toContain('&quot;gora&quot;: 0.0244');
    expect(m.text).not.toContain('SPADEK');

    expect(ostatni(f)).toMatchObject({
      wynik: 'propozycja', pr_numer: 41, mail_wyslany: true,
      propozycja_hash: skrotPropozycji({ dol: 0.0202, srodek: 0.022, gora: 0.0322 }, { 24: 1, 36: 1.25 }),
    });
  });

  test('istniejąca gałąź bota i otwarty PR z inną propozycją: reset z force, nowy plik, nowy opis', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, botIstnieje: true,
      prs: [{ number: 7, state: 'open', body: 'Skrót propozycji: `starystarystary`', html_url: 'https://github.com/aurabroker/ud/pull/7' }],
    });
    await f.wywolaj();
    const zapisy = f.gh.zapisy();
    expect(zapisy.map((z) => `${z.metoda} ${z.sciezka}`)).toEqual([
      'PATCH /repos/aurabroker/ud/pulls/7',
      'POST /repos/aurabroker/ud/git/trees',
      'POST /repos/aurabroker/ud/git/commits',
      `PATCH /repos/aurabroker/ud/git/refs/heads/${BOT}`,
      'PATCH /repos/aurabroker/ud/pulls/7',
    ]);
    // Zanim cokolwiek innego, PR dostaje [NIEAKTUALNE] i traci skrót z opisu.
    expect(zapisy[0].cialo.title.startsWith('[NIEAKTUALNE]')).toBe(true);
    expect(zapisy[0].cialo.body).not.toMatch(/Skrót propozycji|kalibrator:[0-9a-f]/);
    expect(zapisy[3].cialo).toEqual({ sha: f.gh.galezie.get(BOT), force: true });
    expect(f.gh.rodzic.get(f.gh.galezie.get(BOT))).toBe(f.gh.galezie.get(GALAZ));
    expect(Object.keys(zapisy[4].cialo).sort()).toEqual(['body', 'title']);
    expect(zapisy[4].cialo.title.startsWith('[NIEAKTUALNE]')).toBe(false);
    expect(f.gh.pulls[0]).toMatchObject({ state: 'open', merged_at: null });
    expect(f.gh.trescNa(BOT)).toBe(oczekiwanyPlik(dzisWarszawa()));
    expect(f.gh.trescNa(GALAZ)).toBe(PLIK_OBECNY);
    expect(f.gh.pulls).toHaveLength(1);
    expect(f.maile[0].cialo.html).toContain('Zaktualizowany pull request #7');
    expect(f.maile[0].cialo.text).toContain('https://github.com/aurabroker/ud/pull/7');
    expect(ostatni(f)).toMatchObject({ wynik: 'propozycja', pr_numer: 7 });
  });

  test('otwarty PR z tym samym skrótem: cisza; zamknięty bez scalenia: cisza; scalony: nowa propozycja', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env });
    await f.wywolaj();
    expect(f.gh.pulls).toHaveLength(1);
    expect(f.maile).toHaveLength(1);
    const zapisowPo1 = f.gh.zapisy().length;

    // Ta sama propozycja nazajutrz — PR już czeka.
    await f.wywolaj();
    expect(f.gh.zapisy()).toHaveLength(zapisowPo1);
    expect(f.maile).toHaveLength(1);
    expect(ostatni(f)).toMatchObject({ wynik: 'propozycja', pr_numer: 41, mail_wyslany: false });

    // Właściciel zamknął PR bez scalenia — te same liczby nie wracają.
    f.gh.pulls[0].state = 'closed';
    await f.wywolaj();
    expect(f.gh.zapisy()).toHaveLength(zapisowPo1);
    expect(f.maile).toHaveLength(1);
    expect(ostatni(f)).toMatchObject({ wynik: 'odmowa', pr_numer: 41, mail_wyslany: false });

    // Scalony i cofnięty plik to nie odrzucenie: propozycja wraca jako nowy PR.
    f.gh.pulls[0].merged_at = '2026-10-15T10:00:00Z';
    await f.wywolaj();
    expect(f.gh.pulls).toHaveLength(2);
    expect(f.maile).toHaveLength(2);
  });

  test('otwarty PR ze skrótem policzonym niezależnie: cisza (definicja skrótu jest stała)', async () => {
    const skrot = skrotPropozycji({ dol: 0.0202, srodek: 0.022, gora: 0.0322 }, { 24: 1, 36: 1.25 });
    const f = await zaladuj({
      tryb: 'propozycja', env, botIstnieje: true,
      prs: [{ number: 9, state: 'open', body: `Skrót propozycji: \`${skrot}\``, html_url: 'https://github.com/aurabroker/ud/pull/9' }],
    });
    await f.wywolaj();
    expect(f.gh.zapisy()).toEqual([]);
    expect(f.maile).toHaveLength(0);
  });

  test('nowy klucz 48 nie trafia do pliku — idzie do maila jako „do decyzji"', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL],
      wynik: wynikOk({ okresy: { 24: 1, 36: 1.25, 48: 1.5 } }),
    });
    await f.wywolaj();
    const plik = JSON.parse(f.gh.trescNa(BOT));
    expect(plik.okresy).toEqual({ 24: 1, 36: 1.25 });
    expect(f.gh.pulls[0].body).not.toContain('48 mies.');
    const t = f.maile[0].cialo.text;
    expect(t).toContain('Do decyzji');
    expect(t).toContain('48 mies.');
    expect(ostatni(f).powod).toContain('do decyzji: okres 48');
  });

  test('sam nowy klucz 48 przy niezmienionych stawkach: bez PR, jeden mail „do decyzji", potem cisza', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL],
      wynik: wynikOk({ okresy: { 24: 1, 36: 1.25, 48: 1.5 } }),
    });
    await f.wywolaj();
    expect(f.gh.zapisy()).toEqual([]);
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.text).toContain('Do decyzji');
    await f.wywolaj();
    expect(f.maile).toHaveLength(1);
  });

  test('klucz 36 z pliku bez par w danych: zostaje stary mnożnik i uwaga w mailu', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, wynik: wynikOk({ okresy: { 24: 1 } }) });
    await f.wywolaj();
    expect(JSON.parse(f.gh.trescNa(BOT)).okresy).toEqual({ 24: 1, 36: 1.25 });
    expect(f.maile[0].cialo.text).toContain('zostaje dotychczasowy mnożnik 1,25');
  });

  test('brak tokenu GitHuba: odmowa i mail, zero zapisów; drugi przebieg bez maila', async () => {
    const f = await zaladuj({ tryb: 'propozycja' });
    await f.wywolaj();
    expect(f.gh.zapisy()).toEqual([]);
    expect(f.gh.zadania.every((z) => z.auth === null)).toBe(true);
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.text).toContain('GITHUB_KALIBRATOR_TOKEN');
    expect(ostatni(f)).toMatchObject({ wynik: 'odmowa', mail_wyslany: true });
    await f.wywolaj();
    expect(f.maile).toHaveLength(1);
  });

  test('spadek dolnej granicy: wyraźna flaga w mailu i w pull requeście', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env,
      wynik: wynikOk({ stawka: { dol: 0.0195 }, raport: { surowe: { ...RAPORT.surowe, min: 0.01948 } } }),
    });
    await f.wywolaj();
    expect(f.maile[0].cialo.text).toContain('SPADEK dolnej granicy');
    expect(f.maile[0].cialo.html).toContain('SPADEK dolnej granicy');
    expect(f.gh.pulls[0].body).toContain('SPADEK dolnej granicy');
  });

  test('sama zmiana mnożnika 36 to też zmiana: PR z dzisiejszym policzono', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: PLIK_ZGODNY, wynik: wynikOk({ okresy: { 24: 1, 36: 1.26 } }) });
    await f.wywolaj();
    const plik = JSON.parse(f.gh.trescNa(BOT));
    expect(plik.okresy['36']).toBe(1.26);
    expect(plik.policzono).toBe(dzisWarszawa());
  });
});

test.describe('kalibrator: otwarty PR, którego dane już nie dają', () => {
  const env = { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH };
  const STARY = 'a'.repeat(64);
  const prStary = (zmien = {}) => ({
    number: 7, state: 'open', title: 'Kalibracja stawek: 2,02%–2,50% (było 2,02%–2,44%)',
    body: `| tabela |\n\nScalenie do \`${GALAZ}\` = nowe stawki na stronie po zbudowaniu. Zamknięcie bez scalenia = kalibrator nie zaproponuje tych samych liczb ponownie.\n\nSkrót propozycji: \`${STARY}\`\n<!-- kalibrator:${STARY} -->`,
    html_url: 'https://github.com/aurabroker/ud/pull/7', ...zmien,
  });

  test('bez zmian: PR oznaczony [NIEAKTUALNE], skrót usunięty, jeden alarm; nazajutrz cisza', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], botIstnieje: true, prs: [prStary()] });
    expect((await f.wywolaj()).status).toBe(200);
    const zapisy = f.gh.zapisy();
    expect(zapisy.map((z) => `${z.metoda} ${z.sciezka}`)).toEqual(['PATCH /repos/aurabroker/ud/pulls/7']);
    expect(Object.keys(zapisy[0].cialo).sort()).toEqual(['body', 'title']);
    const pr = f.gh.pulls[0];
    expect(pr.state).toBe('open');
    expect(pr.title.startsWith('[NIEAKTUALNE] Kalibracja stawek')).toBe(true);
    expect(pr.body.startsWith('**[NIEAKTUALNE] Nie scalaj.**')).toBe(true);
    expect(pr.body).not.toContain(STARY);
    expect(pr.body).toContain('| tabela |');
    // Zamknięcie oznaczonego PR niczego już nie blokuje — opis nie może twierdzić inaczej.
    expect(pr.body).not.toContain('nie zaproponuje tych samych liczb');
    expect(pr.body).toContain('nie blokuje przyszłych propozycji');
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.subject).toBe('Kalibracja: uwagi');
    expect(f.maile[0].cialo.text).toContain('Pull request #7 oznaczony jako nieaktualny');
    expect(ostatni(f)).toMatchObject({ wynik: 'bez_zmian', mail_wyslany: true });
    expect(ostatni(f).powod).toContain('PR #7 nieaktualny');
    expect(f.gh.trescNa(GALAZ)).toBe(PLIK_ZGODNY);

    await f.wywolaj();
    expect(f.gh.zapisy(), 'już oznaczony — drugi raz go nie ruszamy').toHaveLength(1);
    expect(f.maile).toHaveLength(1);
  });

  test('odmowa (za mało osób): PR oznaczony, uwaga stoi w mailu odmowy', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, botIstnieje: true, prs: [prStary()],
      wynik: { status: 'za_malo_osob', stawka: null, okresy: null, zrodlo: { ...ZRODLO_SQL, osob: 7 }, raport: RAPORT },
    });
    await f.wywolaj();
    expect(f.gh.zapisy().map((z) => `${z.metoda} ${z.sciezka}`)).toEqual(['PATCH /repos/aurabroker/ud/pulls/7']);
    expect(f.gh.pulls[0].body).toContain('za_malo_osob');
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.subject).toContain('odmowa');
    expect(f.maile[0].cialo.text).toContain('Pull request #7 oznaczony jako nieaktualny');
    expect(ostatni(f)).toMatchObject({ wynik: 'odmowa', mail_wyslany: true, pr_numer: null });
  });

  test('oznaczony PR wraca, gdy dane znowu dają zmianę — przepisany na nowo, bez przedrostka', async () => {
    let w = wynikOk();
    const f = await zaladuj({
      tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], botIstnieje: true, prs: [prStary()],
      wynik: () => structuredClone(w),
    });
    await f.wywolaj();
    expect(f.gh.pulls[0].title.startsWith('[NIEAKTUALNE]')).toBe(true);

    w = wynikOk({ stawka: { gora: 0.033 }, raport: { surowe: { ...RAPORT.surowe, max: 0.03295 } } });
    await f.wywolaj();
    expect(f.gh.pulls).toHaveLength(1);
    const pr = f.gh.pulls[0];
    expect(pr).toMatchObject({ number: 7, state: 'open', merged_at: null });
    expect(pr.title.startsWith('[NIEAKTUALNE]')).toBe(false);
    expect(pr.body).toContain(skrotPropozycji({ dol: 0.0202, srodek: 0.022, gora: 0.033 }, { 24: 1, 36: 1.25 }));
    expect(JSON.parse(f.gh.trescNa(BOT)).stawka.gora).toBe(0.033);
    expect(ostatni(f)).toMatchObject({ wynik: 'propozycja', pr_numer: 7 });
  });

  test('odrzucona propozycja wraca, a otwarty jest inny PR: oznaczony i alarm (trzy dni)', async () => {
    let w = wynikOk();
    const f = await zaladuj({ tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w) });
    await f.wywolaj();                                   // dzień 1: P1 → PR #41
    f.gh.pulls[0].state = 'closed';                      // właściciel zamyka bez scalenia
    w = wynikOk({ stawka: { gora: 0.033 }, raport: { surowe: { ...RAPORT.surowe, max: 0.03295 } } });
    await f.wywolaj();                                   // dzień 2: P2 → PR #42
    expect(f.gh.pulls.map((p) => [p.number, p.state])).toEqual([[41, 'closed'], [42, 'open']]);
    const maili = f.maile.length;
    w = wynikOk();
    await f.wywolaj();                                   // dzień 3: dane wracają do odrzuconego P1
    expect(ostatni(f)).toMatchObject({ wynik: 'odmowa', pr_numer: 41 });
    expect(f.gh.pulls[1].title.startsWith('[NIEAKTUALNE]')).toBe(true);
    expect(f.maile).toHaveLength(maili + 1);
    expect(ostatniMail(f).cialo.text).toContain('Pull request #42 oznaczony jako nieaktualny');
  });

  test('mail o oznaczeniu nie wyszedł: następny przebieg przypomina o oznaczonym PR, potem cisza', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], botIstnieje: true, prs: [prStary()],
      resend: (_c, n) => (n === 1 ? { ok: false, status: 500 } : { ok: true, status: 200 }),
    });
    await f.wywolaj();
    expect(f.gh.pulls[0].title.startsWith('[NIEAKTUALNE]')).toBe(true);
    expect(ostatni(f)).toMatchObject({ mail_wyslany: false });
    expect(ostatni(f).powod).not.toContain('PR #7 nieaktualny');
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
    expect(f.maile[1].cialo.text).toContain('Pull request #7 jest oznaczony jako nieaktualny i dalej otwarty');
    expect(f.gh.zapisy(), 'oznaczony — bez drugiego PATCH').toHaveLength(1);
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
  });

  test('przestawiona gałąź, a końcowy opis PR się nie zapisał: PR zostaje [NIEAKTUALNE]; dawne liczby go przepisują', async () => {
    let w = wynikOk();
    const P2 = () => wynikOk({ stawka: { gora: 0.033 }, raport: { surowe: { ...RAPORT.surowe, max: 0.03295 } } });
    const f = await zaladuj({ tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w) });
    await f.wywolaj();                                    // P1 → PR #41
    w = P2();
    f.gh.awarie.pr = 502;
    f.gh.awarie.prOd = f.gh.patchPr() + 2;                // przejdzie tylko PATCH oznaczający
    expect((await f.wywolaj()).status).toBe(500);         // P2: gałąź przestawiona, opis padł
    expect(JSON.parse(f.gh.trescNa(BOT)).stawka.gora).toBe(0.033);
    const pr = f.gh.pulls[0];
    expect(pr.title.startsWith('[NIEAKTUALNE]')).toBe(true);
    expect(pr.body).not.toMatch(/Skrót propozycji/);

    f.gh.awarie.pr = null;
    w = wynikOk();                                        // dane wracają do P1
    await f.wywolaj();
    expect(JSON.parse(f.gh.trescNa(BOT)).stawka.gora, 'gałąź znowu z P1, nie „już czeka" na P2').toBe(0.0322);
    expect(f.gh.pulls).toHaveLength(1);
    expect(f.gh.pulls[0].title.startsWith('[NIEAKTUALNE]')).toBe(false);
    expect(f.gh.pulls[0].body).toContain(skrotPropozycji({ dol: 0.0202, srodek: 0.022, gora: 0.0322 }, { 24: 1, 36: 1.25 }));
  });

  test('przestawienie gałęzi padło: PR oznaczony; te same liczby nazajutrz go przepisują, nie „już czeka"', async () => {
    let w = wynikOk();
    const f = await zaladuj({ tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w) });
    await f.wywolaj();                                    // P1 → PR #41
    w = wynikOk({ stawka: { gora: 0.033 }, raport: { surowe: { ...RAPORT.surowe, max: 0.03295 } } });
    f.gh.awarie.ref = 502;
    expect((await f.wywolaj()).status).toBe(500);
    expect(JSON.parse(f.gh.trescNa(BOT)).stawka.gora, 'gałąź bez zmian — dalej P1').toBe(0.0322);
    expect(f.gh.pulls[0].title.startsWith('[NIEAKTUALNE]')).toBe(true);
    f.gh.awarie.ref = null;
    w = wynikOk();                                        // P1 jak na gałęzi — ale opis PR już bez skrótu
    await f.wywolaj();
    expect(f.gh.pulls[0].title.startsWith('[NIEAKTUALNE]')).toBe(false);
    expect(f.gh.pulls[0].body).toContain(skrotPropozycji({ dol: 0.0202, srodek: 0.022, gora: 0.0322 }, { 24: 1, 36: 1.25 }));
  });

  test('awaria przy budowie commitu: otwarty PR ze starymi liczbami i tak dostaje [NIEAKTUALNE]', async () => {
    let w = wynikOk();
    const f = await zaladuj({ tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w) });
    await f.wywolaj();                                    // P1 → PR #41
    w = wynikOk({ stawka: { gora: 0.033 }, raport: { surowe: { ...RAPORT.surowe, max: 0.03295 } } });
    f.gh.awarie.drzewo = 502;
    expect((await f.wywolaj()).status).toBe(500);
    expect(JSON.parse(f.gh.trescNa(BOT)).stawka.gora, 'gałąź nietknięta').toBe(0.0322);
    expect(f.gh.pulls[0].title.startsWith('[NIEAKTUALNE]')).toBe(true);
    expect(f.gh.pulls[0].body).not.toMatch(/Skrót propozycji/);
  });

  test('przypomnienie o oznaczonym PR liczy znacznik tylko z bieżącej wersji PR', async () => {
    let w = wynikOk();
    let padaMail = false;
    const ZGODNE = () => wynikOk({ stawka: { gora: 0.0244 }, raport: { surowe: { ...RAPORT.surowe, max: 0.0244 } } });
    const f = await zaladuj({
      tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w),
      resend: () => (padaMail ? { ok: false, status: 500 } : { ok: true, status: 200 }),
    });
    await f.wywolaj();                                    // P1 → PR #41, mail
    w = ZGODNE();
    await f.wywolaj();                                    // bez zmian → #41 oznaczony, mail ze znacznikiem
    expect(ostatni(f).powod).toContain('PR #41 nieaktualny');
    w = wynikOk({ stawka: { gora: 0.033 }, raport: { surowe: { ...RAPORT.surowe, max: 0.03295 } } });
    await f.wywolaj();                                    // P2 → #41 przepisany
    w = ZGODNE();
    padaMail = true;
    await f.wywolaj();                                    // bez zmian → #41 oznaczony znowu, mail pada
    expect(f.gh.pulls[0].title.startsWith('[NIEAKTUALNE]')).toBe(true);
    padaMail = false;
    const przed = f.maile.length;
    await f.wywolaj();                                    // przypomnienie mimo znacznika sprzed przepisania
    expect(f.maile).toHaveLength(przed + 1);
    expect(ostatniMail(f).cialo.text).toContain('Pull request #41 jest oznaczony jako nieaktualny i dalej otwarty');
    await f.wywolaj();
    expect(f.maile).toHaveLength(przed + 1);
  });

  test('na sucho: otwartego PR nie rusza (zero zapisów do GitHuba)', async () => {
    const f = await zaladuj({ tryb: 'na_sucho', env, plik: PLIK_ZGODNY, botIstnieje: true, prs: [prStary()] });
    await f.wywolaj();
    expect(f.gh.zapisy()).toEqual([]);
  });

  test('błąd GitHuba przy oznaczaniu: przebieg kończy się normalnie, ud_errors i alarm', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], botIstnieje: true, prs: [prStary()], awariaPr: 502,
    });
    const r = await f.wywolaj();
    expect(r.status).toBe(200);
    expect(ostatni(f).wynik).toBe('bez_zmian');
    expect(f.logi.map((l) => l.wiadomosc).join()).toContain('nie mogę sprawdzić albo oznaczyć otwartego PR');
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.text).toContain('Nie udało się sprawdzić');
    await f.wywolaj();
    expect(f.maile, 'alarm o błędzie nie częściej niż raz na 7 dni').toHaveLength(1);
  });

  test('PR z cudzego repozytorium albo do innej bazy jest pomijany — nowy PR, cudzych nie rusza', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, botIstnieje: true,
      prs: [
        prStary({ number: 7, head: { ref: BOT, repo: { full_name: 'obcy/ud' } } }),
        prStary({ number: 8, base: { ref: 'main' } }),
        prStary({ number: 9, head: { ref: BOT, repo: null } }),
      ],
    });
    await f.wywolaj();
    const zapisy = f.gh.zapisy().map((z) => `${z.metoda} ${z.sciezka}`);
    expect(zapisy).toContain('POST /repos/aurabroker/ud/pulls');
    expect(zapisy.some((z) => /\/pulls\/\d+$/.test(z))).toBe(false);
    const nowy = f.gh.pulls[f.gh.pulls.length - 1];
    expect(nowy).toMatchObject({ state: 'open', head: { ref: BOT, repo: { full_name: 'aurabroker/ud' } }, base: { ref: GALAZ } });
    expect(ostatni(f)).toMatchObject({ wynik: 'propozycja', pr_numer: nowy.number });
    expect(f.gh.pulls.slice(0, 3).map((p) => p.title)).toEqual(Array(3).fill(prStary().title));
  });

  test('gałąź bota nigdy nie stoi na HEAD produkcyjnej — otwarty PR nie „scala się" sam', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, botIstnieje: true, prs: [prStary()] });
    await f.wywolaj();
    expect(f.gh.ustawieniaBota).toHaveLength(1);
    for (const sha of f.gh.ustawieniaBota) expect(sha).not.toBe(f.gh.galezie.get(GALAZ));
    expect(f.gh.pulls[0]).toMatchObject({ number: 7, state: 'open', merged_at: null });
    expect(f.maile[0].cialo.html).toContain('Zaktualizowany pull request #7');
  });
});

test.describe('kalibrator: nieudany mail jest ponawiany', () => {
  const env = { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH };
  const padaPierwszy = (_c, n) => (n === 1 ? { ok: false, status: 500 } : { ok: true, status: 200 });

  test('odmowa: mail nie wyszedł — następny przebieg z tym samym powodem wysyła go jeszcze raz', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, resend: padaPierwszy,
      wynik: { status: 'za_malo_osob', stawka: null, okresy: null, zrodlo: { ...ZRODLO_SQL, osob: 7 }, raport: RAPORT },
    });
    await f.wywolaj();
    expect(ostatni(f)).toMatchObject({ wynik: 'odmowa', mail_wyslany: false });
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
    expect(ostatni(f)).toMatchObject({ wynik: 'odmowa', mail_wyslany: true });
    await f.wywolaj();
    await f.wywolaj();
    await f.wywolaj();
    expect(f.maile, 'po udanym mailu — cisza, także po kilku przebiegach').toHaveLength(2);
  });

  test('ta sama odmowa i ten sam błąd przez pięć przebiegów: jeden mail, nie co drugi', async () => {
    const odmowa = await zaladuj({
      tryb: 'propozycja', env,
      wynik: { status: 'za_malo_osob', stawka: null, okresy: null, zrodlo: { ...ZRODLO_SQL, osob: 7 }, raport: RAPORT },
    });
    const blad = await zaladuj({ tryb: 'propozycja', bladSql: { message: 'statement timeout' } });
    for (let i = 0; i < 5; i += 1) { await odmowa.wywolaj(); await blad.wywolaj(); }
    expect(odmowa.maile).toHaveLength(1);
    expect(blad.maile).toHaveLength(1);
    expect(odmowa.przebiegi.map((p) => p.mail_wyslany)).toEqual([true, false, false, false, false]);
    expect(blad.przebiegi.map((p) => p.mail_wyslany)).toEqual([true, false, false, false, false]);
  });

  test('mail o propozycji nie wyszedł: następny przebieg („PR już czeka") wysyła go jeszcze raz', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], resend: padaPierwszy });
    await f.wywolaj();
    expect(ostatni(f)).toMatchObject({ wynik: 'propozycja', pr_numer: 41, mail_wyslany: false });
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
    expect(f.maile[1].cialo.subject).toBe('Kalibracja: propozycja zmiany stawek');
    expect(f.maile[1].cialo.text).toContain('https://github.com/aurabroker/ud/pull/41');
    expect(ostatni(f)).toMatchObject({ wynik: 'propozycja', pr_numer: 41, mail_wyslany: true });
    expect(f.gh.pulls).toHaveLength(1);
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
  });

  test('mail o przepisanym PR nie wyszedł: ponowiony nazajutrz, mimo udanego maila o poprzedniej wersji', async () => {
    let w = wynikOk();
    let padaMail = false;
    const f = await zaladuj({
      tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w),
      resend: () => (padaMail ? { ok: false, status: 500 } : { ok: true, status: 200 }),
    });
    await f.wywolaj();                                    // P1 → PR #41, mail OK
    w = wynikOk({ stawka: { gora: 0.033 }, raport: { surowe: { ...RAPORT.surowe, max: 0.03295 } } });
    padaMail = true;
    await f.wywolaj();                                    // P2 → #41 zaktualizowany, mail pada
    expect(ostatni(f)).toMatchObject({ wynik: 'propozycja', pr_numer: 41, mail_wyslany: false });
    padaMail = false;
    const przed = f.maile.length;
    await f.wywolaj();                                    // „już czeka" — ale mail o P2 nie wyszedł
    expect(f.maile).toHaveLength(przed + 1);
    expect(ostatniMail(f).cialo.subject).toBe('Kalibracja: propozycja zmiany stawek');
    expect(ostatniMail(f).cialo.text).toContain('3,30%');
    expect(ostatni(f).powod).toContain('mail ponowiony');
    await f.wywolaj();
    expect(f.maile).toHaveLength(przed + 1);
  });

  test('końcowy opis PR zapisany, a odpowiedź zginęła (502): mail o nowej wersji wychodzi nazajutrz', async () => {
    let w = wynikOk();
    const f = await zaladuj({ tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w) });
    await f.wywolaj();                                    // P1 → PR #41, mail OK
    w = wynikOk({ stawka: { gora: 0.033 }, raport: { surowe: { ...RAPORT.surowe, max: 0.03295 } } });
    Object.assign(f.gh.awarie, { pr: 502, prOd: f.gh.patchPr() + 2, prZastosuj: true });
    expect((await f.wywolaj()).status).toBe(500);         // GitHub przyjął opis z P2, my widzimy 502
    expect(f.gh.pulls[0].title.startsWith('[NIEAKTUALNE]')).toBe(false);
    Object.assign(f.gh.awarie, { pr: null, prZastosuj: false });
    const przed = f.maile.length;
    await f.wywolaj();                                    // „już czeka" na P2 — mail o P2 jeszcze nie wyszedł
    expect(f.maile).toHaveLength(przed + 1);
    expect(ostatniMail(f).cialo.subject).toBe('Kalibracja: propozycja zmiany stawek');
    expect(ostatniMail(f).cialo.text).toContain('3,30%');
    await f.wywolaj();
    expect(f.maile).toHaveLength(przed + 1);
  });

  test('A → „nie scalaj" → A z zagubioną odpowiedzią: nazajutrz mail o A, nie miesiąc ciszy', async () => {
    let w = wynikOk();
    const ZGODNE = () => wynikOk({ stawka: { gora: 0.0244 }, raport: { surowe: { ...RAPORT.surowe, max: 0.0244 } } });
    const f = await zaladuj({ tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w) });
    await f.wywolaj();                                    // A → PR #41, mail
    w = ZGODNE();
    await f.wywolaj();                                    // #41 oznaczony, mail „nie scalaj"
    w = wynikOk();
    Object.assign(f.gh.awarie, { pr: 502, prOd: f.gh.patchPr() + 2, prZastosuj: true });
    expect((await f.wywolaj()).status).toBe(500);         // #41 przepisany na A, odpowiedź zginęła
    expect(ostatni(f)).toMatchObject({ wynik: 'blad', pr_numer: 41 });
    Object.assign(f.gh.awarie, { pr: null, prZastosuj: false });
    const przed = f.maile.length;
    await f.wywolaj();
    expect(f.maile).toHaveLength(przed + 1);
    expect(ostatniMail(f).cialo.subject).toBe('Kalibracja: propozycja zmiany stawek');
    await f.wywolaj();
    expect(f.maile).toHaveLength(przed + 1);
  });

  test('V1 → V2 i V1 z zagubionymi odpowiedziami: ostatni mail mówi o tym, co jest w PR', async () => {
    let w = wynikOk();
    const V2 = () => wynikOk({ stawka: { gora: 0.033 }, raport: { surowe: { ...RAPORT.surowe, max: 0.03295 } } });
    const f = await zaladuj({ tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w) });
    const zgubOpis = () => Object.assign(f.gh.awarie, { pr: 502, prOd: f.gh.patchPr() + 2, prZastosuj: true });
    const napraw = () => Object.assign(f.gh.awarie, { pr: null, prZastosuj: false });
    await f.wywolaj();                                    // V1 → #41, mail
    w = V2(); zgubOpis();
    await f.wywolaj();                                    // #41 = V2, odpowiedź zginęła
    napraw();
    await f.wywolaj();                                    // czeka na V2 → mail o V2
    expect(ostatniMail(f).cialo.text).toContain('3,30%');
    w = wynikOk(); zgubOpis();
    await f.wywolaj();                                    // #41 = V1, odpowiedź zginęła
    napraw();
    const przed = f.maile.length;
    await f.wywolaj();                                    // czeka na V1 → mail o V1
    expect(f.maile).toHaveLength(przed + 1);
    expect(ostatniMail(f).cialo.subject).toBe('Kalibracja: propozycja zmiany stawek');
    expect(ostatniMail(f).cialo.text).not.toContain('2,02%–3,30%');
    expect(JSON.parse(f.gh.trescNa(BOT)).stawka.gora).toBe(0.0322);
  });

  test('przypomnienie o oznaczonym PR: znacznik sprzed niezalogowanego przepisania nie ucisza', async () => {
    let w = wynikOk();
    let padaMail = false;
    const ZGODNE = () => wynikOk({ stawka: { gora: 0.0244 }, raport: { surowe: { ...RAPORT.surowe, max: 0.0244 } } });
    const f = await zaladuj({
      tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wynik: () => structuredClone(w),
      resend: () => (padaMail ? { ok: false, status: 500 } : { ok: true, status: 200 }),
    });
    await f.wywolaj();                                    // A → #41
    w = ZGODNE();
    await f.wywolaj();                                    // oznaczony, znacznik w dzienniku
    w = wynikOk();
    Object.assign(f.gh.awarie, { pr: 502, prOd: f.gh.patchPr() + 2, prZastosuj: true });
    await f.wywolaj();                                    // przepisany na A bez wpisu zapisu
    Object.assign(f.gh.awarie, { pr: null, prZastosuj: false });
    await f.wywolaj();                                    // czeka (mail ponowiony)
    w = ZGODNE(); padaMail = true;
    await f.wywolaj();                                    // oznaczony znowu — mail pada
    expect(f.gh.pulls[0].title.startsWith('[NIEAKTUALNE]')).toBe(true);
    padaMail = false;
    const przed = f.maile.length;
    await f.wywolaj();
    expect(f.maile).toHaveLength(przed + 1);
    expect(ostatniMail(f).cialo.text).toContain('Pull request #41 jest oznaczony jako nieaktualny i dalej otwarty');
  });

  test('ponowiony mail o propozycji niesie też bieżące uwagi (ostrzeżenie o tokenie)', async () => {
    const zaDni = (d) => new Date(Date.now() + d * DZIEN).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    let padaMail = true;
    const f = await zaladuj({
      tryb: 'propozycja', env, historia: [NIEDAWNY_MAIL], wygasa: zaDni(10),
      resend: () => (padaMail ? { ok: false, status: 500 } : { ok: true, status: 200 }),
    });
    await f.wywolaj();                                    // PR #41, mail (z ostrzeżeniem o tokenie) pada
    padaMail = false;
    await f.wywolaj();                                    // ponowiony mail o propozycji
    expect(f.maile).toHaveLength(2);
    expect(ostatniMail(f).cialo.subject).toBe('Kalibracja: propozycja zmiany stawek');
    expect(ostatniMail(f).cialo.text).toContain('GITHUB_KALIBRATOR_TOKEN');
    expect(ostatni(f).powod).toContain('mail ponowiony');
    expect(ostatni(f).powod).toContain('ostrzeżenie: token GitHuba wygasa');
  });

  test('alert o stronie: nowa awaria tuż po naprawionej dostaje własny alert', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, plik: PLIK_ZGODNY, strona: '291–351 zł',
      historia: [
        NIEDAWNY_MAIL,
        { uruchomiono: dniTemu(1), wynik: 'bez_zmian', powod: 'bez zmian', mail_wyslany: false, na_stronie: false },
        { uruchomiono: dniTemu(2), wynik: 'bez_zmian', powod: 'bez zmian', mail_wyslany: false, na_stronie: true },
        { uruchomiono: dniTemu(4), wynik: 'bez_zmian', powod: 'bez zmian | alert: strona nie pokazuje stawek z pliku', mail_wyslany: true, na_stronie: false },
      ],
    });
    await f.wywolaj();
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.text).toContain('nie pokazuje przedziału');
  });

  test('błąd przebiegu: mail nie wyszedł — ten sam błąd nazajutrz wysyła go jeszcze raz', async () => {
    const f = await zaladuj({ tryb: 'propozycja', resend: padaPierwszy, bladSql: { message: 'statement timeout' } });
    await f.wywolaj();
    expect(ostatni(f)).toMatchObject({ wynik: 'blad', mail_wyslany: false });
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
    expect(ostatni(f)).toMatchObject({ wynik: 'blad', mail_wyslany: true });
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
  });

  test('alert o stronie: mail nie wyszedł — kolejny przebieg ponawia alert', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], strona: '291–351 zł',
      resend: padaPierwszy,
    });
    await f.wywolaj();
    expect(f.maile).toHaveLength(0);
    await f.wywolaj();
    expect(f.maile, 'alert poszedł, ale Resend odmówił').toHaveLength(1);
    expect(ostatni(f).mail_wyslany).toBe(false);
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
    expect(f.maile[1].cialo.text).toContain('nie pokazuje przedziału');
    expect(ostatni(f).powod).toContain('alert: strona nie pokazuje stawek z pliku');
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
  });
});

test.describe('kalibrator: bramki — odmowa, jeden mail, drugi identyczny przebieg bez maila', () => {
  const env = { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH };
  const przypadki = [
    ['za_malo_osob', { status: 'za_malo_osob', stawka: null, okresy: null, zrodlo: { ...ZRODLO_SQL, osob: 7 }, raport: RAPORT }, 'za_malo_osob'],
    ['anomalie', {
      status: 'anomalie', stawka: null, okresy: null, zrodlo: ZRODLO_SQL,
      raport: { ...RAPORT, anomalie: [{ oferta: 'UD/2026/TT/00034/Kowalski', powod: 'rata × 12 ≠ składka' }] },
    }, 'anomalie'],
    ['dół > góra', wynikOk({ stawka: { dol: 0.03, srodek: 0.025, gora: 0.02 } }), 'dół ≤ środek ≤ góra'],
    ['dół = góra', wynikOk({ stawka: { dol: 0.022, srodek: 0.022, gora: 0.022 } }), 'niższa od górnej'],
    ['góra 0,06', wynikOk({ stawka: { gora: 0.06 } }), '≤ 0,05'],
    ['dół 0,009', wynikOk({ stawka: { dol: 0.009 } }), '0,01 ≤'],
    ['NaN', wynikOk({ stawka: { dol: NaN } }), 'stawka.dol'],
    ['stawka jako napis', wynikOk({ stawka: { gora: '0.0322' } }), 'stawka.gora'],
    ['okresy["24"] ≠ 1', wynikOk({ okresy: { 24: 1.1, 36: 1.25 } }), 'okresy["24"]'],
    ['klucz 72', wynikOk({ okresy: { 24: 1, 36: 1.25, 72: 1.6 } }), 'niedozwolony klucz'],
    ['mnożniki malejące', wynikOk({ okresy: { 24: 1, 36: 1.25, 48: 1.2 } }), 'rosnąć'],
    ['mnożnik ponad 2', wynikOk({ okresy: { 24: 1, 36: 2.5 } }), '[1; 2]'],
    ['dół pod surowym minimum', wynikOk({ stawka: { dol: 0.0201 } }), 'poniżej surowej stawki'],
    ['góra pod surowym maksimum', wynikOk({ stawka: { gora: 0.0321 } }), 'poniżej surowej stawki'],
    ['brak surowych stawek', wynikOk({ raport: { surowe: null } }), 'raport.surowe'],
  ];

  for (const [opis, wynik, fraza] of przypadki) {
    test(opis, async () => {
      const f = await zaladuj({ tryb: 'propozycja', env, wynik });
      const r = await f.wywolaj();
      expect(r.status).toBe(200);
      expect(r.dane.wynik).toBe('odmowa');
      expect(f.gh.zapisy()).toEqual([]);
      expect(f.maile).toHaveLength(1);
      expect(f.maile[0].cialo.subject).toContain('odmowa');
      expect(f.maile[0].cialo.text).toContain(fraza);
      expect(ostatni(f)).toMatchObject({ wynik: 'odmowa', mail_wyslany: true });

      await f.wywolaj();
      expect(f.maile, 'ten sam powód drugi raz — bez maila').toHaveLength(1);
      expect(f.przebiegi.map((p) => p.wynik)).toEqual(['odmowa', 'odmowa']);
      expect(ostatni(f).mail_wyslany).toBe(false);
    });
  }

  test('inny powód odmowy niż wczoraj: mail idzie', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env,
      wynik: { status: 'za_malo_osob', stawka: null, okresy: null, zrodlo: { ...ZRODLO_SQL, osob: 7 }, raport: RAPORT },
      historia: [{ uruchomiono: dniTemu(1), wynik: 'odmowa', powod: 'status za_malo_osob: 6 osób w próbie, potrzeba co najmniej 8', mail_wyslany: true }],
    });
    await f.wywolaj();
    expect(f.maile).toHaveLength(1);
  });

  test('anomalie: numer oferty bez członu z nazwiskiem, tylko w mailu', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, wynik: przypadki[1][1] });
    await f.wywolaj();
    const t = trescMaila(f.maile[0]);
    expect(t).toContain('UD/2026/TT/00034');
    expect(t).not.toContain('Kowalski');
    expect(t).toContain('rata × 12 ≠ składka');
    expect(JSON.stringify(ostatni(f).wyliczone)).not.toContain('Kowalski');
  });

  test('anomalie: numer oferty z polskimi inicjałami agenta też się pokazuje (bez nazwiska)', async () => {
    const f = await zaladuj({
      tryb: 'propozycja', env,
      wynik: { status: 'anomalie', stawka: null, okresy: null, zrodlo: ZRODLO_SQL,
        raport: { ...RAPORT, anomalie: [{ oferta: 'UD/2026/ŁŚ/00034/Młot', powod: 'rata × 12 ≠ składka' }] } },
    });
    await f.wywolaj();
    const t = trescMaila(f.maile[0]);
    expect(t).toContain('UD/2026/ŁŚ/00034');
    expect(t).not.toContain('Młot');
  });

  test('obecny plik na gałęzi produkcyjnej nie przechodzi walidatora: odmowa', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: plikJson({ stawka: { dol: 0.0202, srodek: 0.022, gora: 0.07 } }) });
    await f.wywolaj();
    expect(ostatni(f).wynik).toBe('odmowa');
    expect(f.maile[0].cialo.text).toContain('obecny plik');
    expect(f.gh.zapisy()).toEqual([]);
  });

  test('obecny plik to nie JSON: odmowa, strony nie ma z czym porównać', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: '<<<<<<< konflikt\n', strona: 'cokolwiek' });
    await f.wywolaj();
    expect(ostatni(f)).toMatchObject({ wynik: 'odmowa', na_stronie: null });
    expect(f.maile[0].cialo.text).toContain('niepoprawny JSON');
  });
});

test.describe('kalibrator: alarmy', () => {
  const env = { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH };
  const zaDni = (d) => new Date(Date.now() + d * DZIEN).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  test('token GitHuba wygasa za ≤ 30 dni: ostrzeżenie, potem nie częściej niż raz na 7 dni', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], wygasa: zaDni(12) });
    await f.wywolaj();
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.subject).toBe('Kalibracja: uwagi');
    expect(f.maile[0].cialo.text).toContain('GITHUB_KALIBRATOR_TOKEN');
    expect(f.maile[0].cialo.text).toContain('za 12 dni');
    expect(ostatni(f).powod).toContain('ostrzeżenie: token GitHuba wygasa');
    await f.wywolaj();
    expect(f.maile, 'drugie ostrzeżenie tego samego dnia').toHaveLength(1);
  });

  test('ostrzeżenie sprzed 8 dni nie blokuje kolejnego, sprzed 3 dni — blokuje', async () => {
    for (const [dni, maili] of [[8, 1], [3, 0]]) {
      const f = await zaladuj({
        tryb: 'propozycja', env, plik: PLIK_ZGODNY, wygasa: zaDni(5),
        historia: [
          NIEDAWNY_MAIL,
          { uruchomiono: dniTemu(dni), wynik: 'bez_zmian', powod: 'bez zmian | ostrzeżenie: token GitHuba wygasa', mail_wyslany: true, na_stronie: true },
        ],
      });
      await f.wywolaj();
      expect(f.maile, `ostrzeżenie sprzed ${dni} dni`).toHaveLength(maili);
    }
  });

  test('token ważny dłużej niż 30 dni: bez ostrzeżenia', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], wygasa: zaDni(45) });
    await f.wywolaj();
    expect(f.maile).toHaveLength(0);
  });

  test('w trybie na sucho ostrzeżenie jedzie w codziennym mailu', async () => {
    const f = await zaladuj({ tryb: 'na_sucho', env, wygasa: zaDni(3) });
    await f.wywolaj();
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.text).toContain('GITHUB_KALIBRATOR_TOKEN');
  });

  test('strona niezgodna z plikiem dwa przebiegi z rzędu: jeden alert', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], strona: '**Szacowana składka**\n\n291–351 zł\n' });
    await f.wywolaj();
    expect(f.maile, 'pierwszy przebieg z niezgodną stroną — jeszcze cisza').toHaveLength(0);
    await f.wywolaj();
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.text).toContain('nie pokazuje przedziału 291–464 zł');
    await f.wywolaj();
    expect(f.maile, 'alert raz, nie przy każdym kolejnym przebiegu').toHaveLength(1);
    expect(f.przebiegi.slice(1).map((p) => p.na_stronie)).toEqual([false, false, false]);
    expect(f.strony).toHaveLength(3);
  });

  test('strona zgodna: na_stronie = true, także z twardą spacją i myślnikiem', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], strona: 'składka 291 - 464 zł' });
    await f.wywolaj();
    expect(ostatni(f).na_stronie).toBe(true);
  });

  test('strona z innym przedziałem zaczynającym się tak samo: niezgodna', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env, plik: PLIK_ZGODNY, historia: [NIEDAWNY_MAIL], strona: '1 291–464 zł' });
    await f.wywolaj();
    expect(ostatni(f).na_stronie).toBe(false);
  });
});

test.describe('kalibrator: błędy', () => {
  test('wyjątek: wpis „blad", ud_errors i mail; ten sam błąd jutro — bez maila', async () => {
    const f = await zaladuj({ tryb: 'propozycja', bladSql: { message: 'canceling statement due to statement timeout' } });
    const r = await f.wywolaj();
    expect(r.status).toBe(500);
    expect(f.logi).toHaveLength(1);
    expect(f.logi[0].zrodlo).toBe('kalibrator');
    expect(f.logi[0].wiadomosc).toContain('statement timeout');
    expect(f.maile).toHaveLength(1);
    expect(f.maile[0].cialo.subject).toBe('Kalibracja: błąd przebiegu');
    expect(ostatni(f)).toMatchObject({ wynik: 'blad', tryb: 'propozycja', mail_wyslany: true });

    await f.wywolaj();
    expect(f.logi, 'ud_errors dostaje każdy błąd').toHaveLength(2);
    expect(f.maile, 'mail o tym samym błędzie nie wychodzi drugi raz').toHaveLength(1);
    expect(f.przebiegi.map((p) => p.wynik)).toEqual(['blad', 'blad']);
  });

  test('awaria API GitHuba: błąd przebiegu, nic nie jest zapisywane', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env: { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH }, awaria: 502 });
    expect((await f.wywolaj()).status).toBe(500);
    expect(ostatni(f).wynik).toBe('blad');
    expect(ostatni(f).powod).toContain('HTTP 502');
    expect(f.gh.zapisy()).toEqual([]);
  });

  test('brak wiersza ustawień: błąd, mail na adres domyślny', async () => {
    const f = await zaladuj({ ustawienia: null });
    expect((await f.wywolaj()).status).toBe(500);
    expect(f.maile[0].cialo.to).toEqual(['biuro@utratadochodu.com']);
    expect(ostatni(f)).toMatchObject({ wynik: 'blad', tryb: 'nieznany' });
  });

  test('gałąź produkcyjna ustawiona na gałąź bota: błąd, bez odczytu z GitHuba', async () => {
    const f = await zaladuj({ tryb: 'propozycja', ustawienia: { galaz: BOT }, env: { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH } });
    expect((await f.wywolaj()).status).toBe(500);
    expect(f.gh.zadania).toEqual([]);
  });

  test('limit API bez tokenu: plik czytany z raw.githubusercontent.com', async () => {
    const f = await zaladuj({ tryb: 'na_sucho', limitBezTokenu: true });
    const r = await f.wywolaj();
    expect(r.status).toBe(200);
    expect(f.gh.zadania.map((z) => new URL(z.url).hostname)).toEqual(['api.github.com', 'raw.githubusercontent.com']);
    expect(ostatni(f).wynik).toBe('na_sucho');
  });

  test('Resend: główny klucz odmawia — mail idzie zapasowym z info@', async () => {
    const f = await zaladuj({
      tryb: 'na_sucho', env: { RESEND_API_KEY: 're_zapasowy' },
      resend: (_c, n) => (n === 1 ? { ok: false, status: 403, tresc: 'domain not verified for x@example.com' } : { ok: true, status: 200 }),
    });
    await f.wywolaj();
    expect(f.maile).toHaveLength(2);
    expect(f.maile[1].cialo.from).toBe('UtrataDochodu <info@utratadochodu.pl>');
    expect(f.maile[1].naglowki.Authorization).toBe('Bearer re_zapasowy');
    expect(ostatni(f).mail_wyslany).toBe(true);
    expect(JSON.stringify(f.logi)).not.toContain('x@example.com');
  });

  test('brak kluczy Resend: przebieg zapisany, mail_wyslany = false, wpis w ud_errors', async () => {
    const f = await zaladuj({ tryb: 'na_sucho', env: { RESEND2_API_KEY: '' } });
    expect((await f.wywolaj()).status).toBe(200);
    expect(f.maile).toHaveLength(0);
    expect(ostatni(f)).toMatchObject({ wynik: 'na_sucho', mail_wyslany: false });
    expect(f.logi.map((l) => l.wiadomosc).join()).toContain('RESEND');
  });
});

test.describe('kalibrator: treść i format', () => {
  test('format pliku: kolejność kluczy, wcięcie 2 spacje, newline na końcu', async () => {
    const f = await zaladuj({ tryb: 'propozycja', env: { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH } });
    await f.wywolaj();
    const tresc = f.gh.trescNa(BOT);
    expect(tresc).toBe(oczekiwanyPlik(dzisWarszawa()));
    expect(tresc.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(tresc))).toEqual(['policzono', 'zrodlo', 'stawka', 'okresy']);
    expect(Object.keys(JSON.parse(tresc).zrodlo)).toEqual(['metoda', 'ubezpieczyciel', 'okno', 'osob', 'ofert', 'wariantow', 'par']);
  });

  test('w mailach, pull requeście, commicie i pliku nie ma uuid, PESEL-i ani nazwisk', async () => {
    // Funkcja SQL nie zwraca takich pól — ale gdyby kiedyś zwróciła, nie mają
    // jak wyjść: zrodlo idzie z białej listy, numery ofert bez ostatniego członu.
    const brudne = wynikOk({
      zrodlo: { pesel: '85010112345', klient: 'Jan Kowalski', oferta_id: '3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e' },
      raport: { anomalie: [], osoba: '85010112345' },
    });
    const f = await zaladuj({ tryb: 'propozycja', env: { GITHUB_KALIBRATOR_TOKEN: TOKEN_GH }, wynik: brudne });
    await f.wywolaj();
    const anomalie = await zaladuj({
      tryb: 'na_sucho',
      wynik: {
        status: 'anomalie', stawka: null, okresy: null, zrodlo: ZRODLO_SQL,
        raport: { ...RAPORT, anomalie: [
          { oferta: 'UD/2026/TT/00021/Kowalski-Nowak', powod: 'rata × 12 ≠ składka (85010112345, 3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e, jan@example.com)' },
        ] },
      },
    });
    await anomalie.wywolaj();
    const blad = await zaladuj({ tryb: 'propozycja', bladSql: { message: 'błąd dla 85010112345 i 3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e, jan@example.com' } });
    await blad.wywolaj();

    const github = [
      f.gh.trescNa(BOT),
      ...f.gh.pulls.flatMap((p) => [p.title, p.body]),
      // Treść pliku w base64 sprawdzamy po zdekodowaniu (pierwsza pozycja) —
      // w samym base64 ciąg cyfr między „+" a „/" wyglądałby jak PESEL.
      ...f.gh.zapisy().map((z) => JSON.stringify({ ...z.cialo, content: undefined })),
    ].join('\n');
    const maile = [...f.maile, ...anomalie.maile, ...blad.maile].map(trescMaila).join('\n');
    const dziennik = JSON.stringify([...f.przebiegi, ...anomalie.przebiegi, ...blad.przebiegi]);
    const logi = JSON.stringify(blad.logi);

    expect(f.gh.pulls).toHaveLength(1);
    expect(anomalie.maile).toHaveLength(1);
    expect(blad.maile).toHaveLength(1);
    for (const [gdzie, tresc] of [['GitHub', github], ['maile', maile], ['dziennik', dziennik], ['ud_errors', logi]]) {
      expect(tresc, `${gdzie}: uuid`).not.toMatch(UUID);
      expect(tresc, `${gdzie}: PESEL`).not.toMatch(PESEL);
      expect(tresc, `${gdzie}: nazwisko`).not.toContain('Kowalski');
      expect(tresc, `${gdzie}: e-mail`).not.toContain('jan@example.com');
    }
    // Numery ofert tylko w mailu — nigdy na GitHubie (repozytorium jest publiczne).
    expect(github).not.toContain('UD/2026');
    expect(maile).toContain('UD/2026/TT/00021');
  });

  test('wstawki w HTML maila są escape’owane', async () => {
    const f = await zaladuj({
      tryb: 'na_sucho',
      wynik: {
        status: 'anomalie', stawka: null, okresy: null, zrodlo: ZRODLO_SQL,
        raport: { ...RAPORT, anomalie: [{ oferta: 'UD/2026/TT/00021', powod: '<img src=x onerror=alert(1)>' }] },
      },
    });
    await f.wywolaj();
    const { html } = f.maile[0].cialo;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('policzono: dzisiejsza data tylko przy zmianie stawek lub okresów', async () => {
    const { ocen } = await wnetrze();
    const dzis = '2026-10-14';
    const obecny = JSON.parse(PLIK_ZGODNY);

    // Inne tylko zrodlo (nowe okno, inna próba) — bez zmiany, stara data.
    const bez = ocen(wynikOk({ zrodlo: { osob: 11 } }), obecny, dzis);
    expect(bez.bledy).toEqual([]);
    expect(bez.zmiana).toBe(false);
    expect(bez.kandydat.policzono).toBe('2026-10-01');

    for (const wynik of [wynikOk({ stawka: { gora: 0.033 } }), wynikOk({ stawka: { srodek: 0.023 } }), wynikOk({ okresy: { 24: 1, 36: 1.3 } })]) {
      const z = ocen(wynik, obecny, dzis);
      expect(z.zmiana).toBe(true);
      expect(z.kandydat.policzono).toBe(dzis);
    }
  });
});

test.describe('kalibrator: walidator pliku (ta sama reguła co sprawdzKalibracje w portalu)', () => {
  const dobry = () => ({
    policzono: '2026-10-14',
    zrodlo: { metoda: 'osoby-v1' },
    stawka: { dol: 0.0202, srodek: 0.022, gora: 0.0322 },
    okresy: { 24: 1, 36: 1.25 },
  });
  const z = (zmien) => { const k = dobry(); zmien(k); return k; };

  const PRZYPADKI = [
    ['poprawny plik', dobry(), true],
    ['granice 0,01 i 0,05', z((k) => { k.stawka = { dol: 0.01, srodek: 0.03, gora: 0.05 }; }), true],
    ['komplet okresów', z((k) => { k.okresy = { 24: 1, 36: 1.25, 48: 1.5, 60: 1.75 }; }), true],
    ['brak stawka.gora', z((k) => { delete k.stawka.gora; }), false],
    ['brak okresów', z((k) => { delete k.okresy; }), false],
    ['brak policzono', z((k) => { delete k.policzono; }), false],
    ['napis zamiast liczby', z((k) => { k.stawka.dol = '0.0202'; }), false],
    ['NaN', z((k) => { k.stawka.srodek = NaN; }), false],
    ['Infinity', z((k) => { k.stawka.gora = Infinity; }), false],
    ['dół > góra', z((k) => { k.stawka = { dol: 0.03, srodek: 0.03, gora: 0.02 }; }), false],
    ['środek poza przedziałem', z((k) => { k.stawka.srodek = 0.04; }), false],
    ['stawka powyżej 5%', z((k) => { k.stawka.gora = 0.051; }), false],
    ['stawka poniżej 1%', z((k) => { k.stawka.dol = 0.0099; }), false],
    ['okresy["24"] ≠ 1', z((k) => { k.okresy['24'] = 1.01; }), false],
    ['brak okresu 24', z((k) => { k.okresy = { 36: 1.25 }; }), false],
    ['klucz 72', z((k) => { k.okresy['72'] = 1.9; }), false],
    ['mnożnik ponad 2', z((k) => { k.okresy['36'] = 2.01; }), false],
    ['mnożniki malejące', z((k) => { k.okresy = { 24: 1, 36: 1.4, 48: 1.3 }; }), false],
    ['policzono w złym formacie', z((k) => { k.policzono = '14.10.2026'; }), false],
    ['policzono — nieistniejący dzień', z((k) => { k.policzono = '2026-02-30'; }), false],
    ['nie obiekt', [], false],
  ];

  test('przypadki z walidatora portalu', async () => {
    const { bledyKalibracji } = await wnetrze();
    for (const [opis, plik, poprawny] of PRZYPADKI) {
      expect(bledyKalibracji(plik).length === 0, opis).toBe(poprawny);
    }
  });

  test('ten sam wynik co sprawdzKalibracje() z portalu, na tych samych przypadkach', async () => {
    // Walidator stoi w dwóch miejscach (Deno nie importuje z portalu). Gdyby się
    // rozjechały, kalibrator proponowałby plik, na którym build portalu pada —
    // albo odrzucał plik, który portal przyjmuje.
    const portal = await walidatorPortalu();
    test.skip(!portal, 'symulacja.ts nie eksportuje jeszcze sprawdzKalibracje()');
    const { bledyKalibracji } = await wnetrze();
    const rozne = PRZYPADKI
      .filter(([, plik]) => (bledyKalibracji(plik).length === 0) !== portal(plik))
      .map(([opis, , poprawny]) => `${opis} (kalibrator: ${poprawny ? 'przyjmuje' : 'odrzuca'})`);
    expect(rozne, 'przypadki, w których walidatory się różnią').toEqual([]);
  });

  test('dzisiejszy plik z gałęzi produkcyjnej przechodzi walidator', async () => {
    const { bledyKalibracji } = await wnetrze();
    expect(bledyKalibracji(JSON.parse(czytaj('../apps/portal/src/lib/kalibracja.json')))).toEqual([]);
  });

  test('sprawdzenie strony rozpoznaje przedział na zbudowanej stronie kalkulatora', async () => {
    // Prawdziwy dist/kalkulator/index.md i prawdziwy kalibracja.json: gdyby portal
    // zaczął pisać przedział inaczej, kalibrator co rano alarmowałby fałszywie
    // albo — gorzej — przestałby zauważać stronę, która stawek z pliku nie pokazuje.
    const md = readFileSync(new URL('../dist/kalkulator/index.md', import.meta.url), 'utf8');
    const plik = JSON.parse(readFileSync(new URL('../src/lib/kalibracja.json', import.meta.url), 'utf8'));
    const { sprawdzStrone } = await wnetrze(async (url) => {
      expect(String(url)).toBe(STRONA);
      return new Response(md);
    });
    expect(await sprawdzStrone(plik), 'dist zbudowany ze starego kalibracja.json? — pnpm build').toBe(true);
    const inny = { ...plik, stawka: { ...plik.stawka, gora: plik.stawka.gora + 0.001 } };
    expect(await sprawdzStrone(inny)).toBe(false);
  });

  test('kwoty i procenty jak w kalkulatorze', async () => {
    const { zakres, procent } = await wnetrze();
    expect(zakres(14400, { dol: 0.0202, srodek: 0.022, gora: 0.0244 })).toBe('291–351 zł');
    expect(zakres(14400, { dol: 0.0202, srodek: 0.022, gora: 0.0322 })).toBe('291–464 zł');
    expect(zakres(11700, { dol: 0.0202, srodek: 0.022, gora: 0.0322 })).toBe('236–377 zł');
    expect(zakres(100000, { dol: 0.0202, srodek: 0.022, gora: 0.0322 })).toBe('2 020–3 220 zł');
    expect(procent(0.0202)).toBe('2,02%');
    expect(procent(0.022)).toBe('2,20%');
    expect(procent(0.03217)).toBe('3,217%');
  });
});

test.describe('kalibrator: źródło', () => {
  const zrodlo = czytaj(ZRODLO);

  test('token x-cron-token sprawdzany przed pierwszym odczytem i przed GitHubem', () => {
    const naglowek = zrodlo.indexOf('req.headers.get("x-cron-token")');
    const sprawdzenie = zrodlo.indexOf('supabase.rpc("edge_cron_token_matches"');
    const odczyty = [
      '.from("ud_kalibracja_ustawienia")',
      '.from("ud_kalibracja_przebiegi")',
      'supabase.rpc("ud_kalibracja_stawek"',
      'await pobierzPlik(',
      'await sprawdzStrone(',
    ].map((m) => [m, zrodlo.indexOf(m)]);
    expect(naglowek).toBeGreaterThan(-1);
    expect(sprawdzenie).toBeGreaterThan(naglowek);
    for (const [m, i] of odczyty) {
      expect(i, m).toBeGreaterThan(-1);
      expect(sprawdzenie, `${m} przed sprawdzeniem tokenu`).toBeLessThan(i);
    }
  });

  test('twarda lista zapisów: tylko plik kalibracji na gałęzi bota i PR z niej', async () => {
    const { zapisDozwolony } = await wnetrze();
    const ok = (m, s, c, g = GALAZ) => zapisDozwolony(m, s, c, g);
    const S = 'a'.repeat(40);
    const wpis = (zmien = {}) => ({ path: PLIK, mode: '100644', type: 'blob', content: '{}', ...zmien });
    expect(ok('GET', `/contents/${PLIK}?ref=${GALAZ}`)).toBe(true);
    expect(ok('POST', '/git/trees', { base_tree: S, tree: [wpis()] })).toBe(true);
    expect(ok('POST', '/git/commits', { message: 'm', tree: S, parents: [S] })).toBe(true);
    expect(ok('POST', '/git/refs', { ref: `refs/heads/${BOT}`, sha: S })).toBe(true);
    expect(ok('PATCH', `/git/refs/heads/${BOT}`, { sha: S, force: true })).toBe(true);
    expect(ok('POST', '/pulls', { head: BOT, base: GALAZ, title: 't', body: 'b' })).toBe(true);
    expect(ok('PATCH', '/pulls/7', { title: 't', body: 'b' })).toBe(true);

    // Drzewo: dokładnie jeden wpis — plik kalibracji, zwykły plik, treść wprost.
    expect(ok('POST', '/git/trees', { base_tree: S, tree: [wpis(), wpis({ path: 'apps/portal/src/lib/symulacja.ts' })] })).toBe(false);
    expect(ok('POST', '/git/trees', { base_tree: S, tree: [wpis({ path: 'apps/portal/src/lib/symulacja.ts' })] })).toBe(false);
    expect(ok('POST', '/git/trees', { base_tree: S, tree: [wpis({ path: `./${PLIK}` })] })).toBe(false);
    expect(ok('POST', '/git/trees', { base_tree: S, tree: [wpis({ mode: '100755' })] })).toBe(false);
    expect(ok('POST', '/git/trees', { base_tree: S, tree: [wpis({ mode: '120000' })] })).toBe(false);
    expect(ok('POST', '/git/trees', { base_tree: S, tree: [{ path: PLIK, mode: '100644', type: 'blob', sha: S }] })).toBe(false);
    expect(ok('POST', '/git/trees', { tree: [wpis()] })).toBe(false);
    expect(ok('POST', '/git/trees', { base_tree: S, tree: [] })).toBe(false);
    // Commit: jeden rodzic, bez autora i innych pól.
    expect(ok('POST', '/git/commits', { message: 'm', tree: S, parents: [S, S] })).toBe(false);
    expect(ok('POST', '/git/commits', { message: 'm', tree: S, parents: [] })).toBe(false);
    expect(ok('POST', '/git/commits', { message: 'm', tree: S, parents: [S], author: { name: 'x' } })).toBe(false);
    expect(ok('POST', '/git/commits', { message: 'm', tree: 't' })).toBe(false);
    // Referencja gałęzi bota: pełne sha, force tylko jawnie.
    expect(ok('PATCH', `/git/refs/heads/${BOT}`, { sha: 'a', force: true })).toBe(false);
    expect(ok('PATCH', `/git/refs/heads/${BOT}`, { sha: S })).toBe(false);
    expect(ok('POST', '/git/refs', { ref: `refs/heads/${BOT}`, sha: S, force: true })).toBe(false);
    // Stara droga przez Contents API jest zamknięta — zapis idzie wyłącznie przez commit.
    expect(ok('PUT', `/contents/${PLIK}`, { branch: BOT, content: 'x', sha: 'a', message: 'm' })).toBe(false);
    expect(ok('PATCH', '/pulls/7', {})).toBe(false);

    // Gałąź produkcyjna — żadnej drogi.
    expect(ok('PUT', `/contents/${PLIK}`, { branch: GALAZ, content: 'x', sha: 'a', message: 'm' })).toBe(false);
    expect(ok('PUT', `/contents/${PLIK}`, { content: 'x', sha: 'a', message: 'm' })).toBe(false);
    expect(ok('PATCH', `/git/refs/heads/${GALAZ}`, { sha: 'a', force: true })).toBe(false);
    expect(ok('POST', '/git/refs', { ref: `refs/heads/${GALAZ}`, sha: 'a' })).toBe(false);
    expect(ok('POST', '/pulls', { head: GALAZ, base: BOT, title: 't', body: 'b' })).toBe(false);
    // Inne pliki, inne operacje.
    expect(ok('PUT', '/contents/apps/portal/src/lib/symulacja.ts', { branch: BOT, content: 'x', sha: 'a', message: 'm' })).toBe(false);
    expect(ok('PUT', '/pulls/7/merge', { merge_method: 'squash' })).toBe(false);
    expect(ok('PATCH', '/pulls/7', { state: 'closed' })).toBe(false);
    expect(ok('PATCH', '/pulls/7', { base: 'main' })).toBe(false);
    expect(ok('DELETE', `/git/refs/heads/${GALAZ}`, {})).toBe(false);
    // Gałąź produkcyjna ustawiona na gałąź bota — zero zapisów.
    expect(ok('PATCH', `/git/refs/heads/${BOT}`, { sha: S, force: true }, BOT)).toBe(false);
    expect(ok('POST', '/git/trees', { base_tree: S, tree: [wpis()] }, BOT)).toBe(false);
  });

  test('decyzje właściciela: gałąź bota, plik, nadawca, odbiorca domyślny, podgląd', () => {
    expect(zrodlo).toContain('const GALAZ_BOTA = "kalibrator/propozycja"');
    expect(zrodlo).toContain('const PLIK = "apps/portal/src/lib/kalibracja.json"');
    expect(zrodlo).toContain('const NADAWCA = "UtrataDochodu.pl <noreply@utratadochodu.com>"');
    expect(zrodlo).toContain('const ODBIORCA_DOMYSLNY = "biuro@utratadochodu.com"');
    expect(zrodlo).toContain('https://kalibrator-propozycja.utratadochodu.pages.dev/kalkulator/');
    expect(zrodlo).toMatch(/verify_jwt = false/);
    // Składka netto to inna wielkość — kalibracja liczy brutto i nie woła tych funkcji.
    expect(zrodlo).not.toMatch(/ud_skladka_(mies_)?netto/);
  });
});
