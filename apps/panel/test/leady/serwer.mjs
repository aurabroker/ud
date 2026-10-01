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
  notatka, odpowiedzKolumny, odpowiedzLicznikow, odpowiedzSzczegolow, przetworz, wczytajTablice, zmien, zwin,
} from '../../src/lib/server/leady.js';

const panel = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const UZYTKOWNICY = {
  adm: 'a0000000-0000-0000-0000-0000000000a1',
  ula: 'a0000000-0000-0000-0000-0000000000a2',
  olek: 'a0000000-0000-0000-0000-0000000000a3',
  ines: 'a0000000-0000-0000-0000-0000000000a4',
};

export async function startuj() {
  const klaster = await uruchomKlaster({ dodatkowe: ['pomocnicze.sql'] });
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
         update public.ud_leady_etap set aktywny = true;`);
    wywolania.length = 0;
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
  const sbOferty = {
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }) }),
  };

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
            if (awaria.tryb === 'odpowiedz') return odpowiedz(res, awaria.status ?? 500, awaria.body ?? { status: 'blad', komunikat: 'Błąd serwera' });
          } else if (awaria?.tryb === 'opoznienie') {
            awaria.ile -= 1;
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
    resolve: { alias: { $lib: join(panel, 'src/lib') } },
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
