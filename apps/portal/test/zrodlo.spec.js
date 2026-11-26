import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import {
  parametryZrodla, wartoscZrodlaPoprawna, zrodloZAdresu,
} from '@ud/wniosek';
import { reklama } from '../functions/kup-online/[[reszta]].js';
// Reguła „Google Ads" z panelu — jedna dla listy klientów, statystyk i licznika
// /kup-online. Czysty JS bez importów, więc da się go wziąć i stąd.
import { rodzajZrodla } from '../../panel/src/lib/zrodlo.js';

// Parser JS w trybie ES5 — z zależności Svelte'a (portal nie ma go wprost;
// nowa zależność wymagałaby instalacji). Sprawdza składnię naprawdę, nie wzorcem.
const acorn = createRequire(createRequire(import.meta.url).resolve('svelte/package.json'))('acorn');

/**
 * Źródło leada — parametry kampanii w adresie, nie w urządzeniu.
 *
 * public/zrodlo.js dokleja gclid / gbraid / wbraid / gad_* / utm_* do
 * odnośników wewnętrznych w chwili kliknięcia, kreator wysyła je do
 * form-submit jako `zrodlo` (zrodloZAdresu w @ud/wniosek, gclid tylko przy
 * zgodzie na marketing), a funkcja /kup-online zapisuje z nich `platne`,
 * `utm_campaign` i `gad_campaignid`.
 *
 * Reguły wartości stoją w czterech miejscach, których nie da się połączyć
 * importem (samodzielny skrypt, pakiet, funkcja Pages, CHECK w migracji).
 * Pierwsza część pliku sprawdza, że się zgadzają — na tabeli trudnych
 * wejść, zachowaniem, nie porównaniem tekstu. Druga — przeglądarkę: adresy
 * po kliknięciu, ciało wniosku i to, że w urządzeniu nic nie zostaje.
 */

const ZRODLO_JS = readFileSync('public/zrodlo.js', 'utf8');
const MIGRACJA = readFileSync('../../supabase/migrations/20261120100000_klikniecia_zrodlo_reklamy.sql', 'utf8');
const GCLID = 'Cj0KCQiA_gclid-TEST_123';
const REKLAMA = `?gclid=${GCLID}&utm_source=ads&utm_medium=internet&utm_campaign=jesien26&utm_term=utratadochodu`;

/* ── Uruchomienie samodzielnego skryptu poza przeglądarką ───────────────── */

/**
 * Wykonuje public/zrodlo.js w osobnym kontekście z podstawionym `location`
 * i `document`. Zwraca API (window.UDZrodlo) i zarejestrowane nasłuchy.
 */
function skrypt(search, { origin = 'https://utratadochodu.pl', kontekst = {} } = {}) {
  const sluchacze = [];
  const okno = {};
  const ctx = {
    window: okno,
    location: { search, origin, href: `${origin}/${search}` },
    document: {
      baseURI: `${origin}/`,
      addEventListener: (typ, fn, przechwytywanie) => sluchacze.push({ typ, fn, przechwytywanie }),
    },
    URL,
    URLSearchParams,
  };
  // Deskryptory, nie rozwinięcie `...`: getter, który ma rzucić w skrypcie,
  // rzuciłby już tutaj, przy kopiowaniu.
  Object.defineProperties(ctx, Object.getOwnPropertyDescriptors(kontekst));
  vm.createContext(ctx);
  vm.runInContext(ZRODLO_JS, ctx);
  return { api: ctx.window.UDZrodlo, sluchacze, ctx };
}

/** Pary [klucz, wartość], które skrypt dokleił do odnośnika na /wniosek/. */
function doklejone(search) {
  const { api } = skrypt(search);
  return [...new URL(api.adres('https://utratadochodu.pl/wniosek/')).searchParams];
}

