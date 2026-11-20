/**
 * Test reguły źródła klienta — src/lib/zrodlo.js.
 *
 *   pnpm test:zrodlo
 *
 * Reguła decyduje, ile wniosków i ile składek właściciel przypisze reklamie.
 * Pomyłka nic nie wywala: daje złą liczbę i złą decyzję o budżecie kampanii.
 * Do tego pilnujemy, żeby identyfikator kliknięcia (gclid, gbraid, wbraid)
 * nigdy nie wyszedł z funkcji, które karmią przeglądarkę agenta.
 */
import assert from 'node:assert/strict';
import {
  BEZ_KAMPANII, BEZ_UTM_SOURCE, ETYKIETY_ZRODLA, KLUCZE_ZRODLA, bezIdentyfikatorow, opisZrodla, rodzajZrodla,
  zrodlaWStatystykach,
} from '../src/lib/zrodlo.js';

let ok = 0;
const test = (nazwa, fn) => { fn(); ok += 1; console.log(`  ✓ ${nazwa}`); };
const klucz = (k) => rodzajZrodla(k).klucz;

// Adres kampanii UD_2026 z dokumentacji + gclid, który dokleja Google.
const KAMPANIA = {
  utm_source: 'ads', utm_medium: 'internet', utm_campaign: 'jesien26', utm_content: 'reklama', utm_term: 'utratadochodu',
  platne: true, zgoda_marketing: true, gclid: 'Cj0KCQiA-SEKRET_gclid',
};

test('a) platne === true → Google Ads (także bez utm)', () => {
  assert.deepEqual(rodzajZrodla({ zrodlo: KAMPANIA }), { klucz: 'ads', etykieta: 'Google Ads' });
  assert.equal(klucz({ zrodlo: { platne: true, zgoda_marketing: false } }), 'ads');
  assert.equal(klucz({ zrodlo: { platne: true, zgoda_marketing: false, gad_source: '1' } }), 'ads');
});

test('a) utm_source ads/google przy medium cpc/internet/paid → Google Ads, także bez platne', () => {
  for (const s of ['ads', 'google']) {
    for (const m of ['cpc', 'internet', 'paid']) {
      assert.equal(klucz({ zrodlo: { utm_source: s, utm_medium: m, platne: false, zgoda_marketing: false } }), 'ads', `${s}/${m}`);
    }
  }
});

test('a) wielkość liter i odstępy w utm_source/utm_medium nie mają znaczenia', () => {
  assert.equal(klucz({ zrodlo: { utm_source: '  Google ', utm_medium: 'CPC\t', platne: false } }), 'ads');
  assert.equal(klucz({ zrodlo: { utm_source: 'ADS', utm_medium: ' Internet', platne: false } }), 'ads');
});

test('a) ads/google przy innym medium albo bez medium to NIE reklama płatna', () => {
  assert.deepEqual(rodzajZrodla({ zrodlo: { utm_source: 'google', utm_medium: 'organic', platne: false } }),
    { klucz: 'inne', etykieta: 'Inne: google' });
  assert.deepEqual(rodzajZrodla({ zrodlo: { utm_source: 'ads', platne: false } }), { klucz: 'inne', etykieta: 'Inne: ads' });
  assert.equal(klucz({ zrodlo: { utm_source: 'bing', utm_medium: 'cpc', platne: false } }), 'inne');
});

test('a) platne tylko jako prawdziwe true — "true", 1, "tak" się nie liczą', () => {
  for (const p of ['true', 1, 'tak', 'yes', {}]) {
    assert.equal(klucz({ zrodlo: { platne: p, utm_source: 'newsletter' } }), 'inne', JSON.stringify(p));
  }
});

test('b) link agenta (affiliate_code_used) → Link agenta', () => {
  assert.deepEqual(rodzajZrodla({ zrodlo: null, affiliate_code_used: 'AG7' }), { klucz: 'agent', etykieta: 'Link agenta' });
  assert.equal(klucz({ affiliate_code_used: '  7 ' }), 'agent');
});

test('b) pusty, biały albo nie-napis kod agenta się nie liczy', () => {
  for (const kod of ['', '   ', null, undefined, 7, ['AG7'], { kod: 'AG7' }]) {
    assert.equal(klucz({ affiliate_code_used: kod }), 'brak', JSON.stringify(kod));
  }
});

