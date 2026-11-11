/**
 * Test tabeli „Kup online u Leadenhall" na stronie Niedokończone —
 * czysta logika z src/lib/klikniecia.js.
 *
 *   node scripts/test-klikniecia.mjs
 *
 * Liczby policzone na papierze. Błąd tu nic nie wywala — daje złą liczbę
 * wejść i złą decyzję, gdzie stawiać link do zakupu online.
 */
import assert from 'node:assert/strict';
import { klikniecia, odTygodnia, dzisWPolsce, etykietaMiejsca, MIEJSC, POZOSTALE } from '../src/lib/klikniecia.js';

let ok = 0;
const test = (nazwa, fn) => { fn(); ok += 1; console.log(`  ✓ ${nazwa}`); };

test('pusty widok: bez tygodni, kolumn i kliknięć', () => {
  const k = klikniecia([]);
  assert.deepEqual(k.rzedy, []);
  assert.deepEqual(k.kolumny, []);
  assert.equal(k.wszystkie, 0);
});

test('tydzień × miejsce, sumy w wierszach i w kolumnach', () => {
  const k = klikniecia([
    { tydzien: '2026-11-09', zrodlo: 'kalkulator', klikniec: 5 },
    { tydzien: '2026-11-09', zrodlo: 'facebook', klikniec: 2 },
    { tydzien: '2026-11-02', zrodlo: 'kalkulator', klikniec: 1 },
    { tydzien: '2026-11-02', zrodlo: 'bezposrednio', klikniec: 3 },
  ]);
  assert.deepEqual(k.kolumny, ['kalkulator', 'bezposrednio', 'facebook']);
  assert.deepEqual(k.rzedy.map((r) => r.tydzien), ['2026-11-09', '2026-11-02'], 'najnowszy tydzień na górze');
  assert.deepEqual(k.rzedy[0].liczby, { kalkulator: 5, bezposrednio: 0, facebook: 2 }, 'brak kliknięć to zero, nie undefined');
  assert.equal(k.rzedy[0].razem, 7);
  assert.equal(k.rzedy[1].razem, 4);
  assert.deepEqual(k.razem, { kalkulator: 6, bezposrednio: 3, facebook: 2 });
  assert.equal(k.wszystkie, 11);
});

test('ten sam tydzień i miejsce w dwóch wierszach się sumuje', () => {
  const k = klikniecia([
    { tydzien: '2026-11-09', zrodlo: 'blog', klikniec: 2 },
    { tydzien: '2026-11-09', zrodlo: 'blog', klikniec: 3 },
  ]);
  assert.equal(k.rzedy[0].liczby.blog, 5);
});

test(`ponad ${MIEJSC} miejsc: reszta w „pozostałe", suma się zgadza`, () => {
  const wiersze = Array.from({ length: MIEJSC + 3 }, (_, i) => ({
    tydzien: '2026-11-09', zrodlo: `m${String(i).padStart(2, '0')}`, klikniec: 20 - i,
  }));
  const k = klikniecia(wiersze);
  assert.equal(k.kolumny.length, MIEJSC + 1);
  assert.equal(k.kolumny.at(-1), POZOSTALE);
  assert.deepEqual(k.kolumny.slice(0, MIEJSC), wiersze.slice(0, MIEJSC).map((w) => w.zrodlo), 'najwięcej kliknięć pierwsze');
  const reszta = wiersze.slice(MIEJSC).reduce((s, w) => s + w.klikniec, 0);
  assert.equal(k.razem[POZOSTALE], reszta);
  assert.equal(k.wszystkie, wiersze.reduce((s, w) => s + w.klikniec, 0), 'nic nie ginie przy zwijaniu');
  assert.equal(k.miejscWszystkich, MIEJSC + 3);
});

test(`dokładnie ${MIEJSC} miejsc: bez kolumny „pozostałe"; ${MIEJSC + 1} — zwinięte dokładnie jedno`, () => {
  const ile = (n) => Array.from({ length: n }, (_, i) => ({ tydzien: '2026-11-09', zrodlo: `m${i}`, klikniec: 10 - i }));
  const rowno = klikniecia(ile(MIEJSC));
  assert.equal(rowno.kolumny.length, MIEJSC);
  assert.ok(!rowno.kolumny.includes(POZOSTALE), 'pusta kolumna „pozostałe" przy równo sześciu miejscach');
  const jedno = klikniecia(ile(MIEJSC + 1));
  assert.deepEqual(jedno.kolumny, [...ile(MIEJSC).map((w) => w.zrodlo), POZOSTALE]);
  assert.equal(jedno.razem[POZOSTALE], 10 - MIEJSC, 'zwinięte jest tylko najmniejsze miejsce');
});