/** Trudne wejścia — wspólne dla wszystkich kopii reguł. */
const TRUDNE = [
  '', '?', '?agent=0004', '?z=blog', '?fbclid=x&msclkid=y', '?UTM_SOURCE=ads', '?utm_id=1',
  REKLAMA,
  '?utm_source=ads&utm_medium=internet&utm_campaign=jesien26&utm_content=reklama&utm_term=utratadochodu'
    + '&gad_source=1&gad_campaignid=22334455667&gbraid=GB_1&wbraid=WB-2',
  '?gclid=abc', '?gclid=%3Cscript%3E', `?gclid=${'x'.repeat(200)}`, `?gclid=${'x'.repeat(201)}`,
  '?gclid=%20abc%20', '?gclid=a%20b', '?gclid=a.b', '?gclid=a%2Bb', '?gclid=abc&gclid=def', '?gclid=&gclid=abc',
  '?gclid=%3C&gclid=abc', '?gbraid=GB_1', '?wbraid=WB-2',
  '?gad_source=1', '?gad_source=1%202', '?gad_source=', `?gad_campaignid=${'9'.repeat(32)}`,
  `?gad_campaignid=${'9'.repeat(33)}`, '?gad_campaignid=123', "?gad_campaignid=1';--",
  `?utm_campaign=${'k'.repeat(100)}`, `?utm_campaign=${'k'.repeat(101)}`, '?utm_campaign=%20jesien26%20',
  '?utm_campaign=', '?utm_campaign=%20%20', '?utm_campaign=pierwsza&utm_campaign=druga',
  '?utm_source=a%09b', '?utm_source=a%0Ab', '?utm_source=a%7Fb', '?utm_source=a%00b', '?utm_source=a%1Fb',
  '?utm_source=a%C2%85b', '?utm_source=%EF%BB%BFads', '?utm_source=%E2%80%A9ads%E2%80%A8',
  '?utm_term=utrata+dochodu', '?utm_term=utrata%2Bdochodu', '?utm_content=%C5%BC%C3%B3%C5%82w%20%26%20s%C3%B3l',
  `?utm_campaign=${encodeURIComponent('ą'.repeat(100))}`, `?utm_campaign=${encodeURIComponent('😀'.repeat(50))}`,
  `?utm_campaign=${encodeURIComponent('😀'.repeat(51))}`, '?utm_source=%E0%A4%A', '?utm_source=%FF',
  // Kampania bez identyfikatora kliknięcia (np. wycięty przez Safari) — reguła „Google Ads" z panelu.
  '?utm_source=ads&utm_medium=internet&utm_campaign=UD_2026', '?utm_source=Google&utm_medium=CPC',
  '?utm_source=%20ads%20&utm_medium=paid%09', '?utm_source=ads&utm_medium=organic', '?utm_source=bing&utm_medium=cpc',
  '?utm_source=ads', '?utm_medium=cpc', `?utm_source=ads&utm_medium=${'c'.repeat(101)}`, '?utm_source=ads%0A&utm_medium=cpc',
  '?utm_source=adsx&utm_medium=cpc', '?utm_source=google&utm_medium=cpc&utm_source=bing',
  '?utm_source=<script>alert(1)</script>', '?utm_source=%22%3E%3Cimg%20src%3Dx%3E', '?utm_source=a#gclid=b',
  '?&&&=&=', '???gclid=abc', '?=gclid', '?gclid', '?__proto__=x&constructor=y&utm_source=ok',
];

/* ── CHECK-i z migracji jako funkcje JS (z tekstu pliku) ────────────────── */

function regulaZMigracji(wzor, opis) {
  const m = MIGRACJA.match(wzor);
  expect(m, `w migracji nie ma: ${opis}`).not.toBeNull();
  return m;
}

const checkUtm = (() => {
  const [, min, max] = regulaZMigracji(/char_length\(utm_campaign\) between (\d+) and (\d+)/, 'długość utm_campaign');
  regulaZMigracji(/utm_campaign = btrim\(utm_campaign\)/, 'utm_campaign bez odstępów na brzegach');
  const [, sterujace] = regulaZMigracji(/utm_campaign !~ '([^']+)'/, 'utm_campaign bez znaków sterujących');
  const zakazane = new RegExp(sterujace);
  // Postgres liczy znaki (punkty kodowe), btrim() bez drugiego argumentu zdejmuje tylko spacje.
  return (v) => [...v].length >= Number(min) && [...v].length <= Number(max)
    && v === v.replace(/^ +| +$/g, '') && !zakazane.test(v);
})();

const checkGad = (() => {
  const [, wzor] = regulaZMigracji(/gad_campaignid ~ '([^']+)'/, 'kształt gad_campaignid');
  return (v) => new RegExp(wzor).test(v);
})();

