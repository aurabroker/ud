/**
 * Test lejka „Niedokończone wnioski" — czysta logika z src/lib/lejek.js.
 *
 *   node scripts/test-lejek.mjs
 *
 * Lejek pokazuje, ile osób zaliczyło dany krok. Błąd tutaj nie wywala niczego
 * — daje po prostu zły wykres i złą decyzję („przenieśmy PESEL"), więc liczby
 * sprawdzamy na przykładzie policzonym na papierze.
 */
import assert from 'node:assert/strict';
import { lejek } from '../src/lib/lejek.js';

let ok = 0;
const test = (nazwa, fn) => { fn(); ok += 1; console.log(`  ✓ ${nazwa}`); };

test('pusty widok: brak tygodni, brak wąskiego gardła', () => {
  const l = lejek([]);
  assert.deepEqual(l.rzedy, []);
  assert.equal(l.gardlo, null);
  assert.deepEqual(l.kroki.map((k) => k.id), ['kontakt', 'dane', 'zakres', 'zdrowie', 'zgody']);
});

test('zaliczył krok = ostatni zaliczony krok to ten albo późniejszy', () => {
  // Ostatnie zaliczone kroki: 4 osoby kontakt, 3 dane, 2 zakres, 1 zdrowie, 1 złożył.
  const l = lejek([
    { tydzien: '2026-09-28', ostatni_krok: 'kontakt', szkicow: 4 },
    { tydzien: '2026-09-28', ostatni_krok: 'dane', szkicow: 3 },
    { tydzien: '2026-09-28', ostatni_krok: 'zakres', szkicow: 2 },
    { tydzien: '2026-09-28', ostatni_krok: 'zdrowie', szkicow: 1 },
    { tydzien: '2026-09-28', ostatni_krok: 'zgody', szkicow: 1 },
  ]);
  assert.deepEqual(l.rzedy[0].doszlo, { kontakt: 11, dane: 7, zakres: 4, zdrowie: 2, zgody: 1 });
});

test('krok bez żadnego szkicu nie znika ani nie jest undefined', () => {
  // Nikt nie zatrzymał się na „dane", „zakres" i „zdrowie" — widok nie ma tych wierszy.
  const l = lejek([
    { tydzien: '2026-09-28', ostatni_krok: 'kontakt', szkicow: 5 },
    { tydzien: '2026-09-28', ostatni_krok: 'zgody', szkicow: 1 },
  ]);
  assert.deepEqual(l.rzedy[0].doszlo, { kontakt: 6, dane: 1, zakres: 1, zdrowie: 1, zgody: 1 });
});

test('tygodnie od najnowszego, a „razem" sumuje tygodnie', () => {
  const l = lejek([
    { tydzien: '2026-09-21', ostatni_krok: 'kontakt', szkicow: 2 },
    { tydzien: '2026-09-28', ostatni_krok: 'dane', szkicow: 3 },
    { tydzien: '2026-09-21', ostatni_krok: 'zgody', szkicow: 1 },
  ]);
  assert.deepEqual(l.rzedy.map((r) => r.tydzien), ['2026-09-28', '2026-09-21']);
  assert.deepEqual(l.razem, { kontakt: 6, dane: 4, zakres: 1, zdrowie: 1, zgody: 1 });
});

test('wąskie gardło to największy spadek między sąsiednimi krokami', () => {
  // kontakt 10 → dane 9 (−1) → zakres 3 (−6) → zdrowie 2 (−1) → zgody 1 (−1)
  const l = lejek([
    { tydzien: '2026-09-28', ostatni_krok: 'kontakt', szkicow: 1 },
    { tydzien: '2026-09-28', ostatni_krok: 'dane', szkicow: 6 },
    { tydzien: '2026-09-28', ostatni_krok: 'zakres', szkicow: 1 },
    { tydzien: '2026-09-28', ostatni_krok: 'zdrowie', szkicow: 1 },
    { tydzien: '2026-09-28', ostatni_krok: 'zgody', szkicow: 1 },
  ]);
  assert.deepEqual(l.gardlo, { z: 'dane', do: 'zakres', spadek: 6 });
});

test('nieznany krok w danych jest ignorowany, nie psuje liczb', () => {
  const l = lejek([
    { tydzien: '2026-09-28', ostatni_krok: 'kontakt', szkicow: 2 },
    { tydzien: '2026-09-28', ostatni_krok: 'pesel', szkicow: 99 },
  ]);
  assert.deepEqual(l.rzedy[0].doszlo, { kontakt: 2, dane: 0, zakres: 0, zdrowie: 0, zgody: 0 });
});

console.log(`\nZaliczone: ${ok}`);
