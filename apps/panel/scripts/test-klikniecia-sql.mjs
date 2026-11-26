/**
 * Kontrakt panelu z bazą dla tabeli „Kup online u Leadenhall — kliknięcia"
 * (Niedokończone): prawdziwe migracje kliknięć na jednorazowym Postgresie,
 * wynik `ud_klikniecia_tabela` tak, jak oddałby go PostgREST, i ta sama
 * funkcja `klikniecia()` co na stronie.
 *
 *   node scripts/test-klikniecia-sql.mjs   (część pnpm test:klikniecia)
 *
 * Dwa stany bazy, oba możliwe na produkcji:
 *  1. przed migracją 20261120100000 (panel v.0.80 wdrożony wcześniej) — wiersze
 *     bez `z_reklamy`: strona nie może pokazać zer „z reklamy";
 *  2. po niej — `z_reklamy` i `zmierzonych` na tydzień i razem, także
 *     w zwiniętych miejscach; kliknięcia sprzed migracji (`platne` NULL) to
 *     „—", nie zero.
 *
 * Wymaga binariów Postgresa (lib/pg-tymczasowy.mjs) — bez nich kończy się
 * błędem, nie zielonym wynikiem.
 */
import assert from 'node:assert/strict';
import { uruchomKlaster, wczytaj } from './lib/pg-tymczasowy.mjs';
import { klikniecia, odTygodnia, dzisWPolsce, MIEJSC, POZOSTALE } from '../src/lib/klikniecia.js';

const PRZED = [
  'supabase/migrations/20261111101126_klikniecia.sql',
  'supabase/migrations/20261111130054_klikniecia_tydzien.sql',
  'supabase/migrations/20261111130946_klikniecia_tabela.sql',
];
const MIGRACJA_REKLAMY = 'supabase/migrations/20261120100000_klikniecia_zrodlo_reklamy.sql';

