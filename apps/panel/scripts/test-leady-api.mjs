/**
 * Warstwa serwerowa tablicy leadów (src/lib/server/leady.js) na PRAWDZIWYCH
 * funkcjach SQL.
 *
 *   pnpm test:leady-api
 *
 * Atrapą jest tylko transport: `sb.rpc(nazwa, argumenty)` robi to samo co
 * PostgREST — dopasowuje argumenty po NAZWACH, rzutuje je na typy z sygnatury
 * funkcji i zwraca JSON. Literówka w nazwie argumentu po stronie JS (albo
 * zmiana sygnatury w migracji) kończy się więc błędem PGRST202 tak samo jak
 * na produkcji — tego nie wyłapałby test z atrapą bazy.
 *
 * Czego NIE sprawdza: HTTP (Response, nagłówki — to cienki adapter
 * leady-http.js), sesji Supabase ani widoku w przeglądarce.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  BladApi,
  filtrZParametrow,
  kolumna,
  liczniki,
  notatka,
  odpowiedzKolumny,
  odpowiedzLicznikow,
  odpowiedzSzczegolow,
  przetworz,
  graniceOkresu,
  statystyki,
  synchronizuj,
  szczegoly,
  warianty,
  wgrajPolise,
  adresPliku,
  dodajPolise,
  kwotyZDokumentu,
  odczytajPoliseNowa,
  odczytajWgranaPolise,
  odpowiedzWariantow,
  polisy,
  wczytajPlan,
  wczytajTablice,
  zmien,
  zwin,
} from '../src/lib/server/leady.js';
import { uruchomKlaster } from './lib/pg-tymczasowy.mjs';
import { klienciWidoczni, klientWidoczny } from '../src/lib/server/widocznosc.js';

let klaster;
try {
  klaster = await uruchomKlaster({ dodatkowe: ['pomocnicze.sql', 'fixture.sql'] });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const { psql } = klaster;

/** Wartość z SQL jako tekst (jedna komórka). */
const sql = (zapytanie) => {
  const r = psql(zapytanie);
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

// ── Transport: rpc jak w PostgREST ───────────────────────────────────────────
const sygnatury = new Map();
function sygnatura(nazwa) {
  if (!sygnatury.has(nazwa)) {
    const wynik = sql(`
      select coalesce(json_build_object(
        'zbior', p.proretset,
        'argumenty', (select coalesce(json_agg(json_build_object('n', n, 't', format_type(t, null)) order by o), '[]')
                        from unnest((p.proargnames)[1:p.pronargs], p.proargtypes::oid[]) with ordinality as x(n, t, o))
      )::text, '')
      from pg_proc p where p.proname = '${nazwa}' and p.pronamespace = 'public'::regnamespace`);
    sygnatury.set(nazwa, wynik ? JSON.parse(wynik) : null);
  }
  return sygnatury.get(nazwa);
}

const literal = (wartosc) => {
  const znacznik = `$j${randomBytes(4).toString('hex')}$`;
  return `${znacznik}${JSON.stringify(wartosc)}${znacznik}`;
};

const sbSql = {
  /** @type {Array<[string, any]>} */
  wywolania: [],
  async rpc(nazwa, argumenty = {}) {
    this.wywolania.push([nazwa, argumenty]);
    const sig = sygnatura(nazwa);
    const nazwy = (sig?.argumenty ?? []).map((a) => a.n);
    if (!sig || Object.keys(argumenty).some((k) => !nazwy.includes(k))) {
      return {
        data: null,
        error: { code: 'PGRST202', message: `Could not find the function public.${nazwa}(${Object.keys(argumenty).join(', ')})` },
      };
    }
    const lista = Object.entries(argumenty)
      .map(([k, v]) => {
        const typ = sig.argumenty.find((a) => a.n === k).t;
        if (v === null || v === undefined) return `${k} => null::${typ}`;
        return typ === 'jsonb'
          ? `${k} => ${literal(v)}::jsonb`
          : `${k} => (${literal(v)}::jsonb #>> '{}')::${typ}`;
      })
      .join(', ');
    const zapytanie = sig.zbior
      ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.${nazwa}(${lista}) t`
      : `select to_jsonb(public.${nazwa}(${lista}))`;
    const r = psql(`\\set VERBOSITY verbose\n${zapytanie}`);
    if (r.status !== 0) {
      const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(r.stderr);
      return { data: null, error: { code: m?.[1] ?? 'XX000', message: m?.[2] ?? r.stderr } };
    }
    return { data: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null, error: null };
  },
};

// ── Mini-harness ─────────────────────────────────────────────────────────────
let pass = 0;
const bledy = [];
async function t(nazwa, fn) {
  try {
    await fn();
    pass++;
    if (process.argv.includes('--pelne')) console.log(`PASS ${nazwa}`);
  } catch (e) {
    bledy.push(`FAIL ${nazwa}\n     ${String(e.message).split('\n').join('\n     ')}`);
  }
}
const klucz = (() => { let n = 0; return (p = 'k') => `${p}-${String(++n).padStart(4, '0')}-${randomBytes(3).toString('hex')}`; })();

const ULA = sql('select tt.id_ula()');
const OLEK = sql('select tt.id_olek()');
const ADM = sql('select tt.id_adm()');
const INES = sql('select tt.id_ines()');
const etap = (k) => sql(`select tt.etap('${k}')`);
const lead = (nazwa) => sql(`select tt.lead('${nazwa}')`);
const wersja = (id) => Number(sql(`select tt.wersja('${id}')`));
const etapLeada = (id) => sql(`select tt.etap_leada('${id}')`);
const historia = (id) => Number(sql(`select tt.hist('${id}')`));

try {
  // ═══ Filtr z adresu (bez bazy) ═══════════════════════════════════════════
  await t('filtr: poprawne wartości przechodzą', () => {
    const f = filtrZParametrow(new URLSearchParams(`q=  anna  &opiekun=${ULA}&zrodlo=direct&produkt=trwala&termin=dzisiaj&sort=wartosc`));
    assert.deepEqual(f.filtr, { q: 'anna', opiekun: ULA, zrodlo: 'direct', produkt: 'trwala', termin: 'dzisiaj' });
    assert.equal(f.sort, 'wartosc');
    assert.equal(f.aktywny, true);
  });
  await t('filtr: śmieci są pomijane, nie rzucają', () => {
    const f = filtrZParametrow(new URLSearchParams("opiekun=x' or 1=1&zrodlo=Ala ma kota&produkt=nic&termin=kiedyś&sort=drop"));
    assert.deepEqual(f.filtr, {});
    assert.equal(f.sort, 'dzialanie');
    assert.equal(f.aktywny, false);
  });
  await t('filtr: opiekun ja/brak, q przycięte do 100 znaków', () => {
    assert.equal(filtrZParametrow({ opiekun: 'ja' }).filtr.opiekun, 'ja');
    assert.equal(filtrZParametrow({ opiekun: 'brak' }).filtr.opiekun, 'brak');
    assert.equal(filtrZParametrow({ q: 'x'.repeat(500) }).filtr.q.length, 100);
  });

  // ═══ Pierwsze ładowanie ══════════════════════════════════════════════════
  await t('plan: nie-agent dostaje 403 i NIC nie dopisuje do tablicy', async () => {
    await assert.rejects(wczytajTablice(sbSql, null, INES, new URLSearchParams()), (e) => e instanceof BladApi && e.status === 403);
    await assert.rejects(wczytajPlan(sbSql, '99999999-9999-4999-8999-999999999999', null), (e) => e.status === 403);
    assert.equal(sql('select count(*) from public.ud_leady'), '0');
  });

  await sbSql.rpc('ud_leady_zwin', { p_user: ADM, p_pipeline: sql('select tt.pipeline()'), p_etap: etap('oferta'), p_zwin: true });
  const tablica = await wczytajTablice(sbSql, null, ADM, new URLSearchParams());
  await t('tablica: synchronizacja dopisała 8 klientów (porzucone wnioski nie są leadami)', () => {
    assert.equal(tablica.synchronizacja, true);
    assert.equal(sql('select count(*) from public.ud_leady'), '8');
  });
  await t('tablica: plan z pięcioma etapami (Kontakt scalony z Nowym) i zwiniętą „Ofertą" tego użytkownika', () => {
    assert.deepEqual(tablica.plan.etapy.map((e) => e.klucz), ['nowy', 'oferta', 'decyzja', 'wygrany', 'przegrany']);
    assert.deepEqual(tablica.plan.zwiniete, [etap('oferta')]);
    assert.equal(tablica.plan.rola, 'admin');
  });
  await t('tablica: karty tylko dla rozwiniętych kolumn, liczniki dla wszystkich', () => {
    assert.equal(Object.keys(tablica.kolumny).length, 4);
    assert.ok(!(etap('oferta') in tablica.kolumny), 'zwinięta kolumna nie ładuje kart');
    assert.equal(tablica.liczniki[etap('oferta')].ile, 1, 'ale licznik jest');
    assert.equal(tablica.liczniki[etap('nowy')].ile, 4);
    assert.equal(tablica.liczniki[etap('nowy')].suma, 25000);
    assert.equal(tablica.kolumny[etap('nowy')].karty.length, 4);
    assert.equal(tablica.kolumny[etap('nowy')].razem, 4);
  });
  await t('tablica: karta nie niesie e-maila ani PESEL-u', () => {
    const wszystko = JSON.stringify(tablica.kolumny);
    assert.ok(!wszystko.includes('@x.pl'));
    assert.ok(!wszystko.includes('80010112345'));
    assert.ok(!wszystko.includes('pesel'));
  });
  await t('tablica: filtr zawęża karty I liczniki, „ileWszystkich" zostaje', async () => {
    const t2 = await wczytajTablice(sbSql, null, ADM, new URLSearchParams('produkt=okresowa'));
    assert.equal(t2.filtrAktywny, true);
    assert.equal(t2.liczniki[etap('nowy')].ile, 2);
    assert.equal(t2.liczniki[etap('nowy')].ileWszystkich, 4);
    assert.equal(t2.liczniki[etap('nowy')].suma, 20000);
    assert.equal(t2.kolumny[etap('nowy')].karty.length, 2);
  });
  await t('tablica: nieznany pipeline w adresie → domyślny, bez błędu', async () => {
    const t3 = await wczytajTablice(sbSql, null, ADM, new URLSearchParams('pipeline=00000000-0000-4000-8000-000000000000'));
    assert.equal(t3.plan.pipeline.klucz, 'sprzedaz');
  });
  await t('tablica: ?lead=<id> otwiera szczegóły, nieistniejący → otwartyBrak', async () => {
    const id = lead('Anna Kowalska');
    const t4 = await wczytajTablice(sbSql, null, ADM, new URLSearchParams(`lead=${id}`));
    assert.equal(t4.otwarty.lead.id, id);
    assert.equal(t4.otwarty.email, 'anna@x.pl');
    const t5 = await wczytajTablice(sbSql, null, ADM, new URLSearchParams('lead=00000000-0000-4000-8000-000000000000'));
    assert.equal(t5.otwarty, null);
    assert.equal(t5.otwartyBrak, true);
  });
  await t('tablica: awaria synchronizacji nie blokuje tablicy', async () => {
    const zepsuty = { rpc: (n, a) => (n === 'ud_leady_synchronizuj' ? Promise.resolve({ data: null, error: { message: 'boom' } }) : sbSql.rpc(n, a)) };
    const t6 = await wczytajTablice(zepsuty, null, ADM, new URLSearchParams());
    assert.equal(t6.synchronizacja, false);
    assert.equal(t6.plan.etapy.length, 5);
  });
  await t('synchronizuj: zwraca false przy błędzie, nie rzuca', async () => {
    assert.equal(await synchronizuj({ rpc: async () => { throw new Error('sieć'); } }), false);
  });

  // ═══ Kolumny: stronicowanie ══════════════════════════════════════════════
  const plan = await wczytajPlan(sbSql, ADM, null);
  const P = plan.pipeline.id;
  await t('kolumna: strony po 2 — rozłączne, komplet, razem stałe', async () => {
    const a = await kolumna(sbSql, ADM, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'data', limit: 2, offset: 0 });
    const b = await kolumna(sbSql, ADM, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'data', limit: 2, offset: 2 });
    assert.equal(a.razem, 4);
    assert.equal(b.razem, 4);
    const ids = [...a.karty, ...b.karty].map((k) => k.id);
    assert.equal(new Set(ids).size, 4);
  });
  await t('kolumna: limit ograniczony do 100, śmieciowe offset/limit → domyślne', async () => {
    const k = await kolumna(sbSql, ADM, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'zly', limit: 'abc', offset: -5 });
    assert.equal(k.karty.length, 4);
    const k2 = await kolumna(sbSql, ADM, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'data', limit: 10_000_000, offset: 0 });
    assert.equal(k2.karty.length, 4);
  });
  await t('kolumna: etap spoza uuid → 400', async () => {
    await assert.rejects(kolumna(sbSql, ADM, { pipelineId: P, etapId: 'x', filtr: {}, sort: 'data' }), (e) => e.status === 400);
  });
  await t('kolumna: etap obcego pipeline\'u daje pustą kolumnę, nie cudze karty', async () => {
    const k = await kolumna(sbSql, ADM, { pipelineId: P, etapId: '00000000-0000-4000-8000-000000000000', filtr: {}, sort: 'data' });
    assert.equal(k.karty.length, 0);
    assert.equal(k.razem, 0);
  });
  await t('liczniki: mapa po etapie', async () => {
    const l = await liczniki(sbSql, ADM, P, {});
    assert.equal(Object.keys(l).length, 5);
    assert.equal(l[etap('decyzja')].ile, 1);
    assert.equal(l[etap('wygrany')].skladkiWszystkich, 6000, 'składki w Wygrany (Celina z wariantu)');
  });

  await t('odpowiedzKolumny: strona + liczniki, filtr z adresu, śmieciowy etap → 400', async () => {
    const r = await odpowiedzKolumny(sbSql, ADM, new URLSearchParams(`etap=${etap('nowy')}&produkt=okresowa&sort=wartosc&offset=0`));
    assert.equal(r.status, 200);
    assert.equal(r.body.razem, 2);
    assert.equal(r.body.karty[0].nazwa, 'Gabriel Podkreślnik');
    assert.equal(r.body.liczniki[etap('nowy')].ile, 2);
    await assert.rejects(odpowiedzKolumny(sbSql, ADM, new URLSearchParams('etap=x')), (e) => e.status === 400);
    await assert.rejects(odpowiedzKolumny(sbSql, INES, new URLSearchParams(`etap=${etap('nowy')}`)), (e) => e.status === 403);
  });
  await t('link agenta: tablica podaje link do wniosku z kodem agenta; kod stały; awaria → bez linku, tablica działa', async () => {
    const t1 = await wczytajTablice(sbSql, null, ULA, new URLSearchParams());
    assert.match(t1.linkAgenta, /^https:\/\/utratadochodu\.pl\/wniosek\/\?agent=\d{4}$/);
    const kod = t1.linkAgenta.split('=').pop();
    assert.equal(sql(`select affiliate_code from public.ud_user_profiles where id = '${ULA}'`), kod);
    assert.equal((await wczytajTablice(sbSql, null, ULA, new URLSearchParams())).linkAgenta, t1.linkAgenta);
    const t2 = await wczytajTablice(sbSql, null, OLEK, new URLSearchParams());
    assert.notEqual(t2.linkAgenta, t1.linkAgenta);
    const zepsuty = { rpc: (n, a) => (n === 'ud_agent_kod' ? Promise.reject(new Error('sieć')) : sbSql.rpc(n, a)) };
    const t3 = await wczytajTablice(zepsuty, null, ULA, new URLSearchParams());
    assert.equal(t3.linkAgenta, null);
    assert.equal(t3.plan.etapy.length, 5);
  });
  await t('agent widzi tylko swoje leady: tablica, kolumna, liczniki, szczegóły (02.10.2026)', async () => {
    const tu = await wczytajTablice(sbSql, null, ULA, new URLSearchParams());
    const karty = Object.values(tu.kolumny).flatMap((k) => k.karty);
    assert.ok(karty.length >= 1 && karty.every((k) => k.opiekun_id === ULA), 'tylko karty Uli');
    assert.equal(Object.values(tu.liczniki).reduce((a, x) => a + x.ileWszystkich, 0), 1, 'liczniki nie zdradzają cudzych');
    await assert.rejects(odpowiedzSzczegolow(sbSql, null, ULA, lead('Anna Kowalska')), (e) => e.status === 404, 'wolny lead');
    await assert.rejects(odpowiedzSzczegolow(sbSql, null, ULA, lead('Darek Decyzja')), (e) => e.status === 404, 'lead Olka');
    const t7 = await wczytajTablice(sbSql, null, ULA, new URLSearchParams(`lead=${lead('Darek Decyzja')}`));
    assert.equal(t7.otwarty, null);
    assert.equal(t7.otwartyBrak, true, 'link do cudzego leada wygląda jak nieistniejący');
  });
  await t('odpowiedzLicznikow / odpowiedzSzczegolow: dostęp tylko dla agenta', async () => {
    const r = await odpowiedzLicznikow(sbSql, ADM, new URLSearchParams('zrodlo=direct'));
    assert.equal(Object.values(r.body.liczniki).reduce((a, x) => a + x.ile, 0), 2);
    await assert.rejects(odpowiedzLicznikow(sbSql, INES, new URLSearchParams()), (e) => e.status === 403);
    await assert.rejects(odpowiedzSzczegolow(sbSql, null, INES, lead('Anna Kowalska')), (e) => e.status === 403);
    const s = await odpowiedzSzczegolow(sbSql, null, ADM, lead('Anna Kowalska'));
    assert.equal(s.body.email, 'anna@x.pl');
  });

  // ═══ Zmiana stanu: jedna ścieżka ═════════════════════════════════════════
  const bartek = lead('Bartek Nowak');
  await t('zmien: przeniesienie → 200, kanoniczny stan, wersja +1', async () => {
    const v = wersja(bartek);
    const r = await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('decyzja'), expectedVersion: v, idempotencyKey: klucz() });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.equal(r.body.lead.etap_id, etap('decyzja'));
    assert.equal(r.body.lead.wersja, v + 1);
  });
  await t('zmien: ponowienie z tym samym kluczem → 200 powtorzone, bez drugiego skutku', async () => {
    const v = wersja(bartek);
    const k = klucz();
    await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('nowy'), expectedVersion: v, idempotencyKey: k });
    const h = historia(bartek);
    const r = await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('nowy'), expectedVersion: v, idempotencyKey: k });
    assert.equal(r.status, 200);
    assert.equal(r.body.powtorzone, true);
    assert.equal(historia(bartek), h);
    assert.equal(wersja(bartek), v + 1);
  });
  await t('zmien: ten sam klucz, inny cel → 409 klucz_uzyty', async () => {
    const k = klucz();
    const v = wersja(bartek);
    await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('oferta'), expectedVersion: v, idempotencyKey: k });
    const r = await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('nowy'), expectedVersion: v, idempotencyKey: k });
    assert.equal(r.status, 409);
    assert.equal(r.body.status, 'klucz_uzyty');
    assert.equal(etapLeada(bartek), 'oferta');
  });
  await t('zmien: nieaktualna wersja → 409 konflikt ze świeżym stanem', async () => {
    const v = wersja(bartek);
    const r = await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('wygrany'), expectedVersion: v - 1, idempotencyKey: klucz() });
    assert.equal(r.status, 409);
    assert.equal(r.body.status, 'konflikt');
    assert.equal(r.body.lead.wersja, v);
    assert.equal(etapLeada(bartek), 'oferta');
  });
  await t('zmien: Przegrany bez powodu → 422 brak_danych z listą pól; z powodem → 200', async () => {
    const v = wersja(bartek);
    const r = await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('przegrany'), expectedVersion: v, idempotencyKey: klucz() });
    assert.equal(r.status, 422);
    assert.equal(r.body.status, 'brak_danych');
    assert.deepEqual(r.body.pola, ['powod_utraty']);
    assert.equal(etapLeada(bartek), 'oferta');
    const r2 = await zmien(sbSql, ULA, {
      leadId: bartek, targetStageId: etap('przegrany'), expectedVersion: v, idempotencyKey: klucz(),
      transitionData: { powod_utraty: 'Wybrał konkurencję' },
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.lead.powod_utraty, 'Wybrał konkurencję');
    await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('oferta'), expectedVersion: v + 1, idempotencyKey: klucz() });
  });
  await t('zmien: etap z innego pipeline\'u / nieistniejący → 422 niedozwolony (to samo co z UI)', async () => {
    sql(`insert into public.ud_leady_pipeline (klucz, nazwa) values ('inny', 'Inny')`);
    const obcy = sql(`insert into public.ud_leady_etap (pipeline_id, klucz, nazwa, pozycja) select id, 'obcy', 'Obcy', 10 from public.ud_leady_pipeline where klucz = 'inny' returning id`);
    for (const cel of [obcy, '00000000-0000-4000-8000-000000000000']) {
      const r = await zmien(sbSql, ULA, { leadId: bartek, targetStageId: cel, expectedVersion: wersja(bartek), idempotencyKey: klucz() });
      assert.equal(r.status, 422);
      assert.equal(r.body.status, 'niedozwolony');
    }
    assert.equal(etapLeada(bartek), 'oferta');
  });
  await t('zmien: nieaktywny agent → 403, zmiana się nie wykonuje', async () => {
    const r = await zmien(sbSql, INES, { leadId: bartek, targetStageId: etap('kontakt'), expectedVersion: wersja(bartek), idempotencyKey: klucz() });
    assert.equal(r.status, 403);
    assert.equal(r.body.status, 'brak_uprawnien');
    assert.equal(etapLeada(bartek), 'oferta');
  });
  await t('zmien: nieistniejący lead → 404', async () => {
    const r = await zmien(sbSql, ULA, { leadId: '00000000-0000-4000-8000-000000000000', targetStageId: etap('kontakt'), expectedVersion: 1, idempotencyKey: klucz() });
    assert.equal(r.status, 404);
  });

  await t('zmien: tożsamość wykonawcy tylko z sesji — pola userId/p_user/wykonawca w ciele są ignorowane', async () => {
    const v = wersja(bartek);
    await zmien(sbSql, ULA, {
      leadId: bartek, targetStageId: etap('kontakt'), expectedVersion: v, idempotencyKey: klucz(),
      userId: ADM, user_id: ADM, p_user: ADM, wykonawca: ADM, wykonawcaId: ADM,
    });
    const wyk = sql(`select wykonawca_id from public.ud_leady_historia where lead_id = '${bartek}' order by id desc limit 1`);
    assert.equal(wyk, ULA);
  });
  await t('zmien: podszycie pod administratora nie daje jego uprawnień (zmiana opiekuna na innego)', async () => {
    const r = await zmien(sbSql, ULA, {
      op: 'opiekun', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(),
      opiekunId: OLEK, userId: ADM, p_user: ADM, rola: 'admin',
    });
    assert.equal(r.status, 403);
    assert.equal(sql(`select opiekun_id from public.ud_leady where id = '${bartek}'`), ULA);
  });
  await t('zmien: transitionData nie może podmienić etapu docelowego ani innych pól', async () => {
    const v = wersja(bartek);
    const r = await zmien(sbSql, ULA, {
      leadId: bartek, targetStageId: etap('oferta'), expectedVersion: v, idempotencyKey: klucz(),
      transitionData: { etap_id: etap('wygrany'), wersja: 999, opiekun_id: OLEK },
    });
    assert.equal(r.status, 200);
    assert.equal(etapLeada(bartek), 'oferta');
    assert.equal(sql(`select opiekun_id from public.ud_leady where id = '${bartek}'`), ULA);
  });

  await t('zmien: żądania z nieprawidłowym kształtem → 400 i brak skutku w bazie', async () => {
    const baza = { leadId: bartek, targetStageId: etap('kontakt'), expectedVersion: wersja(bartek), idempotencyKey: klucz() };
    const h = historia(bartek);
    const przed = etapLeada(bartek);
    const zle = [
      null, 'tekst', [],
      { ...baza, leadId: 'x' },
      { ...baza, leadId: undefined },
      { ...baza, targetStageId: 'x' },
      { ...baza, targetStageId: undefined },
      { ...baza, expectedVersion: '3' },
      { ...baza, expectedVersion: 0 },
      { ...baza, expectedVersion: 1.5 },
      { ...baza, expectedVersion: undefined },
      { ...baza, idempotencyKey: 'krotki' },
      { ...baza, idempotencyKey: 'ma spacje i ; drop table' },
      { ...baza, idempotencyKey: undefined },
      { ...baza, op: 'skasuj' },
      { ...baza, op: 'dzialanie', typ: 'gołąb', termin: '2026-12-01T10:00:00Z' },
      { ...baza, op: 'opiekun', opiekunId: 'nie-uuid' },
    ];
    for (const body of zle) {
      await assert.rejects(zmien(sbSql, ULA, body), (e) => e instanceof BladApi && e.status === 400, JSON.stringify(body));
    }
    assert.equal(historia(bartek), h);
    assert.equal(etapLeada(bartek), przed);
  });

  await t('zmien: następne działanie — ustawienie, zmiana i wyczyszczenie', async () => {
    const termin = '2031-01-15T09:30:00.000Z';
    let r = await zmien(sbSql, ULA, { op: 'dzialanie', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), typ: 'telefon', termin, opis: 'Oddzwonić w sprawie oferty' });
    assert.equal(r.status, 200);
    assert.equal(r.body.lead.dzialanie.typ, 'telefon');
    assert.equal(r.body.lead.dzialanie.opis, 'Oddzwonić w sprawie oferty');
    r = await zmien(sbSql, ULA, { op: 'dzialanie', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), typ: null });
    assert.equal(r.status, 200);
    assert.equal(r.body.lead.dzialanie, null);
    r = await zmien(sbSql, ULA, { op: 'dzialanie', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), typ: 'telefon' });
    assert.equal(r.status, 400, 'rodzaj bez terminu');
  });
  await t('zmien: opiekuna przydziela tylko administrator — agent nie zwalnia, nie przejmuje', async () => {
    let r = await zmien(sbSql, ULA, { op: 'opiekun', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), opiekunId: null });
    assert.equal(r.status, 403, 'własnego nie zwolni');
    r = await zmien(sbSql, OLEK, { op: 'opiekun', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), opiekunId: OLEK });
    assert.equal(r.status, 404, 'cudzego nie widzi, więc nie przejmie');
    r = await zmien(sbSql, ADM, { op: 'opiekun', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), opiekunId: OLEK });
    assert.equal(r.status, 200);
    r = await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('oferta'), expectedVersion: wersja(bartek), idempotencyKey: klucz() });
    assert.equal(r.status, 404, 'po przepisaniu Ula traci dostęp');
    r = await zmien(sbSql, ADM, { op: 'opiekun', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), opiekunId: ULA });
    assert.equal(r.status, 200);
    assert.equal(r.body.lead.opiekun_id, ULA);
  });
  await t('notatka: dodanie, ponowienie, walidacja', async () => {
    const k = klucz();
    const r = await notatka(sbSql, ULA, { leadId: bartek, idempotencyKey: k, tresc: '  Prosił o kontakt po 16  ' });
    assert.equal(r.status, 200);
    assert.equal(r.body.notatka.tresc, 'Prosił o kontakt po 16');
    const r2 = await notatka(sbSql, ULA, { leadId: bartek, idempotencyKey: k, tresc: 'Prosił o kontakt po 16' });
    assert.equal(r2.body.powtorzone, true);
    assert.equal(sql(`select count(*) from public.ud_leady_notatki where lead_id = '${bartek}'`), '1');
    await assert.rejects(notatka(sbSql, ULA, { leadId: bartek, idempotencyKey: klucz(), tresc: 5 }), (e) => e.status === 400);
    const pusta = await notatka(sbSql, ULA, { leadId: bartek, idempotencyKey: klucz(), tresc: '   ' });
    assert.equal(pusta.status, 400);
    const dluga = await notatka(sbSql, ULA, { leadId: bartek, idempotencyKey: klucz(), tresc: 'x'.repeat(5000) });
    assert.equal(dluga.status, 400);
    const obca = await notatka(sbSql, INES, { leadId: bartek, idempotencyKey: klucz(), tresc: 'x' });
    assert.equal(obca.status, 403);
  });

  // ═══ Szczegóły ═══════════════════════════════════════════════════════════
  await t('szczegóły: dane kontaktowe, notatki, historia, oferty z sesji agenta', async () => {
    const wolane = [];
    const userSb = {
      from: (tabela) => ({
        select: (kol) => ({
          eq: (k, v) => ({
            order: () => ({ limit: async () => { wolane.push([tabela, kol, k, v]); return { data: [{ id: 'o1', offer_number: 'UD/1', status: 'sent' }] }; } }),
          }),
        }),
      }),
    };
    const s = await szczegoly(sbSql, userSb, ULA, bartek);
    assert.equal(s.email, 'bartek@x.pl');
    assert.equal(s.kontakt.zawod, 'Kierowca');
    assert.ok(s.notatki.length >= 1);
    assert.ok(s.historia.length >= 3);
    assert.equal(s.oferty[0].id, 'o1');
    assert.equal(wolane[0][0], 'ud_offers');
    assert.equal(wolane[0][3], s.klient_id);
    assert.ok(!JSON.stringify(s).includes('81010112345'), 'bez PESEL-u');
  });
  await t('szczegóły: nieistniejący → 404 bez pytania o oferty; śmieciowy id → 400', async () => {
    let wolane = 0;
    const userSb = { from: () => { wolane++; throw new Error('nie powinno być wołane'); } };
    assert.equal(wolane, 0);
    await assert.rejects(szczegoly(sbSql, userSb, ADM, '00000000-0000-4000-8000-000000000000'), (e) => e.status === 404);
    await assert.rejects(szczegoly(sbSql, userSb, ULA, lead('Darek Decyzja')), (e) => e.status === 404, 'cudzy lead jak nieistniejący');
    await assert.rejects(szczegoly(sbSql, userSb, ADM, 'x'), (e) => e.status === 400);
  });

  // ═══ Dane sprzedaży (Wygrany) i statystyki ═══════════════════════════════
  const darek = lead('Darek Decyzja');
  await t('sprzedaż: Wygrany bez danych → 422 brak_danych z polem składki', async () => {
    const r = await zmien(sbSql, OLEK, { leadId: darek, targetStageId: etap('wygrany'), expectedVersion: wersja(darek), idempotencyKey: klucz() });
    assert.equal(r.status, 422);
    assert.equal(r.body.status, 'brak_danych');
    assert.deepEqual(r.body.pola, ['skladka_roczna']);
    assert.equal(etapLeada(darek), 'decyzja');
  });
  await t('sprzedaż: kwoty tekstem i liczbą przechodzą; pola spoza listy i zły wariant są odrzucane przed SQL', async () => {
    const r = await zmien(sbSql, OLEK, {
      leadId: darek, targetStageId: etap('wygrany'), expectedVersion: wersja(darek), idempotencyKey: klucz(),
      transitionData: { sprzedaz: { skladka_roczna: '2 400,00 zł', skladka_mies: 210, wariant_id: 'nie-uuid', sprzedawca_id: ULA, swiadczenie_zgon: '' } },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.lead.sprzedaz.skladka_roczna, 2400);
    assert.equal(r.body.lead.sprzedaz.skladka_mies, 210);
    assert.equal(r.body.lead.sprzedaz.wariant_id, null);
    assert.equal(sql(`select sprzedawca_id from public.ud_leady where id = '${darek}'`), OLEK, 'sprzedawca z opiekuna, nie z ciała żądania');
  });
  await t('sprzedaż: poprawka operacją „sprzedaz", śmieciowa kwota → 400', async () => {
    const r = await zmien(sbSql, OLEK, { op: 'sprzedaz', leadId: darek, expectedVersion: wersja(darek), idempotencyKey: klucz(),
      sprzedaz: { skladka_roczna: 2520, skladka_mies: 210 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.lead.sprzedaz.skladka_roczna, 2520);
    const zla = await zmien(sbSql, OLEK, { op: 'sprzedaz', leadId: darek, expectedVersion: wersja(darek), idempotencyKey: klucz(),
      sprzedaz: { skladka_roczna: 'dużo' } });
    assert.equal(zla.status, 400);
  });
  await t('statystyki: agent widzi swoje (Olek: Darek), administrator wszystkich z podziałem', async () => {
    const o = await statystyki(sbSql, OLEK, new URLSearchParams(`agent=${ULA}`));
    assert.equal(o.agent, OLEK, 'parametr agenta u zwykłego agenta jest ignorowany');
    assert.equal(o.podsumowanie.sprzedaze, 1);
    assert.equal(Number(o.podsumowanie.skladka_roczna_suma), 2520);
    assert.equal(o.wg_agentow, null);
    const a = await statystyki(sbSql, ADM, new URLSearchParams());
    assert.equal(a.podsumowanie.sprzedaze, 2);
    assert.equal(Number(a.podsumowanie.skladka_roczna_suma), 8520);
    assert.equal(a.wg_agentow.length, 2);
    assert.equal(a.okres, 'wszystko');
    const wybrany = await statystyki(sbSql, ADM, new URLSearchParams(`agent=${OLEK}&okres=miesiac`));
    assert.equal(wybrany.podsumowanie.sprzedaze, 1);
    assert.equal(wybrany.okres, 'miesiac');
    await assert.rejects(statystyki(sbSql, INES, new URLSearchParams()), (e) => e.status === 403);
  });
  await t('statystyki: granice okresu w czasie polskim', () => {
    const teraz = new Date('2026-03-31T23:30:00Z');   // w Polsce już 1 kwietnia
    assert.deepEqual(graniceOkresu('miesiac', teraz), { od: '2026-04-01 00:00:00 Europe/Warsaw', do: '2026-05-01 00:00:00 Europe/Warsaw' });
    assert.deepEqual(graniceOkresu('poprzedni', new Date('2026-01-10T10:00:00Z')), { od: '2025-12-01 00:00:00 Europe/Warsaw', do: '2026-01-01 00:00:00 Europe/Warsaw' });
    assert.deepEqual(graniceOkresu('kwartal', teraz), { od: '2026-04-01 00:00:00 Europe/Warsaw', do: '2026-07-01 00:00:00 Europe/Warsaw' });
    assert.deepEqual(graniceOkresu('cokolwiek', teraz), { od: null, do: null });
  });
  await t('warianty: z ofert klienta, sesją agenta; kwoty z wariantu, zgon z parsed_raw', async () => {
    const wolane = [];
    const userSb = {
      from: (tabela) => ({
        select: () => ({
          eq: (k, v) => ({ order: () => ({ limit: async () => { wolane.push([tabela, k, v]); return { data: [{ id: 'o1', offer_number: 'UD/7', status: 'sent' }] }; } }) }),
          in: (k, v) => ({ order: async () => { wolane.push([tabela, k, v]); return { data: [
            { id: 'w1', offer_id: 'o1', insurer_type: 'ceu', product_name: 'LOI Premium', offer_number: 'LOIP/2', premium_total: '4200.00', premium_monthly: null,
              temp_incapacity_covered: true, temp_monthly_benefit: 12000, perm_incapacity_covered: true, perm_sum_insured: 240000, death_covered: true,
              parsed_raw: { death_sum_insured: '100 000' } },
            { id: 'w2', offer_id: 'o1', insurer_type: 'leadenhall', product_name: 'Utrata dochodu (Leadenhall)', offer_number: null, premium_total: 1903,
              premium_monthly: 0, temp_incapacity_covered: true, temp_monthly_benefit: 5000, perm_incapacity_covered: false, death_covered: false },
          ] }; } }),
        }),
      }),
    };
    const w = await warianty(sbSql, userSb, ADM, lead('Gabriel Podkreślnik'));
    // Okno pokazuje numer dokumentu i składki — bez nazwy produktu (decyzja z 02.10.2026).
    assert.deepEqual(w, [
      { id: 'w1', numer: 'LOIP/2', skladka_roczna: 4200, skladka_mies: null, swiadczenie_okresowa: 12000, swiadczenie_trwala: 240000, swiadczenie_zgon: 100000 },
      { id: 'w2', numer: 'UD/7', skladka_roczna: 1903, skladka_mies: null, swiadczenie_okresowa: 5000, swiadczenie_trwala: null, swiadczenie_zgon: null },
    ]);
    assert.ok(!JSON.stringify(w).includes('Utrata dochodu') && !JSON.stringify(w).includes('LOI Premium'));
    assert.deepEqual(wolane.map((x) => x[0]), ['ud_offers', 'ud_offer_documents']);
    await assert.rejects(warianty(sbSql, userSb, ULA, lead('Gabriel Podkreślnik')), (e) => e.status === 404, 'wolny lead — agent nie widzi');
    await assert.rejects(warianty(sbSql, userSb, ADM, '00000000-0000-4000-8000-000000000000'), (e) => e.status === 404);
    await assert.rejects(warianty(sbSql, userSb, ADM, 'x'), (e) => e.status === 400);
  });

  // ═══ Archiwizacja przez API ══════════════════════════════════════════════
  await t('archiwizacja: 200, lead znika z kolumny i liczników; ponowienie → 200; szczegóły → 404', async () => {
    const ewa = lead('Ewa Archiwalna');
    const k = klucz();
    const r = await zmien(sbSql, ADM, { op: 'archiwizuj', leadId: ewa, expectedVersion: wersja(ewa), idempotencyKey: k });
    assert.equal(r.status, 200);
    assert.equal(r.body.zarchiwizowano, true);
    const r2 = await zmien(sbSql, ADM, { op: 'archiwizuj', leadId: ewa, expectedVersion: wersja(ewa) - 1, idempotencyKey: k });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.powtorzone, true);
    const kol = await kolumna(sbSql, ADM, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'data' });
    assert.ok(!kol.karty.some((x) => x.id === ewa));
    await assert.rejects(szczegoly(sbSql, null, ADM, ewa), (e) => e.status === 404);
  });

  // ═══ Zwijanie ════════════════════════════════════════════════════════════
  await t('zwin: zwinięcie, rozwinięcie, rozwiń wszystkie', async () => {
    let r = await zwin(sbSql, OLEK, { pipelineId: P, etapId: etap('nowy'), zwin: true });
    assert.deepEqual(r.body.zwiniete, [etap('nowy')]);
    r = await zwin(sbSql, OLEK, { pipelineId: P, etapId: etap('decyzja'), zwin: true });
    assert.deepEqual(r.body.zwiniete.sort(), [etap('decyzja'), etap('nowy')].sort());
    r = await zwin(sbSql, OLEK, { pipelineId: P, etapId: etap('decyzja'), zwin: false });
    assert.deepEqual(r.body.zwiniete, [etap('nowy')]);
    r = await zwin(sbSql, OLEK, { pipelineId: P, etapId: null, zwin: false });
    assert.deepEqual(r.body.zwiniete, []);
  });
  await t('zwin: stan jest osobny dla użytkownika (K25: wraca po „odświeżeniu")', async () => {
    const t7 = await wczytajTablice(sbSql, null, ADM, new URLSearchParams());
    assert.deepEqual(t7.plan.zwiniete, [etap('oferta')]);
    const t8 = await wczytajTablice(sbSql, null, OLEK, new URLSearchParams());
    assert.deepEqual(t8.plan.zwiniete, []);
  });
  await t('zwin: błędne żądania → 400; obcy etap → 422; nieaktywny agent → 403', async () => {
    const obcy = sql(`select id from public.ud_leady_etap where klucz = 'obcy'`);
    for (const body of [null, { pipelineId: 'x', etapId: null, zwin: false }, { pipelineId: P, etapId: 'x', zwin: true }, { pipelineId: P, etapId: null, zwin: true }, { pipelineId: P, etapId: etap('nowy') }]) {
      await assert.rejects(zwin(sbSql, ULA, body), (e) => e.status === 400, JSON.stringify(body));
    }
    await assert.rejects(zwin(sbSql, ULA, { pipelineId: P, etapId: obcy, zwin: true }), (e) => e.status === 422);
    await assert.rejects(zwin(sbSql, INES, { pipelineId: P, etapId: etap('nowy'), zwin: true }), (e) => e.status === 403);
  });

  // ═══ Polisy (PDF przy leadzie) ═══════════════════════════════════════════
  // Kubełek w pamięci; `from` czyta z bazy testowej (PESEL do hasła PDF).
  const magazyn = new Map();
  const zKubelkiem = ({ rpc = (n, a) => sbSql.rpc(n, a), zepsujZapis = false } = {}) => ({
    rpc,
    from: (tabela) => ({
      select: (kol) => ({
        eq: (k, v) => ({
          maybeSingle: async () => {
            const w = sql(`select to_jsonb(t) from (select ${kol} from public.${tabela} where ${k}::text = '${v}') t`);
            return { data: w ? JSON.parse(w) : null, error: null };
          },
        }),
      }),
    }),
    storage: {
      from: (kubelek) => ({
        upload: async (sciezka, bajty) => {
          if (zepsujZapis) return { data: null, error: { message: 'storage down' } };
          magazyn.set(`${kubelek}/${sciezka}`, bajty);
          return { data: {}, error: null };
        },
        remove: async (sciezki) => { for (const x of sciezki) magazyn.delete(`${kubelek}/${x}`); return { data: [], error: null }; },
        createSignedUrl: async (sciezka, sekundy, opcje) =>
          ({ data: { signedUrl: `https://storage.test/${kubelek}/${sciezka}?ttl=${sekundy}&nazwa=${encodeURIComponent(opcje?.download ?? '')}` }, error: null }),
        download: async (sciezka) => {
          const b = magazyn.get(`${kubelek}/${sciezka}`);
          return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: 'Object not found' } };
        },
      }),
    },
  });
  const PDF = new TextEncoder().encode('%PDF-1.4\n%polisa testowa\n');
  const ZPOLISY = { offer_number: 'LHQ1/1', premium_total: '1500.00', premium_monthly: '125', temp_incapacity_covered: true,
    temp_monthly_benefit: 4000, perm_incapacity_covered: false, death_covered: false };
  const bartekPlik = lead('Bartek Nowak');
  let plikBartka;

  await t('polisa: opiekun wgrywa — plik w prywatnym kubełku, wiersz i historia; kwoty z czytnika do sprawdzenia', async () => {
    const h = historia(bartekPlik);
    const r = await wgrajPolise(zKubelkiem(), ULA, bartekPlik, { nazwa: 'C:\\skany\\polisa  Bartka.pdf', bajty: PDF },
      { odczytaj: async () => ZPOLISY });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    plikBartka = r.body.plik.id;
    assert.equal(r.body.plik.nazwa, 'polisa  Bartka.pdf', 'bez ścieżki z dysku');
    assert.deepEqual(r.body.kwoty, { numer: 'LHQ1/1', skladka_roczna: 1500, skladka_mies: 125, swiadczenie_okresowa: 4000,
      swiadczenie_trwala: null, swiadczenie_zgon: null });
    assert.match(r.body.komunikat, /sprawdź/);
    const klucze = [...magazyn.keys()];
    assert.equal(klucze.length, 1);
    assert.match(klucze[0], new RegExp(`^ud-polisy/${bartekPlik}/[0-9a-f-]{36}\\.pdf$`));
    assert.equal(sql(`select sciezka from public.ud_leady_pliki where id = '${plikBartka}'`), klucze[0].slice('ud-polisy/'.length));
    assert.equal(historia(bartekPlik), h + 1);
  });
  await t('polisa: hasło PDF = 4 ostatnie cyfry PESEL-u, czytane na serwerze; inne hasło → zapis bez kwot', async () => {
    const hasla = [];
    const zHaslem = (dobre) => async (_b, haslo) => {
      hasla.push(haslo);
      if (haslo !== dobre) throw Object.assign(new Error('No password given'), { name: 'PasswordException' });
      return ZPOLISY;
    };
    const r = await wgrajPolise(zKubelkiem(), ULA, bartekPlik, { nazwa: 'p.pdf', bajty: PDF }, { odczytaj: zHaslem('2345') });
    assert.deepEqual(hasla, [undefined, '2345']);
    assert.equal(r.body.kwoty.skladka_roczna, 1500);
    const r2 = await wgrajPolise(zKubelkiem(), ULA, bartekPlik, { nazwa: 'p.pdf', bajty: PDF }, { odczytaj: zHaslem('9999') });
    assert.equal(r2.status, 200, 'plik i tak zapisany');
    assert.equal(r2.body.kwoty, null);
    assert.match(r2.body.komunikat, /hasło/);
    assert.ok(!JSON.stringify([r.body, r2.body]).includes('81010112345'), 'PESEL nie wychodzi w odpowiedzi');
  });
  await t('polisa: dokument w nieznanym układzie → zapis bez kwot, z prośbą o wpisanie ręcznie', async () => {
    const r = await wgrajPolise(zKubelkiem(), ULA, bartekPlik, { nazwa: 'p.pdf', bajty: PDF },
      { odczytaj: async () => { throw new Error('Nie rozpoznano szablonu oferty (Leadenhall/CEU).'); } });
    assert.equal(r.status, 200);
    assert.equal(r.body.kwoty, null);
    assert.match(r.body.komunikat, /ręcznie/);
  });
  await t('polisa: cudzy lead → 404, nie-PDF → 415, pusty → 400, za duży → 413, nieaktywny → 403 — nic w kubełku', async () => {
    const przed = magazyn.size;
    const odczytaj = async () => ZPOLISY;
    await assert.rejects(wgrajPolise(zKubelkiem(), ULA, lead('Darek Decyzja'), { nazwa: 'p.pdf', bajty: PDF }, { odczytaj }), (e) => e.status === 404);
    await assert.rejects(wgrajPolise(zKubelkiem(), ULA, bartekPlik, { nazwa: 'p.pdf', bajty: new TextEncoder().encode('<html>') }), (e) => e.status === 415);
    await assert.rejects(wgrajPolise(zKubelkiem(), ULA, bartekPlik, { nazwa: 'p.pdf', bajty: new Uint8Array() }), (e) => e.status === 400);
    const duzy = new Uint8Array(10 * 1024 * 1024 + 1); duzy.set(PDF);
    await assert.rejects(wgrajPolise(zKubelkiem(), ULA, bartekPlik, { nazwa: 'p.pdf', bajty: duzy }), (e) => e.status === 413);
    await assert.rejects(wgrajPolise(zKubelkiem(), INES, bartekPlik, { nazwa: 'p.pdf', bajty: PDF }), (e) => e.status === 403);
    await assert.rejects(wgrajPolise(zKubelkiem(), ULA, 'x', { nazwa: 'p.pdf', bajty: PDF }), (e) => e.status === 400);
    assert.equal(magazyn.size, przed);
  });
  await t('polisa: SQL odmawia zapisu wiersza → obiekt usunięty z kubełka; awaria kubełka → 502 bez wiersza', async () => {
    const przed = magazyn.size;
    const wiersze = sql(`select count(*) from public.ud_leady_pliki`);
    const odmowa = zKubelkiem({ rpc: (n, a) => (n === 'ud_lead_plik_dodaj'
      ? Promise.resolve({ data: { status: 'brak_leada', komunikat: 'x' }, error: null }) : sbSql.rpc(n, a)) });
    const r = await wgrajPolise(odmowa, ULA, bartekPlik, { nazwa: 'p.pdf', bajty: PDF });
    assert.equal(r.status, 404);
    assert.equal(magazyn.size, przed, 'osierocony plik sprzątnięty');
    await assert.rejects(wgrajPolise(zKubelkiem({ zepsujZapis: true }), ULA, bartekPlik, { nazwa: 'p.pdf', bajty: PDF }),
      (e) => e.status === 502 && e.body.ponow === true && !JSON.stringify(e.body).includes('storage down'));
    assert.equal(sql(`select count(*) from public.ud_leady_pliki`), wiersze);
  });
  await t('plik: adres podpisany na minutę dla opiekuna i administratora; inny agent → 404', async () => {
    const u = await adresPliku(zKubelkiem(), ULA, plikBartka);
    assert.match(u, /^https:\/\/storage\.test\/ud-polisy\/.+\.pdf\?ttl=60&nazwa=polisa%20%20Bartka\.pdf$/);
    assert.ok(await adresPliku(zKubelkiem(), ADM, plikBartka));
    await assert.rejects(adresPliku(zKubelkiem(), OLEK, plikBartka), (e) => e.status === 404);
    await assert.rejects(adresPliku(zKubelkiem(), ULA, 'x'), (e) => e.status === 400);
  });
  await t('szczegóły: lista polis leada', async () => {
    const s = await szczegoly(sbSql, null, ULA, bartekPlik);
    assert.ok(s.pliki.length >= 3 && s.pliki.every((f) => f.id && f.nazwa && f.dodal_nazwa === 'Ula Agent'));
    assert.ok(!JSON.stringify(s.pliki).includes('ud-polisy/'), 'ścieżki w kubełku nie wychodzą do przeglądarki');
  });
  // ═══ Część 5: składka bez opłaty dystrybucyjnej, odczyt polis, „Dodaj polisę" ═
  await t('kwoty z dokumentu: składka bez opłaty dystrybucyjnej (3036/253 z opłatą 276 → 2760/230)', () => {
    assert.deepEqual(kwotyZDokumentu({ offer_number: 'LHQ1/1', premium_total: '3036.00', premium_monthly: 253, distribution_fee: 276,
      temp_incapacity_covered: true, temp_monthly_benefit: 4000 }),
    { numer: 'LHQ1/1', skladka_roczna: 2760, skladka_mies: 230, swiadczenie_okresowa: 4000, swiadczenie_trwala: null, swiadczenie_zgon: null });
    // Wynik czytnika z opłatą w parsed_raw (jak w createOfferFromPdfs).
    const z = kwotyZDokumentu({ premium_total: 7176, premium_monthly: 598, parsed_raw: { distribution_fee: 648 } });
    assert.deepEqual([z.skladka_roczna, z.skladka_mies], [6528, 544]);
    // CEU bez opłaty; opłata nie mniejsza od składki to śmieci z czytnika — kwota bez zmian.
    assert.equal(kwotyZDokumentu({ premium_total: 4200, distribution_fee: null }).skladka_roczna, 4200);
    assert.equal(kwotyZDokumentu({ premium_total: 100, distribution_fee: 150 }).skladka_roczna, 100);
  });
  await t('warianty: odpowiedź niesie polisy leada (bez ścieżek w kubełku); kwoty wariantu bez opłaty', async () => {
    const userSb = {
      from: () => ({
        select: () => ({
          eq: () => ({ order: () => ({ limit: async () => ({ data: [{ id: 'o1', offer_number: 'UD/7' }] }) }) }),
          in: () => ({ order: async () => ({ data: [{ id: 'w1', offer_id: 'o1', offer_number: 'LHQ1/1', premium_total: 3036, premium_monthly: 253,
            distribution_fee: 276, temp_incapacity_covered: true, temp_monthly_benefit: 4000 }] }) }),
        }),
      }),
    };
    const r = await odpowiedzWariantow(sbSql, userSb, ULA, bartekPlik);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.warianty[0].skladka_roczna, r.body.warianty[0].skladka_mies], [2760, 230]);
    assert.ok(r.body.polisy.length >= 3 && r.body.polisy.every((f) => f.id && f.nazwa && !('sciezka' in f)));
  });
  await t('odczyt wgranej polisy: kwoty bez opłaty, hasło z PESEL-u klienta; cudzy lead albo plik innego leada → 404', async () => {
    const hasla = [];
    const odczytaj = async (_b, haslo) => {
      hasla.push(haslo);
      if (haslo !== '2345') throw Object.assign(new Error('No password given'), { name: 'PasswordException' });
      return { ...ZPOLISY, premium_total: '3036.00', premium_monthly: '253', distribution_fee: 276 };
    };
    const przed = magazyn.size;
    const r = await odczytajWgranaPolise(zKubelkiem(), ULA, bartekPlik, plikBartka, { odczytaj });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.kwoty.skladka_roczna, r.body.kwoty.skladka_mies], [2760, 230]);
    assert.deepEqual(hasla, [undefined, '2345']);
    assert.match(r.body.komunikat, /sprawdź/);
    assert.ok(!JSON.stringify(r.body).includes('81010112345'), 'PESEL nie wychodzi w odpowiedzi');
    assert.equal(magazyn.size, przed, 'odczyt niczego nie zapisuje');
    await assert.rejects(odczytajWgranaPolise(zKubelkiem(), OLEK, bartekPlik, plikBartka, { odczytaj }), (e) => e.status === 404);
    await assert.rejects(odczytajWgranaPolise(zKubelkiem(), ADM, lead('Darek Decyzja'), plikBartka, { odczytaj }), (e) => e.status === 404);
    await assert.rejects(odczytajWgranaPolise(zKubelkiem(), ULA, bartekPlik, 'x', { odczytaj }), (e) => e.status === 400);
  });
  await t('nowa polisa, odczyt przed zapisem: hasło z pola PESEL; bez hasła „brak", złe „zle"; nic nie zapisuje', async () => {
    const zHaslem = async (_b, haslo) => {
      if (haslo !== '2345') throw Object.assign(new Error('Incorrect Password'), { name: 'PasswordException' });
      return { ...ZPOLISY, distribution_fee: 150 };
    };
    const przed = magazyn.size;
    let r = await odczytajPoliseNowa(sbSql, ULA, PDF, '2345', { odczytaj: zHaslem });
    assert.deepEqual([r.body.kwoty.skladka_roczna, r.body.kwoty.skladka_mies, r.body.haslo], [1350, 112.5, null]);
    r = await odczytajPoliseNowa(sbSql, ULA, PDF, null, { odczytaj: zHaslem });
    assert.deepEqual([r.body.kwoty, r.body.haslo], [null, 'brak']);
    assert.match(r.body.komunikat, /PESEL/);
    r = await odczytajPoliseNowa(sbSql, ULA, PDF, '9999', { odczytaj: zHaslem });
    assert.equal(r.body.haslo, 'zle');
    r = await odczytajPoliseNowa(sbSql, ULA, PDF, '12ab', { odczytaj: zHaslem });
    assert.equal(r.body.haslo, 'brak', 'nagłówek spoza 4 cyfr nie jest hasłem');
    await assert.rejects(odczytajPoliseNowa(sbSql, ULA, new TextEncoder().encode('<html>'), null, { odczytaj: zHaslem }), (e) => e.status === 415);
    await assert.rejects(odczytajPoliseNowa(sbSql, INES, PDF, null, { odczytaj: zHaslem }), (e) => e.status === 403);
    assert.equal(magazyn.size, przed);
  });
  await t('dodaj polisę: klient i lead w Wygrany; ponowienie tym samym kluczem; ten sam PESEL → 409; błędy → 400/403/422', async () => {
    const body = { idempotencyKey: klucz(), userId: ADM, dataSprzedazy: '2026-09-15',
      klient: { imieNazwisko: 'Zenon Polisa', pesel: '90010154321', email: 'zenon@x.pl', telefon: '600 100 200' },
      sprzedaz: { skladka_roczna: '2 760', skladka_mies: 230, swiadczenie_okresowa: 4000, wariant_id: 'nie-uuid' } };
    const r = await dodajPolise(sbSql, ULA, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const l = r.body.lead_id;
    assert.equal(sql(`select tt.etap_leada('${l}')`), 'wygrany');
    assert.equal(sql(`select opiekun_id || '|' || sprzedawca_id || '|' || skladka_roczna from public.ud_leady where id = '${l}'`), `${ULA}|${ULA}|2760.00`,
      'użytkownik z sesji, nie z ciała');
    const r2 = await dodajPolise(sbSql, ULA, body);
    assert.deepEqual([r2.status, r2.body.lead_id, r2.body.powtorzone], [200, l, true]);
    const r3 = await dodajPolise(sbSql, ULA, { ...body, idempotencyKey: klucz() });
    assert.deepEqual([r3.status, r3.body.status, r3.body.lead_id], [409, 'klient_istnieje', l]);
    const r4 = await dodajPolise(sbSql, ULA, { ...body, idempotencyKey: klucz(), klient: { imieNazwisko: 'Bez Skladki' }, sprzedaz: {} });
    assert.deepEqual([r4.status, r4.body.pola], [422, ['skladka_roczna']]);
    const r5 = await dodajPolise(sbSql, ULA, { ...body, idempotencyKey: klucz(), klient: { imieNazwisko: 'Dla Olka' }, agentId: OLEK });
    assert.equal(r5.status, 403);
    await assert.rejects(dodajPolise(sbSql, ULA, { ...body, idempotencyKey: 'x' }), (e) => e.status === 400);
    await assert.rejects(dodajPolise(sbSql, ULA, { ...body, idempotencyKey: klucz(), agentId: 'x' }), (e) => e.status === 400);
    await assert.rejects(dodajPolise(sbSql, ULA, null), (e) => e.status === 400);
  });
  await t('statystyki: prowizja i stawka w odpowiedzi (agent: własna stawka)', async () => {
    sql(`update public.ud_user_profiles set prowizja_procent = 20 where id = '${ULA}'`);
    const s = await statystyki(sbSql, ULA, new URLSearchParams());
    assert.equal(Number(s.stawka), 20);
    assert.ok(Number(s.podsumowanie.prowizja_suma) > 0 && s.podsumowanie.bez_stawki === 0);
    sql(`update public.ud_user_profiles set prowizja_procent = null where id = '${ULA}'`);
  });
  // ═══ Część 6: wykaz polis ══════════════════════════════════════════════════
  await t('wykaz polis: numer i okres ochrony przechodzą przez zmianę stanu (biała lista), agent widzi swoje, admin wszystkie', async () => {
    const leadZenona = sql(`select l.id from public.ud_leady l join public.ud_clients c on c.id = l.klient_id where c.full_name = 'Zenon Polisa'`);
    const wersja = Number(sql(`select wersja from public.ud_leady where id = '${leadZenona}'`));
    const r = await zmien(sbSql, ULA, { op: 'sprzedaz', leadId: leadZenona, expectedVersion: wersja, idempotencyKey: klucz(),
      sprzedaz: { skladka_roczna: 2760, skladka_mies: 230, polisa_numer: 'LHP 9/2026', ochrona_od: '2026-09-15', ochrona_do: '2027-09-14', obce: 'x' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(sql(`select polisa_numer || '|' || ochrona_od || '|' || ochrona_do from public.ud_leady where id = '${leadZenona}'`),
      'LHP 9/2026|2026-09-15|2027-09-14');
    const zle = await zmien(sbSql, ULA, { op: 'sprzedaz', leadId: leadZenona, expectedVersion: wersja + 1, idempotencyKey: klucz(),
      sprzedaz: { skladka_roczna: 2760, ochrona_od: '2026-09-15', ochrona_do: '2026-09-01' } });
    assert.deepEqual([zle.status, zle.body.pola], [400, ['ochrona_do']]);

    const w = await polisy(sbSql, ULA, new URLSearchParams('agent=' + OLEK));
    assert.equal(w.rola, 'user');
    assert.equal(w.okres, 'wszystko');
    assert.ok(w.polisy.every((x) => x.agent_id === ULA), 'agent nie podejrzy cudzych także parametrem');
    const z = w.polisy.find((x) => x.lead_id === leadZenona);
    assert.deepEqual([z.numer, z.ochrona_od, z.ochrona_do, Number(z.skladka_mies)], ['LHP 9/2026', '2026-09-15', '2027-09-14', 230]);
    const a = await polisy(sbSql, ADM, new URLSearchParams('okres=cokolwiek'));
    assert.ok(a.polisy.length > w.polisy.length && Array.isArray(a.agenci) && a.okres === 'wszystko');
    await assert.rejects(polisy(sbSql, INES, new URLSearchParams()), (e) => e.status === 403);
  });
  await t('dodaj polisę: numer i okres ochrony z okna zapisane', async () => {
    const r = await dodajPolise(sbSql, ULA, { idempotencyKey: klucz(), klient: { imieNazwisko: 'Olga Okresowa' },
      sprzedaz: { skladka_roczna: 1500, polisa_numer: 'N-77', ochrona_od: '2026-08-01', ochrona_do: '2027-07-31' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(sql(`select polisa_numer || '|' || ochrona_do from public.ud_leady where id = '${r.body.lead_id}'`), 'N-77|2027-07-31');
  });
  await t('przetworz: polisa przyjmuje tylko application/pdf (formularz z cudzej strony → 415)', async () => {
    const r = await przetworz({ user: { id: ULA }, oczekiwanyTyp: 'application/pdf', typTresci: 'multipart/form-data; boundary=x',
      czytajCialo: async () => { throw new Error('nie powinno być czytane'); }, wykonaj: async () => ({ status: 200, body: {} }) });
    assert.equal(r.status, 415);
  });

  // ═══ Klienci widoczni (zakładka „Klienci", wybór klienta w ofercie) ══════
  await t('klienci: administrator — wszyscy (null), agent — klienci swoich leadów, nieaktywny — nikt', async () => {
    assert.equal(await klienciWidoczni(sbSql, ADM), null);
    const ula = await klienciWidoczni(sbSql, ULA);
    const bartekKlient = sql(`select klient_id from public.ud_leady where id = '${bartekPlik}'`);
    const darekKlient = sql(`select klient_id from public.ud_leady where id = '${lead('Darek Decyzja')}'`);
    assert.ok(ula.includes(bartekKlient) && !ula.includes(darekKlient));
    assert.deepEqual(await klienciWidoczni(sbSql, INES), []);
    assert.equal(await klientWidoczny(sbSql, ULA, bartekKlient), true);
    assert.equal(await klientWidoczny(sbSql, ULA, darekKlient), false);
    assert.equal(await klientWidoczny(sbSql, ADM, darekKlient), true);
  });

  // ═══ Błędy infrastruktury i obsługa żądania ══════════════════════════════
  await t('błąd bazy → 502 bez surowego komunikatu', async () => {
    const wadliwy = { rpc: async () => ({ data: null, error: { code: 'XX000', message: 'connection to 10.0.0.5 refused (secret detail)' } }) };
    await assert.rejects(
      zmien(wadliwy, ULA, { leadId: bartek, targetStageId: etap('kontakt'), expectedVersion: 1, idempotencyKey: klucz() }),
      (e) => e.status === 502 && !JSON.stringify(e.body).includes('secret') && e.body.ponow === true,
    );
  });
  await t('nieznany wynik funkcji SQL → 500, nie „ok"', async () => {
    const dziwny = { rpc: async () => ({ data: { status: 'cos_nowego' }, error: null }) };
    await assert.rejects(
      zmien(dziwny, ULA, { leadId: bartek, targetStageId: etap('kontakt'), expectedVersion: 1, idempotencyKey: klucz() }),
      (e) => e.status === 500,
    );
  });
  await t('przetworz: brak sesji → 401; zły typ treści → 415; zły JSON → 400', async () => {
    const wykonaj = async () => { throw new Error('nie powinno dojść'); };
    assert.equal((await przetworz({ user: null, wykonaj })).status, 401);
    assert.equal((await przetworz({ user: { id: ULA }, typTresci: 'text/plain', czytajCialo: async () => ({}), wykonaj })).status, 415);
    assert.equal((await przetworz({ user: { id: ULA }, typTresci: 'application/x-www-form-urlencoded', czytajCialo: async () => ({}), wykonaj })).status, 415);
    assert.equal((await przetworz({ user: { id: ULA }, typTresci: null, czytajCialo: async () => ({}), wykonaj })).status, 415);
    assert.equal((await przetworz({ user: { id: ULA }, typTresci: 'application/json', czytajCialo: async () => { throw new SyntaxError('x'); }, wykonaj })).status, 400);
  });
  await t('przetworz: odczyt nie wymaga treści; user.id trafia do wykonania; błąd obcy → 500 bez wycieku', async () => {
    const r = await przetworz({ user: { id: ULA }, odczyt: true, wykonaj: async ({ userId }) => ({ status: 200, body: { userId } }) });
    assert.deepEqual(r, { status: 200, body: { userId: ULA } });
    const e500 = await przetworz({ user: { id: ULA }, odczyt: true, wykonaj: async () => { throw new Error('sekret: hasło=abc'); } });
    assert.equal(e500.status, 500);
    assert.ok(!JSON.stringify(e500.body).includes('sekret'));
    const e409 = await przetworz({ user: { id: ULA }, odczyt: true, wykonaj: async () => { throw new BladApi(409, { status: 'blad', komunikat: 'x' }); } });
    assert.equal(e409.status, 409);
  });
  await t('przetworz: ciało JSON nie może podmienić użytkownika', async () => {
    const r = await przetworz({
      user: { id: ULA }, typTresci: 'application/json; charset=utf-8',
      czytajCialo: async () => ({ userId: ADM }),
      wykonaj: async ({ userId, body }) => ({ status: 200, body: { userId, zCiala: body.userId } }),
    });
    assert.equal(r.body.userId, ULA);
  });

  // Kontrakt: każda funkcja SQL wołana przez warstwę serwerową istniała w teście.
  await t('kontrakt: wszystkie funkcje SQL z leady.js były wołane (nazwy argumentów zgodne z sygnaturą)', () => {
    const wolane = new Set(sbSql.wywolania.map(([n]) => n));
    for (const f of ['ud_leady_plan', 'ud_leady_synchronizuj', 'ud_leady_liczniki', 'ud_leady_kolumna', 'ud_lead_szczegoly', 'ud_lead_zmien', 'ud_lead_notatka', 'ud_leady_zwin',
                     'ud_lead_plik', 'ud_lead_plik_dodaj', 'ud_lead_polisa_reczna', 'ud_leady_statystyki', 'ud_leady_polisy']) {
      assert.ok(wolane.has(f), `nie wołano ${f}`);
    }
  });
} finally {
  klaster.stop();
}

for (const b of bledy) console.log(b);
console.log(`\nAPI: ${pass} PASS, ${bledy.length} FAIL`);
process.exit(bledy.length === 0 && pass > 0 ? 0 : 1);