test.describe('jedna reguła w czterech miejscach', () => {
  test('skrypt strony dokleja dokładnie to, co pakiet uznaje za poprawne — na każdym trudnym wejściu', () => {
    for (const search of TRUDNE) {
      expect(doklejone(search), search).toEqual(parametryZrodla(search));
    }
  });

  test('funkcja /kup-online zapisuje platne, utm_campaign i gad_campaignid zgodnie z pakietem i regułą panelu', () => {
    // `platne` w liczniku = „Google Ads" w panelu (rodzajZrodla na tym, co
    // kreator wysłałby z tego adresu) — inaczej „z reklamy" na Niedokończonych
    // i „Google Ads" w Statystykach liczyłyby dwie różne rzeczy.
    let reklam = 0;
    for (const search of TRUDNE) {
      const pary = Object.fromEntries(parametryZrodla(search));
      const oczekiwane = { platne: rodzajZrodla(zrodloZAdresu(search, false)).klucz === 'ads' };
      if (oczekiwane.platne) reklam += 1;
      if (pary.utm_campaign !== undefined) oczekiwane.utm_campaign = pary.utm_campaign;
      if (pary.gad_campaignid !== undefined) oczekiwane.gad_campaignid = pary.gad_campaignid;
      expect(reklama(new URL(`https://utratadochodu.pl/kup-online${search}`).searchParams), search).toEqual(oczekiwane);
    }
    expect(reklam, 'tabela bez przypadków „z reklamy" nic nie sprawdza').toBeGreaterThan(10);
  });

  test('CHECK w migracji przepuszcza każdą wartość, którą zapisze funkcja, i nie jest pozorny', () => {
    for (const search of TRUDNE) {
      const wiersz = reklama(new URL(`https://utratadochodu.pl/kup-online${search}`).searchParams);
      if (wiersz.utm_campaign !== undefined) expect(checkUtm(wiersz.utm_campaign), search).toBe(true);
      if (wiersz.gad_campaignid !== undefined) expect(checkGad(wiersz.gad_campaignid), search).toBe(true);
    }
    // gad_campaignid: ten sam wzorzec w obie strony.
    for (const v of ['1', '22334455667', '9'.repeat(32), '9'.repeat(33), '', '1 2', "1';--", 'a_b-C', 'ą']) {
      expect(checkGad(v), v).toBe(wartoscZrodlaPoprawna('gad_campaignid', v));
    }
    // CHECK nie przepuszcza tego, czego funkcja nigdy nie zapisze.
    for (const zle of ['', ' a', 'a ', 'k'.repeat(101), 'a\tb', 'a\nb', 'a\u007Fb', 'a\u0001b']) {
      expect(checkUtm(zle), JSON.stringify(zle)).toBe(false);
    }
    // `platne` bez wartości domyślnej i z NULL-em: kliknięcia sprzed pomiaru to NULL, nie false
    // (false wyglądałoby w panelu jak „z reklamy: 0").
    expect(MIGRACJA).toMatch(/add column if not exists platne boolean,/);
    expect(MIGRACJA).not.toMatch(/platne boolean (not null|default)/);
    expect(MIGRACJA).toMatch(/add column if not exists utm_campaign text,/);
    expect(MIGRACJA).toMatch(/add column if not exists gad_campaignid text;/);
  });

  test('migracja: z_reklamy i zmierzonych na końcu widoku i wyniku funkcji, uprawnienia jak dotąd', () => {
    expect(MIGRACJA).toMatch(/count\(\*\)::int as klikniec,\s*\(count\(\*\) filter \(where platne\)\)::int as z_reklamy,\s*count\(platne\)::int as zmierzonych\s*from public\.ud_klikniecia/);
    expect(MIGRACJA).toContain('drop function if exists public.ud_klikniecia_tabela(date, int);');
    expect(MIGRACJA).toContain('returns table (tydzien date, zrodlo text, klikniec int, miejsc_wszystkich int, z_reklamy int, zmierzonych int)');
    expect(MIGRACJA).toMatch(/security invoker\s+set search_path = ''/);
    expect(MIGRACJA).toContain('revoke all on function public.ud_klikniecia_tabela(date, int) from public, anon, authenticated;');
    expect(MIGRACJA).toContain('grant execute on function public.ud_klikniecia_tabela(date, int) to service_role;');
    expect(MIGRACJA).toContain('with (security_invoker = true)');
    // Identyfikatora kliknięcia ani adresu IP w tabeli nie ma i nie będzie.
    expect(MIGRACJA).not.toMatch(/add column[^;]*\b(gclid|gbraid|wbraid|ip|user_agent)\b/i);
  });
});

/* ── Samodzielny skrypt: zachowanie bez przeglądarki ────────────────────── */

