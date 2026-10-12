/**
 * Reguły wyboru kandydatów do przypomnienia SMS o ofercie — na jednorazowym
 * klastrze Postgresa, z prawdziwych migracji.
 *
 *   node scripts/test-przypomnienia-sql.mjs
 *
 * Ładuje atrapę Supabase i migracje tablicy leadów (lib/pg-tymczasowy.mjs),
 * do tego supabase/tests/przypomnienia-stub.sql (wersja i telefon oferty,
 * pytania klienta, dziennik wysyłek) i obie migracje przypomnień, potem
 * supabase/tests/przypomnienia.sql — asercje PASS/FAIL.
 *
 * PRZYPOMNIENIA_MIGRACJE=plik1.sql,plik2.sql podmienia migracje przypomnień
 * (test mutacyjny: sama pierwsza wersja musi dać czerwony wynik).
 *
 * Bez binariów Postgresa kończy się błędem, nie zielonym wynikiem.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { uruchomKlaster, wczytaj, korzen } from './lib/pg-tymczasowy.mjs';

const migracje = process.env.PRZYPOMNIENIA_MIGRACJE
  ? process.env.PRZYPOMNIENIA_MIGRACJE.split(',').map((p) => readFileSync(resolve(p), 'utf8'))
  : readdirSync(join(korzen, 'supabase/migrations'))
      .filter((p) => /_oferty_przypomnienia_sms(_\d+)?\.sql$/.test(p))
      .sort()
      .map((p) => wczytaj(`supabase/migrations/${p}`));

let klaster;
try {
  klaster = await uruchomKlaster({ dodatkowe: ['przypomnienia-stub.sql'] });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

let wyjscie = 1;
try {
  for (const [i, sql] of migracje.entries()) {
    const r = klaster.psql(sql);
    if (r.status !== 0) throw new Error(`migracja przypomnień nr ${i + 1}:\n${r.stderr}`);
  }
  const r = klaster.psql(wczytaj('supabase/tests/przypomnienia.sql'));
  const linie = `${r.stderr}\n${r.stdout}`.split('\n');
  const pass = linie.filter((l) => /NOTICE:\s+PASS /.test(l)).map((l) => l.replace(/^.*NOTICE:\s+/, ''));
  const fail = linie.filter((l) => /NOTICE:\s+FAIL /.test(l)).map((l) => l.replace(/^.*NOTICE:\s+/, ''));
  const bledy = linie.filter((l) => /ERROR:|FATAL:/.test(l));
  for (const p of pass) console.log('  ✓ ' + p.slice(5));
  for (const f of fail) console.log('  ✗ ' + f.slice(5));
  for (const b of bledy) console.log(b);
  console.log(`\nSQL przypomnień: ${pass.length} PASS, ${fail.length} FAIL, ${bledy.length} błędów SQL (migracji: ${migracje.length})`);
  wyjscie = r.status === 0 && fail.length === 0 && bledy.length === 0 && pass.length > 0 ? 0 : 1;
} catch (e) {
  console.error(e.message);
} finally {
  klaster.stop();
}
process.exit(wyjscie);
