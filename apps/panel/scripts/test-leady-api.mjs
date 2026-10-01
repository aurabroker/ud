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
  przetworz,
  synchronizuj,
  szczegoly,
  wczytajPlan,
  wczytajTablice,
  zmien,
  zwin,
} from '../src/lib/server/leady.js';
import { uruchomKlaster } from './lib/pg-tymczasowy.mjs';

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

  await sbSql.rpc('ud_leady_zwin', { p_user: ULA, p_pipeline: sql('select tt.pipeline()'), p_etap: etap('oferta'), p_zwin: true });
  const tablica = await wczytajTablice(sbSql, null, ULA, new URLSearchParams());
  await t('tablica: synchronizacja dopisała 8 klientów i szkic ze zgodą', () => {
    assert.equal(tablica.synchronizacja, true);
    assert.equal(sql('select count(*) from public.ud_leady'), '9');
  });
  await t('tablica: plan z sześcioma etapami i zwiniętą „Ofertą" tego użytkownika', () => {
    assert.deepEqual(tablica.plan.etapy.map((e) => e.klucz), ['nowy', 'kontakt', 'oferta', 'decyzja', 'wygrany', 'przegrany']);
    assert.deepEqual(tablica.plan.zwiniete, [etap('oferta')]);
    assert.equal(tablica.plan.rola, 'user');
  });
  await t('tablica: karty tylko dla rozwiniętych kolumn, liczniki dla wszystkich', () => {
    assert.equal(Object.keys(tablica.kolumny).length, 5);
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
    const t2 = await wczytajTablice(sbSql, null, ULA, new URLSearchParams('produkt=okresowa'));
    assert.equal(t2.filtrAktywny, true);
    assert.equal(t2.liczniki[etap('nowy')].ile, 2);
    assert.equal(t2.liczniki[etap('nowy')].ileWszystkich, 4);
    assert.equal(t2.liczniki[etap('nowy')].suma, 20000);
    assert.equal(t2.kolumny[etap('nowy')].karty.length, 2);
  });
  await t('tablica: nieznany pipeline w adresie → domyślny, bez błędu', async () => {
    const t3 = await wczytajTablice(sbSql, null, ULA, new URLSearchParams('pipeline=00000000-0000-4000-8000-000000000000'));
    assert.equal(t3.plan.pipeline.klucz, 'sprzedaz');
  });
  await t('tablica: ?lead=<id> otwiera szczegóły, nieistniejący → otwartyBrak', async () => {
    const id = lead('Anna Kowalska');
    const t4 = await wczytajTablice(sbSql, null, ULA, new URLSearchParams(`lead=${id}`));
    assert.equal(t4.otwarty.lead.id, id);
    assert.equal(t4.otwarty.email, 'anna@x.pl');
    const t5 = await wczytajTablice(sbSql, null, ULA, new URLSearchParams('lead=00000000-0000-4000-8000-000000000000'));
    assert.equal(t5.otwarty, null);
    assert.equal(t5.otwartyBrak, true);
  });
  await t('tablica: awaria synchronizacji nie blokuje tablicy', async () => {
    const zepsuty = { rpc: (n, a) => (n === 'ud_leady_synchronizuj' ? Promise.resolve({ data: null, error: { message: 'boom' } }) : sbSql.rpc(n, a)) };
    const t6 = await wczytajTablice(zepsuty, null, ULA, new URLSearchParams());
    assert.equal(t6.synchronizacja, false);
    assert.equal(t6.plan.etapy.length, 6);
  });
  await t('synchronizuj: zwraca false przy błędzie, nie rzuca', async () => {
    assert.equal(await synchronizuj({ rpc: async () => { throw new Error('sieć'); } }), false);
  });

  // ═══ Kolumny: stronicowanie ══════════════════════════════════════════════
  const plan = await wczytajPlan(sbSql, ULA, null);
  const P = plan.pipeline.id;
  await t('kolumna: strony po 2 — rozłączne, komplet, razem stałe', async () => {
    const a = await kolumna(sbSql, ULA, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'data', limit: 2, offset: 0 });
    const b = await kolumna(sbSql, ULA, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'data', limit: 2, offset: 2 });
    assert.equal(a.razem, 4);
    assert.equal(b.razem, 4);
    const ids = [...a.karty, ...b.karty].map((k) => k.id);
    assert.equal(new Set(ids).size, 4);
  });
  await t('kolumna: limit ograniczony do 100, śmieciowe offset/limit → domyślne', async () => {
    const k = await kolumna(sbSql, ULA, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'zly', limit: 'abc', offset: -5 });
    assert.equal(k.karty.length, 4);
    const k2 = await kolumna(sbSql, ULA, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'data', limit: 10_000_000, offset: 0 });
    assert.equal(k2.karty.length, 4);
  });
  await t('kolumna: etap spoza uuid → 400', async () => {
    await assert.rejects(kolumna(sbSql, ULA, { pipelineId: P, etapId: 'x', filtr: {}, sort: 'data' }), (e) => e.status === 400);
  });
  await t('kolumna: etap obcego pipeline\'u daje pustą kolumnę, nie cudze karty', async () => {
    const k = await kolumna(sbSql, ULA, { pipelineId: P, etapId: '00000000-0000-4000-8000-000000000000', filtr: {}, sort: 'data' });
    assert.equal(k.karty.length, 0);
    assert.equal(k.razem, 0);
  });
  await t('liczniki: mapa po etapie', async () => {
    const l = await liczniki(sbSql, ULA, P, {});
    assert.equal(Object.keys(l).length, 6);
    assert.equal(l[etap('decyzja')].ile, 1);
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
    await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('kontakt'), expectedVersion: v, idempotencyKey: k });
    const h = historia(bartek);
    const r = await zmien(sbSql, ULA, { leadId: bartek, targetStageId: etap('kontakt'), expectedVersion: v, idempotencyKey: k });
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
  await t('zmien: opiekun — zwolnienie własnego i przejęcie; administrator przepisuje', async () => {
    let r = await zmien(sbSql, ULA, { op: 'opiekun', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), opiekunId: null });
    assert.equal(r.status, 200);
    assert.equal(r.body.lead.opiekun_id, null);
    r = await zmien(sbSql, OLEK, { op: 'opiekun', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), opiekunId: OLEK });
    assert.equal(r.status, 200);
    r = await zmien(sbSql, ULA, { op: 'opiekun', leadId: bartek, expectedVersion: wersja(bartek), idempotencyKey: klucz(), opiekunId: ULA });
    assert.equal(r.status, 403, 'cudzego opiekuna agent nie przejmie');
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
    const s = await szczegoly(sbSql, userSb, bartek);
    assert.equal(s.email, 'bartek@x.pl');
    assert.equal(s.kontakt.zawod, 'Kierowca');
    assert.ok(s.notatki.length >= 1);
    assert.ok(s.historia.length >= 3);
    assert.equal(s.oferty[0].id, 'o1');
    assert.equal(wolane[0][0], 'ud_offers');
    assert.equal(wolane[0][3], s.klient_id);
    assert.ok(!JSON.stringify(s).includes('81010112345'), 'bez PESEL-u');
  });
  await t('szczegóły: szkic nie odpytuje ofert; nieistniejący → 404; śmieciowy id → 400', async () => {
    let wolane = 0;
    const userSb = { from: () => { wolane++; throw new Error('nie powinno być wołane'); } };
    const s = await szczegoly(sbSql, userSb, lead('Szymon Szkic'));
    assert.equal(s.klient_id, null);
    assert.deepEqual(s.oferty, []);
    assert.equal(wolane, 0);
    await assert.rejects(szczegoly(sbSql, userSb, '00000000-0000-4000-8000-000000000000'), (e) => e.status === 404);
    await assert.rejects(szczegoly(sbSql, userSb, 'x'), (e) => e.status === 400);
  });

  // ═══ Archiwizacja przez API ══════════════════════════════════════════════
  await t('archiwizacja: 200, lead znika z kolumny i liczników; ponowienie → 200; szczegóły → 404', async () => {
    const ewa = lead('Ewa Archiwalna');
    const k = klucz();
    const r = await zmien(sbSql, ULA, { op: 'archiwizuj', leadId: ewa, expectedVersion: wersja(ewa), idempotencyKey: k });
    assert.equal(r.status, 200);
    assert.equal(r.body.zarchiwizowano, true);
    const r2 = await zmien(sbSql, ULA, { op: 'archiwizuj', leadId: ewa, expectedVersion: wersja(ewa) - 1, idempotencyKey: k });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.powtorzone, true);
    const kol = await kolumna(sbSql, ULA, { pipelineId: P, etapId: etap('nowy'), filtr: {}, sort: 'data' });
    assert.ok(!kol.karty.some((x) => x.id === ewa));
    await assert.rejects(szczegoly(sbSql, null, ewa), (e) => e.status === 404);
  });

  // ═══ Zwijanie ════════════════════════════════════════════════════════════
  await t('zwin: zwinięcie, rozwinięcie, rozwiń wszystkie', async () => {
    let r = await zwin(sbSql, OLEK, { pipelineId: P, etapId: etap('kontakt'), zwin: true });
    assert.deepEqual(r.body.zwiniete, [etap('kontakt')]);
    r = await zwin(sbSql, OLEK, { pipelineId: P, etapId: etap('decyzja'), zwin: true });
    assert.deepEqual(r.body.zwiniete.sort(), [etap('decyzja'), etap('kontakt')].sort());
    r = await zwin(sbSql, OLEK, { pipelineId: P, etapId: etap('decyzja'), zwin: false });
    assert.deepEqual(r.body.zwiniete, [etap('kontakt')]);
    r = await zwin(sbSql, OLEK, { pipelineId: P, etapId: null, zwin: false });
    assert.deepEqual(r.body.zwiniete, []);
  });
  await t('zwin: stan jest osobny dla użytkownika (K25: wraca po „odświeżeniu")', async () => {
    const t7 = await wczytajTablice(sbSql, null, ULA, new URLSearchParams());
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
    for (const f of ['ud_leady_plan', 'ud_leady_synchronizuj', 'ud_leady_liczniki', 'ud_leady_kolumna', 'ud_lead_szczegoly', 'ud_lead_zmien', 'ud_lead_notatka', 'ud_leady_zwin']) {
      assert.ok(wolane.has(f), `nie wołano ${f}`);
    }
  });
} finally {
  klaster.stop();
}

for (const b of bledy) console.log(b);
console.log(`\nAPI: ${pass} PASS, ${bledy.length} FAIL`);
process.exit(bledy.length === 0 && pass > 0 ? 0 : 1);
