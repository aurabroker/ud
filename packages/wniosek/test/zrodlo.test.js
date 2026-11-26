/**
 * Źródło wizyty (src/zrodlo.js) — reguły białej listy i kształt
 * `form_data.zrodlo`. Najważniejsze: identyfikator kliknięcia wychodzi
 * WYŁĄCZNIE przy zgodzie na marketing, a funkcja nigdy nie rzuca — źródło nie
 * może zatrzymać wniosku.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAMETRY_ZRODLA, parametryZrodla, wartoscZrodlaPoprawna, zrodloZAdresu,
} from '../src/zrodlo.js';
import * as pakiet from '../src/index.js';

const GCLID = 'Cj0KCQiA_example-GCLID_123';

test('biała lista: dokładnie dziesięć parametrów z kontraktu', () => {
  assert.deepEqual([...PARAMETRY_ZRODLA].sort(), [
    'gad_campaignid', 'gad_source', 'gbraid', 'gclid',
    'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term', 'wbraid',
  ]);
  assert.throws(() => { PARAMETRY_ZRODLA.push('fbclid'); }, 'lista jest zamrożona');
});

test('eksport z pakietu i ścieżki @ud/wniosek/zrodlo', async () => {
  assert.equal(pakiet.zrodloZAdresu, zrodloZAdresu);
  assert.equal(pakiet.parametryZrodla, parametryZrodla);
  // Samoodwołanie pakietu po nazwie — ta sama ścieżka, którą weźmie panel.
  const sciezka = await import('@ud/wniosek/zrodlo');
  assert.equal(sciezka.zrodloZAdresu, zrodloZAdresu);
});

test('kampania z reklamy UD_2026: UTM-y, gclid i gad_* — bez zgody', () => {
  const adres = '?utm_source=ads&utm_medium=internet&utm_campaign=jesien26&utm_content=reklama'
    + `&utm_term=utratadochodu&gad_source=1&gad_campaignid=22334455667&gclid=${GCLID}`;
  assert.deepEqual(zrodloZAdresu(adres, false), {
    zrodlo: {
      gad_source: '1', gad_campaignid: '22334455667',
      utm_source: 'ads', utm_medium: 'internet', utm_campaign: 'jesien26',
      utm_term: 'utratadochodu', utm_content: 'reklama',
      platne: true, zgoda_marketing: false,
    },
  });
});

test('identyfikator kliknięcia tylko przy zgodzie na marketing (true, nie „truthy”)', () => {
  const adres = `?gclid=${GCLID}&gbraid=GB_1&wbraid=WB-2`;
  const bez = zrodloZAdresu(adres, false).zrodlo;
  assert.deepEqual(bez, { platne: true, zgoda_marketing: false });
  for (const k of ['gclid', 'gbraid', 'wbraid']) assert.equal(k in bez, false, k);

  assert.deepEqual(zrodloZAdresu(adres, true).zrodlo, {
    platne: true, zgoda_marketing: true, gclid: GCLID, gbraid: 'GB_1', wbraid: 'WB-2',
  });
  // Coś, co tylko wygląda na zgodę, zgodą nie jest.
  for (const nieZgoda of [undefined, null, 1, 'true', {}, []]) {
    const z = zrodloZAdresu(adres, nieZgoda).zrodlo;
    assert.equal(z.zgoda_marketing, false, String(nieZgoda));
    assert.equal('gclid' in z, false, String(nieZgoda));
  }
});

test('platne: gclid / gbraid / wbraid / gad_source — tak; samo gad_campaignid i UTM-y — nie', () => {
  for (const adres of [`?gclid=${GCLID}`, '?gbraid=abc', '?wbraid=abc', '?gad_source=1']) {
    assert.equal(zrodloZAdresu(adres, false).zrodlo.platne, true, adres);
  }
  assert.deepEqual(zrodloZAdresu('?gad_source=5', false), {
    zrodlo: { gad_source: '5', platne: true, zgoda_marketing: false },
  });
  assert.deepEqual(zrodloZAdresu('?gad_campaignid=123', false), {
    zrodlo: { gad_campaignid: '123', platne: false, zgoda_marketing: false },
  });
  assert.equal(zrodloZAdresu('?utm_source=ads&utm_medium=cpc', true).zrodlo.platne, false);
  // Niepoprawny gclid nie robi kliknięcia płatnym.
  assert.equal(zrodloZAdresu('?gclid=%3Cscript%3E&utm_source=x', true).zrodlo.platne, false);
});

test('brak poprawnych parametrów z białej listy → {} (także sam ?agent= i inne klucze)', () => {
  for (const adres of [
    '', '?', '?agent=0004', '?dochod=12500&odkladam=250', '?z=blog', '?fbclid=abc&msclkid=x',
    '?UTM_SOURCE=ads', '?utm_source=', '?utm_source=%20%20', '?gclid=', '?gclid=a%20b',
    '?utm_id=1&utm_source_platform=x', '#gclid=abc',
  ]) {
    assert.deepEqual(zrodloZAdresu(adres, true), {}, adres);
  }
});

test('trim: odstępy z brzegów znikają, wartość po trim idzie dalej', () => {
  assert.deepEqual(parametryZrodla('?utm_campaign=%20jesien26%20&gclid=%20abc%20'), [
    ['gclid', 'abc'], ['utm_campaign', 'jesien26'],
  ]);
  // Odstęp w środku identyfikatora — niepoprawny; w UTM-ie — dozwolony.
  assert.deepEqual(parametryZrodla('?gclid=a%20b&utm_term=utrata+dochodu'), [['utm_term', 'utrata dochodu']]);
  // „+” w adresie to spacja (URLSearchParams), więc „+a+” po trim daje „a”.
  assert.deepEqual(parametryZrodla('?utm_source=+a+'), [['utm_source', 'a']]);
});

test('duplikaty: liczy się pierwsze wystąpienie, także gdy jest niepoprawne', () => {
  assert.deepEqual(parametryZrodla('?utm_source=pierwszy&utm_source=drugi'), [['utm_source', 'pierwszy']]);
  assert.deepEqual(parametryZrodla('?gclid=%3C&gclid=dobry'), []);
  assert.deepEqual(parametryZrodla('?gclid=dobry&gclid=%3C'), [['gclid', 'dobry']]);
});

test('identyfikatory: znaki base64url, 1–200', () => {
  const ok = (k, v) => assert.equal(wartoscZrodlaPoprawna(k, v), true, `${k}=${v}`);
  const zle = (k, v) => assert.equal(wartoscZrodlaPoprawna(k, v), false, `${k}=${v}`);
  for (const k of ['gclid', 'gbraid', 'wbraid']) {
    ok(k, 'a'); ok(k, 'A-z_09'); ok(k, 'x'.repeat(200));
    zle(k, ''); zle(k, 'x'.repeat(201)); zle(k, 'a.b'); zle(k, 'a=b'); zle(k, 'a b');
    zle(k, '<script>'); zle(k, 'ąę'); zle(k, 'a\nb'); zle(k, 'a/b'); zle(k, 'a+b');
  }
});

test('gad_source i gad_campaignid: te same znaki, 1–32', () => {
  for (const k of ['gad_source', 'gad_campaignid']) {
    assert.equal(wartoscZrodlaPoprawna(k, '1'), true);
    assert.equal(wartoscZrodlaPoprawna(k, '22334455667'), true);
    assert.equal(wartoscZrodlaPoprawna(k, 'x'.repeat(32)), true);
    assert.equal(wartoscZrodlaPoprawna(k, 'x'.repeat(33)), false);
    assert.equal(wartoscZrodlaPoprawna(k, ''), false);
    assert.equal(wartoscZrodlaPoprawna(k, '1 2'), false);
    assert.equal(wartoscZrodlaPoprawna(k, "1';--"), false);
  }
});

test('utm_*: 1–100 znaków bez znaków sterujących; polskie litery i spacje w środku wolno', () => {
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    assert.equal(wartoscZrodlaPoprawna(k, 'x'.repeat(100)), true, `${k} 100`);
    assert.equal(wartoscZrodlaPoprawna(k, 'x'.repeat(101)), false, `${k} 101`);
    assert.equal(wartoscZrodlaPoprawna(k, 'utrata dochodu — jesień'), true);
    assert.equal(wartoscZrodlaPoprawna(k, ''), false);
    for (const c of ['\u0000', '\u0001', '\t', '\n', '\r', '\u001F', '\u007F']) {
      assert.equal(wartoscZrodlaPoprawna(k, `a${c}b`), false, `${k} z U+${c.charCodeAt(0).toString(16)}`);
    }
  }
  // Przez adres: 100 znaków przechodzi, 101 odpada, reszta zostaje.
  assert.deepEqual(parametryZrodla(`?utm_campaign=${'k'.repeat(100)}`), [['utm_campaign', 'k'.repeat(100)]]);
  assert.deepEqual(parametryZrodla(`?utm_campaign=${'k'.repeat(101)}&utm_source=ads`), [['utm_source', 'ads']]);
  assert.deepEqual(parametryZrodla('?utm_source=a%09b&utm_medium=a%7Fb&utm_term=ok'), [['utm_term', 'ok']]);
});

test('klucze spoza białej listy są ignorowane, także podobne', () => {
  for (const k of ['fbclid', 'msclkid', 'utm_id', 'utm_x', 'gad', 'gclsrc', 'agent', 'GCLID', '__proto__', 'constructor']) {
    assert.equal(wartoscZrodlaPoprawna(k, 'abc'), false, k);
  }
  assert.deepEqual(parametryZrodla('?__proto__=x&constructor=y&utm_source=ads'), [['utm_source', 'ads']]);
});

test('śmieci w adresie nie rzucają i nie przechodzą', () => {
  for (const adres of [
    '%', '?%E0%A4%A', '?gclid=%FF%FE', '?&&&=&=', '?utm_source=%00', '?=gclid', '???gclid=abc',
    'gclid', '?gclid', `?${'a'.repeat(100_000)}`, '?utm_source=\uD800',
  ]) {
    assert.doesNotThrow(() => zrodloZAdresu(adres, true), adres);
    const wynik = zrodloZAdresu(adres, true);
    assert.equal(typeof wynik, 'object', adres);
    if (wynik.zrodlo) for (const v of Object.values(wynik.zrodlo)) assert.notEqual(v, '', adres);
  }
  // Bez „?” też działa — URLSearchParams przyjmuje oba zapisy.
  assert.deepEqual(parametryZrodla('utm_source=ads'), [['utm_source', 'ads']]);
});

test('nigdy nie rzuca: null, undefined, liczba, obiekt, tablica', () => {
  for (const wejscie of [null, undefined, 5, NaN, {}, [], { gclid: 'abc' }, [['gclid', 'abc']], true, Symbol('x')]) {
    assert.deepEqual(zrodloZAdresu(wejscie, true), {}, String(wejscie?.toString?.() ?? wejscie));
    assert.deepEqual(parametryZrodla(wejscie), []);
  }
});

test('wynik nie dzieli stanu między wywołaniami', () => {
  const a = zrodloZAdresu('?utm_source=a', false);
  a.zrodlo.utm_source = 'zmienione';
  assert.equal(zrodloZAdresu('?utm_source=a', false).zrodlo.utm_source, 'a');
});
