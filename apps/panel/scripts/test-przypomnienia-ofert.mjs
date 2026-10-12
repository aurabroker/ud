/**
 * test-przypomnienia-ofert.mjs — SMS do klientów, którzy dostali ofertę i milczą
 * (decyzja z 12.10.2026). Uruchom: node scripts/test-przypomnienia-ofert.mjs
 *
 * Bez bazy i bez SMSAPI: atrapa klienta Supabase trzyma oferty i dziennik
 * wysyłek w pamięci, odtwarza warunkowy UPDATE (zajęcie wersji, także
 * osieroconej) i liczy zapytania. Wybór kandydatów to SQL
 * (ud_oferty_do_przypomnienia) — tu atrapa oddaje gotową listę, a reguły
 * wyboru sprawdza scripts/test-przypomnienia-sql.mjs na prawdziwym Postgresie.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { wyslijPrzypomnienia, KANAL_PRZYPOMNIENIA, BUDZET_ZAPYTAN, CZAS_MS } from '../src/lib/server/przypomnieniaOfert.js';
import { SMS_PRZYPOMNIENIE, jednaCzesc, wOknieWysylki, PRZYPOMNIENIA_NA_RAZ } from '../src/lib/server/smsOferta.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(72)} = ${JSON.stringify(actual)}${ok ? '' : `  (oczekiwano ${JSON.stringify(expected)})`}`);
}

const TERAZ = new Date('2026-10-13T08:00:00Z'); // wtorek, 10:00 w Warszawie
const GODZINE_TEMU = new Date(TERAZ.getTime() - 3600 * 1000).toISOString();

/** Porównanie jak w PostgREST: liczby jako liczby, reszta jako tekst (ISO sortuje się poprawnie). */
const porownaj = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && a !== '' && b !== '' ? na - nb : String(a).localeCompare(String(b));
};

/** Wyrażenie `or=(…)` PostgREST-u: przecinki na najwyższym poziomie, `and(…)`, `kol.op.wartość`. */
function warunekOr(wyr) {
  const czesci = [];
  let glebokosc = 0;
  let biezace = '';
  for (const z of wyr) {
    if (z === '(') glebokosc++;
    if (z === ')') glebokosc--;
    if (z === ',' && glebokosc === 0) { czesci.push(biezace); biezace = ''; } else biezace += z;
  }
  czesci.push(biezace);
  const jeden = (c) => {
    const and = /^and\((.*)\)$/.exec(c);
    if (and) {
      const pod = warunekOr(and[1]);
      return (r) => pod.wszystkie(r);
    }
    const m = /^([a-z_]+)\.(is|eq|lt|gt|gte|lte)\.(.*)$/.exec(c);
    if (!m) throw new Error('nieznany warunek: ' + c);
    const [, kol, op, wart] = m;
    return (r) => {
      const v = r[kol];
      if (op === 'is') return wart === 'null' ? v == null : false;
      if (v == null) return false;
      const c2 = porownaj(v, wart);
      return { eq: c2 === 0, lt: c2 < 0, gt: c2 > 0, gte: c2 >= 0, lte: c2 <= 0 }[op];
    };
  };
  const warunki = czesci.map(jeden);
  return { ktorykolwiek: (r) => warunki.some((w) => w(r)), wszystkie: (r) => warunki.every((w) => w(r)) };
}

/**
 * Atrapa: oferty { id, wersja, przypomnienie_wersja, przypomnienie_sms_at, user_id },
 * dziennik, lista kandydatów, wstrzykiwane awarie („ud_send_log.insert" itd.).
 */
