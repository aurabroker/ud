/**
 * Test skryptu Google Ads `narzedzia/ads-kampania-uk.js`.
 *
 *     node --test narzedzia/test/
 *
 * Skryptu nie da się uruchomić poza Google Ads, więc test ładuje jego PRAWDZIWE
 * źródło do piaskownicy (`node:vm`) z atrapą `AdsApp` i woła `main()`. Atrapa
 * zachowuje się jak API w tych miejscach, na których skrypt polega: zapytania
 * GAQL filtrują po nazwie i statusie tak, jak są napisane, a `mutateAll` oddaje
 * po jednym wyniku na operację.
 *
 * CZEGO TEN TEST NIE POWIE: czy Google przyjmie operacje (nazwy pól są wzięte
 * z definicji API v26, ale prawdziwej odpowiedzi API tu nie ma), czy reklamy
 * przejdą weryfikację zasad i czy frazy mają jakikolwiek ruch. Na to pierwsze
 * odpowiada „Podgląd" w Google Ads, na resztę — konto po uruchomieniu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zrodloZAdresu } from '../../packages/wniosek/src/zrodlo.js';
import { opisZrodla } from '../../apps/panel/src/lib/zrodlo.js';

const TU = dirname(fileURLToPath(import.meta.url));
const REPO = join(TU, '..', '..');
const PLIK = join(TU, '..', 'ads-kampania-uk.js');
const ZRODLO = readFileSync(PLIK, 'utf8');

const iterator = (wiersze) => {
  let i = 0;
  return { hasNext: () => i < wiersze.length, next: () => wiersze[i++] };
};

/**
 * Konto Google Ads na niby.
 * @param {object} [o]
 * @param {{name: string, status: string}[]} [o.kampanie]  kampanie już istniejące w koncie
 * @param {string} [o.waluta]
 * @param {boolean} [o.menedzer]
 * @param {{id: string, name: string}[]} [o.niezadeklarowane]  bez deklaracji o reklamie politycznej UE
 * @param {boolean} [o.podglad]
 * @param {boolean} [o.odmowa]  Google odrzuca całą paczkę
 * @param {(ctx: any) => void} [o.przedStartem]  podmiana ustawień skryptu przed `main()`
 */
function uruchom(o = {}) {
  const dziennik = [];
  const paczki = [];
  const zapytania = [];
  const AdsApp = {
    currentAccount: () => ({
      getCustomerId: () => '123-456-7890',
      getName: () => 'Konto testowe',
      getCurrencyCode: () => o.waluta ?? 'PLN',
    }),
    getExecutionInfo: () => ({ isPreview: () => o.podglad === true }),
    search(q) {
      zapytania.push(q);
      if (/\bFROM\s+customer\b/i.test(q)) {
        return iterator([{ customer: { manager: o.menedzer === true, currencyCode: o.waluta ?? 'PLN' } }]);
      }
      if (/missing_eu_political_advertising_declaration/.test(q)) {
        return iterator((o.niezadeklarowane ?? []).map((k) => ({ campaign: k })));
      }
      if (/\bFROM\s+campaign\b/i.test(q)) {
        // Filtrujemy tak, jak napisano zapytanie — skrypt, który zapomni
        // o statusie, dostanie także kampanie usunięte.
        const nazwa = q.match(/campaign\.name\s*=\s*'([^']*)'/)?.[1];
        const bezUsunietych = /campaign\.status\s*!=\s*'?REMOVED'?/.test(q);
        return iterator((o.kampanie ?? [])
          .filter((k) => (nazwa === undefined || k.name === nazwa))
          .filter((k) => !(bezUsunietych && k.status === 'REMOVED'))
          .map((k) => ({ campaign: k })));
      }
      throw new Error(`atrapa nie zna zapytania: ${q}`);
    },
    mutateAll(operacje, opcje) {
      paczki.push({ operacje, opcje });
      return operacje.map((_, i) => (o.odmowa
        ? { isSuccessful: () => false, getResourceName: () => null, getErrorMessages: () => [`Odmowa testowa nr ${i}`] }
        : { isSuccessful: () => true, getResourceName: () => `customers/1234567890/zasob/${i + 1}`, getErrorMessages: () => [] }));
    },
  };
  const ctx = vm.createContext({ AdsApp, Logger: { log: (t) => dziennik.push(String(t)) } });
  vm.runInContext(ZRODLO, ctx, { filename: PLIK });
  o.przedStartem?.(ctx);
  ctx.main();
  // Obiekty z piaskownicy mają inne prototypy niż testowe — porównujemy kopie.
  const operacje = paczki.length ? JSON.parse(JSON.stringify(paczki[0].operacje)) : [];
  return { ctx, dziennik: dziennik.join('\n'), paczki, operacje, zapytania };
}

