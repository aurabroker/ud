/**
 * Serwer testów przeglądarkowych tablicy leadów.
 *
 * Jeden proces: jednorazowy klaster Postgresa z migracjami i danymi testowymi
 * + serwer Vite z PRAWDZIWYMI komponentami Svelte + endpointy API, które wołają
 * te same funkcje serwerowe co trasy SvelteKita (src/lib/server/leady.js) na
 * prawdziwych funkcjach SQL. Zastąpione jest tylko to, czego tu nie ma:
 * sesja (nagłówek x-test-user zamiast ciasteczka Supabase) i transport do
 * bazy (psql zamiast PostgREST).
 *
 * Do testów służą też trzy ścieżki pomocnicze /__test/*: reset danych,
 * wstrzykiwanie awarii sieci (zgubiona odpowiedź, 502) i dowolne SQL do
 * asercji oraz do symulacji „innej osoby" zmieniającej lead.
 */
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { uruchomKlaster, wczytaj } from '../../scripts/lib/pg-tymczasowy.mjs';
import {
  BladApi, adresPliku, dodajPolise, notatka, odczytajPoliseNowa, odczytajWgranaPolise, odpowiedzKolumny, odpowiedzLicznikow,
  odpowiedzSzczegolow, odpowiedzWariantow, polisy, przetworz, statystyki, statystykiZrodel, synchronizuj, uzupelnijZPolisy, wczytajTablice,
  wgrajPolise, zmien, zwin,
} from '../../src/lib/server/leady.js';
import { liczNiedokonczone } from '../../src/lib/server/niedokonczone.js';
import { kartaKlienta, listaKlientow } from '../../src/lib/server/klienci.js';
import { filtryListy } from '../../src/lib/klienci/lista.js';

const panel = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const UZYTKOWNICY = {
  adm: 'a0000000-0000-0000-0000-0000000000a1',
  ula: 'a0000000-0000-0000-0000-0000000000a2',
  olek: 'a0000000-0000-0000-0000-0000000000a3',
  ines: 'a0000000-0000-0000-0000-0000000000a4',
};

