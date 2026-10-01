/**
 * Testy SQL tablicy leadów (Kanban) na jednorazowym klastrze Postgresa.
 *
 *   pnpm test:leady-sql
 *
 * Co robi: stawia pusty klaster w katalogu tymczasowym, ładuje atrapę
 * środowiska Supabase (supabase/tests/stub.sql), obie migracje, które tablicę
 * tworzą (szkice + leady), i uruchamia supabase/tests/leady.sql — asercje
 * PASS/FAIL na funkcjach z migracji. Potem dwie sesje na prawdziwych
 * transakcjach sprawdzają to, czego jedna sesja nie pokaże: że równoległe
 * żądania na tym samym leadzie ustawiają się w kolejkę (konflikt, ponowienie).
 *
 * Czego NIE sprawdza: schematu produkcji (atrapa ma tylko potrzebne kolumny),
 * PostgREST ani uprawnień nadawanych przez Supabase poza tymi z migracji.
 *
 * Wymaga binariów Postgresa — patrz lib/pg-tymczasowy.mjs (tam też zmienna
 * LEADY_MIGRACJA do testów mutacyjnych). Zmienna LEADY_PO=plik.sql wykonuje
 * dodatkowe zapytania na tym samym klastrze (diagnoza).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uruchomKlaster, wczytaj } from './lib/pg-tymczasowy.mjs';

const TESTY = wczytaj('supabase/tests/leady.sql');

let wyjscie = 1;
let klaster;
try {
  klaster = await uruchomKlaster({ dodatkowe: ['pomocnicze.sql', 'fixture.sql'] });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const { psql, sesja } = klaster;

try {
  // ── Asercje SQL ───────────────────────────────────────────────────────────
  const r = psql(TESTY);
  const linie = `${r.stderr}\n${r.stdout}`.split('\n');
  const pass = linie.filter((l) => /NOTICE:\s+PASS /.test(l)).length;
  const fail = linie.filter((l) => /NOTICE:\s+FAIL /.test(l)).map((l) => l.replace(/^.*NOTICE:\s+/, ''));
  const bledy = linie.filter((l) => /ERROR:|FATAL:/.test(l));

  // Pomoc przy diagnozie: LEADY_PO=plik.sql wykonuje dodatkowe zapytania na tym samym klastrze.
  if (process.env.LEADY_PO) {
    const po = psql(readFileSync(resolve(process.env.LEADY_PO), 'utf8'));
    console.log(po.stdout + po.stderr);
  }

  // ── Współbieżność: dwie sesje, prawdziwe blokady wierszy ──────────────────
  const dla = (sql) => psql(sql).stdout.trim();
  const ula = dla(`select tt.id_ula()`);
  const olek = dla(`select tt.id_olek()`);
  const lead = dla(`select tt.lead('Bartek Nowak')`);
  const etap = (k) => dla(`select tt.etap('${k}')`);
  const wersja = () => Number(dla(`select tt.wersja('${lead}')`));
  const etapLeada = () => dla(`select tt.etap_leada('${lead}')`);
  const zmien = (klucz, uzytkownik, cel, v) =>
    `select (r->>'status') || ':' || coalesce(r->>'powtorzone', '-') from (select public.ud_lead_zmien('przenies', '${lead}', ${v}, '${klucz}', '${uzytkownik}', '{"etap_id":"${etap(cel)}"}'::jsonb) r) q;`;
  const wspolbieznosc = [];
  const sprawdz = (nazwa, ok, szczegol = '') => {
    wspolbieznosc.push({ nazwa, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${nazwa}${ok ? '' : ' — ' + szczegol}`);
  };

  {
    // A: dwie różne zmiany na tej samej wersji — druga czeka na blokadę i dostaje konflikt.
    const v = wersja();
    const [s1, s2] = await Promise.all([
      sesja(`begin;\n${zmien('conc-a-aaaaaaaa', ula, 'kontakt', v)}\nselect pg_sleep(1.5);\ncommit;`),
      sesja(zmien('conc-a-bbbbbbbb', olek, 'wygrany', v), 400),
    ]);
    sprawdz('współbieżność: pierwsza zmiana przechodzi', s1.out.startsWith('ok:'), s1.out + s1.err);
    sprawdz('współbieżność: druga (ta sama wersja) dostaje konflikt, nie nadpisuje', s2.out === 'konflikt:-', s2.out + s2.err);
    sprawdz('współbieżność: druga naprawdę czekała na blokadę wiersza', s2.ms > 900, `${s2.ms} ms`);
    sprawdz('współbieżność: stan końcowy = wynik pierwszej, wersja +1',
      etapLeada() === 'kontakt' && wersja() === v + 1, `${etapLeada()} v${wersja()}`);
  }
  {
    // B: ten sam klucz i ta sama treść jednocześnie — druga sesja to ponowienie, nie błąd unikalności.
    const v = wersja();
    const [s1, s2] = await Promise.all([
      sesja(`begin;\n${zmien('conc-b-aaaaaaaa', ula, 'oferta', v)}\nselect pg_sleep(1.5);\ncommit;`),
      sesja(zmien('conc-b-aaaaaaaa', ula, 'oferta', v), 400),
    ]);
    sprawdz('współbieżność: ten sam klucz — pierwsza ok', s1.out.startsWith('ok:-'), s1.out + s1.err);
    sprawdz('współbieżność: ten sam klucz — druga to ponowienie (bez błędu unikalności)', s2.out === 'ok:true' && s2.kod === 0, s2.out + s2.err);
    sprawdz('współbieżność: ten sam klucz — jeden wpis w historii, wersja +1',
      dla(`select count(*) from public.ud_leady_historia where klucz = 'conc-b-aaaaaaaa'`) === '1' && wersja() === v + 1);
  }
  {
    // C: notatka, ten sam klucz jednocześnie.
    const nota = `select public.ud_lead_notatka('${lead}', 'conc-c-aaaaaaaa', '${ula}', 'Jedna notatka')->>'status';`;
    const [s1, s2] = await Promise.all([
      sesja(`begin;\n${nota}\nselect pg_sleep(1.2);\ncommit;`),
      sesja(nota, 300),
    ]);
    sprawdz('współbieżność: notatka z tym samym kluczem — obie ok, jedna notatka',
      s1.out.startsWith('ok') && s2.out === 'ok' && dla(`select count(*) from public.ud_leady_notatki where tresc = 'Jedna notatka'`) === '1',
      `${s1.out}|${s2.out}${s1.err}${s2.err}`);
  }
  {
    // D: dwie synchronizacje naraz nie tworzą duplikatów ani nie wywalają się na unikalności.
    psql(`insert into public.ud_clients (id, full_name, email, source) values ('c0000000-0000-0000-0000-0000000000d1', 'Dominika Równoległa', 'dominika@x.pl', 'form');`);
    const sync = `select (public.ud_leady_synchronizuj()->>'klienci');`;
    const [s1, s2] = await Promise.all([sesja(`begin;\n${sync}\nselect pg_sleep(1.2);\ncommit;`), sesja(sync, 300)]);
    sprawdz('współbieżność: równoległe synchronizacje — jeden lead, bez błędu',
      s1.kod === 0 && s2.kod === 0 && dla(`select count(*) from public.ud_leady where klient_id = 'c0000000-0000-0000-0000-0000000000d1'`) === '1'
      && s1.out.split('\n')[0] === '1' && s2.out === '0', `${s1.out}|${s2.out}${s1.err}${s2.err}`);
  }

  const wspFail = wspolbieznosc.filter((w) => !w.ok).length;
  console.log(`\nSQL: ${pass} PASS, ${fail.length} FAIL, ${bledy.length} błędów SQL; współbieżność: ${wspolbieznosc.length - wspFail}/${wspolbieznosc.length}`);
  if (process.argv.includes('--pelne')) console.log(linie.filter((l) => /NOTICE:\s+PASS /.test(l)).map((l) => l.replace(/^.*NOTICE:\s+/, '')).join('\n'));
  for (const f of fail) console.log(f);
  for (const b of bledy) console.log(b);
  if (r.status !== 0 && bledy.length === 0) console.log(r.stderr);
  wyjscie = r.status === 0 && fail.length === 0 && bledy.length === 0 && wspFail === 0 && pass > 0 ? 0 : 1;
} catch (e) {
  console.error(e.message);
} finally {
  klaster.stop();
}
process.exit(wyjscie);
