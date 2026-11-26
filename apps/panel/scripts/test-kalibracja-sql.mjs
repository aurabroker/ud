/**
 * Kalibracja stawek kalkulatora — ud_kalibracja_stawek() i reszta migracji
 * na jednorazowym klastrze Postgresa, z prawdziwej migracji.
 *
 *   node scripts/test-kalibracja-sql.mjs
 *
 * Ładuje atrapę Supabase i migracje tablicy leadów (lib/pg-tymczasowy.mjs),
 * atrapy przypomnienia-stub.sql, kosz-stub.sql i kalibracja-stub.sql
 * (kolumny wariantu, uprawnienia jak na produkcji), migrację kalibracji —
 * TRZY razy, żeby sprawdzić, że ponowne uruchomienie nie rusza zadania crona
 * — potem zamrożony zestaw z produkcji (kalibracja-fixture.sql)
 * i supabase/tests/kalibracja.sql.
 *
 * KALIBRACJA_MIGRACJA=plik.sql podmienia migrację kalibracji (test mutacyjny:
 * pogorszona migracja musi dać czerwony wynik).
 * Bez binariów Postgresa kończy się błędem, nie zielonym wynikiem.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { uruchomKlaster, wczytaj, korzen } from './lib/pg-tymczasowy.mjs';

const plikKalibracji = readdirSync(join(korzen, 'supabase/migrations')).find((p) => /_kalibracja_stawek\.sql$/.test(p));
const migracja = process.env.KALIBRACJA_MIGRACJA
  ? readFileSync(resolve(process.env.KALIBRACJA_MIGRACJA), 'utf8')
  : wczytaj(`supabase/migrations/${plikKalibracji}`);

let klaster;
try {
  klaster = await uruchomKlaster({ dodatkowe: ['przypomnienia-stub.sql', 'kosz-stub.sql', 'kalibracja-stub.sql'] });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

/** Stan zadania crona po kolejnym kroku — sprawdza go kalibracja.sql. */
const zapiszStanCrona = (krok) =>
  `insert into tk.cron_stan (krok, ile, aktywne, harmonogram, polecenie)
   select '${krok}', count(*), bool_and(active), min(schedule), min(command)
     from cron.job where jobname = 'kalibracja-stawek';`;

let wyjscie = 1;
try {
  const kroki = [
    ['migracja (1. raz)', migracja],
    ['stan crona', `create schema if not exists tk;
      create table tk.cron_stan (krok text, ile int, aktywne boolean, harmonogram text, polecenie text);
      ${zapiszStanCrona('po_pierwszym')}`],
    ['migracja (2. raz)', migracja],
    ['stan crona', zapiszStanCrona('po_drugim')],
    // Właściciel włącza zadanie; kolejna migracja nie może go wyłączyć.
    ['włączenie crona', `select cron.alter_job((select jobid from cron.job where jobname = 'kalibracja-stawek'), active := true);`],
    ['migracja (3. raz)', migracja],
    ['stan crona', `${zapiszStanCrona('po_wlaczeniu_i_trzecim')}
      select cron.alter_job((select jobid from cron.job where jobname = 'kalibracja-stawek'), active := false);`],
    ['zestaw z produkcji', wczytaj('supabase/tests/kalibracja-fixture.sql')],
  ];
  for (const [nazwa, sql] of kroki) {
    const r = klaster.psql(sql);
    if (r.status !== 0) throw new Error(`${nazwa}:\n${r.stderr}`);
  }
  const r = klaster.psql(wczytaj('supabase/tests/kalibracja.sql'));
  const linie = `${r.stderr}\n${r.stdout}`.split('\n');
  const pass = linie.filter((l) => /NOTICE:\s+PASS /.test(l)).map((l) => l.replace(/^.*NOTICE:\s+/, ''));
  const fail = linie.filter((l) => /NOTICE:\s+FAIL /.test(l)).map((l) => l.replace(/^.*NOTICE:\s+/, ''));
  const bledy = linie.filter((l) => /ERROR:|FATAL:/.test(l));
  for (const p of pass) console.log('  ✓ ' + p.slice(5));
  for (const f of fail) console.log('  ✗ ' + f.slice(5));
  for (const b of bledy) console.log(b);
  console.log(`\nSQL kalibracji: ${pass.length} PASS, ${fail.length} FAIL, ${bledy.length} błędów SQL`);
  wyjscie = r.status === 0 && fail.length === 0 && bledy.length === 0 && pass.length > 0 ? 0 : 1;
} catch (e) {
  console.error(e.message);
} finally {
  klaster.stop();
}
process.exit(wyjscie);