function atrapa({ oferty, kandydaci, dziennik = [], awarie = {} }) {
  const stan = {
    oferty: oferty.map((o) => ({ przypomnienie_wersja: null, przypomnienie_sms_at: null, user_id: 'agent-1', ...o })),
    dziennik,
    zapytan: 0,
  };
  let nastepneId = 1;
  const sb = {
    async rpc(nazwa) {
      stan.zapytan++;
      if (nazwa !== 'ud_oferty_do_przypomnienia') throw new Error('rpc ' + nazwa);
      return { data: kandydaci, error: null };
    },
    from(tabela) {
      const f = [];
      let op = 'select';
      let patch = null;
      let wiersz = null;
      let zwrot = false;
      const b = {
        select() { if (op !== 'select') zwrot = true; return b; },
        update(p) { op = 'update'; patch = p; return b; },
        insert(r) { op = 'insert'; wiersz = r; return b; },
        eq(k, v) { f.push((r) => r[k] === v); return b; },
        in(k, v) { f.push((r) => v.includes(r[k])); return b; },
        gte(k, v) { f.push((r) => r[k] >= v); return b; },
        limit() { return b; },
        or(wyr) { const w = warunekOr(wyr); f.push(w.ktorykolwiek); return b; },
        then(ok, zle) {
          return Promise.resolve().then(() => {
            stan.zapytan++;
            const awaria = awarie[`${tabela}.${op}`];
            if (awaria) return { data: null, error: { message: `awaria ${tabela}.${op}` } };
            const zbior = tabela === 'ud_offers' ? stan.oferty : stan.dziennik;
            if (op === 'insert') {
              const nowy = { id: 'log-' + nextId(), created_at: TERAZ.toISOString(), ...wiersz };
              zbior.push(nowy);
              return { data: zwrot ? [{ id: nowy.id }] : null, error: null };
            }
            const trafione = zbior.filter((r) => f.every((x) => x(r)));
            if (op === 'update') {
              for (const r of trafione) Object.assign(r, patch);
              return { data: zwrot ? trafione.map((r) => ({ id: r.id, user_id: r.user_id })) : null, error: null };
            }
            return { data: trafione, error: null };
          }).then(ok, zle);
        },
      };
      return b;
    },
  };
  function nextId() { return nastepneId++; }
  return { sb, stan };
}

/**
 * Atrapa SMSAPI: odpowiedź per numer, domyślnie wysłany. Zapisuje, czy w chwili
 * wysyłki dziennik miał już wpis „pending" dla tego numeru.
 */
function smsapi(odpowiedzi = {}, stan = null) {
  const wyslane = [];
  const sendSms = async (numer, tresc) => {
    const zSladem = stan ? stan.dziennik.some((d) => d.recipient === numer && d.status === 'pending') : null;
    wyslane.push({ numer, tresc, zSladem });
    const o = odpowiedzi[numer];
    if (o === 'wyjatek') throw new Error('sieć');
    return o ?? { sent: true, id: 'sms-' + wyslane.length };
  };
  return { sendSms, wyslane };
}

const kand = (id, telefon, wersja = 1, telefonKlienta = null) =>
  ({ offer_id: id, wersja, telefon_oferty: telefon, telefon_klienta: telefonKlienta, sent_at: '2026-10-08T10:00:00Z' });

const uruchom = (sb, sendSms, extra = {}) => wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ, zegar: () => 0, ...extra });

console.log('Treść i godziny');
check('jedna część SMS-a', jednaCzesc(SMS_PRZYPOMNIENIE), true);
check('bez linku, gołej domeny i kodu', /https?:|www\.|\b[\w-]+\.(pl|com|eu)\b|kod|pesel|pin/i.test(SMS_PRZYPOMNIENIE), false);
check('bez zwrotów sprzedażowych (rabat, ostatnia szansa…)', /rabat|promocj|zniżk|znizk|ostatni|tylko dzis|okazj/i.test(SMS_PRZYPOMNIENIE), false);
check('wtorek 10:00 — można', wOknieWysylki(TERAZ), true);
check('wtorek 8:59 — nie', wOknieWysylki(new Date('2026-10-13T06:59:00Z')), false);
check('wtorek 18:59 — można', wOknieWysylki(new Date('2026-10-13T16:59:00Z')), true);
check('wtorek 19:00 — nie', wOknieWysylki(new Date('2026-10-13T17:00:00Z')), false);
check('sobota 12:00 — nie', wOknieWysylki(new Date('2026-10-17T10:00:00Z')), false);
check('niedziela 12:00 — nie', wOknieWysylki(new Date('2026-10-18T10:00:00Z')), false);
check('zimą 9:00 czasu polskiego = 8:00 UTC — można', wOknieWysylki(new Date('2026-12-01T08:00:00Z')), true);
check('latem 7:30 UTC = 9:30 czasu polskiego — można', wOknieWysylki(new Date('2026-07-01T07:30:00Z')), true);