test('pierwszeństwo: reklama wygrywa z linkiem agenta', () => {
  assert.equal(klucz({ zrodlo: { platne: true }, affiliate_code_used: 'AG7' }), 'ads');
  assert.equal(klucz({ zrodlo: { utm_source: 'google', utm_medium: 'cpc', platne: false }, affiliate_code_used: 'AG7' }), 'ads');
});

test('pierwszeństwo: link agenta wygrywa z innym utm_source i z „Inne" bez utm_source', () => {
  assert.equal(klucz({ zrodlo: { utm_source: 'facebook', platne: false }, affiliate_code_used: 'AG7' }), 'agent');
  assert.equal(klucz({ zrodlo: { utm_campaign: 'x', platne: false }, affiliate_code_used: 'AG7' }), 'agent');
});

test('c) inny utm_source → „Inne: <utm_source>", przycięty, wielkość liter zachowana, najwyżej 40 znaków', () => {
  assert.deepEqual(rodzajZrodla({ zrodlo: { utm_source: '  Newsletter ', platne: false } }),
    { klucz: 'inne', etykieta: 'Inne: Newsletter' });
  const dlugi = 'x'.repeat(100);
  const e = rodzajZrodla({ zrodlo: { utm_source: dlugi } }).etykieta;
  assert.equal(Array.from(e.replace('Inne: ', '')).length, 40);
  assert.ok(e.endsWith('…'));
  // Emoji nie rozpada się na pół (skracanie po punktach kodowych).
  const emoji = rodzajZrodla({ zrodlo: { utm_source: '😀'.repeat(50) } }).etykieta;
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(emoji), 'samotny surogat');
});

test('d) zrodlo bez utm_source → „Inne" (wizyta oznaczona, tylko nie wiadomo skąd)', () => {
  assert.deepEqual(rodzajZrodla({ zrodlo: { utm_campaign: 'jesien26', platne: false, zgoda_marketing: false } }),
    { klucz: 'inne', etykieta: 'Inne' });
  assert.deepEqual(rodzajZrodla({ zrodlo: { gad_campaignid: '123', platne: false } }), { klucz: 'inne', etykieta: 'Inne' });
  assert.deepEqual(rodzajZrodla({ zrodlo: { utm_source: '   ', platne: false } }), { klucz: 'inne', etykieta: 'Inne' });
  assert.deepEqual(rodzajZrodla({ zrodlo: { utm_source: 42, platne: false } }), { klucz: 'inne', etykieta: 'Inne' });
});

test('e) bez zrodlo → „Brak danych"', () => {
  assert.deepEqual(rodzajZrodla({}), { klucz: 'brak', etykieta: 'Brak danych' });
  assert.deepEqual(rodzajZrodla({ zrodlo: null, affiliate_code_used: null }), { klucz: 'brak', etykieta: 'Brak danych' });
});

test('śmieci zamiast zrodlo (napis, tablica, liczba) → jak brak; śmieci zamiast klienta nie rzucają', () => {
  for (const z of ['ads', '{"platne":true}', ['platne'], [{ platne: true }], 1, true, 0]) {
    assert.equal(klucz({ zrodlo: z }), 'brak', JSON.stringify(z));
  }
  for (const k of [null, undefined, 'klient', 5, [], true]) {
    assert.deepEqual(rodzajZrodla(k), { klucz: 'brak', etykieta: 'Brak danych' }, JSON.stringify(k));
    assert.equal(opisZrodla(k).klucz, 'brak');
  }
});

test('zrodlo z form_data (karta klienta czyta cały wiersz) — ta sama reguła', () => {
  assert.equal(klucz({ form_data: { zrodlo: KAMPANIA } }), 'ads');
  assert.equal(klucz({ form_data: { zrodlo: { utm_source: 'mail', platne: false } }, affiliate_code_used: '' }), 'inne');
  assert.equal(klucz({ form_data: 'tekst' }), 'brak');
  assert.equal(klucz({ form_data: [1, 2] }), 'brak');
  assert.equal(klucz({ form_data: null, affiliate_code_used: 'AG' }), 'agent');
  // Pole `zrodlo` (z PostgREST) ma pierwszeństwo przed form_data — także gdy jest null.
  assert.equal(klucz({ zrodlo: null, form_data: { zrodlo: KAMPANIA } }), 'brak');
});

