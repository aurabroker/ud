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
function atrapa({ rpc = {}, awariaPlikow = null, awariaWpisu = null } = {}) {
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
            async eq(k, v) {
              log.push(['delete', tabela, k, v]);
              return { error: awariaWpisu === v ? { message: 'baza padła' } : null };
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
for (const [status, fragment] of [['brak_oferty', 'już nie ma'], ['brak_uprawnien', 'nie może'], ['xyz', 'Nieoczekiwany']]) {
  const { sb } = atrapa({ rpc: { ud_oferta_do_kosza: { data: { status }, error: null } } });
  check(`do kosza: status ${status} → zdanie dla agenta`, (await rzuca(() => przeniesDoKosza(sb, 'O1', 'U1')))?.includes(fragment), true);
}
{
  const { sb } = atrapa({ rpc: { ud_oferta_do_kosza: { data: null, error: { message: 'function does not exist' } } } });
  check('do kosza: błąd bazy (np. brak migracji) → wyjątek, nic po cichu', /function does not exist/.test(await rzuca(() => przeniesDoKosza(sb, 'O1', 'U1'))), true);
}
{
  const { sb, log } = atrapa({ rpc: { ud_oferta_z_kosza: { data: { status: 'ok', offer_id: 'O1' }, error: null } } });
  check('przywrócenie: zwraca id oferty (to samo co przed usunięciem)', await przywrocZKosza(sb, 'K1', 'U1'), { offerId: 'O1' });
  check('… argumenty SQL', log[0], ['rpc', 'ud_oferta_z_kosza', { p_kosz: 'K1', p_user: 'U1' }]);
}
for (const [status, fragment] of [['brak_wpisu', 'nie ma w koszu'], ['oferta_istnieje', 'już jest'], ['konflikt_linku', 'ten sam link']]) {
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
  check('kolejność: najpierw pliki, potem wpis', log.slice(1).map((l) => l[0] + ':' + (l[3] ?? l[2].join?.(',') ?? '')), ['remove:O1/a.pdf,O1/podsumowanie.pdf', 'delete:K1', 'delete:K2']);
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
  const { sb } = atrapa({ rpc: { ud_kosz_ofert_do_wyczyszczenia: { data: null, error: { message: 'x' } } } });
  check('błąd odczytu kandydatów — wyjątek', Boolean(await rzuca(() => wyczyscKosz({ sb }))), true);
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
  const cron = zrodlo('routes/api/cron/kosz-ofert/+server.js');
  const iToken = cron.indexOf("rpc('edge_cron_token_matches'");
  check('cron: token sprawdzany przed czyszczeniem', iToken > 0 && iToken < cron.indexOf('wyczyscKosz('), true);
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