console.log('Wysyłka');
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 2 }], kandydaci: [kand('A', '504 400 901'), kand('B', '+48 600 100 200', 2)] });
  const { sendSms, wyslane } = smsapi({}, stan);
  const w = await uruchom(sb, sendSms);
  check('dwie oferty — dwa SMS-y', [w.wyslano, wyslane.length], [2, 2]);
  check('treść to SMS_PRZYPOMNIENIE', wyslane.every((s) => s.tresc === SMS_PRZYPOMNIENIE), true);
  check('w chwili wysyłki dziennik ma już wpis „pending" (ślad PRZED SMS-em)', wyslane.map((s) => s.zSladem), [true, true]);
  check('zajęte wersje 1 i 2', stan.oferty.map((o) => o.przypomnienie_wersja), [1, 2]);
  check('dziennik: kanał przypomnienia, status sent, wersja, id SMS-a',
    stan.dziennik.map((d) => [d.channel, d.status, d.recipient, d.wersja, d.provider_id]),
    [[KANAL_PRZYPOMNIENIA, 'sent', '48504400901', 1, 'sms-1'], [KANAL_PRZYPOMNIENIA, 'sent', '48600100200', 2, 'sms-2']]);
  check('żaden wpis nie został „pending"', stan.dziennik.some((d) => d.status === 'pending'), false);

  // Drugie wywołanie z tą samą listą (np. nakładający się cron) nie wyśle nic.
  const drugi = smsapi();
  const w2 = await uruchom(sb, drugi.sendSms);
  check('drugie wywołanie: zero SMS-ów (wersja zajęta / numer z ostatnich 7 dni)', [w2.wyslano, drugi.wyslane.length], [0, 0]);
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '504400901'), kand('B', '504 400 901')] });
  const { sendSms, wyslane } = smsapi();
  await uruchom(sb, sendSms);
  check('ten sam numer przy dwóch ofertach — jeden SMS', wyslane.length, 1);
  check('druga oferta nie zajęta (może dostać, gdy numer się zmieni)', stan.oferty[1].przypomnienie_wersja, null);
}
for (const status of ['sent', 'pending']) {
  const dziennik = [{ channel: KANAL_PRZYPOMNIENIA, recipient: '48504400901', status, created_at: '2026-10-10T08:00:00Z' }];
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')], dziennik });
  const { sendSms, wyslane } = smsapi();
  await uruchom(sb, sendSms);
  check(`numer z przypomnieniem „${status}" sprzed 3 dni — pominięty, oferta nietknięta`, [wyslane.length, stan.oferty[0].przypomnienie_wersja], [0, null]);
}
{
  const dziennik = [
    { channel: KANAL_PRZYPOMNIENIA, recipient: '48504400901', status: 'error', created_at: '2026-10-12T08:00:00Z' },
    { channel: KANAL_PRZYPOMNIENIA, recipient: '48504400901', status: 'sent', created_at: '2026-10-05T08:00:00Z' },
    { channel: 'sms', recipient: '48504400901', status: 'sent', created_at: '2026-10-12T08:00:00Z' },
  ];
  const { sb } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')], dziennik });
  const { sendSms, wyslane } = smsapi();
  await uruchom(sb, sendSms);
  check('nie blokują: błąd wczoraj, przypomnienie sprzed 8 dni, SMS o samej ofercie', wyslane.length, 1);
}
{
  const { sb } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '123', 1, '504400901'), kand('B', null, 1, 'abc')] });
  const { sendSms, wyslane } = smsapi();
  const w = await uruchom(sb, sendSms);
  check('zły numer przy ofercie — bierze numer z kartoteki', wyslane.map((s) => s.numer), ['48504400901']);
  check('bez żadnego poprawnego numeru — pominięta', w.pominieto, 1);
}
{
  const { sb } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '+49 1512 3456789')] });
  const { sendSms, wyslane } = smsapi();
  await uruchom(sb, sendSms);
  check('numer zagraniczny — bez SMS-a (nie zgadujemy kierunkowego)', wyslane.length, 0);
}