export async function startuj() {
  const klaster = await uruchomKlaster({ dodatkowe: ['pomocnicze.sql', 'karta-klienta-stub.sql'] });
  const fixture = wczytaj('supabase/tests/fixture-ui.sql');
  const sql = (q) => {
    const r = klaster.psql(q);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const reset = () => {
    sql(`truncate public.ud_leady_widok_uzytkownika, public.ud_leady_notatki, public.ud_leady_historia, public.ud_leady,
                  public.ud_offers, public.ud_wnioski_szkice, public.ud_clients, public.ud_user_profiles restart identity cascade;
         delete from public.ud_leady_etap where pipeline_id in (select id from public.ud_leady_pipeline where klucz <> 'sprzedaz');
         delete from public.ud_leady_pipeline where klucz <> 'sprzedaz';
         update public.ud_leady_etap set aktywny = (klucz <> 'kontakt');`);
    wywolania.length = 0;
    magazyn.clear();
    sql(fixture);
    awarie.length = 0;
  };

  // ── Transport: rpc jak w PostgREST (nazwane argumenty, typy z sygnatury) ──
  const sygnatury = new Map();
  const sygnatura = (nazwa) => {
    if (!sygnatury.has(nazwa)) {
      const w = sql(`select coalesce(json_build_object('zbior', p.proretset, 'argumenty',
          (select coalesce(json_agg(json_build_object('n', n, 't', format_type(t, null)) order by o), '[]')
             from unnest((p.proargnames)[1:p.pronargs], p.proargtypes::oid[]) with ordinality as x(n, t, o)))::text, '')
        from pg_proc p where p.proname = '${nazwa}' and p.pronamespace = 'public'::regnamespace`);
      sygnatury.set(nazwa, w ? JSON.parse(w) : null);
    }
    return sygnatury.get(nazwa);
  };
  const literal = (v) => { const z = `$j${randomBytes(4).toString('hex')}$`; return `${z}${JSON.stringify(v)}${z}`; };
  const sb = {
    async rpc(nazwa, argumenty = {}) {
      const sig = sygnatura(nazwa);
      const nazwy = (sig?.argumenty ?? []).map((a) => a.n);
      if (!sig || Object.keys(argumenty).some((k) => !nazwy.includes(k))) {
        return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nazwa}` } };
      }
      const lista = Object.entries(argumenty).map(([k, v]) => {
        const typ = sig.argumenty.find((a) => a.n === k).t;
        if (v === null || v === undefined) return `${k} => null::${typ}`;
        return typ === 'jsonb' ? `${k} => ${literal(v)}::jsonb` : `${k} => (${literal(v)}::jsonb #>> '{}')::${typ}`;
      }).join(', ');
      const zapytanie = sig.zbior
        ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.${nazwa}(${lista}) t`
        : `select to_jsonb(public.${nazwa}(${lista}))`;
      const r = klaster.psql(`\\set VERBOSITY verbose\n${zapytanie}`);
      if (r.status !== 0) {
        const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(r.stderr);
        return { data: null, error: { code: m?.[1] ?? 'XX000', message: m?.[2] ?? r.stderr } };
      }
      return { data: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null, error: null };
    },
  };
  // Lista kolumn z .select() jak w PostgREST: 'a, b', 'alias:kol->klucz',
  // 'kol->>klucz', '*'. Wykonywana naprawdę — brakująca kolumna to błąd, jak na
  // produkcji, a zapytanie, które ma czytać tylko `form_data->zrodlo`, nie dostaje
  // całego form_data (tego test listy klientów pilnuje). Zagnieżdżeń (relacji)
  // atrapa nie zna i mówi to wprost.
  const projekcja = (kolumny) => {
    if (typeof kolumny !== 'string' || !kolumny.trim() || kolumny.trim() === '*') return 't.*';
    return kolumny.split(',').map((x) => x.trim()).filter(Boolean).map((pole) => {
      const m = /^(?:([A-Za-z_][A-Za-z0-9_]*):)?([A-Za-z_][A-Za-z0-9_]*)((?:->>?[A-Za-z0-9_]+)*)$/.exec(pole);
      if (!m) throw new Error(`Atrapa nie zna projekcji: ${pole}`);
      const [, alias, kolumna, sciezka] = m;
      const kroki = [...sciezka.matchAll(/(->>?)([A-Za-z0-9_]+)/g)];
      const wyrazenie = kroki.reduce((w, [, op, k]) => `${w}${op}'${k}'`, `t."${kolumna}"`);
      return `${wyrazenie} as "${alias ?? (kroki.length ? kroki.at(-1)[2] : kolumna)}"`;
    }).join(', ');
  };

  // Klient „z sesją agenta" do ofert i wariantów: czyta prawdziwe wiersze z bazy
  // testowej (bez RLS — uprawnienia ofert to osobny temat, nie tablicy leadów).
  // Ten sam kształt służy też licznikowi „Niedokończone" (select z count/head + is null).
  const sbOferty = {
    from: (tabela) => {
      const warunki = [];
      let tylkoLiczba = false;
      let kolumny = 't.*';
      const zapytanie = {
        select: (lista, opcje) => {
          tylkoLiczba = Boolean(opcje?.head && opcje?.count);
          kolumny = projekcja(lista);
          return zapytanie;
        },
        eq: (k, v) => { warunki.push(`${k}::text = ${literal(String(v))}::jsonb #>> '{}'`); return zapytanie; },
        in: (k, v) => { warunki.push(`${k}::text in (select jsonb_array_elements_text(${literal(v.map(String))}::jsonb))`); return zapytanie; },
        is: (k, v) => {
          if (v !== null) throw new Error('Atrapa obsługuje tylko .is(kolumna, null)');
          warunki.push(`${k} is null`);
          return zapytanie;
        },
        not: (k, op, v) => {
          if (op !== 'is' || v !== null) throw new Error('Atrapa obsługuje tylko .not(kolumna, \'is\', null)');
          warunki.push(`${k} is not null`);
          return zapytanie;
        },
        order: () => zapytanie,
        limit: () => zapytanie,
        maybeSingle: async () => {
          const zrodlo = `select * from public.${tabela}${warunki.length ? ` where ${warunki.join(' and ')}` : ''} limit 1`;
          const w = sql(`select to_jsonb(p) from (select ${kolumny} from (${zrodlo}) t) p`);
          return { data: w ? JSON.parse(w) : null, error: null };
        },
        then: (rozwiaz, odrzuc) => {
          try {
            const zrodlo = `select * from public.${tabela}${warunki.length ? ` where ${warunki.join(' and ')}` : ''}`;
            if (tylkoLiczba) { rozwiaz({ data: null, count: Number(sql(`select count(*) from (${zrodlo}) t`)), error: null }); return; }
            // Kolejność po created_at całego wiersza, gdy tabela ją ma (ud_leady_etap jej nie ma).
            const w = sql(`select coalesce(jsonb_agg(to_jsonb(p) - '__kolejnosc' order by p.__kolejnosc), '[]'::jsonb)
                             from (select ${kolumny}, to_jsonb(t)->>'created_at' as __kolejnosc from (${zrodlo}) t) p`);
            rozwiaz({ data: JSON.parse(w), error: null });
          } catch (e) { odrzuc(e); }
        },
      };
      return zapytanie;
    },
  };

  // „Według źródła" jak w load strony statystyk: osobno, błąd tylko w tej sekcji.
  // ?brakZrodel=1 — udaje panel wdrożony przed migracją (rpc bez funkcji w bazie).
  const zrodlaStatystyk = async (uzytkownik, parametry) => {
    const transport = parametry.get('brakZrodel') === '1'
      ? { rpc: async (n) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${n}` } }) }
      : sb;
    try {
      return { zr: await statystykiZrodel(transport, uzytkownik, parametry), zrBlad: '' };
    } catch (e) {
      return { zr: null, zrBlad: e instanceof BladApi && e.status !== 403 ? e.message : 'Nie udało się wczytać statystyk według źródła.' };
    }
  };

  // ── Kubełek polis w pamięci; adres podpisany = ścieżka serwera testowego ────
  const magazyn = new Map();
  const kubelki = {
    from: (kubelek) => ({
      upload: async (sciezka, bajty) => { magazyn.set(`${kubelek}/${sciezka}`, Buffer.from(bajty)); return { data: {}, error: null }; },
      remove: async (sciezki) => { for (const x of sciezki) magazyn.delete(`${kubelek}/${x}`); return { data: [], error: null }; },
      createSignedUrl: async (sciezka, sekundy, opcje) =>
        ({ data: { signedUrl: `/__test/magazyn/${kubelek}/${sciezka}?nazwa=${encodeURIComponent(opcje?.download ?? '')}` }, error: null }),
      download: async (sciezka) => {
        const b = magazyn.get(`${kubelek}/${sciezka}`);
        return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: 'Object not found' } };
      },
    }),
  };
  // Klucz serwisowy w trasach polis: rpc + odczyt PESEL-u + kubełek.
  const sbPolisy = { rpc: (n, a) => sb.rpc(n, a), from: (t) => sbOferty.from(t), storage: kubelki };
  // Czytnik testowy: prawdziwego PDF-u polisy tu nie ma, więc rozpoznaje znaczniki
  // w treści pliku. „UD-TEST-KWOTY" → kwoty jak z Leadenhall; „UD-TEST-HASLO" →
  // wymaga 4 ostatnich cyfr PESEL-u; „UD-TEST-OPLATA" → składka 3 036 / 253 z opłatą
  // dystrybucyjną 276 (jak w prawdziwej ofercie Leadenhall); „UD-TEST-POLISA" →
  // numer LHC3100906 i ochrona 05.02.2026–04.02.2027 (jak z prawdziwej polisy,
  // pole `polisa` czytnika z src/lib/server/czytnik-polis.js); reszta → nieznany
  // układ (jak prawdziwy czytnik).
  const odczytajTestowo = async (bajty, haslo) => {
    const tekst = Buffer.from(bajty).toString('latin1');
    if (tekst.includes('UD-TEST-HASLO') && haslo !== '2345') {
      throw Object.assign(new Error('No password given'), { name: 'PasswordException' });
    }
    const polisa = tekst.includes('UD-TEST-POLISA')
      ? { polisa_numer: 'LHC3100906', ochrona_od: '2026-02-05', ochrona_do: '2027-02-04', swiadczenie_okresowa: null }
      : undefined;
    if (tekst.includes('UD-TEST-OPLATA')) {
      return { offer_number: 'LHQ8/1', premium_total: 3036, premium_monthly: 253, distribution_fee: 276, installments: 12,
               temp_incapacity_covered: true, temp_monthly_benefit: 5000, perm_incapacity_covered: false, death_covered: false, polisa };
    }
    if (tekst.includes('UD-TEST-KWOTY') || tekst.includes('UD-TEST-HASLO')) {
      return { offer_number: 'LHQ9/1', premium_total: '1500.00', premium_monthly: '125', temp_incapacity_covered: true,
               temp_monthly_benefit: 4000, perm_incapacity_covered: false, death_covered: false, polisa };
    }
    if (polisa) return { polisa };
    throw new Error('Nie rozpoznano szablonu oferty (Leadenhall/CEU).');
  };
  const czytajBajty = (req) => new Promise((rozwiaz, odrzuc) => {
    const kawalki = [];
    req.on('data', (d) => kawalki.push(d));
    req.on('end', () => rozwiaz(new Uint8Array(Buffer.concat(kawalki))));
    req.on('error', odrzuc);
  });

  // ── Awarie wstrzykiwane przez testy ───────────────────────────────────────
  /** @type {{ sciezka: string, tryb: string, ile: number, status?: number, body?: any, opoznienieMs?: number }[]} */
  const awarie = [];
  /** @type {{ metoda: string, sciezka: string, zapytanie: string }[]} */
  const wywolania = [];
  const znajdzAwarie = (sciezka) => awarie.find((a) => a.sciezka === sciezka && a.ile > 0);

  const czytajCialo = (req) => new Promise((rozwiaz, odrzuc) => {
    let dane = '';
    req.on('data', (d) => { dane += d; });
    req.on('end', () => { try { rozwiaz(dane ? JSON.parse(dane) : {}); } catch (e) { odrzuc(e); } });
    req.on('error', odrzuc);
  });
  const odpowiedz = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };

  const wtyczka = {
    name: 'leady-api',
    configureServer(serwer) {
      serwer.middlewares.use(async (req, res, dalej) => {
        const url = new URL(req.url, 'http://x');
        const sciezka = url.pathname;
        const uzytkownik = UZYTKOWNICY[req.headers['x-test-user']] ?? UZYTKOWNICY.ula;
        const user = req.headers['x-test-user'] === 'brak' ? null : { id: uzytkownik };

        try {
          // ── pomocnicze ──
          if (sciezka === '/__test/reset') { reset(); return odpowiedz(res, 200, { ok: true }); }
          if (sciezka === '/__test/sql') {
            const { sql: q } = await czytajCialo(req);
            return odpowiedz(res, 200, { wynik: sql(q) });
          }
          if (sciezka === '/__test/awaria') {
            const a = await czytajCialo(req);
            if (a.wyczysc) awarie.length = 0; else awarie.push({ ile: 1, ...a });
            return odpowiedz(res, 200, { ok: true });
          }
          if (sciezka === '/__test/wywolania') return odpowiedz(res, 200, { wywolania });
          if (sciezka.startsWith('/__test/magazyn/')) {
            const plik = magazyn.get(decodeURIComponent(sciezka.slice('/__test/magazyn/'.length)));
            if (!plik) return odpowiedz(res, 404, { status: 'blad' });
            res.setHeader('content-type', 'application/pdf');
            return res.end(plik);
          }
          if (sciezka === '/__test/magazyn') return odpowiedz(res, 200, { pliki: [...magazyn.keys()] });
          if (sciezka === '/__test/ssr') {
            // Renderowanie po stronie serwera (tak jak robi to SvelteKit na Cloudflare): bez window i document.
            const { render } = await serwer.ssrLoadModule('svelte/server');
            const Tablica = (await serwer.ssrLoadModule('/src/lib/leady/Tablica.svelte')).default;
            const { utworzApi } = await serwer.ssrLoadModule('/src/lib/leady/api.js');
            const dane = await wczytajTablice(sb, sbOferty, uzytkownik, url.searchParams);
            const { body } = render(Tablica, { props: { dane, api: utworzApi({ fetch: async () => { throw new Error('SSR nie woła API'); } }), odUrl: () => {} } });
            res.setHeader('content-type', 'text/html; charset=utf-8');
            return res.end(body);
          }
          if (sciezka === '/__test/ssr-statystyki') {
            // Strona /panel/statystyki z danymi z tych samych funkcji co jej load (+page.server.js).
            const { render } = await serwer.ssrLoadModule('svelte/server');
            const Strona = (await serwer.ssrLoadModule('/src/routes/panel/statystyki/+page.svelte')).default;
            // Jak load strony: najpierw synchronizacja leadów (statystyki.spec.js
            // sprawdza też, że load ją woła przed obiema funkcjami).
            await synchronizuj(sb);
            let st;
            try {
              st = await statystyki(sb, uzytkownik, url.searchParams);
            } catch (e) {
              if (e instanceof BladApi) return odpowiedz(res, e.status, { komunikat: e.message });
              throw e;
            }
            const { body } = render(Strona, { props: { data: { st, blad: '', ...(await zrodlaStatystyk(uzytkownik, url.searchParams)) } } });
            res.setHeader('content-type', 'text/html; charset=utf-8');
            return res.end(`<!doctype html><meta charset="utf-8"><body>${body}</body>`);
          }
          if (sciezka === '/__test/ssr-klient') {
            // Karta klienta (/panel/klienci/<id>) z danymi z tej samej funkcji co jej load.
            // ?nazwa= — klient po nazwisku z fixture. Dane strony idą też jako JSON
            // (tak SvelteKit oddaje je przeglądarce) — test sprawdza, czego w nich nie ma.
            const { render } = await serwer.ssrLoadModule('svelte/server');
            const Strona = (await serwer.ssrLoadModule('/src/routes/panel/klienci/[id]/+page.svelte')).default;
            const id = sql(`select id from public.ud_clients where full_name = ${literal(url.searchParams.get('nazwa') ?? '')}::jsonb #>> '{}'`);
            // ?widok= i ?zrodlo= — filtry listy, z której agent przyszedł (strzałki „Poprzedni / Następny").
            const dane = await kartaKlienta({ rpc: (n, a) => sb.rpc(n, a), from: (t) => sbOferty.from(t) }, uzytkownik, id,
              filtryListy(url.searchParams));
            if (!dane) return odpowiedz(res, 404, { komunikat: 'Klient nie znaleziony' });
            const { body } = render(Strona, { props: { data: dane } });
            res.setHeader('content-type', 'text/html; charset=utf-8');
            return res.end(`<!doctype html><meta charset="utf-8"><body>${body}<script type="application/json" id="dane-strony">${
              JSON.stringify(dane).replace(/</g, '\\u003c')}</script></body>`);
          }
          if (sciezka === '/__test/karta-dane') {
            // Dane karty klienta dla harnessu w przeglądarce (test/leady/karta.html) — odpowiednik load.
            const id = sql(`select id from public.ud_clients where full_name = ${literal(url.searchParams.get('nazwa') ?? '')}::jsonb #>> '{}'`);
            const dane = await kartaKlienta({ rpc: (n, a) => sb.rpc(n, a), from: (t) => sbOferty.from(t) }, uzytkownik, id,
              filtryListy(url.searchParams));
            return dane ? odpowiedz(res, 200, dane) : odpowiedz(res, 404, { komunikat: 'Klient nie znaleziony' });
          }
          if (sciezka === '/__test/klienci-dane') {
            // Dane zakładki „Klienci" dla harnessu w przeglądarce (test/leady/klienci.html) — odpowiednik load.
            const clients = await listaKlientow({ rpc: (n, a) => sb.rpc(n, a), from: (t) => sbOferty.from(t) }, uzytkownik);
            return odpowiedz(res, 200, { clients, ...filtryListy(url.searchParams) });
          }
          if (sciezka === '/__test/ssr-klienci') {
            // Zakładka „Klienci" z danymi z tej samej funkcji co jej load (+page.server.js).
            const { render } = await serwer.ssrLoadModule('svelte/server');
            const Strona = (await serwer.ssrLoadModule('/src/routes/panel/klienci/+page.svelte')).default;
            const clients = await listaKlientow({ rpc: (n, a) => sb.rpc(n, a), from: (t) => sbOferty.from(t) }, uzytkownik);
            const { body } = render(Strona, { props: { data: { clients, ...filtryListy(url.searchParams) } } });
            res.setHeader('content-type', 'text/html; charset=utf-8');
            // Dane listy jak JSON (tak SvelteKit oddaje je przeglądarce) — test sprawdza, czego w nich nie ma.
            return res.end(`<!doctype html><meta charset="utf-8"><body>${body}<script type="application/json" id="dane-strony">${
              JSON.stringify(clients).replace(/</g, '\\u003c')}</script></body>`);
          }
          if (sciezka === '/__test/statystyki-dane') {
            // Dane strony /panel/statystyki dla harnessu w przeglądarce (odpowiednik load).
            try {
              return odpowiedz(res, 200, { st: await statystyki(sb, uzytkownik, url.searchParams), blad: '', ja: uzytkownik,
                ...(await zrodlaStatystyk(uzytkownik, url.searchParams)) });
            } catch (e) {
              if (e instanceof BladApi) return odpowiedz(res, e.status, e.body);
              throw e;
            }
          }
          if (sciezka === '/__test/polisy-dane') {
            // Dane strony /panel/polisy (odpowiednik load).
            try {
              return odpowiedz(res, 200, { w: await polisy(sb, uzytkownik, url.searchParams), blad: '', ja: uzytkownik });
            } catch (e) {
              if (e instanceof BladApi) return odpowiedz(res, e.status, e.body);
              throw e;
            }
          }
          // ── „Dodaj polisę" (te same funkcje co w src/routes/panel/statystyki/api/*) ──
          if (sciezka === '/panel/statystyki/api/odczyt') {
            const wynik = await przetworz({
              user, oczekiwanyTyp: 'application/pdf', typTresci: req.headers['content-type'],
              czytajCialo: () => czytajBajty(req),
              wykonaj: ({ userId, body }) => {
                let nazwaPliku = req.headers['x-nazwa-pliku'] || '';
                try { nazwaPliku = decodeURIComponent(nazwaPliku); } catch { /* jak przyszło */ }
                return odczytajPoliseNowa(sbPolisy, userId, body, req.headers['x-haslo'] ?? null,
                  { odczytaj: odczytajTestowo, nazwa: nazwaPliku });
              },
            });
            return odpowiedz(res, wynik.status, wynik.body);
          }
          // ── wykaz polis: „Uzupełnij z plików PDF" (src/routes/panel/polisy/api/uzupelnij) ──
          if (sciezka === '/panel/polisy/api/uzupelnij') {
            const wynik = await przetworz({
              user, typTresci: req.headers['content-type'], czytajCialo: () => czytajCialo(req),
              wykonaj: ({ userId, body }) => uzupelnijZPolisy(sbPolisy, userId, body?.leadId, { odczytaj: odczytajTestowo }),
            });
            return odpowiedz(res, wynik.status, wynik.body);
          }
          if (sciezka === '/panel/statystyki/api/polisa') {
            const wynik = await przetworz({
              user, typTresci: req.headers['content-type'], czytajCialo: () => czytajCialo(req),
              wykonaj: ({ userId, body }) => dodajPolise(sb, userId, body),
            });
            return odpowiedz(res, wynik.status, wynik.body);
          }
          if (sciezka === '/__test/ssr-uklad') {
            // Układ panelu (menu z zakładką „Niedokończone") z licznikiem z tej samej funkcji co jego load.
            const { render } = await serwer.ssrLoadModule('svelte/server');
            const { createRawSnippet } = await serwer.ssrLoadModule('svelte');
            const Uklad = (await serwer.ssrLoadModule('/src/routes/panel/+layout.svelte')).default;
            const niedokonczone = await liczNiedokonczone(sbOferty);
            const children = createRawSnippet(() => ({ render: () => '<p>treść</p>' }));
            // ?rola=admin — konto administratora; ?sciezka= — adres bieżącej strony ($app/stores).
            const profile = url.searchParams.get('rola') === 'admin'
              ? { full_name: 'Centrala', role: 'admin' } : { full_name: 'Ula Agent', role: 'agent' };
            globalThis.__zaslepkaStrony = { url: new URL(`http://127.0.0.1${url.searchParams.get('sciezka') || '/panel/leady'}`), data: { profile } };
            try {
              const { body } = render(Uklad, { props: {
                data: { user: { id: uzytkownik, email: 'ula@x.pl' }, profile, niedokonczone },
                children,
              } });
              res.setHeader('content-type', 'text/html; charset=utf-8');
              return res.end(`<!doctype html><meta charset="utf-8"><body>${body}</body>`);
            } finally {
              globalThis.__zaslepkaStrony = undefined;
            }
          }
          if (sciezka === '/__test/ssr-ustawienia-nav') {
            // Pasek sekcji „Ustawień" (Wysyłki · Panel Admina · Ustawienia systemu).
            const { render } = await serwer.ssrLoadModule('svelte/server');
            const Nav = (await serwer.ssrLoadModule('/src/lib/components/UstawieniaNav.svelte')).default;
            globalThis.__zaslepkaStrony = {
              url: new URL(`http://127.0.0.1${url.searchParams.get('sciezka') || '/panel/logi'}`),
              data: { profile: { role: url.searchParams.get('rola') === 'admin' ? 'admin' : 'user' } },
            };
            try {
              const { body } = render(Nav, { props: {} });
              res.setHeader('content-type', 'text/html; charset=utf-8');
              return res.end(`<!doctype html><meta charset="utf-8"><body>${body}</body>`);
            } finally {
              globalThis.__zaslepkaStrony = undefined;
            }
          }
          if (sciezka === '/__test/tablica') {
            const wynik = await przetworz({ user, odczyt: true, wykonaj: async ({ userId }) =>
              ({ status: 200, body: await wczytajTablice(sb, sbOferty, userId, url.searchParams) }) });
            return odpowiedz(res, wynik.status, wynik.body);
          }

          if (!sciezka.startsWith('/panel/leady/api/')) return dalej();
          const nazwa = sciezka.replace('/panel/leady/api/', '');
          wywolania.push({ metoda: req.method, sciezka: nazwa, zapytanie: url.search });

          // ── awarie transportu ──
          const awaria = znajdzAwarie(nazwa.startsWith('lead/') ? 'lead' : nazwa);
          if (awaria?.opoznienieMs) await new Promise((r) => setTimeout(r, awaria.opoznienieMs));
          if (awaria && awaria.tryb !== 'opoznienie') {
            awaria.ile -= 1;
            if (awaria.tryb === 'zgubOdpowiedz') {
              // Wykonaj naprawdę, ale odpowiedzi nie wysyłaj — połączenie pada.
              const cialo = req.method === 'POST' ? await czytajCialo(req) : null;
              if (nazwa === 'zmien') await przetworz({ user, typTresci: 'application/json', czytajCialo: async () => cialo, wykonaj: ({ userId, body }) => zmien(sb, userId, body) });
              req.socket.destroy();
              return;
            }
            if (awaria.tryb === 'zerwij') { req.socket.destroy(); return; }
            if (awaria.tryb === 'przetworzI502') {
              // Wykonaj naprawdę, ale odpowiedz 502 (proxy zgubiło odpowiedź). Przeglądarka nie ponawia
              // takiego żądania sama — ponowienie z tym samym kluczem musi zrobić aplikacja.
              const cialo = await czytajCialo(req);
              if (nazwa === 'zmien') await przetworz({ user, typTresci: 'application/json', czytajCialo: async () => cialo, wykonaj: ({ userId, body }) => zmien(sb, userId, body) });
              return odpowiedz(res, 502, { status: 'blad', komunikat: 'Bad gateway', ponow: true });
            }
            if (awaria.tryb === 'odpowiedz') return odpowiedz(res, awaria.status ?? 500, awaria.body ?? { status: 'blad', komunikat: 'Błąd serwera' });
          } else if (awaria?.tryb === 'opoznienie') {
            awaria.ile -= 1;
          }

          // ── polisy (te same funkcje co w src/routes/panel/leady/api/polisa|plik) ──
          if (/^polisa\/[^/]+\/odczyt$/.test(nazwa)) {
            const wynik = await przetworz({
              user, typTresci: req.headers['content-type'], czytajCialo: () => czytajCialo(req),
              wykonaj: ({ userId, body }) => odczytajWgranaPolise(sbPolisy, userId, decodeURIComponent(nazwa.split('/')[1]), body?.plikId,
                { odczytaj: odczytajTestowo }),
            });
            return odpowiedz(res, wynik.status, wynik.body);
          }
          if (nazwa.startsWith('polisa/')) {
            const wynik = await przetworz({
              user,
              oczekiwanyTyp: 'application/pdf',
              typTresci: req.headers['content-type'],
              czytajCialo: () => czytajBajty(req),
              wykonaj: ({ userId, body }) => {
                let nazwaPliku = req.headers['x-nazwa-pliku'] || '';
                try { nazwaPliku = decodeURIComponent(nazwaPliku); } catch { /* jak przyszło */ }
                return wgrajPolise(sbPolisy, userId, decodeURIComponent(nazwa.slice(7)), { nazwa: nazwaPliku, bajty: body },
                  { odczytaj: odczytajTestowo });
              },
            });
            return odpowiedz(res, wynik.status, wynik.body);
          }
          if (nazwa.startsWith('plik/')) {
            if (!user) { res.statusCode = 303; res.setHeader('location', '/login'); return res.end(); }
            try {
              const adresPodpisany = await adresPliku(sbPolisy, user.id, decodeURIComponent(nazwa.slice(5)));
              res.statusCode = 303;
              res.setHeader('location', adresPodpisany);
              return res.end();
            } catch (e) {
              if (e instanceof BladApi) return odpowiedz(res, e.status, e.body);
              throw e;
            }
          }

          // ── trasy (te same funkcje co w src/routes/panel/leady/api/*) ──
          const typTresci = req.headers['content-type'];
          const wynik = await przetworz({
            user,
            odczyt: req.method === 'GET',
            typTresci,
            czytajCialo: () => czytajCialo(req),
            wykonaj: async ({ userId, body }) => {
              if (nazwa === 'zmien') return zmien(sb, userId, body);
              if (nazwa === 'notatka') return notatka(sb, userId, body);
              if (nazwa === 'zwin') return zwin(sb, userId, body);
              if (nazwa === 'kolumna') return odpowiedzKolumny(sb, userId, url.searchParams);
              if (nazwa === 'liczniki') return odpowiedzLicznikow(sb, userId, url.searchParams);
              if (nazwa.startsWith('lead/')) return odpowiedzSzczegolow(sb, sbOferty, userId, decodeURIComponent(nazwa.slice(5)));
              if (nazwa.startsWith('warianty/')) return odpowiedzWariantow(sb, sbOferty, userId, decodeURIComponent(nazwa.slice(9)));
              return { status: 404, body: { status: 'blad', komunikat: 'Nieznana ścieżka.' } };
            },
          });
          return odpowiedz(res, wynik.status, wynik.body);
        } catch (e) {
          console.error('[serwer testowy]', e);
          return odpowiedz(res, 500, { status: 'blad', komunikat: String(e.message) });
        }
      });
    },
  };

  reset();
  const vite = await createServer({
    root: panel,
    configFile: false,
    logLevel: 'warn',
    resolve: { alias: {
      $lib: join(panel, 'src/lib'),
      '$app/stores': join(panel, 'test/leady/app-zaslepka.js'),
      '$app/navigation': join(panel, 'test/leady/app-zaslepka.js'),
    } },
    plugins: [svelte({ configFile: false }), wtyczka],
    server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [resolve(panel, '../..')] } },
    optimizeDeps: { noDiscovery: true },
  });
  await vite.listen();
  const adres = vite.resolvedUrls?.local?.[0]?.replace(/\/$/, '');
  return {
    url: adres,
    zatrzymaj: async () => { await vite.close(); klaster.stop(); },
  };
}