test('wiersze zwinięte już w bazie: „pozostałe" zawsze na końcu, liczba miejsc z bazy', () => {
  // Tak oddaje je ud_klikniecia_tabela: najczęstsze miejsca + suma reszty pod POZOSTALE.
  const k = klikniecia([
    { tydzien: '2026-11-09', zrodlo: POZOSTALE, klikniec: 40, miejsc_wszystkich: 25 },
    { tydzien: '2026-11-09', zrodlo: 'facebook', klikniec: 3, miejsc_wszystkich: 25 },
    { tydzien: '2026-11-02', zrodlo: 'mail', klikniec: 2, miejsc_wszystkich: 25 },
  ]);
  assert.deepEqual(k.kolumny, ['facebook', 'mail', POZOSTALE], 'największa suma nie wypycha „pozostałe" na początek');
  assert.equal(k.razem[POZOSTALE], 40);
  assert.equal(k.miejscWszystkich, 25);
  assert.equal(k.wszystkie, 45);
});

test('kolumna miejsca idzie za sumą z CAŁEGO okresu, nie z jednego tygodnia', () => {
  // „mail" ma w sumie więcej, choć w najnowszym tygodniu prowadzi „blog".
  const k = klikniecia([
    { tydzien: '2026-11-09', zrodlo: 'blog', klikniec: 2 },
    { tydzien: '2026-11-09', zrodlo: 'mail', klikniec: 1 },
    { tydzien: '2026-11-02', zrodlo: 'mail', klikniec: 9 },
  ]);
  assert.deepEqual(k.kolumny, ['mail', 'blog']);
});

test('remis: kolejność alfabetyczna, stała między odświeżeniami', () => {
  const a = klikniecia([
    { tydzien: '2026-11-09', zrodlo: 'zeta', klikniec: 1 },
    { tydzien: '2026-11-09', zrodlo: 'alfa', klikniec: 1 },
  ]);
  const b = klikniecia([
    { tydzien: '2026-11-09', zrodlo: 'alfa', klikniec: 1 },
    { tydzien: '2026-11-09', zrodlo: 'zeta', klikniec: 1 },
  ]);
  assert.deepEqual(a.kolumny, ['alfa', 'zeta']);
  assert.deepEqual(b.kolumny, a.kolumny);
});

test('etykiety: brak ?z= i nieczytelne ?z= po polsku, reszta bez zmian', () => {
  assert.equal(etykietaMiejsca('bezposrednio'), 'bez oznaczenia');
  assert.equal(etykietaMiejsca('inne'), 'inne lub nieczytelne');
  assert.equal(etykietaMiejsca(POZOSTALE), 'pozostałe');
  assert.equal(etykietaMiejsca('kalkulator'), 'kalkulator');
  // Przechodzi białą listę źródeł; nie może sięgnąć do prototypu obiektu.
  assert.equal(etykietaMiejsca('constructor'), 'constructor');
});

test('odTygodnia: poniedziałek sprzed 11 tygodni (12 tygodni razem z bieżącym)', () => {
  assert.equal(odTygodnia('2026-11-11'), '2026-08-24'); // środa → pn 09.11 − 77 dni
  assert.equal(odTygodnia('2026-11-09'), '2026-08-24'); // poniedziałek
  assert.equal(odTygodnia('2026-11-15'), '2026-08-24'); // niedziela tego samego tygodnia
  assert.equal(odTygodnia('2026-11-16'), '2026-08-31'); // następny poniedziałek
  assert.equal(odTygodnia('2026-11-11', 1), '2026-11-09');
  assert.equal(odTygodnia('2027-01-01', 1), '2026-12-28', 'przez koniec roku');
});

test('dzisWPolsce: data w Warszawie, nie w UTC', () => {
  // 23:30 UTC 11.11 to już 12.11 w Polsce (CET, UTC+1).
  assert.equal(dzisWPolsce(new Date('2026-11-11T23:30:00Z')), '2026-11-12');
  assert.equal(dzisWPolsce(new Date('2026-11-11T22:30:00Z')), '2026-11-11');
  // Czas letni (UTC+2): 22:30 UTC 30.06 to 01.07.
  assert.equal(dzisWPolsce(new Date('2026-06-30T22:30:00Z')), '2026-07-01');
});

console.log(`\n${ok} testów zaliczonych.`);