console.log('Osierocone zajęcie');
{
  // Baza zwróciła ofertę zajętą 2 h temu bez wpisu w dzienniku — przejmujemy.
  const dwieGodziny = new Date(TERAZ.getTime() - 2 * 3600 * 1000).toISOString();
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1, przypomnienie_wersja: 1, przypomnienie_sms_at: dwieGodziny }], kandydaci: [kand('A', '504400901')] });
  const { sendSms, wyslane } = smsapi();
  const w = await uruchom(sb, sendSms);
  check('zajęcie sprzed 2 h — przejęte i wysłane', [w.wyslano, wyslane.length, stan.oferty[0].przypomnienie_sms_at], [1, 1, TERAZ.toISOString()]);
}
{
  // To samo, ale inne wywołanie przejęło ją przed chwilą — nie wysyłamy drugi raz.
  const przedChwila = new Date(TERAZ.getTime() - 60 * 1000).toISOString();
  const { sb } = atrapa({ oferty: [{ id: 'A', wersja: 1, przypomnienie_wersja: 1, przypomnienie_sms_at: przedChwila }], kandydaci: [kand('A', '504400901')] });
  const { sendSms, wyslane } = smsapi();
  const w = await uruchom(sb, sendSms);
  check('zajęcie sprzed minuty (inne wywołanie) — bez SMS-a', [w.wyslano, w.pominieto, wyslane.length], [0, 1, 0]);
}
{
  const { sb } = atrapa({ oferty: [{ id: 'A', wersja: 1, przypomnienie_wersja: 1, przypomnienie_sms_at: GODZINE_TEMU }], kandydaci: [kand('A', '504400901')] });
  const { sendSms, wyslane } = smsapi();
  await uruchom(sb, sendSms);
  check('zajęcie dokładnie sprzed godziny — jeszcze nie (ściśle starsze)', wyslane.length, 0);
}

