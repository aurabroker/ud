import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

/**
 * Pomocniki testów funkcji brzegowych (szkice, przypomnienia).
 *
 * Funkcje brzegowe to Deno + TypeScript + importy z adresów URL — w Node'ie nie
 * ruszą wprost. Ładujemy więc ICH PRAWDZIWE ŹRÓDŁO: zdejmujemy typy, wycinamy
 * importy i podajemy zależności (Supabase, logger, fetch, Deno) jako parametry.
 * Przepisana kopia rozjechałaby się przy pierwszej zmianie po tamtej stronie.
 */

export const KATALOG = fileURLToPath(new URL('../../../supabase/', import.meta.url));
export const czytaj = (sciezka) => readFileSync(KATALOG + sciezka, 'utf8');

/** Zdejmuje typy TypeScriptu — resztę uruchamiamy jak zwykły JS. */
export const bezTypow = (kod) => stripTypeScriptTypes(kod, { mode: 'strip' });

/** Kod funkcji bez typów i bez importów (te podaje test jako parametry). */
export const kodFunkcji = (sciezka) => bezTypow(czytaj(sciezka)).replace(/^import .+;$/gm, '');

export const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

export const SZKIC_PODPIS = await import(
  `data:text/javascript;base64,${Buffer.from(bezTypow(czytaj('functions/_shared/szkic-podpis.ts'))).toString('base64')}`
);

export const KROKI = ['kontakt', 'dane', 'zakres', 'zdrowie', 'zgody'];
export const SEKRET = 'sekret-testowy-hmac';
export const ID_NIEISTNIEJACE = '00000000-0000-4000-8000-000000000000';

/** Minimalna atrapa PostgREST nad jedną tabelą, z ograniczeniami z migracji. */
export function atrapaBazy({ rpcOdpowiedzi = {} } = {}) {
  const wiersze = [];
  const rpc = [];
  let licznik = 0;

  const naruszenie = (w) => {
    if (!w.zgoda_kontakt && (w.imie != null || w.email != null || w.phone != null)) {
      return 'szkic_kontakt_tylko_za_zgoda';
    }
    if (w.zgoda_kontakt && !(w.zgoda_wersja && w.zgoda_tresc && w.zgoda_at)) return 'szkic_zgoda_udokumentowana';
    if (w.ukonczony_at && w.ostatni_krok !== 'zgody') return 'szkic_ukonczony_to_ostatni_krok';
    if (!KROKI.includes(w.ostatni_krok)) return 'ostatni_krok_check';
    return null;
  };

  const klient = {
    from(tabela) {
      if (tabela !== 'ud_wnioski_szkice') throw new Error(`nieoczekiwana tabela: ${tabela}`);
      const st = { op: 'select', patch: null, filtry: [], opcje: null, pojedynczy: false };
      const b = {
        select(_kolumny, opcje) { st.opcje = opcje ?? null; st.wybor = true; return b; },
        insert(r) { st.op = 'insert'; st.patch = r; return b; },
        update(p) { st.op = 'update'; st.patch = p; return b; },
        eq(k, v) { st.filtry.push((r) => r[k] === v); return b; },
        is(k, v) { st.filtry.push((r) => (r[k] ?? null) === v); return b; },
        in(k, lista) { st.filtry.push((r) => lista.includes(r[k])); return b; },
        gte(k, v) { st.filtry.push((r) => r[k] >= v); return b; },
        single() { st.pojedynczy = true; return b; },
        then(ok, blad) {
          return Promise.resolve().then(() => {
            const trafione = wiersze.filter((r) => st.filtry.every((f) => f(r)));
            if (st.op === 'insert') {
              licznik += 1;
              const nowy = {
                id: `00000000-0000-4000-8000-${String(licznik).padStart(12, '0')}`,
                created_at: new Date().toISOString(),
                ostatni_krok: 'kontakt', zgoda_kontakt: false,
                imie: null, email: null, phone: null,
                ukonczony_at: null, przypomnienie_wyslane_at: null,
                ...st.patch,
              };
              const n = naruszenie(nowy);
              if (n) return { data: null, error: { message: `violates check constraint "${n}"` } };
              wiersze.push(nowy);
              return { data: st.pojedynczy ? { id: nowy.id } : [{ id: nowy.id }], error: null };
            }
            if (st.op === 'update') {
              for (const r of trafione) {
                const po = { ...r, ...st.patch };
                const n = naruszenie(po);
                if (n) return { data: null, error: { message: `violates check constraint "${n}"` } };
                Object.assign(r, st.patch);
              }
              // `update(...).select('id')` oddaje zmienione wiersze — na tym opiera się
              // „zajęcie" szkicu w funkcji przypomnień (atomowe, po warunkach w WHERE).
              return { data: st.wybor ? trafione.map((r) => ({ id: r.id })) : null, error: null };
            }
            if (st.opcje?.count) return { count: trafione.length, error: null };
            return { data: trafione, error: null };
          }).then(ok, blad);
        },
      };
      return b;
    },
    async rpc(nazwa, argumenty) {
      rpc.push({ nazwa, argumenty });
      if (rpcOdpowiedzi[nazwa]) return { data: rpcOdpowiedzi[nazwa](argumenty), error: null };
      if (nazwa === 'ud_wnioski_szkic_ukoncz') {
        const w = wiersze.find((r) => r.id === argumenty.p_id && !r.ukonczony_at);
        if (w) Object.assign(w, { ukonczony_at: new Date().toISOString(), ostatni_krok: 'zgody', imie: null, email: null, phone: null });
      }
      return { data: null, error: null };
    },
  };
  return { klient, wiersze, rpc };
}