test.describe('public/zrodlo.js poza przeglądarką', () => {
  const STRONA = 'https://utratadochodu.pl';

  test('bez parametrów nie słucha kliknięć, a adres() oddaje wejście bez zmian', () => {
    for (const search of ['', '?agent=7', '?gclid=%3C']) {
      const { api, sluchacze } = skrypt(search);
      expect(sluchacze, search).toEqual([]);
      expect(api.adres('/wniosek/')).toBe('/wniosek/');
    }
  });

  test('z parametrami: click i auxclick w fazie przechwytywania', () => {
    const { sluchacze } = skrypt(REKLAMA);
    expect(sluchacze.map((s) => [s.typ, s.przechwytywanie])).toEqual([['click', true], ['auxclick', true]]);
  });

  test('adres(): co dekoruje, czego nie rusza', () => {
    const { api } = skrypt(REKLAMA);
    const dopisek = `gclid=${GCLID}&utm_source=ads&utm_medium=internet&utm_campaign=jesien26&utm_term=utratadochodu`;
    expect(api.adres('/wniosek/')).toBe(`${STRONA}/wniosek/?${dopisek}`);
    expect(api.adres('/kup-online?z=blog')).toBe(`${STRONA}/kup-online?z=blog&${dopisek}`);
    // Parametry odnośnika zostają bajt w bajt, fragment też; istniejących nie nadpisujemy.
    expect(api.adres('/kalkulator/?dochod=12500&zawod=Lekarz%20rodzinny#odkladanie'))
      .toBe(`${STRONA}/kalkulator/?dochod=12500&zawod=Lekarz%20rodzinny&${dopisek}#odkladanie`);
    expect(api.adres('/wniosek/?agent=0004&utm_campaign=z-linku'))
      .toBe(`${STRONA}/wniosek/?agent=0004&utm_campaign=z-linku&gclid=${GCLID}&utm_source=ads&utm_medium=internet&utm_term=utratadochodu`);
    expect(api.adres('/wniosek/?')).toBe(`${STRONA}/wniosek/?${dopisek}`);
    // Odnośnik, który ma już wszystko, zostaje jak był.
    expect(api.adres(`/wniosek/?${dopisek}`)).toBe(`/wniosek/?${dopisek}`);

    for (const nietykalny of [
      'https://example.com/wniosek/', 'http://utratadochodu.pl/wniosek/', '//example.com/x', 'mailto:info@utratadochodu.pl',
      'tel:+48504400901', 'javascript:void(0)', 'data:text/html,x', '#', '#odkladanie', '  #kotwica',
      '/owu/leadenhall-utrata-dochodu.pdf', '/owu/', '/media/a-cover-800.webp', '/pobierz/12',
      '/podziekowanie/', '/podziekowanie', '/index.md', '/wniosek/index.md', '/llms.txt', '/blog/rss.xml',
      '/sitemap-index.xml', '/owu-adresy.json', '/og-domyslny.jpg', '/favicon.svg', '/zrodlo.js', '/plik.ZIP',
      '', 'http://[::1', 123, null, undefined,
    ]) {
      expect(api.adres(nietykalny), String(nietykalny)).toBe(nietykalny);
    }
  });

  test('obsługa kliknięcia: dekoruje <a href>, pomija download, prawy przycisk i dziwne cele — bez wyjątku', () => {
    const { sluchacze } = skrypt(REKLAMA);
    const [klik, aux] = [sluchacze[0].fn, sluchacze[1].fn];
    const odnosnik = (href, { download = false } = {}) => {
      const a = {
        nodeType: 1, href,
        hasAttribute: (n) => n === 'download' && download,
        getAttribute: () => a.href,
        setAttribute: (n, v) => { if (n === 'href') a.href = v; },
      };
      return a;
    };
    const cel = (a) => ({ nodeType: 1, closest: (s) => (s === 'a[href]' ? a : null) });

    const zwykly = odnosnik('/wniosek/');
    klik({ target: cel(zwykly) });
    expect(zwykly.href).toContain(`gclid=${GCLID}`);

    // Kliknięty węzeł tekstowy — liczy się jego rodzic.
    const wTekscie = odnosnik('/kalkulator/');
    klik({ target: { nodeType: 3, parentElement: cel(wTekscie) } });
    expect(wTekscie.href).toContain('utm_campaign=jesien26');

    const doPobrania = odnosnik('/wniosek/', { download: true });
    klik({ target: cel(doPobrania) });
    expect(doPobrania.href).toBe('/wniosek/');

    const srodkowy = odnosnik('/wniosek/');
    aux({ button: 1, target: cel(srodkowy) });
    expect(srodkowy.href).toContain('utm_source=ads');

    const prawy = odnosnik('/wniosek/');
    aux({ button: 2, target: cel(prawy) });
    expect(prawy.href, 'prawy przycisk („Kopiuj adres linku") nie może wynosić gclid').toBe('/wniosek/');

    for (const dziwne of [
      undefined, null, {}, { target: null }, { target: { nodeType: 3, parentElement: null } },
      { target: { nodeType: 9 } }, { target: { nodeType: 1, closest: () => { throw new Error('x'); } } },
      { target: cel(odnosnik('http://[::1')) }, { target: cel({ nodeType: 1, hasAttribute: () => { throw new Error('y'); } }) },
    ]) {
      expect(() => klik(dziwne)).not.toThrow();
      expect(() => aux(dziwne)).not.toThrow();
    }
  });

  test('wrogie środowisko: skrypt nigdy nie rzuca, a window.UDZrodlo zawsze jest', () => {
    const wrogie = {
      'brak URL i URLSearchParams': { URL: undefined, URLSearchParams: undefined },
      'location rzuca': { get location() { throw new Error('zablokowane'); } },
      'addEventListener rzuca': { document: { baseURI: 'https://utratadochodu.pl/', addEventListener() { throw new Error('x'); } } },
      'brak document': { document: undefined },
      'search nie jest tekstem': { location: { search: 42, origin: 'https://utratadochodu.pl' } },
    };
    for (const [nazwa, kontekst] of Object.entries(wrogie)) {
      let wynik;
      expect(() => { wynik = skrypt(REKLAMA, { kontekst }); }, nazwa).not.toThrow();
      expect(typeof wynik.api?.adres, nazwa).toBe('function');
      expect(() => wynik.api.adres('/wniosek/'), nazwa).not.toThrow();
    }
    // Zamrożone okno: przypisanie UDZrodlo rzuciłoby w trybie ścisłym.
    expect(() => skrypt(REKLAMA, { kontekst: { window: Object.freeze({}) } })).not.toThrow();
  });

  test('skrypt niczego nie zapisuje w urządzeniu i jest w ES5 (błąd składni byłby nie do złapania)', () => {
    const kod = ZRODLO_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    expect(kod).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|cookieStore/);
    // Składnia sprawdzana parserem w trybie ES5, nie wzorcem: wzorzec przepuszczał
    // `?.`, `??`, metody skrócone, spread, destrukturyzację, parametry domyślne
    // i for…of — a SyntaxError w starej przeglądarce to okno awarii na każdej stronie.
    expect(() => acorn.parse(ZRODLO_JS, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
    // Strażnik nie jest pozorny: każda z tych konstrukcji w ES5 się nie parsuje.
    for (const nowsze of ['a?.b', 'a ?? b', 'var o = { f(x) {} };', 'f(...a);', 'var [a] = b;', 'function f(a = 1) {}',
      'for (var x of y) {}', 'var f = () => 1;', 'let a = 1;', 'const a = 1;', 'class A {}', 'var s = `x`;']) {
      expect(() => acorn.parse(nowsze, { ecmaVersion: 5, sourceType: 'script' }), nowsze).toThrow();
    }
    expect(kod.trim().startsWith('(function () {')).toBe(true);
  });

  test('ładuje go każda strona, zaraz po zgody.js, z defer; statyk poza funkcjami', () => {
    const html = readFileSync('dist/index.html', 'utf8');
    expect(html).toMatch(/<script src="\/zgody\.js"><\/script><script src="\/zrodlo\.js" defer><\/script>/);
    for (const strona of ['wniosek/index.html', 'kalkulator/index.html', 'blog/index.html', '404.html']) {
      expect(readFileSync(`dist/${strona}`, 'utf8'), strona).toContain('<script src="/zrodlo.js" defer></script>');
      // <meta charset> nadal w pierwszym kilobajcie.
      const bajty = readFileSync(`dist/${strona}`);
      expect(bajty.indexOf('<meta charset'), strona).toBeGreaterThanOrEqual(0);
      expect(bajty.indexOf('<meta charset'), strona).toBeLessThan(1024);
    }
    expect(readFileSync('dist/zrodlo.js', 'utf8')).toBe(ZRODLO_JS);
    expect(JSON.parse(readFileSync('public/_routes.json', 'utf8')).exclude).toContain('/zrodlo.js');
    // CSP: skrypty z 'self' — zrodlo.js nie potrzebuje żadnego nowego hosta.
    expect(readFileSync('public/_headers', 'utf8')).toMatch(/script-src 'self'/);
  });
});

/* ── Przeglądarka ───────────────────────────────────────────────────────── */

const ATRAPA_TURNSTILE = 'window.turnstile={render:function(){return "w1"},getResponse:function(){return "token-testowy"},'
  + 'reset:function(){},remove:function(){}};window.onloadTurnstileCallback&&window.onloadTurnstileCallback();';
const ID_SZKICU = '22222222-2222-4222-8222-222222222222';
const PESEL = '90010112349';

/**
 * Wspólne atrapy: Turnstile przez page.route (nie addInitScript — CLAUDE.md),
 * tagi Google i Meta jako puste skrypty (nic nie wychodzi z sandboksa), szkic
 * odpowiada jak funkcja, /kup-online (funkcja Pages, serwer testowy jej nie ma)
 * — zwykłą stroną. Zbiera błędy skryptów strony.
 */
async function przygotuj(page) {
  const bledy = [];
  page.on('pageerror', (e) => bledy.push(String(e?.stack ?? e)));
  const ctx = page.context();
  await ctx.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (r) => r.fulfill({
    contentType: 'application/javascript', body: ATRAPA_TURNSTILE,
  }));
  await ctx.route(/googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|doubleclick\.net|googleadservices\.com/,
    (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  const szkice = [];
  await ctx.route('**/functions/v1/wniosek-szkic', async (r) => {
    szkice.push(r.request().postDataJSON());
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', id: ID_SZKICU }) });
  });
  const kupOnline = [];
  await ctx.route(/\/kup-online(\?|$)/, async (r) => {
    kupOnline.push(r.request().url());
    await r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>kup</title>' });
  });
  return { bledy, szkice, kupOnline };
}

/** Na koniec: żadnego błędu skryptu i żadnego okienka awarii. */
async function bezAwarii(page, bledy) {
  expect(bledy, 'błąd skryptu na stronie (awaria.js pokazałby okienko)').toEqual([]);
  expect(await page.locator('#ud-awaria').count()).toBe(0);
}

/** Wstawia na górę strony odnośniki testowe, ponad banerem zgód. */
async function wstaw(page, odnosniki) {
  await page.evaluate((lista) => {
    const box = document.createElement('div');
    box.id = 'test-linki';
    box.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483600;background:#fff;display:flex;flex-wrap:wrap;gap:8px;padding:8px';
    for (const [id, href, atrybuty] of lista) {
      const a = document.createElement('a');
      a.id = id;
      if (href !== null) a.setAttribute('href', href);
      for (const [k, v] of Object.entries(atrybuty ?? {})) a.setAttribute(k, v);
      a.textContent = id;
      box.appendChild(a);
    }
    document.body.prepend(box);
  }, odnosniki);
}

const parametry = (adres) => Object.fromEntries(new URL(adres).searchParams);

test.describe('w przeglądarce', () => {
  test('wejście z reklamy → klik w „Policz składkę” w nagłówku → /wniosek/ niesie parametry', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/${REKLAMA}`);
    await page.locator('header a[href="/wniosek/"]').click();
    await page.waitForURL('**/wniosek/**');
    expect(parametry(page.url())).toEqual({
      gclid: GCLID, utm_source: 'ads', utm_medium: 'internet', utm_campaign: 'jesien26', utm_term: 'utratadochodu',
    });
    // I dalej: z wniosku na kalkulator parametry jadą kolejny raz.
    await page.locator('header a[href="/kalkulator/"]').first().click();
    await page.waitForURL('**/kalkulator/**');
    expect(parametry(page.url())).toMatchObject({ gclid: GCLID, utm_campaign: 'jesien26' });
    await bezAwarii(page, bledy);
  });

  test('odnośnik dodany po wczytaniu (jak z wyspy Svelte): dekorowany, ?dochod= i #fragment zostają', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/o-nas/${REKLAMA}`);
    // Nic nie przepisuje DOM-u przy wczytaniu: odnośniki strony są czyste.
    const zParametrami = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
      .filter((a) => /gclid|utm_/.test(a.getAttribute('href'))).length);
    expect(zParametrami).toBe(0);

    await wstaw(page, [['pozniej', '/kalkulator/?dochod=12500#odkladanie']]);
    await page.click('#pozniej');
    await page.waitForURL('**/kalkulator/**');
    const u = new URL(page.url());
    expect(u.hash).toBe('#odkladanie');
    expect(u.searchParams.get('dochod')).toBe('12500');
    expect(u.searchParams.get('gclid')).toBe(GCLID);
    expect(u.search.startsWith('?dochod=12500&')).toBe(true);
    await bezAwarii(page, bledy);
  });

  test('?agent= i parametr, który odnośnik już ma, nie są nadpisywane', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/${REKLAMA}`);
    await wstaw(page, [['agent', '/wniosek/?agent=0004&utm_campaign=z-linku']]);
    await page.click('#agent');
    await page.waitForURL('**/wniosek/**');
    const p = new URL(page.url()).searchParams;
    expect(p.get('agent')).toBe('0004');
    expect(p.getAll('utm_campaign')).toEqual(['z-linku']);
    expect(p.get('gclid')).toBe(GCLID);
    expect(p.get('utm_source')).toBe('ads');
    await bezAwarii(page, bledy);
  });

  test('niepoprawna wartość odpada, poprawne jadą dalej', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/?gclid=%3Cscript%3E&utm_campaign=${'k'.repeat(101)}&utm_source=ads&gbraid=GB_1&utm_medium=a%09b`);
    await page.locator('header a[href="/wniosek/"]').click();
    await page.waitForURL('**/wniosek/**');
    expect(parametry(page.url())).toEqual({ gbraid: 'GB_1', utm_source: 'ads' });
    await bezAwarii(page, bledy);
  });

  test('obce, mailto:, tel:, #, /owu/…pdf, /index.md, download i /podziekowanie/ zostają nietknięte', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/o-nas/${REKLAMA}`);
    const nietykalne = [
      ['obcy', 'https://example.com/wniosek/'], ['mail', 'mailto:info@utratadochodu.pl'], ['tel', 'tel:+48504400901'],
      ['kotwica', '#tresc'], ['owu', '/owu/leadenhall-utrata-dochodu.pdf'], ['md', '/index.md'],
      ['pobierz', '/wniosek/', { download: '' }], ['dzieki', '/podziekowanie/'], ['media', '/media/x-cover-800.webp'],
      ['zly', 'http://[::1'],
    ];
    await wstaw(page, [...nietykalne, ['kontrolny', '/wniosek/']]);
    // Każde kliknięcie zatrzymujemy na samym odnośniku: skrypt (faza przechwytywania
    // na document) zdąży zadziałać, a strona zostaje.
    await page.evaluate(() => document.querySelectorAll('#test-linki a')
      .forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
    for (const [id, href] of nietykalne) {
      await page.click(`#${id}`);
      expect(await page.getAttribute(`#${id}`, 'href'), id).toBe(href);
    }
    await page.click('#kontrolny');
    expect(await page.getAttribute('#kontrolny', 'href'), 'odnośnik kontrolny nie został udekorowany — test jest pozorny')
      .toContain(`gclid=${GCLID}`);
    await bezAwarii(page, bledy);
  });

  test('środkowy przycisk (auxclick) dekoruje i nowa karta dostaje parametry; prawy — nie', async ({ page, context }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/o-nas/${REKLAMA}`);
    await wstaw(page, [['srodkowy', '/kalkulator/'], ['prawy', '/wniosek/']]);
    const [karta] = await Promise.all([
      context.waitForEvent('page'),
      page.click('#srodkowy', { button: 'middle' }),
    ]);
    await karta.waitForLoadState('domcontentloaded');
    expect(new URL(karta.url()).pathname).toBe('/kalkulator/');
    expect(parametry(karta.url())).toMatchObject({ gclid: GCLID, utm_campaign: 'jesien26' });
    await karta.close();

    await page.click('#prawy', { button: 'right' });
    expect(await page.getAttribute('#prawy', 'href')).toBe('/wniosek/');
    await bezAwarii(page, bledy);
  });

  test('odnośnik /kup-online w nowej karcie dostaje parametry (funkcja zapisze z nich „z reklamy”)', async ({ page, context }) => {
    const { bledy, kupOnline } = await przygotuj(page);
    await page.goto(`/wniosek/${REKLAMA}&gad_campaignid=123`);
    await wstaw(page, [['kup', '/kup-online?z=test', { target: '_blank', rel: 'noopener nofollow' }]]);
    const [karta] = await Promise.all([context.waitForEvent('page'), page.click('#kup')]);
    await karta.waitForLoadState('domcontentloaded');
    expect(kupOnline).toHaveLength(1);
    const p = parametry(kupOnline[0]);
    expect(p).toMatchObject({ z: 'test', gclid: GCLID, utm_campaign: 'jesien26', gad_campaignid: '123' });
    expect(kupOnline[0].indexOf('z=test')).toBeLessThan(kupOnline[0].indexOf('gclid='));
    await bezAwarii(page, bledy);
  });

  test('window.UDZrodlo.adres() — z parametrami i bez', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/${REKLAMA}`);
    const wynik = await page.evaluate(() => ({
      wniosek: window.UDZrodlo.adres('/wniosek/'),
      kotwica: window.UDZrodlo.adres('/kalkulator/?dochod=1#odkladanie'),
      obcy: window.UDZrodlo.adres('https://example.com/'),
      pdf: window.UDZrodlo.adres('/owu/a.pdf'),
      liczba: window.UDZrodlo.adres(5),
    }));
    expect(parametry(wynik.wniosek)).toMatchObject({ gclid: GCLID, utm_term: 'utratadochodu' });
    expect(wynik.kotwica).toMatch(/\?dochod=1&gclid=.*#odkladanie$/);
    expect(wynik).toMatchObject({ obcy: 'https://example.com/', pdf: '/owu/a.pdf', liczba: 5 });

    await page.goto('/');
    expect(await page.evaluate(() => window.UDZrodlo.adres('/wniosek/'))).toBe('/wniosek/');
    await bezAwarii(page, bledy);
  });

  test('w urządzeniu nic nie zostaje: bez nowych kluczy w localStorage, sessionStorage i bez ciasteczek', async ({ page, context }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/${REKLAMA}`);
    const przed = await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]);
    await wstaw(page, [['a', '/wniosek/'], ['b', '/kalkulator/']]);
    await page.evaluate(() => document.querySelectorAll('#test-linki a')
      .forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
    await page.click('#a');
    await page.click('#b', { button: 'middle' }).catch(() => {});
    await page.evaluate(() => window.UDZrodlo.adres('/wniosek/'));
    expect(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)])).toEqual(przed);

    // Przez kilka stron: dozwolone są tylko istniejące klucze serwisu.
    await page.locator('header a[href="/wniosek/"]').click();
    await page.waitForURL('**/wniosek/**');
    await page.locator('header a[href="/kalkulator/"]').first().click();
    await page.waitForURL('**/kalkulator/**');
    const [lokalne, sesyjne, ciastka] = await page.evaluate(() => [
      Object.keys(localStorage), Object.keys(sessionStorage), document.cookie,
    ]);
    expect(lokalne.filter((k) => k !== 'ud_zgody')).toEqual([]);
    expect(sesyjne.filter((k) => k !== 'ud:wniosek')).toEqual([]);
    expect(ciastka).toBe('');
    expect(await context.cookies()).toEqual([]);
    await bezAwarii(page, bledy);
  });
});

/* ── Kreator: zrodlo w ciele żądania do form-submit ─────────────────────── */

test.describe('kreator wysyła źródło', () => {
  /** Wypełnia kreator na bieżącej stronie /wniosek/ i zwraca ciało żądania do form-submit. */
  async function wyslijWniosek(page) {
    const wnioski = [];
    await page.context().route('**/functions/v1/form-submit', async (r) => {
      wnioski.push(r.request().postDataJSON());
      await r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
    });
    await expect(page.locator('input[name="fullName"]')).toBeVisible();
    await page.fill('input[name="fullName"]', 'Jan Kowalski');
    await page.fill('input[name="email"]', 'jan@example.com');
    await page.fill('input[name="phone"]', '504400901');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await page.fill('input[name="profession"]', 'Lekarz');
    await page.fill('input[name="pesel"]', PESEL);
    await page.getByRole('button', { name: 'Dalej' }).click();
    await page.fill('input[name="tempIncapacitySum"]', '10000');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.locator('input[name="med_heart"][value="no"]')).toBeVisible();
    await page.getByRole('button', { name: 'Dalej' }).click();
    await page.check('input[name="exclusions_accepted"]');
    await page.check('input[name="informedAccepted"]');
    await page.getByRole('button', { name: 'Wyślij wniosek' }).click();
    await page.waitForURL('**/podziekowanie/');
    expect(wnioski).toHaveLength(1);
    return wnioski[0];
  }

  test('bez zgody na marketing: zrodlo z UTM-ami i platne, ale BEZ gclid', async ({ page }) => {
    const { bledy, szkice } = await przygotuj(page);
    await page.goto(`/${REKLAMA}&gad_source=1&gad_campaignid=22334455667`);
    await page.getByRole('button', { name: 'Odrzucam wszystkie' }).click();
    await page.locator('header a[href="/wniosek/"]').click();
    await page.waitForURL('**/wniosek/**');

    const wniosek = await wyslijWniosek(page);
    expect(wniosek.zrodlo).toEqual({
      gad_source: '1', gad_campaignid: '22334455667',
      utm_source: 'ads', utm_medium: 'internet', utm_campaign: 'jesien26', utm_term: 'utratadochodu',
      platne: true, zgoda_marketing: false,
    });
    expect(JSON.stringify(wniosek), 'identyfikator kliknięcia bez zgody').not.toContain(GCLID);
    expect(wniosek.pesel).toBe(PESEL);                         // reszta wniosku bez zmian
    expect(wniosek['cf-turnstile-response']).toBe('token-testowy');
    // Szkic źródła nie dostaje.
    expect(JSON.stringify(szkice)).not.toMatch(/zrodlo|gclid|utm_|jesien26/);
    // Przekierowanie po wysyłce idzie bez parametrów, a w sesji jest tylko znacznik wniosku.
    expect(new URL(page.url()).search).toBe('');
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual(['ud:wniosek']);
    await bezAwarii(page, bledy);
  });

  test('ze zgodą na marketing (baner „Akceptuję wszystkie”): gclid w zrodlo', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/${REKLAMA}`);
    await page.getByRole('button', { name: 'Akceptuję wszystkie' }).click();
    expect(await page.evaluate(() => window.UDCookies.stan().marketing)).toBe(true);
    await page.locator('header a[href="/wniosek/"]').click();
    await page.waitForURL('**/wniosek/**');

    const wniosek = await wyslijWniosek(page);
    expect(wniosek.zrodlo).toEqual({
      utm_source: 'ads', utm_medium: 'internet', utm_campaign: 'jesien26', utm_term: 'utratadochodu',
      platne: true, zgoda_marketing: true, gclid: GCLID,
    });
    await bezAwarii(page, bledy);
  });

  test('zgoda zapisana wcześniej (ud_zgody w localStorage), wejście wprost na /wniosek/ z reklamy', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.addInitScript(() => {
      localStorage.setItem('ud_zgody', JSON.stringify({ wersja: 2, analityka: false, marketing: true, data: new Date().toISOString() }));
    });
    await page.goto(`/wniosek/?gbraid=GB_1&utm_campaign=jesien26`);
    const wniosek = await wyslijWniosek(page);
    expect(wniosek.zrodlo).toEqual({ utm_campaign: 'jesien26', platne: true, zgoda_marketing: true, gbraid: 'GB_1' });
    await bezAwarii(page, bledy);
  });

  test('bez parametrów w adresie: ciało wniosku nie ma klucza zrodlo', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.goto('/wniosek/?agent=0004');
    const wniosek = await wyslijWniosek(page);
    expect(wniosek).not.toHaveProperty('zrodlo');
    expect(wniosek.affiliateCode).toBe('0004');
    await bezAwarii(page, bledy);
  });

  test('zepsute UDCookies nie zatrzymuje wniosku — idzie bez gclid', async ({ page }) => {
    const { bledy } = await przygotuj(page);
    await page.goto(`/wniosek/${REKLAMA}`);
    await page.evaluate(() => { window.UDCookies = { stan() { throw new Error('zepsute'); } }; });
    const wniosek = await wyslijWniosek(page);
    // zrodloWizyty() łapie wyjątek — wniosek idzie bez źródła, ale idzie.
    expect(wniosek).not.toHaveProperty('zrodlo');
    expect(wniosek.pesel).toBe(PESEL);
    await bezAwarii(page, bledy);
  });
});