console.log('Błędy SMSAPI');
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '504400901'), kand('B', '600100200')] });
  const { sendSms, wyslane } = smsapi({ '48504400901': { sent: false, error: 'SMSAPI błąd 103: brak punktów — brak punktów na koncie' } });
  const w = await uruchom(sb, sendSms);
  check('brak punktów — przerwane po pierwszym', [wyslane.length, Boolean(w.przerwano)], [1, true]);
  check('oferta zwolniona — następny cron spróbuje', stan.oferty[0].przypomnienie_wersja, null);
  check('druga oferta nietknięta', stan.oferty[1].przypomnienie_wersja, null);
  check('w dzienniku błąd z treścią (nie „pending")', stan.dziennik[0].status + ' / ' + /103/.test(stan.dziennik[0].error), 'error / true');
}
{
  // 105 to filtr IP konta, nie zły numer — każda kolejna próba skończy się tak samo.
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '504400901'), kand('B', '600100200')] });
  const { sendSms, wyslane } = smsapi({ '48504400901': { sent: false, error: 'SMSAPI błąd 105: Invalid IP — adres IP spoza listy dozwolonych' } });
  const w = await uruchom(sb, sendSms);
  check('SMSAPI 105 (filtr IP) — zwolniona, przerwane', [stan.oferty[0].przypomnienie_wersja, wyslane.length, Boolean(w.przerwano)], [null, 1, true]);
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '504400901'), kand('B', '600100200')] });
  const { sendSms, wyslane } = smsapi({ '48504400901': { sent: false, error: 'SMSAPI błąd 13: No correct phone numbers — brak prawidłowego numeru odbiorcy' } });
  const w = await uruchom(sb, sendSms);
  check('odrzucony numer (13) — oferta zostaje zajęta, idzie dalej', [stan.oferty[0].przypomnienie_wersja, wyslane.length, w.wyslano, w.bledow], [1, 2, 1, 1]);
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')] });
  const { sendSms } = smsapi({ '48504400901': { sent: false, stub: true } });
  const w = await uruchom(sb, sendSms);
  check('bez SMSAPI_TOKEN (stub) — nic nie „zużyte"', [stan.oferty[0].przypomnienie_wersja, w.wyslano, /SMSAPI_TOKEN/.test(w.przerwano)], [null, 0, true]);
  check('stub w dzienniku jako „stub"', stan.dziennik.map((d) => d.status), ['stub']);
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')] });
  const { sendSms } = smsapi({ '48504400901': 'wyjatek' });
  const w = await uruchom(sb, sendSms);
  check('wyjątek przed wysyłką (sms.js łapie błędy sieci) — złapany, oferta zwolniona', [stan.oferty[0].przypomnienie_wersja, w.bledow], [null, 1]);
}
{
  // sms.js zamienia wyjątek fetch (limit 8 s, zerwane połączenie) na „SMSAPI: …".
  // Odpowiedzi nie było — SMS mógł wyjść. Nie ponawiamy.
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }, { id: 'B', wersja: 1 }], kandydaci: [kand('A', '504400901'), kand('B', '600100200')] });
  const { sendSms, wyslane } = smsapi({ '48504400901': { sent: false, error: 'SMSAPI: The operation was aborted due to timeout' } });
  const w = await uruchom(sb, sendSms);
  check('brak odpowiedzi SMSAPI — oferta ZOSTAJE zajęta, wywołanie przerwane', [stan.oferty[0].przypomnienie_wersja, wyslane.length, Boolean(w.przerwano)], [1, 1, true]);
  check('w dzienniku: błąd z dopiskiem „nie wiadomo, czy SMS wyszedł"', /nie wiadomo/.test(stan.dziennik[0].error) && stan.dziennik[0].status === 'error', true);
}

console.log('Dziennik wysyłek');
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')], awarie: { 'ud_send_log.insert': true } });
  const { sendSms, wyslane } = smsapi();
  const w = await uruchom(sb, sendSms);
  check('nie da się zapisać „pending" — SMS NIE wychodzi', wyslane.length, 0);
  check('… oferta zwolniona, wywołanie przerwane', [stan.oferty[0].przypomnienie_wersja, Boolean(w.przerwano)], [null, true]);
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')], awarie: { 'ud_send_log.select': true } });
  const { sendSms, wyslane } = smsapi();
  const w = await uruchom(sb, sendSms);
  check('nie da się sprawdzić limitu 7 dni — bez SMS-a, bez zajęcia', [wyslane.length, stan.oferty[0].przypomnienie_wersja, Boolean(w.przerwano)], [0, null, true]);
}
{
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')], awarie: { 'ud_offers.update': true } });
  const { sendSms, wyslane } = smsapi();
  const w = await uruchom(sb, sendSms);
  check('nie da się zająć oferty — bez SMS-a', [wyslane.length, stan.dziennik.length, Boolean(w.przerwano)], [0, 0, true]);
}
{
  // Wynik wysyłki nie zapisał się: wpis zostaje „pending" i blokuje ponowienie.
  const { sb, stan } = atrapa({ oferty: [{ id: 'A', wersja: 1 }], kandydaci: [kand('A', '504400901')], awarie: { 'ud_send_log.update': true } });
  const { sendSms, wyslane } = smsapi();
  const w = await uruchom(sb, sendSms);
  check('wynik się nie zapisał — SMS policzony, wpis zostaje „pending"', [w.wyslano, wyslane.length, stan.dziennik[0].status], [1, 1, 'pending']);
  const { sb: sb2 } = atrapa({ oferty: [{ id: 'B', wersja: 1 }], kandydaci: [kand('B', '504400901')], dziennik: stan.dziennik });
  const drugi = smsapi();
  await uruchom(sb2, drugi.sendSms);
  check('… i ten numer nie dostanie drugiego SMS-a przez 7 dni', drugi.wyslane.length, 0);
}

