import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podmienFetch, odpowiedz } from './pomocnicze.js';
import { strona, przekierowanie, kontraktFunkcji, odczytPubliczny, cisza, wGodzinachPracy } from '../src/sondy.js';

test('strona z poprawnym statusem i treścią przechodzi', async () => {
  const przywroc = podmienFetch(async () => odpowiedz('<h1>Ubezpieczenie utraty dochodu</h1>'));
  try {
    const w = await strona({ nazwa: 's', url: 'https://x', zawiera: 'utraty dochodu' }).uruchom();
    assert.equal(w.ok, true);
    assert.equal(w.kod, 200);
  } finally { przywroc(); }
});

test('status 200 z podstawioną stroną błędu jest wychwycony', async () => {
  // CDN potrafi oddać 200 ze swoją stroną — sam status nic nie dowodzi.
  const przywroc = podmienFetch(async () => odpowiedz('<h1>Error 1016</h1>'));
  try {
    const w = await strona({ nazwa: 's', url: 'https://x', zawiera: 'utraty dochodu' }).uruchom();
    assert.equal(w.ok, false);
    assert.match(w.szczegoly, /brak w treści/);
  } finally { przywroc(); }
});

test('zbyt wolna odpowiedź to niepowodzenie', async () => {
  const przywroc = podmienFetch(async () => {
    await new Promise((r) => setTimeout(r, 60));
    return odpowiedz('ok');
  });
  try {
    const w = await strona({ nazwa: 's', url: 'https://x', maxMs: 10 }).uruchom();
    assert.equal(w.ok, false);
    assert.match(w.szczegoly, /wolno/);
  } finally { przywroc(); }
});

test('błąd sieci nie wyrzuca wyjątku, tylko zwraca niepowodzenie', async () => {
  const przywroc = podmienFetch(async () => { throw new Error('ECONNREFUSED'); });
  try {
    const w = await strona({ nazwa: 's', url: 'https://x' }).uruchom();
    assert.equal(w.ok, false);
    assert.match(w.szczegoly, /ECONNREFUSED/);
  } finally { przywroc(); }
});

test('kontrakt funkcji: umówiony błąd 400 to sukces sondy', async () => {
  // Funkcja MA odrzucić puste ciało — to dowód, że jest wdrożona i działa.
  const przywroc = podmienFetch(async () =>
    odpowiedz({ status: 'error', message: 'Brak danych formularza.' }, { status: 400 }));
  try {
    const w = await kontraktFunkcji({
      nazwa: 'f', url: 'https://x', status: 400, komunikatZawiera: 'Brak danych formularza',
    }).uruchom();
    assert.equal(w.ok, true);
  } finally { przywroc(); }
});

test('kontrakt funkcji: inny komunikat to niepowodzenie', async () => {
  // Tak wyglądałby regres w rodzaju PGRST204 — odpowiedź jest, ale nie ta.
  const przywroc = podmienFetch(async () =>
    odpowiedz({ status: 'error', message: 'column not found' }, { status: 400 }));
  try {
    const w = await kontraktFunkcji({
      nazwa: 'f', url: 'https://x', status: 400, komunikatZawiera: 'Brak danych formularza',
    }).uruchom();
    assert.equal(w.ok, false);
    assert.match(w.szczegoly, /inna odpowiedź/);
  } finally { przywroc(); }
});

test('kontrakt funkcji: 404 znaczy, że funkcja nie jest wdrożona', async () => {
  const przywroc = podmienFetch(async () => odpowiedz('not found', { status: 404 }));
  try {
    const w = await kontraktFunkcji({ nazwa: 'f', url: 'https://x', status: 400 }).uruchom();
    assert.equal(w.ok, false);
    assert.equal(w.kod, 404);
  } finally { przywroc(); }
});

test('odczyt publiczny: pusta odpowiedź przy wymaganym wierszu to regres RLS', async () => {
  const przywroc = podmienFetch(async () => odpowiedz([]));
  try {
    const w = await odczytPubliczny({ nazwa: 'd', url: 'https://x', klucz: 'k' }).uruchom();
    assert.equal(w.ok, false);
    assert.match(w.szczegoly, /0 wierszy/);
  } finally { przywroc(); }
});

test('przekierowanie pobierania OWU musi prowadzić do storage', async () => {
  const przywroc = podmienFetch(async () =>
    new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }));
  try {
    const w = await przekierowanie({ nazwa: 'p', url: 'https://x', doDomeny: 'supabase.co' }).uruchom();
    assert.equal(w.ok, false);
    assert.match(w.szczegoly, /poza supabase\.co/);
  } finally { przywroc(); }
});

test('godziny pracy: wtorek 10:00 tak, sobota 10:00 nie, wtorek 23:00 nie', () => {
  // Przesunięcie +1 h (czas środkowoeuropejski).
  assert.equal(wGodzinachPracy(new Date('2026-08-25T09:00:00Z'), 1), true);
  assert.equal(wGodzinachPracy(new Date('2026-08-29T09:00:00Z'), 1), false);
  assert.equal(wGodzinachPracy(new Date('2026-08-25T22:00:00Z'), 1), false);
});

test('cisza: poza godzinami pracy sonda milczy zamiast alarmować', async () => {
  const przywroc = podmienFetch(async () => { throw new Error('nie powinno się wykonać'); });
  try {
    const w = await cisza({
      nazwa: 'c', url: 'https://x?select=id', klucz: 'k',
      teraz: () => new Date('2026-08-29T03:00:00Z'),   // sobota, noc
    }).uruchom();
    assert.equal(w.ok, true);
    assert.match(w.szczegoly, /poza godzinami pracy/);
  } finally { przywroc(); }
});

test('cisza: zero zgłoszeń w godzinach pracy to alarm', async () => {
  const przywroc = podmienFetch(async () =>
    new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } }));
  try {
    const w = await cisza({
      nazwa: 'c', url: 'https://x?select=id', klucz: 'k',
      teraz: () => new Date('2026-08-25T09:00:00Z'),
    }).uruchom();
    assert.equal(w.ok, false);
    assert.match(w.szczegoly, /zero zgłoszeń/);
  } finally { przywroc(); }
});

test('cisza: są zgłoszenia, więc sonda jest zielona', async () => {
  const przywroc = podmienFetch(async () =>
    new Response('[]', { status: 200, headers: { 'content-range': '0-0/7' } }));
  try {
    const w = await cisza({
      nazwa: 'c', url: 'https://x?select=id', klucz: 'k',
      teraz: () => new Date('2026-08-25T09:00:00Z'),
    }).uruchom();
    assert.equal(w.ok, true);
    assert.match(w.szczegoly, /7 zgłoszeń/);
  } finally { przywroc(); }
});
