/**
 * Jednorazowy klaster Postgresa do testów SQL (tablica leadów).
 *
 * Stawia pusty klaster w katalogu tymczasowym, ładuje atrapę środowiska
 * Supabase (supabase/tests/stub.sql) i migracje, które tablicę tworzą (szkice +
 * leady), a po testach go kasuje. Binaria muszą być w systemie (initdb, pg_ctl,
 * psql) — gdy ich nie ma, rzuca błąd: pominięty test to nie jest zielony test.
 * Jako root uruchamia je przez `runuser -u postgres`, bo Postgres nie wstaje
 * jako root.
 *
 * Zmienna LEADY_MIGRACJA podmienia plik migracji tablicy leadów (testy
 * mutacyjne: pogorszona migracja musi dać czerwony wynik).
 */
import { spawn, spawnSync } from 'node:child_process';
import { chownSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const korzen = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const wczytaj = (sciezka) => readFileSync(join(korzen, sciezka), 'utf8');

function znajdzBinaria() {
  const kandydaci = [];
  const pg = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
  if (pg.status === 0) kandydaci.push(pg.stdout.trim());
  const lib = '/usr/lib/postgresql';
  if (existsSync(lib)) {
    for (const v of readdirSync(lib).sort((a, b) => Number(b) - Number(a))) kandydaci.push(join(lib, v, 'bin'));
  }
  return kandydaci.find((k) => existsSync(join(k, 'initdb')) && existsSync(join(k, 'psql')));
}

/**
 * @param {{ dodatkowe?: string[] }} [opcje] dodatkowy SQL ładowany po migracjach
 *   (pomocnicze testów, fixture)
 */
export async function uruchomKlaster(opcje = {}) {
  const bin = znajdzBinaria();
  if (!bin) {
    throw new Error(
      'Nie znaleziono Postgresa (initdb/pg_ctl/psql). Test SQL nie został wykonany — to NIE jest wynik zielony.',
    );
  }

  const jakoRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const opakuj = (polecenie, argumenty) =>
    jakoRoot ? ['runuser', ['-u', 'postgres', '--', polecenie, ...argumenty]] : [polecenie, argumenty];

  const katalog = mkdtempSync(join(tmpdir(), 'ud-leady-sql-'));
  if (jakoRoot) {
    chownSync(
      katalog,
      Number(spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' }).stdout),
      Number(spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' }).stdout),
    );
  }
  const dane = join(katalog, 'dane');
  const port = String(20000 + Math.floor(Math.random() * 20000));

  const uruchom = (polecenie, argumenty, wejscie) => {
    const [cmd, args] = opakuj(polecenie, argumenty);
    return spawnSync(cmd, args, { encoding: 'utf8', input: wejscie, maxBuffer: 64 * 1024 * 1024 });
  };
  const psqlArgs = ['-h', katalog, '-p', port, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At'];
  const psql = (sql) => uruchom(join(bin, 'psql'), psqlArgs, sql);

  /** Sesja psql w tle: obietnica z wyjściem i czasem trwania (do testów blokad). */
  const sesja = (sql, opoznienieMs = 0) =>
    new Promise((rozwiaz) => {
      setTimeout(() => {
        const [cmd, args] = opakuj(join(bin, 'psql'), psqlArgs);
        const start = Date.now();
        const dziecko = spawn(cmd, args);
        let out = '';
        let err = '';
        dziecko.stdout.on('data', (d) => (out += d));
        dziecko.stderr.on('data', (d) => (err += d));
        dziecko.on('close', (kod) => rozwiaz({ kod, out: out.trim(), err, ms: Date.now() - start }));
        dziecko.stdin.end(sql);
      }, opoznienieMs);
    });

  const stop = () => {
    uruchom(join(bin, 'pg_ctl'), ['-D', dane, '-m', 'immediate', 'stop']);
    rmSync(katalog, { recursive: true, force: true });
  };

  try {
    let r = uruchom(join(bin, 'initdb'), ['-D', dane, '-U', 'postgres', '-A', 'trust', '--no-sync', '-E', 'UTF8', '--locale=C.UTF-8']);
    if (r.status !== 0) throw new Error('initdb: ' + r.stderr);
    r = uruchom(join(bin, 'pg_ctl'), [
      '-D', dane, '-l', join(katalog, 'log'), '-w',
      '-o', `-k ${katalog} -p ${port} -c listen_addresses= -c fsync=off -c synchronous_commit=off`, 'start',
    ]);
    if (r.status !== 0) throw new Error('pg_ctl start: ' + r.stderr);

    const migracjaLeadow = process.env.LEADY_MIGRACJA
      ? readFileSync(resolve(process.env.LEADY_MIGRACJA), 'utf8')
      : wczytaj('supabase/migrations/20261001180000_leady_kanban.sql');
    const kroki = [
      ['stub', wczytaj('supabase/tests/stub.sql')],
      ['migracja szkiców', wczytaj('supabase/migrations/20261001101112_wnioski_szkice.sql')],
      ['migracja leadów', migracjaLeadow],
      ...(opcje.dodatkowe ?? []).map((nazwa) => [nazwa, wczytaj(`supabase/tests/${nazwa}`)]),
    ];
    for (const [nazwa, sql] of kroki) {
      r = psql(sql);
      if (r.status !== 0) throw new Error(`${nazwa}:\n${r.stderr}`);
    }
  } catch (e) {
    stop();
    throw e;
  }

  return { psql, sesja, stop, katalog, port };
}