console.log('Limity jednego wywołania');
{
  const oferty = Array.from({ length: 25 }, (_, i) => ({ id: 'O' + i, wersja: 1 }));
  const kandydaci = oferty.map((o, i) => kand(o.id, String(500000000 + i)));
  const { sb, stan } = atrapa({ oferty, kandydaci });
  const { sendSms, wyslane } = smsapi();
  const w = await uruchom(sb, sendSms);
  check(`najwyżej ${PRZYPOMNIENIA_NA_RAZ} SMS-ów na wywołanie, reszta czeka`, [wyslane.length, w.zostalo], [PRZYPOMNIENIA_NA_RAZ, 25 - PRZYPOMNIENIA_NA_RAZ]);
  check(`zapytań (z SMSAPI) nie więcej niż ${BUDZET_ZAPYTAN}`, stan.zapytan + wyslane.length <= BUDZET_ZAPYTAN, true);
}
{
  const oferty = Array.from({ length: 10 }, (_, i) => ({ id: 'O' + i, wersja: 1 }));
  const kandydaci = oferty.map((o, i) => kand(o.id, String(500000000 + i)));
  const { sb } = atrapa({ oferty, kandydaci });
  const odp = Object.fromEntries(kandydaci.map((k) => ['48' + k.telefon_oferty, { sent: false, error: 'SMSAPI błąd 13: zly numer' }]));
  const { sendSms, wyslane } = smsapi(odp);
  await uruchom(sb, sendSms);
  check(`odrzucone numery też liczą się do limitu ${PRZYPOMNIENIA_NA_RAZ} prób`, wyslane.length, PRZYPOMNIENIA_NA_RAZ);
}
{
  // Sto kandydatów, wszyscy z przypomnieniem w tym tygodniu: każdy kosztuje
  // zapytanie, więc pętla musi stanąć na budżecie, nie przejść całej listy.
  const kandydaci = Array.from({ length: 100 }, (_, i) => kand('O' + i, String(500000000 + i)));
  const dziennik = kandydaci.map((k) => ({ channel: KANAL_PRZYPOMNIENIA, recipient: '48' + k.telefon_oferty, status: 'sent', created_at: '2026-10-12T08:00:00Z' }));
  const { sb, stan } = atrapa({ oferty: kandydaci.map((k) => ({ id: k.offer_id, wersja: 1 })), kandydaci, dziennik });
  const { sendSms } = smsapi();
  const w = await uruchom(sb, sendSms);
  check(`sto pominiętych — zapytań najwyżej ${BUDZET_ZAPYTAN}, reszta czeka`, [stan.zapytan <= BUDZET_ZAPYTAN, w.zostalo > 0], [true, true]);
}
{
  // Zegar: każde odczytanie przesuwa czas o 4 s — po CZAS_MS nowy kandydat nie startuje.
  let t = 0;
  const zegar = () => { const v = t; t += 4000; return v; };
  const oferty = Array.from({ length: 6 }, (_, i) => ({ id: 'O' + i, wersja: 1 }));
  const { sb } = atrapa({ oferty, kandydaci: oferty.map((o, i) => kand(o.id, String(500000000 + i))) });
  const { sendSms, wyslane } = smsapi();
  const w = await wyslijPrzypomnienia({ sb, sendSms, teraz: TERAZ, zegar });
  check(`po ${CZAS_MS / 1000} s nowy kandydat nie startuje`, [wyslane.length < 6, w.zostalo > 0], [true, true]);
}

