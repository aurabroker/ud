/**
 * test-kosz.mjs — kosz ofert na 30 dni, warstwa panelu (decyzja z 13.10.2026).
 * Uruchom: node scripts/test-kosz.mjs   (reguły SQL: scripts/test-kosz-sql.mjs)
 *
 * Atrapa klienta Supabase: RPC, Storage i delete z dziennikiem wywołań.
 * Do tego sprawdzenie źródeł: oba przyciski „Usuń" idą do kosza, a nie do
 * twardego deleteOffer; przywrócenie bierze użytkownika z sesji; cron
 * sprawdza token przed czymkolwiek.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { przeniesDoKosza, przywrocZKosza, listaKosza, wyczyscKosz, KOSZ_DNI, KUBELEK_OFERT } from '../src/lib/server/kosz.js';
import { sprawdzTokenCrona } from '../src/lib/server/cronBramka.js';
import { potwierdz } from '../src/lib/potwierdz.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(70)} = ${JSON.stringify(actual)}${ok ? '' : `  (oczekiwano ${JSON.stringify(expected)})`}`);
}
async function rzuca(fn) {
  try { await fn(); return null; } catch (e) { return e.message; }
}

/** Atrapa: odpowiedzi RPC po nazwie, awarie Storage/delete, dziennik wywołań. */
function atrapa({ rpc = {}, awariaPlikow = null, awariaWpisu = null, juzUsuniete = [] } = {}) {
  const log = [];
  const sb = {
    async rpc(nazwa, arg) {
      log.push(['rpc', nazwa, arg]);
      const o = rpc[nazwa];
      return typeof o === 'function' ? o(arg) : (o ?? { data: null, error: { message: 'brak atrapy ' + nazwa } });
    },
    storage: {
      from(kubelek) {
        return {
          async remove(sciezki) {
            log.push(['remove', kubelek, sciezki]);
            return { data: [], error: awariaPlikow && sciezki.some((s) => s.startsWith(awariaPlikow)) ? { message: 'storage padł' } : null };
          },
        };
      },
    },
    from(tabela) {
      return {
        delete() {
          return {
            eq(k, v) {
              return {
                async select() {
                  log.push(['delete', tabela, k, v]);
                  if (awariaWpisu === v) return { data: null, error: { message: 'baza padła' } };
                  return { data: juzUsuniete.includes(v) ? [] : [{ id: v }], error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { sb, log };
}

console.log('Przeniesienie i przywrócenie');
{
  const { sb, log } = atrapa({ rpc: { ud_oferta_do_kosza: { data: { status: 'ok', kosz_id: 'K1', offer_id: 'O1' }, error: null } } });
  check('do kosza: zwraca id wpisu i oferty', await przeniesDoKosza(sb, 'O1', 'U1'), { koszId: 'K1', offerId: 'O1' });
  check('… z użytkownikiem i ofertą w argumentach SQL', log[0], ['rpc', 'ud_oferta_do_kosza', { p_offer: 'O1', p_user: 'U1' }]);
}
for (const [status, fragment] of [['brak_oferty', 'nie możesz'], ['brak_uprawnien', 'nie może'], ['xyz', 'Nieoczekiwany']]) {
  const { sb } = atrapa({ rpc: { ud_oferta_do_kosza: { data: { status }, error: null } } });
  check(`do kosza: status ${status} → zdanie dla agenta`, (await rzuca(() => przeniesDoKosza(sb, 'O1', 'U1')))?.includes(fragment), true);
}
{
  const { sb } = atrapa({ rpc: { ud_oferta_do_kosza: { data: null, error: { message: 'permission denied for table ud_offers' } } } });
  check('do kosza: błąd bazy → wyjątek z treścią błędu, nic po cichu', /Kosz: permission denied/.test(await rzuca(() => przeniesDoKosza(sb, 'O1', 'U1'))), true);
}
// Panel wdrożony przed migracją (13.10.2026): PostgREST odpowiada PGRST202
// po angielsku. Agent ma przeczytać, że oferta NIE zniknęła.
for (const [nazwa, fn] of [['do kosza', (sb) => przeniesDoKosza(sb, 'O1', 'U1')], ['przywrócenie', (sb) => przywrocZKosza(sb, 'K1', 'U1')], ['lista', (sb) => listaKosza(sb, 'U1')]]) {
  const brak = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.x(p_user) in the schema cache' } };
  const { sb } = atrapa({ rpc: { ud_oferta_do_kosza: brak, ud_oferta_z_kosza: brak, ud_kosz_ofert_lista: brak } });
  const tekst = await rzuca(() => fn(sb));
  check(`${nazwa}: brak funkcji w bazie (PGRST202) → po polsku, „nic nie zostało usunięte"`,
    [/nie jest jeszcze włączony/.test(tekst), /nic nie zostało usunięte/.test(tekst), /schema cache/.test(tekst)], [true, true, false]);
}
{
  const { sb, log } = atrapa({ rpc: { ud_oferta_z_kosza: { data: { status: 'ok', offer_id: 'O1' }, error: null } } });
  check('przywrócenie: zwraca id oferty (to samo co przed usunięciem)', await przywrocZKosza(sb, 'K1', 'U1'), { offerId: 'O1' });
  check('… argumenty SQL (z terminem 30 dni)', log[0], ['rpc', 'ud_oferta_z_kosza', { p_kosz: 'K1', p_user: 'U1', p_dni: 30 }]);
}
for (const [status, fragment] of [['brak_wpisu', 'nie ma w koszu'], ['oferta_istnieje', 'już jest'], ['konflikt_linku', 'ten sam link'], ['po_terminie', '30 dni']]) {
  const { sb } = atrapa({ rpc: { ud_oferta_z_kosza: { data: { status }, error: null } } });
  check(`przywrócenie: status ${status} → zdanie dla agenta`, (await rzuca(() => przywrocZKosza(sb, 'K1', 'U1')))?.includes(fragment), true);
}
{
  const { sb, log } = atrapa({ rpc: { ud_kosz_ofert_lista: { data: [{ id: 'K1' }], error: null } } });
  check('lista: wpisy z SQL, okres 30 dni', [await listaKosza(sb, 'U1'), log[0][2]], [[{ id: 'K1' }], { p_user: 'U1', p_dni: 30 }]);
  check('KOSZ_DNI = 30, kubełek ud-offers', [KOSZ_DNI, KUBELEK_OFERT], [30, 'ud-offers']);
}

console.log('Czyszczenie po 30 dniach');
const wpis = (id, offer, pliki) => ({ id, offer_id: offer, pliki_storage: pliki });
{
  const { sb, log } = atrapa({ rpc: { ud_kosz_ofert_do_wyczyszczenia: { data: [
    wpis('K1', 'O1', ['O1/a.pdf', 'O1/podsumowanie.pdf']),
    wpis('K2', 'O2', []),
  ], error: null } } });
  const w = await wyczyscKosz({ sb });
  check('dwa wpisy: pliki pierwszego, oba wpisy usunięte', [w.kandydatow, w.usunieto, w.plikow, w.przerwano], [2, 2, 2, undefined]);
  check('kolejność: najpierw pliki, potem wpis — z tabeli ud_offers_kosz', log.slice(1),
    [['remove', 'ud-offers', ['O1/a.pdf', 'O1/podsumowanie.pdf']], ['delete', 'ud_offers_kosz', 'id', 'K1'], ['delete', 'ud_offers_kosz', 'id', 'K2']]);
  check('pliki z kubełka ud-offers, okres 30 dni w zapytaniu', [log[1][1], log[0][2].p_dni], ['ud-offers', 30]);
}
{
  const { sb, log } = atrapa({ rpc: { ud_kosz_ofert_do_wyczyszczenia: { data: [
    wpis('K1', 'O1', ['O1/a.pdf', 'O2/cudzy.pdf', 'LW044.pdf', '../O1/x.pdf', 'O1/../O2/y.pdf', null]),
  ], error: null } } });
  await wyczyscKosz({ sb });
  check('usuwa TYLKO pliki z katalogu tej oferty', log[1][2], ['O1/a.pdf']);
}
{
  const { sb, log } = atrapa({ awariaPlikow: 'O1/', rpc: { ud_kosz_ofert_do_wyczyszczenia: { data: [
    wpis('K1', 'O1', ['O1/a.pdf']), wpis('K2', 'O2', ['O2/b.pdf']),
  ], error: null } } });
  const w = await wyczyscKosz({ sb });
  check('awaria Storage — wpis zostaje (jutro ponowi), wywołanie przerwane', [w.usunieto, Boolean(w.przerwano), log.some((l) => l[0] === 'delete')], [0, true, false]);
}
{
  const { sb } = atrapa({ awariaWpisu: 'K1', rpc: { ud_kosz_ofert_do_wyczyszczenia: { data: [
    wpis('K1', 'O1', ['O1/a.pdf']), wpis('K2', 'O2', ['O2/b.pdf']),
  ], error: null } } });
  const w = await wyczyscKosz({ sb });
  check('awaria usunięcia wpisu — przerwane, licznik bez niego', [w.usunieto, /K1/.test(w.przerwano)], [0, true]);
}
{
  const { sb } = atrapa({ juzUsuniete: ['K1'], rpc: { ud_kosz_ofert_do_wyczyszczenia: { data: [wpis('K1', 'O1', [])], error: null } } });
  const w = await wyczyscKosz({ sb });
  check('wpis usunięty w międzyczasie (0 wierszy) — nie liczony jako usunięty', [w.usunieto, w.przerwano], [0, undefined]);
}
{
  const { sb } = atrapa({ rpc: { ud_kosz_ofert_do_wyczyszczenia: { data: null, error: { message: 'x' } } } });
  check('błąd odczytu kandydatów — wyjątek', Boolean(await rzuca(() => wyczyscKosz({ sb }))), true);
}

console.log('Bramka crona (cronBramka.js)');
{
  const bramka = (odp) => sprawdzTokenCrona({ rpc: async () => { if (odp === 'wyjatek') throw new Error('sieć'); return odp; } }, 'tok');
  check('true z bazy — przepuszcza', await bramka({ data: true, error: null }), { ok: true });
  for (const [opis, odp] of [['false', { data: false, error: null }], ['null', { data: null, error: null }], ['brak danych', {}], ['napis "true"', { data: 'true', error: null }], ['1', { data: 1, error: null }]]) {
    const r = await bramka(odp);
    check(`${opis} — 401, bez wpisu do dziennika`, [r.ok, r.status, r.doDziennika], [false, 401, undefined]);
  }
  const blad = await bramka({ data: null, error: { message: 'baza nie odpowiada' } });
  check('błąd bazy — 503 i treść do ud_errors', [blad.ok, blad.status, blad.doDziennika], [false, 503, 'baza nie odpowiada']);
  const wyjatek = await bramka('wyjatek');
  check('wyjątek klienta — 503', [wyjatek.ok, wyjatek.status], [false, 503]);
  check('pusty token — 401 bez pytania bazy', await sprawdzTokenCrona({ rpc: async () => { throw new Error('nie wolno pytać'); } }, ''), { ok: false, status: 401, error: 'brak tokenu' });
}

console.log('Potwierdzenie przed wysłaniem (potwierdz.js)');
{
  const proba = (odpowiedz, dalej) => {
    let anulowano = false;
    const poprzedni = globalThis.confirm;
    globalThis.confirm = () => odpowiedz;
    try {
      const zwrot = potwierdz('Na pewno?', dalej)({ cancel: () => { anulowano = true; }, formData: null });
      return { anulowano, zwrot };
    } finally { globalThis.confirm = poprzedni; }
  };
  let wolano = false;
  const anuluj = proba(false, () => { wolano = true; return 'cb'; });
  check('„Anuluj" — cancel() i NIC dalej (formularz nie idzie)', [anuluj.anulowano, wolano, anuluj.zwrot], [true, false, undefined]);
  const ok = proba(true, () => 'cb');
  check('„OK" — bez cancel, zwraca callback z argumentu', [ok.anulowano, ok.zwrot], [false, 'cb']);
  check('„OK" bez drugiego argumentu — domyślne zachowanie enhance', proba(true).zwrot, undefined);

  // Wzorzec, który przepuszczał „Anuluj": onsubmit z confirm przy use:enhance.
  const svelte = [];
  const zbierz = (kat) => { for (const e of readdirSync(new URL(kat, import.meta.url), { withFileTypes: true })) {
    const sc = kat + e.name + (e.isDirectory() ? '/' : '');
    if (e.isDirectory()) zbierz(sc); else if (e.name.endsWith('.svelte')) svelte.push(sc);
  } };
  zbierz('../src/');
  const zle = svelte.filter((p) => /onsubmit=\{[^}]*confirm\(/.test(readFileSync(new URL(p, import.meta.url), 'utf8')));
  check('żaden formularz nie pyta przez onsubmit + confirm (przy use:enhance nie działa)', zle, []);
  const ilePotw = svelte.reduce((n, p) => n + (readFileSync(new URL(p, import.meta.url), 'utf8').match(/use:enhance=\{potwierdz\(/g) || []).length, 0);
  check('sześć formularzy pyta przez potwierdz()', ilePotw, 6);
}

console.log('Źródła');
{
  const zrodlo = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
  const strona = zrodlo('routes/panel/offer/[id]/+page.server.js');
  const lista = zrodlo('routes/panel/+page.server.js');
  const akcja = (s) => s.slice(s.indexOf('delete: async'), s.indexOf('}', s.indexOf('catch', s.indexOf('delete: async'))));
  check('strona oferty: „Usuń" idzie do kosza, nie do deleteOffer', /przeniesDoKosza\(/.test(akcja(strona)) && !/deleteOffer\(/.test(akcja(strona)), true);
  check('lista ofert: „Usuń" idzie do kosza, nie do deleteOffer', /przeniesDoKosza\(/.test(akcja(lista)) && !/deleteOffer\(/.test(akcja(lista)), true);
  check('oba: użytkownik z sesji (user.id)', /przeniesDoKosza\(createAdminClient\(\), [\w.]+, user\.id\)/.test(strona) && /przeniesDoKosza\(createAdminClient\(\), [\w.]+, user\.id\)/.test(lista), true);
  const kosz = zrodlo('routes/panel/kosz/+page.server.js');
  check('kosz: przywrócenie z użytkownikiem z sesji', /przywrocZKosza\(createAdminClient\(\), [\w.]+, user\.id\)/.test(kosz), true);
  check('kosz: bez sesji — logowanie', (kosz.match(/redirect\(303, '\/login'\)/g) || []).length, 2);
  const koszWidok = zrodlo('routes/panel/kosz/+page.svelte');
  check('kosz: przy błędzie wczytania NIE pisze „Kosz jest pusty"', /\{#if !data\.blad\}[^{]*Kosz jest pusty/.test(koszWidok), true);
  const cron = zrodlo('routes/api/cron/kosz-ofert/+server.js');
  const iToken = cron.indexOf('await sprawdzTokenCrona(sb, token)');
  check('cron: bramka przed czyszczeniem, odmowa kończy wywołanie', iToken > 0 && iToken < cron.indexOf('wyczyscKosz(')
    && /if \(!bramka\.ok\) \{[\s\S]*?return json\([^;]*bramka\.status/.test(cron), true);
  check('cron: przerwanie i wyjątek do ud_errors', /if \(wynik\.przerwano\)[\s\S]*zapiszBlad\(/.test(cron) && /catch \(e\)[\s\S]*zapiszBlad\(/.test(cron.slice(cron.indexOf('wyczyscKosz('))), true);
  check('cron: tylko POST (GET → 405)', /export function GET[\s\S]*status: 405/.test(cron), true);
  const katalog = new URL('../../../supabase/migrations/', import.meta.url);
  const plik = readdirSync(katalog).find((p) => /_oferty_kosz\.sql$/.test(p));
  const migracja = readFileSync(new URL(plik, katalog), 'utf8');
  check('migracja: cron woła ten adres z tokenem z Vaulta', migracja.includes('/api/cron/kosz-ofert') && /x-cron-token[\s\S]*vault\.decrypted_secrets/.test(migracja), true);
}

if (failures) {
  console.log(`\n✗ ${failures} błędów`);
  process.exit(1);
}
console.log('\n✓ wszystko zgodne');