const ustawienia = () => {
  const ctx = vm.createContext({ AdsApp: {}, Logger: { log() {} } });
  vm.runInContext(ZRODLO, ctx, { filename: PLIK });
  return JSON.parse(JSON.stringify({ KAMPANIA: ctx.KAMPANIA, GRUPY: ctx.GRUPY, WYKLUCZENIA: ctx.WYKLUCZENIA }));
};

const tworzenia = (operacje, rodzaj) => operacje.filter((op) => op[rodzaj]).map((op) => op[rodzaj].create);
const dlugosc = (t) => [...t].length;

// ── Teksty ───────────────────────────────────────────────────────────────────

test('nagłówki mają najwyżej 30 znaków, opisy najwyżej 90', () => {
  const { GRUPY } = ustawienia();
  assert.ok(GRUPY.length >= 1, 'brak grup reklam');
  for (const g of GRUPY) {
    for (const n of g.naglowki) assert.ok(dlugosc(n) <= 30, `nagłówek ma ${dlugosc(n)} znaków: „${n}”`);
    for (const d of g.opisy) assert.ok(dlugosc(d) <= 90, `opis ma ${dlugosc(d)} znaków: „${d}”`);
  }
});

test('każda reklama ma 3–15 nagłówków i 2–4 opisy, bez powtórzeń', () => {
  for (const g of ustawienia().GRUPY) {
    assert.ok(g.naglowki.length >= 3 && g.naglowki.length <= 15, `${g.nazwa}: ${g.naglowki.length} nagłówków`);
    assert.ok(g.opisy.length >= 2 && g.opisy.length <= 4, `${g.nazwa}: ${g.opisy.length} opisów`);
    assert.equal(new Set(g.naglowki).size, g.naglowki.length, `${g.nazwa}: powtórzony nagłówek`);
    assert.equal(new Set(g.opisy).size, g.opisy.length, `${g.nazwa}: powtórzony opis`);
  }
});

test('frazy: najwyżej 80 znaków i 10 słów, żadna nie stoi w dwóch grupach', () => {
  const wszystkie = [];
  for (const g of ustawienia().GRUPY) {
    assert.ok(g.frazy.length >= 1, `${g.nazwa}: brak fraz`);
    for (const f of g.frazy) {
      assert.ok(dlugosc(f) <= 80, `fraza za długa: „${f}”`);
      assert.ok(f.trim().split(/\s+/).length <= 10, `fraza ma ponad 10 słów: „${f}”`);
      assert.equal(f, f.trim().toLowerCase(), `fraza ma być małymi literami, bez odstępów na brzegach: „${f}”`);
      wszystkie.push(f);
    }
  }
  assert.equal(new Set(wszystkie).size, wszystkie.length, 'ta sama fraza w dwóch grupach licytowałaby sama ze sobą');
});

test('teksty reklam nie łamią zasad serwisu', () => {
  // Te same zakazy co na stronach /uk/ (CLAUDE.md, „Wersja ukraińska"), plus
  // dwie rzeczy właściwe reklamie: bez kwot i procentów (starzeją się razem
  // z kalibracją i ZUS-em, a zastrzeżenia do limitu się tu nie zmieszczą)
  // i bez cudzych znaków towarowych.
  const ZAKAZANE = [
    [/першого дня/i, '„od pierwszego dnia"'],
    [/каренц/i, '„karencja" zamiast „період очікування"'],
    [/мінімум|щонайменше/i, 'okres wypłaty to czas najdłuższy'],
    [/гарант/i, 'gwarancja'],
    [/безкоштовн/i, '„bezpłatnie"'],
    [/Leadenhall|CEU|Lloyd/i, 'cudzy znak towarowy'],
    [/страховик/i, 'kto jest ubezpieczycielem, mówi strona — reklama nie ma na to miejsca'],
    [/\d\s*%/, 'procent'],
    [/\d\s*(zł|злот|PLN)/i, 'kwota'],
  ];
  for (const g of ustawienia().GRUPY) {
    for (const t of [...g.naglowki, ...g.opisy]) {
      for (const [wzor, co] of ZAKAZANE) assert.ok(!wzor.test(t), `${co} w tekście „${t}”`);
    }
  }
});