test('opisZrodla: kampania = utm_campaign, bez niej gad_campaignid; słowo = utm_term', () => {
  assert.deepEqual(opisZrodla({ zrodlo: KAMPANIA }),
    { klucz: 'ads', etykieta: 'Google Ads', kampania: 'jesien26', slowo: 'utratadochodu' });
  assert.deepEqual(opisZrodla({ zrodlo: { platne: true, gad_source: '1', gad_campaignid: '23071977' } }),
    { klucz: 'ads', etykieta: 'Google Ads', kampania: '23071977', slowo: null });
  assert.equal(opisZrodla({ zrodlo: { platne: true, utm_campaign: '  ', gad_campaignid: '5' } }).kampania, '5',
    'pusta kampania utm nie zasłania gad_campaignid');
  assert.deepEqual(opisZrodla({ affiliate_code_used: 'AG7' }), { klucz: 'agent', etykieta: 'Link agenta', kampania: null, slowo: null });
  assert.deepEqual(opisZrodla({}), { klucz: 'brak', etykieta: 'Brak danych', kampania: null, slowo: null });
  assert.equal(opisZrodla({ zrodlo: { utm_campaign: 12, utm_term: ['x'] } }).kampania, null);
  assert.equal(opisZrodla({ zrodlo: { utm_campaign: 12, utm_term: ['x'] } }).slowo, null);
});

test('identyfikatory kliknięcia nigdy nie wychodzą z rodzajZrodla ani opisZrodla', () => {
  const z = { ...KAMPANIA, gbraid: 'GBRAID-SEKRET', wbraid: 'WBRAID-SEKRET' };
  for (const wynik of [rodzajZrodla({ zrodlo: z }), opisZrodla({ zrodlo: z }), opisZrodla({ form_data: { zrodlo: z } })]) {
    const tekst = JSON.stringify(wynik);
    assert.ok(!/SEKRET|gclid|gbraid|wbraid/.test(tekst), tekst);
  }
});

test('bezIdentyfikatorow: wycina gclid/gbraid/wbraid z zrodlo i z wierzchu, resztę zostawia, oryginału nie rusza', () => {
  const fd = { full_name: 'Anna', gclid: 'WIERZCH', zrodlo: { ...KAMPANIA, gbraid: 'G', wbraid: 'W' }, med_heart: 'no' };
  const czysty = bezIdentyfikatorow(fd);
  assert.deepEqual(czysty, {
    full_name: 'Anna', med_heart: 'no',
    zrodlo: { utm_source: 'ads', utm_medium: 'internet', utm_campaign: 'jesien26', utm_content: 'reklama',
              utm_term: 'utratadochodu', platne: true, zgoda_marketing: true },
  });
  assert.ok(!JSON.stringify(czysty).includes('SEKRET'));
  assert.equal(fd.zrodlo.gclid, KAMPANIA.gclid, 'oryginał nietknięty');
  assert.equal(fd.gclid, 'WIERZCH');
});

test('bezIdentyfikatorow: dziwne form_data przechodzi bez zmian i bez wyjątku', () => {
  for (const fd of [null, undefined, 'tekst', 5, [1, 2]]) assert.deepEqual(bezIdentyfikatorow(fd), fd);
  assert.deepEqual(bezIdentyfikatorow({ zrodlo: 'ads' }), { zrodlo: 'ads' });
  assert.deepEqual(bezIdentyfikatorow({}), {});
});

// ── Statystyki według źródła ─────────────────────────────────────────────────
// Grupy tak, jak oddaje je ud_leady_statystyki_zrodla (utm_* już małymi literami).
const g = (klucze, miary) => ({
  platne: false, utm_source: null, utm_medium: null, link_agenta: false, ma_zrodlo: false, kampania: null,
  wnioski: 0, sprzedaze: 0, z_danymi: 0, skladka_roczna_suma: 0, prowizja_suma: 0, bez_stawki: 0, ...klucze, ...miary,
});