let klaster;
try {
  klaster = await uruchomKlaster();
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const sql = (q) => {
  const r = klaster.psql(q);
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
// Jak PostgREST: zbiór wierszy funkcji jako tablica obiektów JSON.
const tabela = () => JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from public.ud_klikniecia_tabela('${odTygodnia(dzisWPolsce())}'::date, ${MIEJSC}) t`));

let ok = 0;
const bledy = [];
async function test(nazwa, fn) {
  try { await fn(); ok += 1; console.log(`  ✓ ${nazwa}`); } catch (e) { bledy.push(`  ✘ ${nazwa}\n    ${e.message}`); console.log(`  ✘ ${nazwa}`); }
}

try {
  for (const m of PRZED) sql(wczytaj(m));
  // Bieżący tydzień: 3 × kalkulator, 1 × facebook; tydzień wcześniej: 2 × mail.
  sql(`insert into public.ud_klikniecia (czas, cel, zrodlo) values
         (now(), 'leadenhall', 'kalkulator'), (now(), 'leadenhall', 'kalkulator'), (now(), 'leadenhall', 'kalkulator'),
         (now(), 'leadenhall', 'facebook'),
         (now() - interval '7 days', 'leadenhall', 'mail'), (now() - interval '7 days', 'leadenhall', 'mail')`);

  await test('przed migracją reklamy: wiersze bez z_reklamy → strona milczy o reklamie (null, nie zera)', () => {
    const w = tabela();
    assert.ok(w.length > 0);
    assert.ok(w.every((x) => !('z_reklamy' in x) && !('zmierzonych' in x)), JSON.stringify(w));
    const k = klikniecia(w);
    assert.equal(k.zReklamy, null);
    assert.equal(k.wszystkie, 6);
  });

  sql(wczytaj(MIGRACJA_REKLAMY));

  await test('po migracji: stare kliknięcia mają platne NULL — niezmierzone, „—" zamiast fałszywego 0', () => {
    assert.equal(sql(`select count(*) from public.ud_klikniecia where platne is null`), '6');
    assert.equal(sql(`select column_default is null and is_nullable = 'YES' from information_schema.columns
                       where table_name = 'ud_klikniecia' and column_name = 'platne'`), 't');
    const w = tabela();
    assert.ok(w.every((x) => x.z_reklamy === 0 && x.zmierzonych === 0), JSON.stringify(w));
    const k = klikniecia(w);
    assert.equal(k.zReklamy, 0);
    assert.deepEqual(k.rzedy.map((r) => r.reklamy), ['—', '—']);
    assert.equal(k.reklamy, '—');
    assert.equal(k.niezmierzone, true);
  });

  // Po migracji: nowa funkcja portalu (zawsze true/false) i zapis awaryjny samym celem i źródłem (NULL).
  sql(`insert into public.ud_klikniecia (czas, cel, zrodlo, platne, utm_campaign, gad_campaignid) values
         (now(), 'leadenhall', 'kalkulator', true, 'jesien26', null),
         (now(), 'leadenhall', 'wniosek', true, null, '998877'),
         (now(), 'leadenhall', 'wniosek', false, null, null),
         (now() - interval '7 days', 'leadenhall', 'mail', true, 'jesien26', null)`);
  sql(`insert into public.ud_klikniecia (czas, cel, zrodlo) values (now(), 'leadenhall', 'blog')`);

  await test('po migracji: „w tym z reklamy" na tydzień i razem, tydzień częściowo zmierzony jako „≥"', () => {
    const k = klikniecia(tabela());
    // Bieżący: 4 stare + 3 nowe (2 z reklamy) + 1 awaryjny; poprzedni: 2 stare + 1 nowy z reklamy.
    assert.deepEqual(k.rzedy.map((r) => [r.razem, r.zReklamy, r.zmierzonych, r.reklamy]), [[8, 2, 3, '≥ 2'], [3, 1, 1, '≥ 1']]);
    assert.equal(k.zReklamy, 3);
    assert.equal(k.reklamy, '≥ 3');
    assert.equal(k.wszystkie, 11);
  });

  // Więcej miejsc niż kolumn: z_reklamy z miejsc zwiniętych w bazie pod „pozostałe" się nie gubi.
  sql(`insert into public.ud_klikniecia (czas, cel, zrodlo, platne)
       select now(), 'leadenhall', 'm' || n, n % 2 = 0 from generate_series(1, ${MIEJSC + 2}) n`);

  await test('zwinięte miejsca: z_reklamy i zmierzonych sumują się razem z kliknięciami', () => {
    const w = tabela();
    assert.ok(w.some((x) => x.zrodlo === POZOSTALE), 'baza zwinęła miejsca');
    const k = klikniecia(w);
    const reklamyWBazie = Number(sql(`select count(*) filter (where platne) from public.ud_klikniecia`));
    assert.equal(k.zReklamy, reklamyWBazie);
    assert.equal(k.zmierzonych, Number(sql(`select count(platne) from public.ud_klikniecia`)));
    assert.equal(k.wszystkie, Number(sql('select count(*) from public.ud_klikniecia')));
  });

  await test('tydzień w całości po migracji: sama liczba, bez „≥"', () => {
    sql(`delete from public.ud_klikniecia where platne is null`);
    const k = klikniecia(tabela());
    assert.equal(k.niezmierzone, false);
    assert.ok(k.rzedy.every((r) => !r.reklamy.startsWith('≥') && r.reklamy !== '—'), JSON.stringify(k.rzedy));
    assert.equal(k.reklamy, String(k.zReklamy));
  });
} catch (e) {
  bledy.push(`  ✘ przygotowanie: ${e.message}`);
} finally {
  klaster.stop();
}

for (const b of bledy) console.log(b);
console.log(`\nKliknięcia SQL: ${ok} PASS, ${bledy.length} FAIL`);
process.exit(bledy.length === 0 && ok > 0 ? 0 : 1);