// ── Co powstaje w koncie ─────────────────────────────────────────────────────

test('całość idzie jednym wywołaniem: albo powstaje wszystko, albo nic', () => {
  const { paczki } = uruchom();
  assert.equal(paczki.length, 1);
  assert.equal(paczki[0].opcje?.partialFailure, false);
});

test('kampania powstaje WSTRZYMANA', () => {
  const [k] = tworzenia(uruchom().operacje, 'campaignOperation');
  assert.equal(k.status, 'PAUSED');
});

test('kampania: tylko wyszukiwarka Google, bez partnerów i sieci reklamowej', () => {
  const kampanie = tworzenia(uruchom().operacje, 'campaignOperation');
  assert.equal(kampanie.length, 1);
  const [k] = kampanie;
  assert.equal(k.advertisingChannelType, 'SEARCH');
  assert.deepEqual(k.networkSettings, {
    targetGoogleSearch: true,
    targetSearchNetwork: false,
    targetContentNetwork: false,
    targetPartnerSearchNetwork: false,
  });
});

test('reklamy widzą osoby przebywające w Polsce, nie „zainteresowane Polską"', () => {
  const { operacje } = uruchom();
  const [k] = tworzenia(operacje, 'campaignOperation');
  assert.equal(k.geoTargetTypeSetting?.positiveGeoTargetType, 'PRESENCE');
  const lokalizacje = tworzenia(operacje, 'campaignCriterionOperation').filter((c) => c.location);
  assert.deepEqual(lokalizacje.map((c) => [c.location.geoTargetConstant, c.negative === true]),
    [['geoTargetConstants/2616', false]]);
});

