/**
 * test-przypomnienia-ofert.mjs — SMS do klientów, którzy dostali ofertę i milczą
 * (decyzja z 12.10.2026). Uruchom: node scripts/test-przypomnienia-ofert.mjs
 *
 * Bez bazy i bez SMSAPI: atrapa klienta Supabase trzyma oferty i dziennik
 * wysyłek w pamięci i odtwarza warunkowy UPDATE (zajęcie wersji). Wybór
 * kandydatów to SQL (ud_oferty_do_przypomnienia) — tu atrapa oddaje gotową
 * listę, a reguły wyboru sprawdza się na bazie „na sucho".
 */
import { readFileSync } from 'node:fs';
import { wyslijPrzypomnienia, KANAL_PRZYPOMNIENIA } from '../src/lib/server/przypomnieniaOfert.js';
import { SMS_PRZYPOMNIENIE, jednaCzesc, wOknieWysylki, PRZYPOMNIENIA_NA_RAZ } from '../src/lib/server/smsOferta.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(64)} = ${JSON.stringify(actual)}${ok ? '' : `  (oczekiwano ${JSON.stringify(expected)})`}`);
}

const TERAZ = new Date('2026-10-13T08:00:00Z'); // wtorek, 10:00 w Warszawie

/** Atrapa: oferty { id, wersja, przypomnienie_wersja, user_id }, dziennik, lista kandydatów. */
function atrapa({ oferty, kandydaci, dziennik = [] }) {
  const stan = { oferty: oferty.map((o) => ({ przypomnienie_wersja: null, user_id: 'agent-1', ...o })), dziennik };
  const sb = {
    async rpc(nazwa) {
      if (nazwa !== 'ud_oferty_do_przypomnienia') throw new Error('rpc ' + nazwa);
      return { data: kandydaci, error: null };
    },
    from(tabela) {
      const f = [];
      let op = 'select';
      let patch = null;
      let wiersz = null;
      const b = {
        select() { if (op === 'select') op = 'select'; else b.zwrot = true; return b; },
        update(p) { op = 'update'; patch = p; return b; },
        insert(r) { op = 'insert'; wiersz = r; return b; },
        eq(k, v) { f.push((r) => r[k] === v); return b; },
        gte(k, v) { f.push((r) => r[k] >= v); return b; },
        limit() { return b; },
        or(wyr) {
          const m = /przypomnienie_wersja\.is\.null,przypomnienie_wersja\.lt\.(\d+)/.exec(wyr);
          if (!m) throw new Error('nieznany or: ' + wyr);
          f.push((r) => r.przypomnienie_wersja == null || r.przypomnienie_wersja < Number(m[1]));
          return b;
        },
        then(ok, zle) {
          return Promise.resolve().then(() => {
            const zbior = tabela === 'ud_offers' ? stan.oferty : stan.dziennik;
            if (op === 'insert') { zbior.push({ created_at: TERAZ.toISOString(), ...wiersz }); return { error: null }; }
            const trafione = zbior.filter((r) => f.every((x) => x(r)));
            if (op === 'update') { for (const r of trafione) Object.assign(r, patch); return { data: b.zwrot ? trafione.map((r) => ({ id: r.id, user_id: r.user_id })) : null, error: null }; }
            return { data: trafione, error: null };
          }).then(ok, zle);
        },
      };
      return b;
    },
  };
  return { sb, stan };
}

/** Atrapa SMSAPI: odpowiedź per numer, domyślnie wysłany. */
function smsapi(odpowiedzi = {}) {
  const wyslane = [];
  const sendSms = async (numer, tresc) => {
    wyslane.push({ numer, tresc });
    const o = odpowiedzi[numer];
    if (o === 'wyjatek') throw new Error('sieć');
    return o ?? { sent: true, id: 'sms-' + wyslane.length };
  };
  return { sendSms, wyslane };
}

const kand = (id, telefon, wersja = 1, telefonKlienta = null) =>
  ({ offer_id: id, wersja, telefon_oferty: telefon, telefon_klienta: telefonKlienta, sent_at: '2026-10-08T10:00:00Z' });

console.log('Treść i godziny');
check('jedna część SMS-a', jednaCzesc(SMS_PRZYPOMNIENIE), true);
check('bez linku, gołej domeny i kodu', /https?:|www\.|\b[\w-]+\.(pl|com|eu)\b|kod|pesel|pin/i.test(SMS_PRZYPOMNIENIE), false);
check('wtorek 10:00 — można', wOknieWysylki(TERAZ), true);
check('wtorek 8:59 — nie', wOknieWysylki(new Date('2026-10-13T06:59:00Z')), false);
check('wtorek 19:00 — nie', wOknieWysylki(new Date('2026-10-13T17:00:00Z')), false);
check('sobota 12:00 — nie', wOknieWysylki(new Date('2026-10-17T10:00:00Z')), false);
check('zimą 9:00 czasu polskiego = 8:00 UTC — można', wOknieWysylki(new Date('2026-12-01T08:00:00Z')), true);

