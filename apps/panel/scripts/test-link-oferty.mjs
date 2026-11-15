/**
 * Ważność linku do oferty po stronie panelu (bez bazy).
 *
 *   node scripts/test-link-oferty.mjs
 *
 * 1. linkOfertyAktywny / waznoscPoWysylce z src/lib/server/linkOferty.js.
 * 2. Strażnik źródeł: każda trasa pod src/routes/offer/[token], która szuka oferty
 *    po share_token, dobiera share_expires_at i woła linkOfertyAktywny — nowa trasa
 *    bez tej kontroli otworzyłaby wygasły link.
 * 3. sendOfferToClient przedłuża termin przy wysyłce (waznoscPoWysylce w update).
 *
 * Część SQL (kolumna, ud_offer_by_token) — scripts/test-link-oferty-sql.mjs.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkOfertyAktywny, waznoscPoWysylce, WAZNOSC_LINKU_DNI } from '../src/lib/server/linkOferty.js';

const panel = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0;
const bledy = [];
const test = (nazwa, fn) => {
  try {
    fn();
    ok++;
    console.log(`  ok  ${nazwa}`);
  } catch (e) {
    bledy.push(nazwa);
    console.log(`  ZLE ${nazwa}\n      ${e.message.split('\n')[0]}`);
  }
};

const teraz = new Date('2026-11-13T12:00:00Z');
const dzien = 24 * 3600 * 1000;
const za = (dni) => new Date(teraz.getTime() + dni * dzien).toISOString();

console.log('# linkOfertyAktywny');
test('brak oferty — nieaktywny', () => assert.equal(linkOfertyAktywny(null, teraz), false));
test('termin w przyszłości — aktywny', () => assert.equal(linkOfertyAktywny({ share_expires_at: za(1) }, teraz), true));
test('termin minął — nieaktywny', () => assert.equal(linkOfertyAktywny({ share_expires_at: za(-1) }, teraz), false));
test('termin równy „teraz” — nieaktywny', () => assert.equal(linkOfertyAktywny({ share_expires_at: teraz.toISOString() }, teraz), false));
test('link sprzed 13.11.2026 (NULL) — aktywny do decyzji właściciela', () =>
  assert.equal(linkOfertyAktywny({ share_expires_at: null }, teraz), true));
test('zepsuta data — nieaktywny', () => assert.equal(linkOfertyAktywny({ share_expires_at: 'jutro' }, teraz), false));

console.log('# waznoscPoWysylce');
test('NULL zostaje NULL (wysyłka nie decyduje o starych linkach)', () => assert.equal(waznoscPoWysylce(null, teraz), null));
test('termin minął — nowy pełny termin od wysyłki', () => assert.equal(waznoscPoWysylce(za(-5), teraz), za(WAZNOSC_LINKU_DNI)));
test('termin krótszy niż pełny — przedłużony', () => assert.equal(waznoscPoWysylce(za(10), teraz), za(WAZNOSC_LINKU_DNI)));
test('termin dłuższy niż pełny — bez skracania', () => assert.equal(waznoscPoWysylce(za(90), teraz), za(90)));

console.log('# trasy /offer/[token]');
const katalog = join(panel, 'src/routes/offer/[token]');
const pliki = [];
const zbierz = (d) => {
  for (const p of readdirSync(d)) {
    const s = join(d, p);
    if (statSync(s).isDirectory()) zbierz(s);
    else if (/\+(page\.)?server\.js$/.test(p)) pliki.push(s);
  }
};
zbierz(katalog);
test('są trasy do sprawdzenia', () => assert.ok(pliki.length >= 5, `znaleziono ${pliki.length}`));
for (const plik of pliki) {
  const zrodlo = readFileSync(plik, 'utf8');
  if (!zrodlo.includes("eq('share_token'")) continue;
  const nazwa = relative(panel, plik);
  test(`${nazwa}: pobiera share_expires_at`, () => assert.match(zrodlo, /select\([^)]*share_expires_at/));
  test(`${nazwa}: sprawdza linkOfertyAktywny przed hasłem i danymi`, () => {
    const kontrola = zrodlo.indexOf('linkOfertyAktywny(offer)');
    assert.ok(kontrola > 0, 'brak wywołania linkOfertyAktywny(offer)');
    for (const dalej of ['isVerified(', 'verifyPin(', 'ud_offer_pins', 'ud_offer_documents', 'ud_offer_files']) {
      const i = zrodlo.indexOf(dalej);
      if (i >= 0) assert.ok(kontrola < i, `${dalej} stoi przed kontrolą ważności`);
    }
  });
}

console.log('# wysyłka oferty');
test('sendOfferToClient przedłuża termin linku', () => {
  const zrodlo = readFileSync(join(panel, 'src/lib/server/offers.js'), 'utf8');
  const i = zrodlo.indexOf('export async function sendOfferToClient');
  const fragment = zrodlo.slice(i, zrodlo.indexOf('\nexport ', i + 10));
  assert.match(fragment, /waznoscPoWysylce\(offer\.share_expires_at\)/);
  assert.match(fragment, /share_expires_at: waznosc/);
});

console.log(`\nWynik: ${ok} ok, ${bledy.length} źle${bledy.length ? ' — ' + bledy.join('; ') : ''}`);
process.exit(bledy.length ? 1 : 0);