test('statystyki: cztery wiersze zawsze w kolejności Google Ads, Link agenta, Inne, Brak danych — także z zerami', () => {
  const { wiersze, razem } = zrodlaWStatystykach([]);
  assert.deepEqual(wiersze.map((w) => w.klucz), KLUCZE_ZRODLA);
  assert.deepEqual(wiersze.map((w) => w.etykieta), KLUCZE_ZRODLA.map((k) => ETYKIETY_ZRODLA[k]));
  for (const w of wiersze) assert.equal(w.wnioski + w.sprzedaze, 0);
  assert.equal(razem.wnioski, 0);
  assert.deepEqual(zrodlaWStatystykach(null).razem, razem);
});

test('statystyki: rodzaj z tej samej reguły, sumy w wierszach, podwiersze kampanii i utm_source, Razem', () => {
  const { wiersze, razem } = zrodlaWStatystykach([
    g({ ma_zrodlo: true, platne: true, utm_source: 'ads', utm_medium: 'internet', kampania: 'jesien26' },
      { wnioski: 3, sprzedaze: 1, z_danymi: 1, skladka_roczna_suma: 3000.1, prowizja_suma: 450.2 }),
    g({ ma_zrodlo: true, platne: false, utm_source: 'google', utm_medium: 'cpc', kampania: 'jesien26' },
      { wnioski: 1, sprzedaze: 1, z_danymi: 1, skladka_roczna_suma: 1000.2, prowizja_suma: 0, bez_stawki: 1 }),
    g({ ma_zrodlo: true, platne: true, kampania: null }, { wnioski: 1 }),
    g({ ma_zrodlo: true, platne: true, link_agenta: true, kampania: '998877' }, { wnioski: 1, sprzedaze: 1, z_danymi: 1, skladka_roczna_suma: 500, prowizja_suma: 50 }),
    g({ link_agenta: true }, { wnioski: 2, sprzedaze: 1, z_danymi: 1, skladka_roczna_suma: 2000, prowizja_suma: 300 }),
    g({ ma_zrodlo: true, link_agenta: true, utm_source: 'facebook' }, { wnioski: 1 }),
    g({ ma_zrodlo: true, utm_source: 'facebook', utm_medium: 'social' }, { wnioski: 2, sprzedaze: 1, z_danymi: 1, skladka_roczna_suma: 1000, bez_stawki: 1 }),
    g({ ma_zrodlo: true, utm_source: 'newsletter' }, { wnioski: 3 }),
    g({ ma_zrodlo: true, kampania: 'x' }, { wnioski: 1 }),
    g({}, { wnioski: 4, sprzedaze: 3, z_danymi: 2, skladka_roczna_suma: 2200, prowizja_suma: 160 }),
  ]);
  const w = Object.fromEntries(wiersze.map((x) => [x.klucz, x]));
  assert.deepEqual([w.ads.wnioski, w.ads.sprzedaze, w.ads.skladka_roczna_suma, w.ads.prowizja_suma, w.ads.bez_stawki], [6, 3, 4500.3, 500.2, 1]);
  assert.deepEqual(w.ads.pod.map((p) => [p.etykieta, p.wnioski, p.sprzedaze]),
    [['jesien26', 4, 2], ['998877', 1, 1], [BEZ_KAMPANII, 1, 0]], 'kampanie: najwięcej wniosków + sprzedaży pierwsze');
  assert.deepEqual([w.agent.wnioski, w.agent.sprzedaze, w.agent.skladka_roczna_suma], [3, 1, 2000]);
  assert.deepEqual(w.agent.pod, [], 'link agenta bez podwierszy');
  assert.deepEqual([w.inne.wnioski, w.inne.sprzedaze, w.inne.bez_stawki], [6, 1, 1]);
  // facebook 2 + 1 sprzedaż = newsletter 3 + 0 → remis, alfabetycznie; FaceBook z linkiem agenta jest w „Link agenta".
  assert.deepEqual(w.inne.pod.map((p) => [p.etykieta, p.wnioski]), [['facebook', 2], ['newsletter', 3], [BEZ_UTM_SOURCE, 1]]);
  assert.deepEqual([w.brak.wnioski, w.brak.sprzedaze, w.brak.z_danymi], [4, 3, 2]);
  assert.deepEqual(w.brak.pod, []);
  // Razem = suma wszystkich grup; grosze bez ogona zmiennoprzecinkowego.
  assert.deepEqual([razem.wnioski, razem.sprzedaze, razem.z_danymi, razem.skladka_roczna_suma, razem.prowizja_suma, razem.bez_stawki],
    [19, 8, 7, 9700.3, 960.2, 2]);
  assert.equal(wiersze.reduce((s, x) => s + x.wnioski, 0), razem.wnioski, 'wiersze sumują się do Razem');
});