console.log('Wysyłka');
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 2 }], kandydaci: [kand('A', '504 400 901'), kand('B', '+48 600 100 200', 2)] });
  const { sendSms, wyslane } = smsapi();
  const w = await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ });
  check('dwie oferty — dwa SMS-y', [w.wyslano, wyslane.length], [2, 2]);
  check('treść to SMS_PRZYPOMNIENIE', wyslane.every((s) => s.tresc === SMS_PRZYPOMNIENIE), true);
  check('zajęte wersje 1 i 2', stan.oferty.map((o) => o.przypomnienie_wersja), [1, 2]);
  check('dziennik: kanał przypomnienia, status sent', stan.dziennik.map((d) => [d.channel, d.status, d.recipient]), [[KANAL_PRZYPOMNIENIA, 'sent', '48504400901'], [KANAL_PRZYPOMNIENIA, 'sent', '48600100200']]);

  // Drugie wywołanie z tą samą listą (np. nakładający się cron) nie wyśle nic.
  const drugi = smsapi();
  const w2 = await wyslijPrzypomnienia({ sb, sendSms: drugi.sendSms, teraz: TERAZ });
  check('drugie wywołanie: zero SMS-ów (wersja zajęta / numer z ostatnich 7 dni)', [w2.wyslano, drugi.wyslane.length], [0, 0]);
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '504400901'), kand('B', '504 400 901')] });
  const { sendSms, wyslane } = smsapi();
  await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ });
  check('ten sam numer przy dwóch ofertach — jeden SMS', wyslane.length, 1);
  check('druga oferta nie zajęta (może dostać, gdy numer się zmieni)', stan.oferty[1].przypomnienie_wersja, null);
}
{
  const dziennik = [{ channel: KANAL_PRZYPOMNIENIA, recipient: '48504400901', status: 'sent', created_at: '2026-10-10T08:00:00Z' }];
  const { sb } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')], dziennik });
  const { sendSms, wyslane } = smsapi();
  await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ });
  check('numer z przypomnieniem sprzed 3 dni — pominięty', wyslane.length, 0);
}
{
  const { sb } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '123', 1, '504400901'), kand('B', null, 1, 'abc')] });
  const { sendSms, wyslane } = smsapi();
  const w = await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ });
  check('zły numer przy ofercie — bierze numer z kartoteki', wyslane.map((s) => s.numer), ['48504400901']);
  check('bez żadnego poprawnego numeru — pominięta', w.pominieto, 1);
}

console.log('Błędy SMSAPI');
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '504400901'), kand('B', '600100200')] });
  const { sendSms, wyslane } = smsapi({ '48504400901': { sent: false, error: 'SMSAPI błąd 103: brak punktów — brak punktów na koncie' } });
  const w = await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ });
  check('brak punktów — przerwane po pierwszym', [wyslane.length, Boolean(w.przerwano)], [1, true]);
  check('oferta zwolniona — następny cron spróbuje', stan.oferty[0].przypomnienie_wersja, null);
  check('druga oferta nietknięta', stan.oferty[1].przypomnienie_wersja, null);
  check('w dzienniku błąd z treścią', stan.dziennik[0].status + ' / ' + /103/.test(stan.dziennik[0].error), 'error / true');
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '504400901'), kand('B', '600100200')] });
  const { sendSms, wyslane } = smsapi({ '48504400901': { sent: false, error: 'SMSAPI błąd 105: zły numer — błędny numer odbiorcy' } });
  const w = await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ });
  check('błędny numer (105) — oferta zostaje zajęta, idzie dalej', [stan.oferty[0].przypomnienie_wersja, wyslane.length, w.wyslano], [1, 2, 1]);
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')] });
  const { sendSms } = smsapi({ '48504400901': { sent: false, stub: true } });
  const w = await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ });
  check('bez SMSAPI_TOKEN (stub) — nic nie „zużyte"', [stan.oferty[0].przypomnienie_wersja, w.wyslano, /SMSAPI_TOKEN/.test(w.przerwano)], [null, 0, true]);
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')] });
  const { sendSms } = smsapi({ '48504400901': 'wyjatek' });
  const w = await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ });
  check('wyjątek przy wysyłce — złapany, oferta zwolniona', [stan.oferty[0].przypomnienie_wersja, w.bledow], [null, 1]);
}
{
  const oferty = Array.from({ length: 25 }, (_, i) => ({ id: 'O' + i, wersja: 1 }));
  const kandydaci = oferty.map((o, i) => kand(o.id, String(500000000 + i)));
  const { sb } = atrapa({ oferty, kandydaci });
  const { sendSms, wyslane } = smsapi();
  await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ });
  check(`najwyżej ${PRZYPOMNIENIA_NA_RAZ} SMS-ów na wywołanie`, wyslane.length, PRZYPOMNIENIA_NA_RAZ);
}

console.log('Punkt wejścia crona');
{
  const zrodlo = readFileSync(new URL('../src/routes/api/cron/przypomnienia-ofert/+server.js', import.meta.url), 'utf8');
  const iToken = zrodlo.indexOf("rpc('edge_cron_token_matches'");
  check('token sprawdzany', iToken > 0, true);
  check('token przed oknem godzin i przed wysyłką', iToken < zrodlo.indexOf('wOknieWysylki()') && iToken < zrodlo.indexOf('wyslijPrzypomnienia('), true);
  check('tylko POST (GET → 405)', /export function GET[\s\S]*status: 405/.test(zrodlo), true);
  const migracja = readFileSync(new URL('../../../supabase/migrations/20261012123157_oferty_przypomnienia_sms.sql', import.meta.url), 'utf8');
  check('cron woła ten adres z tokenem z Vaulta', migracja.includes('/api/cron/przypomnienia-ofert') && /x-cron-token[\s\S]*vault\.decrypted_secrets/.test(migracja), true);
  check('zadanie powstaje wyłączone', /cron\.alter_job\(v_id, active := false\)/.test(migracja), true);
}

if (failures) {
  console.log(`\n✗ ${failures} błędów`);
  process.exit(1);
}
console.log('\n✓ wszystko zgodne');
