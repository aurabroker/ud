import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atrapaD1 } from './pomocnicze.js';
import { naniesStan, posprzataj, DNI_HISTORII } from '../src/baza.js';
import { ulozWiadomosc, wyslij } from '../src/alarm.js';

const wynik = (ok, czas, extra = {}) => ({ sonda: 'test', ok, czas, ...extra });

test('pojedyncze niepowodzenie nie jest jeszcze awarią', async () => {
  const db = atrapaD1();
  const r = await naniesStan(db, wynik(false, 1000), 2);
  assert.equal(r.przejscie, null, 'jedno mrugnięcie nie może budzić nikogo w nocy');
  assert.equal(r.podRzad, 1);
});

test('drugie niepowodzenie z rzędu zgłasza awarię', async () => {
  const db = atrapaD1();
  await naniesStan(db, wynik(false, 1000), 2);
  const r = await naniesStan(db, wynik(false, 2000), 2);
  assert.equal(r.przejscie, 'awaria');
});

test('trwająca awaria nie generuje kolejnych alertów', async () => {
  const db = atrapaD1();
  await naniesStan(db, wynik(false, 1000), 2);
  await naniesStan(db, wynik(false, 2000), 2);
  for (const czas of [3000, 4000, 5000, 6000]) {
    const r = await naniesStan(db, wynik(false, czas), 2);
    assert.equal(r.przejscie, null, 'godzina awarii to ma być jedna wiadomość, nie dwanaście');
  }
});

test('powrót po zgłoszonej awarii jest zgłaszany', async () => {
  const db = atrapaD1();
  await naniesStan(db, wynik(false, 1000), 2);
  await naniesStan(db, wynik(false, 2000), 2);
  const r = await naniesStan(db, wynik(true, 3000), 2);
  assert.equal(r.przejscie, 'powrot');
});

test('powrót po niezgłoszonym mrugnięciu jest przemilczany', async () => {
  const db = atrapaD1();
  await naniesStan(db, wynik(false, 1000), 2);   // jedno niepowodzenie, bez alertu
  const r = await naniesStan(db, wynik(true, 2000), 2);
  assert.equal(r.przejscie, null, 'nie ogłaszamy powrotu z awarii, o której nikt nie słyszał');
});

test('kolejna awaria po powrocie znów się zgłasza', async () => {
  const db = atrapaD1();
  await naniesStan(db, wynik(false, 1000), 2);
  await naniesStan(db, wynik(false, 2000), 2);
  await naniesStan(db, wynik(true, 3000), 2);
  await naniesStan(db, wynik(false, 4000), 2);
  const r = await naniesStan(db, wynik(false, 5000), 2);
  assert.equal(r.przejscie, 'awaria', 'migający serwis ma się zgłaszać za każdym razem');
});

test('próg 1 zgłasza od pierwszego niepowodzenia', async () => {
  const db = atrapaD1();
  const r = await naniesStan(db, wynik(false, 1000), 1);
  assert.equal(r.przejscie, 'awaria');
});

test('czas trwania awarii liczy się od pierwszego niepowodzenia, nie od alertu', async () => {
  const db = atrapaD1();
  await naniesStan(db, wynik(false, 1000), 2);
  const r = await naniesStan(db, wynik(false, 9000), 2);
  assert.equal(r.od, 1000);
});

test('wiadomość o awarii niesie to, co potrzebne do decyzji', () => {
  const w = ulozWiadomosc('awaria', wynik(false, Date.UTC(2026, 7, 27, 10, 0), {
    kod: 500, szczegoly: 'PGRST204',
  }), { status: 'https://status.example' });

  assert.equal(w.poziom, 'awaria');
  assert.match(w.tytul, /test/);
  assert.match(w.tresc, /500/);
  assert.match(w.tresc, /PGRST204/);
  assert.match(w.tresc, /status\.example/);
});

test('wiadomość o powrocie podaje, jak długo trwała awaria', () => {
  const start = Date.UTC(2026, 7, 27, 10, 0);
  const w = ulozWiadomosc('powrot', wynik(true, start + 25 * 60_000), { od: start });
  assert.equal(w.poziom, 'powrot');
  assert.match(w.tresc, /około 25 min/);
});

test('brak webhooka nie jest błędem', async () => {
  const r = await wyslij(undefined, { poziom: 'awaria', tytul: 't', tresc: 'x' }, wynik(false, 1));
  assert.equal(r.wyslano, false);
  assert.match(r.powod, /ALERT_WEBHOOK/);
});

test('nieudana wysyłka alertu nie wyrzuca wyjątku', async () => {
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('sieć padła'); };
  try {
    const r = await wyslij('https://webhook.example', { poziom: 'awaria', tytul: 't', tresc: 'x' }, wynik(false, 1));
    assert.equal(r.wyslano, false, 'alert ma się nie udać po cichu, nie przerwać przebiegu');
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test('sprzątanie kasuje tylko pomiary spoza okna historii', async () => {
  const db = atrapaD1();
  const teraz = Date.now();
  await db.prepare('INSERT INTO pomiar (sonda, czas, ok, ms, kod, szczegoly) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('a', teraz - (DNI_HISTORII + 1) * 86_400_000, 1, 10, 200, null).run();
  await db.prepare('INSERT INTO pomiar (sonda, czas, ok, ms, kod, szczegoly) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('a', teraz - 3600_000, 1, 10, 200, null).run();

  assert.equal(await posprzataj(db), 1);
  assert.equal(db._pomiary.length, 1);
});