console.log('Punkt wejścia crona');
{
  const zrodlo = readFileSync(new URL('../src/routes/api/cron/przypomnienia-ofert/+server.js', import.meta.url), 'utf8');
  const iToken = zrodlo.indexOf("rpc('edge_cron_token_matches'");
  const iTest = zrodlo.indexOf("env.SMSAPI_TEST === '1'");
  const iWysylka = zrodlo.indexOf('wyslijPrzypomnienia(');
  check('token sprawdzany', iToken > 0, true);
  check('token przed oknem godzin i przed wysyłką', iToken < zrodlo.indexOf('wOknieWysylki()') && iToken < iWysylka, true);
  check('SMSAPI_TEST=1 wstrzymuje przypomnienia (przed wysyłką)', iTest > iToken && iTest < iWysylka, true);
  check('przerwanie wysyłki i wyjątek trafiają do ud_errors', /if \(wynik\.przerwano\)[\s\S]*zapiszBlad\(/.test(zrodlo) && /catch \(e\)[\s\S]*zapiszBlad\(/.test(zrodlo.slice(iWysylka)), true);
  check('zły token z nagłówkiem trafia do ud_errors', /zgodny !== true[\s\S]{0,400}zapiszBlad\(/.test(zrodlo), true);
  check('tylko POST (GET → 405)', /export function GET[\s\S]*status: 405/.test(zrodlo), true);
}

console.log('SMSAPI (sms.js)');
{
  const sms = readFileSync(new URL('../src/lib/server/sms.js', import.meta.url), 'utf8');
  check('limit czasu na każde wywołanie SMSAPI', /signal: AbortSignal\.timeout\(TIMEOUT_MS\)/.test(sms), true);
  check('limit krótszy niż cierpliwość crona (30 s)', Number(/const TIMEOUT_MS = (\d+)/.exec(sms)?.[1]) <= 10000, true);
  check('105 opisany jako filtr IP, nie zły numer', /105: '[^']*IP/.test(sms) && !/105: '[^']*numer/.test(sms), true);
  check('13 opisany jako zły numer', /13: '[^']*numer/.test(sms), true);
}

console.log('Migracje');
{
  const katalog = new URL('../../../supabase/migrations/', import.meta.url);
  const pliki = readdirSync(katalog).filter((p) => /_oferty_przypomnienia_sms(_\d+)?\.sql$/.test(p)).sort();
  check('dwie migracje przypomnień (nazwy = wersje w bazie)', pliki, ['20261012123157_oferty_przypomnienia_sms.sql', '20261012162649_oferty_przypomnienia_sms_2.sql']);
  const pierwsza = readFileSync(new URL(pliki[0], katalog), 'utf8');
  check('cron woła ten adres z tokenem z Vaulta', pierwsza.includes('/api/cron/przypomnienia-ofert') && /x-cron-token[\s\S]*vault\.decrypted_secrets/.test(pierwsza), true);
  check('zadanie powstaje wyłączone', /cron\.alter_job\(v_id, active := false\)/.test(pierwsza), true);
  const druga = readFileSync(new URL(pliki[1], katalog), 'utf8');
  check('druga migracja nie włącza zadania crona', /cron\./.test(druga.replace(/--.*$/gm, '')), false);
}

if (failures) {
  console.log(`\n✗ ${failures} błędów`);
  process.exit(1);
}
console.log('\n✓ wszystko zgodne');
