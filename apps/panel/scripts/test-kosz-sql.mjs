/**
 * Kosz ofert na 30 dni — funkcje SQL na jednorazowym klastrze Postgresa,
 * z prawdziwych migracji.
 *
 *   node scripts/test-kosz-sql.mjs
 *
 * Ładuje atrapę Supabase i migracje tablicy leadów (lib/pg-tymczasowy.mjs),
 * atrapy przypomnienia-stub.sql i kosz-stub.sql (kolumny oferty, pliki,
 * PIN-y), migracje przypomnień i kosza, potem supabase/tests/kosz.sql.
 *
 * KOSZ_MIGRACJA=plik.sql podmienia migrację kosza (test mutacyjny).
 * Bez binariów Postgresa kończy się błędem, nie zielonym wynikiem.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { uruchomKlaster, wczytaj, korzen } from './lib/pg-tymczasowy.mjs';

const migracje = readdirSync(join(korzen, 'supabase/migrations'))
  .filter((p) => /_oferty_przypomnienia_sms(_\d+)?\.sql$/.test(p))
  .sort()
  .map((p) => wczytaj(`supabase/migrations/${p}`));
const plikKosza = readdirSync(join(korzen, 'supabase/migrations')).find((p) => /_oferty_kosz\.sql$/.test(p));
migracje.push(process.env.KOSZ_MIGRACJA
  ? readFileSync(resolve(process.env.KOSZ_MIGRACJA), 'utf8')
  : wczytaj(`supabase/migrations/${plikKosza}`));

let klaster;
try {
  klaster = await uruchomKlaster({ dodatkowe: ['przypomnienia-stub.sql', 'kosz-stub.sql'] });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

let wyjscie = 1;
try {
  for (const [i, sql] of migracje.entries()) {
    const r = klaster.psql(sql);
    if (r.status !== 0) throw new Error(`migracja nr ${i + 1}:\n${r.stderr}`);
  }
  const r = klaster.psql(wczytaj('supabase/tests/kosz.sql'));
  const linie = `${r.stderr}\n${r.stdout}`.split('\n');
  const pass = linie.filter((l) => /NOTICE:\s+PASS /.test(l)).map((l) => l.replace(/^.*NOTICE:\s+/, ''));
  const fail = linie.filter((l) => /NOTICE:\s+FAIL /.test(l)).map((l) => l.replace(/^.*NOTICE:\s+/, ''));
  const bledy = linie.filter((l) => /ERROR:|FATAL:/.test(l));
  for (const p of pass) console.log('  ✓ ' + p.slice(5));
  for (const f of fail) console.log('  ✗ ' + f.slice(5));
  for (const b of bledy) console.log(b);
  console.log(`\nSQL kosza: ${pass.length} PASS, ${fail.length} FAIL, ${bledy.length} błędów SQL`);
  wyjscie = r.status === 0 && fail.length === 0 && bledy.length === 0 && pass.length > 0 ? 0 : 1;
} catch (e) {
  console.error(e.message);
} finally {
  klaster.stop();
}
process.exit(wyjscie);
