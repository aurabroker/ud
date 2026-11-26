/**
 * Pomocniki tekstowe i linkowanie między zawodami (21.10.2026, po audycie SEO).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZAWODY, kategorie, pokrewne, przekierowania, malymi, liczebnik } from '../src/index.js';

test('liczebnik: 1 zawód, 2–4 zawody, 5+ zawodów, 12–14 zawodów', () => {
  const f = (n) => liczebnik(n, ['zawód', 'zawody', 'zawodów']);
  assert.equal(f(1), '1 zawód');
  assert.equal(f(3), '3 zawody');
  assert.equal(f(5), '5 zawodów');
  assert.equal(f(12), '12 zawodów');
  assert.equal(f(22), '22 zawody');
  // Strona kategorii Medycyna pisała „43 zawodów".
  assert.equal(f(43), '43 zawody');
  assert.equal(f(113), '113 zawodów');
});

test('malymi: zostawia skróty, resztę zmniejsza', () => {
  assert.equal(malymi('Specjalisty HR'), 'specjalisty HR');
  assert.equal(malymi('AI Engineera'), 'AI engineera');
  assert.equal(malymi('DevOps Engineera'), 'DevOps engineera');
  assert.equal(malymi('IT / Tech'), 'IT / tech');
  assert.equal(malymi('Lekarza Weterynarii'), 'lekarza weterynarii');
});

test('pokrewne: każdy zawód dostaje odnośnik od zawodu ze swojej grupy', () => {
  // Do 21.10.2026 pokrewne brały pierwsze z alfabetu i 61 ze 188 stron nie
  // dostawało żadnego odnośnika z tej sekcji.
  const przychodzace = new Map();
  for (const z of ZAWODY) {
    for (const p of pokrewne(z.slug, 10)) przychodzace.set(p.slug, (przychodzace.get(p.slug) ?? 0) + 1);
  }
  const bez = ZAWODY.filter((z) => !przychodzace.get(z.slug)).map((z) => z.slug);
  assert.deepEqual(bez, []);
  // W grupie większej niż 10 każdy dostaje dokładnie 10 — rozkład równy, nie „pierwsi z alfabetu".
  for (const k of kategorie().filter((k) => k.liczba > 10)) {
    for (const z of ZAWODY.filter((x) => x.kategoria === k.nazwa)) {
      assert.equal(przychodzace.get(z.slug), 10, `${z.slug} w grupie ${k.nazwa}`);
    }
  }
});

test('pokrewne: stały zestaw, bez bieżącego zawodu, bez powtórzeń', () => {
  for (const z of ZAWODY) {
    const a = pokrewne(z.slug, 10).map((p) => p.slug);
    assert.deepEqual(a, pokrewne(z.slug, 10).map((p) => p.slug));
    assert.ok(!a.includes(z.slug), z.slug);
    assert.equal(new Set(a).size, a.length, z.slug);
  }
});

test('przekierowania: każda reguła także bez ukośnika na końcu', () => {
  const reguly = przekierowania();
  const zrodla = new Set(reguly.map((r) => r.z));
  for (const r of reguly.filter((r) => r.z.endsWith('/'))) {
    assert.ok(zrodla.has(r.z.slice(0, -1)), `brak wariantu bez ukośnika dla ${r.z}`);
  }
});

test('dochód przykładowy: liczba w rozsądnym przedziale przy każdym zawodzie', () => {
  for (const z of ZAWODY) {
    assert.ok(Number.isInteger(z.dochodPrzykladowy) && z.dochodPrzykladowy >= 3000
      && z.dochodPrzykladowy <= 60000, `${z.slug}: ${z.dochodPrzykladowy}`);
    assert.equal('swiadczenieDzienne' in z, false, `${z.slug} ma jeszcze limit dzienny`);
  }
});