test('statystyki: dwie długie kampanie o tym samym początku to dwa podwiersze z unikalnym kluczem', () => {
  const a = `${'k'.repeat(70)}-A`;
  const b = `${'k'.repeat(70)}-B`;
  const { wiersze } = zrodlaWStatystykach([
    g({ ma_zrodlo: true, platne: true, kampania: a }, { wnioski: 1 }),
    g({ ma_zrodlo: true, platne: true, kampania: b }, { wnioski: 1 }),
    g({ ma_zrodlo: true, platne: true, kampania: BEZ_KAMPANII }, { wnioski: 1 }),
    g({ ma_zrodlo: true, platne: true }, { wnioski: 1 }),
  ]);
  const pod = wiersze[0].pod;
  assert.equal(pod.length, 4, 'prawdziwa kampania o nazwie „bez nazwy kampanii" nie zlewa się z brakiem nazwy');
  assert.equal(new Set(pod.map((p) => p.klucz)).size, 4);
  assert.ok(pod.every((p) => Array.from(p.etykieta).length <= 60));
});

test('statystyki: wartość ponad 100 znaków (spreparowany wniosek) nie jedzie w całości w danych strony', () => {
  // form-submit kopiuje ciało żądania do form_data bez limitu; SQL tnie do 100, a tu klucz
  // podwiersza też — gdyby SQL tego nie zrobił (stara wersja funkcji), 2 MB nie trafia do przeglądarki.
  const wielkie = 'K'.repeat(2_000_000);
  const wynik = zrodlaWStatystykach([
    g({ ma_zrodlo: true, platne: true, kampania: wielkie }, { wnioski: 1 }),
    g({ ma_zrodlo: true, utm_source: 'ź'.repeat(2_000_000) }, { wnioski: 1 }),
  ]);
  const [ads, , inne] = wynik.wiersze;
  for (const p of [...ads.pod, ...inne.pod]) {
    assert.ok(Array.from(p.klucz).length <= 100, `klucz ma ${p.klucz.length} znaków`);
    assert.ok(Array.from(p.etykieta).length <= 60);
  }
  assert.ok(JSON.stringify(wynik).length < 2_000, `dane strony: ${JSON.stringify(wynik).length} znaków`);
  // Do 100 znaków klucz to cała wartość (tyle przepuszcza portal) — bez „…".
  const sto = 'k'.repeat(100);
  assert.equal(zrodlaWStatystykach([g({ ma_zrodlo: true, platne: true, kampania: sto }, { wnioski: 1 })]).wiersze[0].pod[0].klucz, sto);
});

test('statystyki: kwoty jako napisy (numeric z bazy) i śmieci w grupach', () => {
  const { wiersze, razem } = zrodlaWStatystykach([
    g({ ma_zrodlo: true, platne: true }, { sprzedaze: 1, skladka_roczna_suma: '1200.50', prowizja_suma: '120.05' }),
    null, 'grupa', 7, [],
    g({}, { wnioski: 'abc', skladka_roczna_suma: null }),
  ]);
  assert.equal(wiersze[0].skladka_roczna_suma, 1200.5);
  assert.equal(razem.prowizja_suma, 120.05);
  assert.equal(razem.wnioski, 0);
});

test('statystyki: link_agenta i platne tylko jako prawdziwe true (jak w regule)', () => {
  const { wiersze } = zrodlaWStatystykach([
    g({ link_agenta: 'true' }, { wnioski: 1 }),
    g({ ma_zrodlo: true, platne: 'true', utm_source: 'mail' }, { wnioski: 1 }),
    g({ ma_zrodlo: 'true', platne: true }, { wnioski: 1 }),
  ]);
  const w = Object.fromEntries(wiersze.map((x) => [x.klucz, x.wnioski]));
  assert.deepEqual(w, { ads: 0, agent: 0, inne: 1, brak: 2 });
});

console.log(`\n${ok} testów zaliczonych.`);
