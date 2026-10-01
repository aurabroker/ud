/**
 * Testy niepowtarzalności treści.
 *
 * Ten plik jest powodem, dla którego cała operacja ma sens. „Napiszemy
 * unikalne teksty" to postanowienie; test jest jedyną rzeczą, która sprawia,
 * że po trzydziestym zawodzie nikt nie zacznie kopiować akapitów z poprzedniego.
 *
 * Próg wzięty z pomiaru starego serwisu: tam 21,9% zdań na przeciętnej
 * podstronie występowało na najwyżej trzech stronach, reszta była wspólna dla
 * dziesiątek. To jest poziom, który system Helpful Content degraduje.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRESCI, tresc } from '../src/tresc.js';
import { ZAWODY, zawod } from '../src/index.js';

/** Zdania dłuższe niż 40 znaków — krótsze bywają wspólne bez szkody. */
function zdania(t) {
  if (!t) return [];
  const teksty = [
    t.wstep, t.dochod, t.przerwa,
    ...(t.ryzyka ?? []).flatMap((r) => [r.tytul, r.opis]),
    ...(t.pytania ?? []).flatMap((p) => [p.pytanie, p.odpowiedz]),
  ].filter(Boolean);
  return teksty
    .flatMap((s) => s.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
}

const ZE_TRESCIA = Object.keys(TRESCI);

test('treść dotyczy zawodu, który opisuje', () => {
  for (const slug of ZE_TRESCIA) {
    const z = zawod(slug);
    assert.ok(z, `treść dla „${slug}", a takiego aktywnego zawodu nie ma`);
    const t = tresc(slug);
    for (const pole of ['wstep', 'dochod', 'przerwa']) {
      assert.ok(t[pole] && t[pole].length > 80,
        `„${slug}" — pole ${pole} jest puste albo za krótkie, żeby cokolwiek wnosić`);
    }
    assert.equal(t.ryzyka?.length, 3, `„${slug}" — oczekiwane trzy ryzyka`);
    assert.ok(t.pytania?.length >= 2, `„${slug}" — co najmniej dwa pytania`);
  }
});

test('żadne zdanie nie powtarza się między zawodami', () => {
  const gdzie = new Map();
  for (const slug of ZE_TRESCIA) {
    for (const z of zdania(tresc(slug))) {
      if (!gdzie.has(z)) gdzie.set(z, []);
      gdzie.get(z).push(slug);
    }
  }

  const powtorzone = [...gdzie.entries()].filter(([, gdzieU]) => gdzieU.length > 1);
  const opis = powtorzone
    .slice(0, 5)
    .map(([z, g]) => `  „${z.slice(0, 70)}…" → ${g.join(', ')}`)
    .join('\n');

  assert.equal(powtorzone.length, 0,
    `${powtorzone.length} zdań powtarza się między zawodami:\n${opis}`);
});

test('teksty nie są przeróbką jednego szablonu', () => {
  // Podobieństwo liczone na zbiorach trigramów słów: łapie zdanie, w którym
  // zmieniono tylko nazwę zawodu, a reszta została ta sama.
  const trigramy = (slug) => {
    const slowa = zdania(tresc(slug)).join(' ').toLowerCase().split(/\s+/);
    const out = new Set();
    for (let i = 0; i + 2 < slowa.length; i += 1) out.add(slowa.slice(i, i + 3).join(' '));
    return out;
  };

  const mapa = new Map(ZE_TRESCIA.map((s) => [s, trigramy(s)]));
  const zbytPodobne = [];

  for (let i = 0; i < ZE_TRESCIA.length; i += 1) {
    for (let j = i + 1; j < ZE_TRESCIA.length; j += 1) {
      const a = mapa.get(ZE_TRESCIA[i]);
      const b = mapa.get(ZE_TRESCIA[j]);
      if (a.size === 0 || b.size === 0) continue;
      const wspolne = [...a].filter((t) => b.has(t)).length;
      const jaccard = wspolne / (a.size + b.size - wspolne);
      if (jaccard > 0.3) {
        zbytPodobne.push(`${ZE_TRESCIA[i]} ↔ ${ZE_TRESCIA[j]}: ${(jaccard * 100).toFixed(0)}% wspólnych trigramów`);
      }
    }
  }

  assert.deepEqual(zbytPodobne.slice(0, 8), [],
    `pary zawodów o zbyt podobnej treści (próg 30%):\n  ${zbytPodobne.slice(0, 8).join('\n  ')}`);
});

test('treść wspomina zawód, dla którego jest napisana', () => {
  for (const slug of ZE_TRESCIA) {
    const z = zawod(slug);
    const t = tresc(slug);
    const caly = [t.wstep, t.dochod, t.przerwa].join(' ').toLowerCase();
    // Rdzeń nazwy bez końcówki fleksyjnej — „stomatolog" złapie „stomatologa".
    const rdzen = z.nazwa.split(/\s+/)[0].toLowerCase().slice(0, -2);
    assert.ok(caly.includes(rdzen),
      `„${slug}" — tekst ani razu nie wspomina zawodu (szukano „${rdzen}")`);
  }
});

test('raport pokrycia', () => {
  const wszystkie = ZAWODY.length;
  const napisane = ZE_TRESCIA.length;
  console.log(`    treść własna: ${napisane} z ${wszystkie} zawodów (${Math.round(napisane / wszystkie * 100)}%)`);
  // Ten test nie ma prawa padać — ma pokazywać liczbę przy każdym uruchomieniu.
  assert.ok(napisane >= 0);
});