test('kampania niesie deklarację o reklamie politycznej UE', () => {
  // Bez niej API odrzuca tworzenie kampanii (FieldError.REQUIRED).
  const [k] = tworzenia(uruchom().operacje, 'campaignOperation');
  assert.equal(k.containsEuPoliticalAdvertising, 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING');
});

test('nie ma kryterium języka', () => {
  // Od końca września 2026 API odrzuca kryterium języka w kampanii w wyszukiwarce
  // (ContextError.OPERATION_NOT_PERMITTED_FOR_CONTEXT) — a przy jednym atomowym
  // wywołaniu odrzuciłoby razem z nim całą kampanię.
  const kryteria = tworzenia(uruchom().operacje, 'campaignCriterionOperation');
  assert.deepEqual(kryteria.filter((c) => 'language' in c), []);
});

test('budżet dzienny i najwyższa stawka idą z ustawień, w mikrojednostkach', () => {
  const { operacje, ctx } = uruchom({
    przedStartem: (c) => { c.KAMPANIA.budzetDziennyZl = 35; c.KAMPANIA.maksCpcZl = 2.5; },
  });
  assert.equal(ctx.KAMPANIA.budzetDziennyZl, 35);
  const [b] = tworzenia(operacje, 'campaignBudgetOperation');
  assert.equal(b.amountMicros, 35_000_000);
  assert.equal(b.explicitlyShared, false);
  const [k] = tworzenia(operacje, 'campaignOperation');
  assert.deepEqual(k.targetSpend, { cpcBidCeilingMicros: 2_500_000 });
  assert.equal(k.campaignBudget, b.resourceName);
});

test('nazwy tymczasowe: numer konta bez myślników, ujemne i niepowtarzalne; odwołania trafiają w coś utworzonego wcześniej', () => {
  const { operacje } = uruchom();
  const znane = new Set();
  for (const op of operacje) {
    const [rodzaj] = Object.keys(op);
    const c = op[rodzaj].create;
    assert.ok(c, `${rodzaj}: operacja inna niż create`);
    for (const pole of ['campaignBudget', 'campaign', 'adGroup']) {
      if (c[pole] !== undefined) assert.ok(znane.has(c[pole]), `${rodzaj}.${pole} wskazuje na ${c[pole]}, którego jeszcze nie ma`);
    }
    if (c.resourceName !== undefined) {
      assert.match(c.resourceName, /^customers\/1234567890\/[A-Za-z]+\/-\d+$/);
      assert.ok(!znane.has(c.resourceName), `powtórzona nazwa ${c.resourceName}`);
      znane.add(c.resourceName);
    }
  }
  assert.ok(znane.size >= 3, 'budżet, kampania i co najmniej jedna grupa');
});

test('każda grupa z ustawień dostaje grupę reklam, reklamę i swoje frazy w dopasowaniu do wyrażenia', () => {
  const { operacje } = uruchom();
  const { GRUPY } = ustawienia();
  const grupy = tworzenia(operacje, 'adGroupOperation');
  assert.deepEqual(grupy.map((g) => g.name), GRUPY.map((g) => g.nazwa));
  for (const [i, g] of grupy.entries()) {
    assert.equal(g.type, 'SEARCH_STANDARD');
    const reklamy = tworzenia(operacje, 'adGroupAdOperation').filter((r) => r.adGroup === g.resourceName);
    assert.equal(reklamy.length, 1, `${g.name}: reklam ${reklamy.length}`);
    assert.deepEqual(reklamy[0].ad.responsiveSearchAd.headlines.map((h) => h.text), GRUPY[i].naglowki);
    assert.deepEqual(reklamy[0].ad.responsiveSearchAd.descriptions.map((d) => d.text), GRUPY[i].opisy);
    const frazy = tworzenia(operacje, 'adGroupCriterionOperation').filter((f) => f.adGroup === g.resourceName);
    assert.deepEqual(frazy.map((f) => [f.keyword.text, f.keyword.matchType, f.negative === true]),
      GRUPY[i].frazy.map((f) => [f, 'PHRASE', false]));
  }
});

test('informacja „wniosek po polsku, potrzebny PESEL" stoi w każdej reklamie na stałe', () => {
  // Opis przypięty do pierwszej pozycji wyświetla się zawsze; nieprzypięty —
  // kiedy Google zechce. Bez tego płacimy za kliknięcia osób, które odpadną
  // na polskim formularzu albo na polu PESEL.
  for (const r of tworzenia(uruchom().operacje, 'adGroupAdOperation')) {
    const przypiete = r.ad.responsiveSearchAd.descriptions.filter((d) => d.pinnedField === 'DESCRIPTION_1');
    assert.equal(przypiete.length, 1, 'dokładnie jeden opis przypięty do pierwszej pozycji');
    assert.match(przypiete[0].text, /польською/);
    assert.match(przypiete[0].text, /PESEL/);
    assert.deepEqual(r.ad.responsiveSearchAd.headlines.filter((h) => h.pinnedField), [], 'nagłówki bez przypięć');
  }
});

test('reklamy prowadzą na strony /uk/, które są w portalu', () => {
  for (const r of tworzenia(uruchom().operacje, 'adGroupAdOperation')) {
    assert.equal(r.ad.finalUrls.length, 1);
    const adres = new URL(r.ad.finalUrls[0]);
    assert.equal(adres.origin, 'https://utratadochodu.pl');
    assert.match(adres.pathname, /^\/uk\/([a-z-]+\/)?$/);
    assert.equal(adres.search, '', 'parametry kampanii idą sufiksem kampanii, nie w adresie reklamy');
    const strona = join(REPO, 'apps/portal/src/pages', adres.pathname, 'index.astro');
    assert.ok(existsSync(strona), `nie ma strony ${adres.pathname} (${strona})`);
  }
});

test('wniosek z tej kampanii panel pokaże jako Google Ads z jej nazwą i słowem kluczowym', () => {
  const [k] = tworzenia(uruchom().operacje, 'campaignOperation');
  assert.ok(k.finalUrlSuffix.includes('{keyword}'), 'sufiks bez {keyword} — panel nie pokaże słowa kluczowego');
  // Google podstawia {keyword} przy kliknięciu; identyfikatora kliknięcia nie dokładamy,
  // żeby sprawdzić drogę kogoś, kto nie zgodził się na cookies marketingowe.
  const poKliknieciu = '?' + k.finalUrlSuffix.replace('{keyword}', encodeURIComponent('страхування доходу'));
  const { zrodlo } = zrodloZAdresu(poKliknieciu, false);
  assert.ok(zrodlo, 'kreator nie rozpoznał parametrów kampanii');
  const opis = opisZrodla({ zrodlo });
  assert.equal(opis.klucz, 'ads');
  assert.equal(opis.kampania, ustawienia().KAMPANIA.utmCampaign);
  assert.equal(opis.slowo, 'страхування доходу');
});

test('słowa wykluczające idą na poziomie kampanii', () => {
  const { operacje } = uruchom();
  const { WYKLUCZENIA } = ustawienia();
  const wykluczone = tworzenia(operacje, 'campaignCriterionOperation').filter((c) => c.keyword);
  assert.deepEqual(wykluczone.map((c) => c.keyword.text), WYKLUCZENIA);
  for (const c of wykluczone) {
    assert.equal(c.negative, true);
    assert.equal(c.keyword.matchType, 'PHRASE');
  }
  // Najczęstsze „ubezpieczenie" w ukraińskich zapytaniach w Polsce to polisa
  // do karty pobytu i do wizy — inny produkt.
  assert.ok(WYKLUCZENIA.includes('карта побиту'));
  assert.ok(WYKLUCZENIA.some((w) => /^віз/.test(w)));
});

// ── Bezpieczniki ─────────────────────────────────────────────────────────────

test('za długi nagłówek zatrzymuje skrypt przed wysłaniem czegokolwiek', () => {
  const zaDlugi = 'Страхування від втрати доходу 2';
  assert.equal(dlugosc(zaDlugi), 31);
  const { paczki, dziennik } = uruchom({ przedStartem: (c) => { c.GRUPY[0].naglowki.push(zaDlugi); } });
  assert.equal(paczki.length, 0);
  assert.ok(dziennik.includes(zaDlugi), 'dziennik nie mówi, który tekst jest za długi');
});

test('kampania o tej nazwie już jest → drugi raz nie powstaje', () => {
  const { KAMPANIA } = ustawienia();
  const { paczki, dziennik } = uruchom({ kampanie: [{ name: KAMPANIA.nazwa, status: 'PAUSED' }] });
  assert.equal(paczki.length, 0);
  assert.match(dziennik, /już istnieje/i);
});

test('usunięta kampania o tej nazwie nie blokuje', () => {
  const { KAMPANIA } = ustawienia();
  const { paczki } = uruchom({ kampanie: [{ name: KAMPANIA.nazwa, status: 'REMOVED' }] });
  assert.equal(paczki.length, 1);
});

test('kampania o innej nazwie nie blokuje', () => {
  const { paczki } = uruchom({ kampanie: [{ name: 'Wyszukiwarka PL', status: 'ENABLED' }] });
  assert.equal(paczki.length, 1);
});

test('konto w innej walucie → nic nie powstaje (budżet jest w złotych)', () => {
  const { paczki, dziennik } = uruchom({ waluta: 'EUR' });
  assert.equal(paczki.length, 0);
  assert.match(dziennik, /EUR/);
});

test('konto menedżerskie → nic nie powstaje', () => {
  const { paczki, dziennik } = uruchom({ menedzer: true });
  assert.equal(paczki.length, 0);
  assert.match(dziennik, /mened[żz]ersk/i);
});

test('odmowa Google → dziennik mówi wprost, że nic nie powstało, i podaje powód', () => {
  const { paczki, dziennik } = uruchom({ odmowa: true });
  assert.equal(paczki.length, 1);
  assert.match(dziennik, /NIC NIE POWSTAŁO/);
  assert.match(dziennik, /Odmowa testowa nr 0/);
  assert.doesNotMatch(dziennik, /GOTOWE/);
});

test('udane utworzenie → dziennik mówi, że kampania jest wstrzymana i co sprawdzić', () => {
  const { dziennik } = uruchom();
  assert.match(dziennik, /GOTOWE/);
  assert.match(dziennik, /WSTRZYMANA/);
});

test('podgląd → dziennik nie twierdzi, że kampania powstała', () => {
  const { dziennik } = uruchom({ podglad: true });
  assert.match(dziennik, /PODGLĄD/);
  assert.doesNotMatch(dziennik, /GOTOWE/);
});

test('kampanie bez deklaracji UE w koncie → ostrzeżenie z ich nazwami', () => {
  // Od 01.04.2026 jedna taka kampania blokuje w API każdą zmianę w koncie
  // (MutateError.EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED).
  const { dziennik } = uruchom({ odmowa: true, niezadeklarowane: [{ id: '11', name: 'Stara kampania' }] });
  assert.match(dziennik, /Stara kampania/);
  assert.match(dziennik, /reklam\w* polityczn/i);
});
