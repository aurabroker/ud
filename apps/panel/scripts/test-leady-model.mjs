/**
 * Czysta logika widoku tablicy leadów (src/lib/leady/model.js) i klient API
 * (src/lib/leady/api.js) — bez przeglądarki i bez bazy.
 *
 *   pnpm test:leady-model
 */
process.env.TZ = 'Europe/Warsaw';

import assert from 'node:assert/strict';
import {
  akcjeEtapu, akcjeLeada, czyMoznaPrzeniesc, daneSprzedazyZFormularza, dniWEtapie, indeksWstawienia, kontekstKarty,
  mozeZmienicOpiekuna, opcjeOpiekuna, opiekunNaKarcie, opisFiltra, ostrzezenia, pasujeDoFiltra, porownajKarty,
  terminTekst, wartoscKarty, wiekKarty, wymagaPowodu, wymagaSprzedazy, zSeparatorami,
} from '../src/lib/leady/model.js';
import { BladSieci, utworzApi } from '../src/lib/leady/api.js';

let pass = 0;
const bledy = [];
async function t(nazwa, fn) {
  try { await fn(); pass++; } catch (e) { bledy.push(`FAIL ${nazwa}\n     ${String(e.message).split('\n').join('\n     ')}`); }
}

const TERAZ = new Date('2026-10-02T10:00:00+02:00');
const dni = (n) => new Date(TERAZ.getTime() + n * 86400000).toISOString();
const karta = (o = {}) => ({
  id: 'a', etap_id: 'e1', wersja: 1, rodzaj: 'klient', nazwa: 'Anna Kowalska', telefon: '500100200', zrodlo: 'form',
  produkty: ['okresowa'], wartosc: 8000, opiekun_id: 'u1', opiekun_nazwa: 'Ula', dzialanie: null,
  etap_od: dni(-1), zgloszono: dni(-3), krok_nr: null, dane_do: null, powod_utraty: null, ...o,
});
const OTWARTY = { id: 'e1', nazwa: 'Nowy', rodzaj: 'otwarty', wymagane_pola: [] };
const PRZEGRANY = { id: 'e6', nazwa: 'Przegrany', rodzaj: 'przegrany', wymagane_pola: ['powod_utraty'] };
const plan = (rola = 'user') => ({ rola, uzytkownik: { id: 'u1', nazwa: 'Ula' }, agenci: [{ id: 'u1', nazwa: 'Ula' }, { id: 'u2', nazwa: 'Olek' }] });

// ── Ostrzeżenia ──────────────────────────────────────────────────────────────
await t('ostrzeżenia: brak działania i brak opiekuna mają TEKST', () => {
  const o = ostrzezenia(karta({ opiekun_id: null }), OTWARTY, TERAZ);
  assert.deepEqual(o.map((x) => x.id), ['brak_dzialania', 'brak_opiekuna']);
  assert.equal(o[0].tekst, 'Brak zaplanowanego działania');
  assert.ok(o.every((x) => x.ikona && x.tekst), 'ikona i tekst — sam kolor nie wystarcza');
});
await t('ostrzeżenia: przeterminowane jest pierwsze i błędem', () => {
  const o = ostrzezenia(karta({ dzialanie: { typ: 'telefon', termin: dni(-1) } }), OTWARTY, TERAZ);
  assert.equal(o[0].id, 'przeterminowane');
  assert.equal(o[0].waga, 'blad');
  assert.match(o[0].tekst, /Telefon wczoraj/);
});
await t('ostrzeżenia: działanie w przyszłości nie ostrzega', () => {
  assert.deepEqual(ostrzezenia(karta({ dzialanie: { typ: 'email', termin: dni(2) } }), OTWARTY, TERAZ), []);
});
await t('wiek karty: pierwsza kolumna od zieleni (0) do 5, potem czerwień; napis z liczbą dni', () => {
  assert.deepEqual(wiekKarty(karta({ etap_od: TERAZ.toISOString() }), OTWARTY, true, TERAZ), { dni: 0, czerwony: false, poziom: 0, tekst: 'Dziś w etapie' });
  assert.equal(wiekKarty(karta({ etap_od: dni(-1) }), OTWARTY, true, TERAZ).tekst, '1 dzień w etapie');
  assert.equal(wiekKarty(karta({ etap_od: dni(-3) }), OTWARTY, true, TERAZ).poziom, 3);
  const piec = wiekKarty(karta({ etap_od: dni(-5) }), OTWARTY, true, TERAZ);
  assert.ok(piec.poziom === 5 && !piec.czerwony, 'pięć dni to jeszcze nie „dłużej niż 5"');
  const szesc = wiekKarty(karta({ etap_od: dni(-6) }), OTWARTY, true, TERAZ);
  assert.ok(szesc.czerwony && szesc.poziom === null && szesc.tekst === '6 dni w etapie');
});
await t('wiek karty: inne otwarte kolumny bez koloru do 5 dni, potem czerwień; zamknięte — nic', () => {
  const trzy = wiekKarty(karta({ etap_od: dni(-3) }), OTWARTY, false, TERAZ);
  assert.ok(!trzy.czerwony && trzy.poziom === null && trzy.dni === 3);
  assert.ok(wiekKarty(karta({ etap_od: dni(-6) }), OTWARTY, false, TERAZ).czerwony);
  assert.equal(wiekKarty(karta({ etap_od: dni(-30) }), PRZEGRANY, false, TERAZ), null);
  assert.equal(wiekKarty(karta({ etap_od: dni(-30) }), { rodzaj: 'wygrany' }, true, TERAZ), null);
});
await t('ostrzeżenia: czas w etapie nie dubluje napisu na karcie', () => {
  assert.ok(!ostrzezenia(karta({ etap_od: dni(-30), dzialanie: { typ: 'inne', termin: dni(1) } }), OTWARTY, TERAZ).some((x) => x.id === 'dlugo_w_etapie'));
});
await t('opiekun na karcie: administrator ukryty, brak → „Bez opiekuna"', () => {
  assert.equal(opiekunNaKarcie(karta({ opiekun_admin: true, opiekun_nazwa: 'Ada Admin' })), null);
  assert.equal(opiekunNaKarcie(karta({ opiekun_admin: false })), 'Ula');
  assert.equal(opiekunNaKarcie(karta({ opiekun_id: null, opiekun_nazwa: null })), 'Bez opiekuna');
});
await t('wartość karty: w Wygrany składka roczna albo prośba o dane; gdzie indziej świadczenie', () => {
  const WYG = { rodzaj: 'wygrany' };
  assert.equal(wartoscKarty(karta({ sprzedaz: { skladka_roczna: 3036 } }), WYG), `Składka 3036 zł / rok`.replace('3036', new Intl.NumberFormat('pl-PL').format(3036)));
  assert.equal(wartoscKarty(karta({ sprzedaz: null }), WYG), 'Brak danych sprzedaży');
  assert.match(wartoscKarty(karta(), OTWARTY), /^Świadczenie .* \/ mies\.$/);
});
await t('menu leada: w Wygrany pozycja danych sprzedaży obok notatki; gdzie indziej jej nie ma', () => {
  const WYG = { id: 'e5', nazwa: 'Wygrany', rodzaj: 'wygrany', wymagane_pola: ['skladka_roczna'] };
  const ids = akcjeLeada({ karta: karta({ sprzedaz: null }), etap: WYG, plan: plan() }).map((p) => p.id);
  assert.equal(ids[ids.indexOf('notatka') + 1], 'sprzedaz');
  assert.equal(akcjeLeada({ karta: karta({ sprzedaz: null }), etap: WYG, plan: plan() }).find((p) => p.id === 'sprzedaz').etykieta, 'Uzupełnij dane sprzedaży…');
  assert.equal(akcjeLeada({ karta: karta({ sprzedaz: { skladka_roczna: 100 } }), etap: WYG, plan: plan() }).find((p) => p.id === 'sprzedaz').etykieta, 'Dane sprzedaży…');
  assert.ok(!akcjeLeada({ karta: karta(), etap: OTWARTY, plan: plan() }).some((p) => p.id === 'sprzedaz'));
});
await t('dane sprzedaży z formularza: kwoty jak w SQL, puste pomija, śmieci zgłasza', () => {
  const { sprzedaz, bledne } = daneSprzedazyZFormularza(
    { skladka_roczna: '3 036,50 zł', skladka_mies: '', swiadczenie_okresowa: '10000', swiadczenie_trwala: 'abc', swiadczenie_zgon: '0' }, 'w-1');
  assert.deepEqual(sprzedaz, { skladka_roczna: 3036.5, swiadczenie_okresowa: 10000, wariant_id: 'w-1' });
  assert.deepEqual(bledne, ['swiadczenie_trwala', 'swiadczenie_zgon']);
  assert.ok(wymagaSprzedazy({ wymagane_pola: ['skladka_roczna'] }) && !wymagaSprzedazy(OTWARTY));
});
await t('ostrzeżenia: etap zamykający nie ostrzega o braku działania ani opiekuna', () => {
  assert.deepEqual(ostrzezenia(karta({ opiekun_id: null, etap_od: dni(-30) }), PRZEGRANY, TERAZ), []);
});
await t('ostrzeżenia: szkic niesie datę usunięcia danych; blisko terminu → „uwaga"', () => {
  const daleko = ostrzezenia(karta({ rodzaj: 'szkic', dane_do: dni(20), dzialanie: { typ: 'telefon', termin: dni(1) } }), OTWARTY, TERAZ).find((x) => x.id === 'dane_do');
  assert.equal(daleko.waga, 'info');
  assert.match(daleko.tekst, /^Dane z formularza usuniemy 22\.10\.2026$/);
  const blisko = ostrzezenia(karta({ rodzaj: 'szkic', dane_do: dni(3) }), OTWARTY, TERAZ).find((x) => x.id === 'dane_do');
  assert.equal(blisko.waga, 'uwaga');
});
await t('dniWEtapie: nie schodzi poniżej zera', () => assert.equal(dniWEtapie(karta({ etap_od: dni(1) }), TERAZ), 0));

// ── Etykiety ─────────────────────────────────────────────────────────────────
await t('termin: dziś / jutro / wczoraj / data, bez godziny przy północy', () => {
  assert.equal(terminTekst('2026-10-02T14:30:00+02:00', TERAZ), 'dziś 14:30');
  assert.equal(terminTekst('2026-10-03T10:00:00+02:00', TERAZ), 'jutro 10:00');
  assert.equal(terminTekst('2026-10-01T09:15:00+02:00', TERAZ), 'wczoraj 09:15');
  assert.match(terminTekst('2026-10-20T10:00:00+02:00', TERAZ), /^20 paź 10:00$/);
  assert.equal(terminTekst('2026-10-03T00:00:00+02:00', TERAZ), 'jutro');
  assert.equal(terminTekst('nie-data', TERAZ), '');
});
await t('kontekst i wartość karty: zakres, szkic, jednoznaczna kwota', () => {
  assert.equal(kontekstKarty(karta({ produkty: ['okresowa', 'trwala'] })), 'Okresowa niezdolność + Trwała niezdolność');
  assert.equal(kontekstKarty(karta({ produkty: [] })), 'Zakres ochrony nieokreślony');
  assert.equal(kontekstKarty(karta({ rodzaj: 'szkic', krok_nr: 2 })), 'Niedokończony wniosek — zaliczono krok 2 z 5');
  // Polska norma: czterocyfrowe liczby bez separatora tysięcy, od pięciu cyfr ze spacją.
  assert.equal(wartoscKarty(karta({ wartosc: 8000.5 })), 'Świadczenie 8000,5 zł / mies.');
  assert.equal(wartoscKarty(karta({ wartosc: 12000 })).replace(/\s/g, ' '), 'Świadczenie 12 000 zł / mies.');
  assert.equal(wartoscKarty(karta({ wartosc: null })), null);
});

// ── Filtr po stronie klienta (K13) ───────────────────────────────────────────
await t('pasujeDoFiltra: opiekun ja / brak / uuid', () => {
  assert.equal(pasujeDoFiltra(karta(), { opiekun: 'ja' }, 'u1'), true);
  assert.equal(pasujeDoFiltra(karta({ opiekun_id: 'u2' }), { opiekun: 'ja' }, 'u1'), false);
  assert.equal(pasujeDoFiltra(karta({ opiekun_id: null }), { opiekun: 'brak' }, 'u1'), true);
  assert.equal(pasujeDoFiltra(karta(), { opiekun: 'brak' }, 'u1'), false);
  assert.equal(pasujeDoFiltra(karta({ opiekun_id: 'u2' }), { opiekun: 'u2' }, 'u1'), true);
});
await t('pasujeDoFiltra: produkt, źródło, termin', () => {
  assert.equal(pasujeDoFiltra(karta({ produkty: [] }), { produkt: 'nieznany' }, 'u1'), true);
  assert.equal(pasujeDoFiltra(karta(), { produkt: 'nieznany' }, 'u1'), false);
  assert.equal(pasujeDoFiltra(karta(), { produkt: 'trwala' }, 'u1'), false);
  assert.equal(pasujeDoFiltra(karta(), { zrodlo: 'direct' }, 'u1'), false);
  const z = (typ, termin) => karta({ dzialanie: { typ, termin } });
  assert.equal(pasujeDoFiltra(z('telefon', dni(-1)), { termin: 'przeterminowane' }, 'u1', TERAZ), true);
  assert.equal(pasujeDoFiltra(z('telefon', dni(1)), { termin: 'przeterminowane' }, 'u1', TERAZ), false);
  assert.equal(pasujeDoFiltra(karta(), { termin: 'przeterminowane' }, 'u1', TERAZ), false, 'bez działania nie jest przeterminowane');
  assert.equal(pasujeDoFiltra(karta(), { termin: 'brak' }, 'u1', TERAZ), true);
  assert.equal(pasujeDoFiltra(z('telefon', '2026-10-02T23:00:00+02:00'), { termin: 'dzisiaj' }, 'u1', TERAZ), true);
  assert.equal(pasujeDoFiltra(z('telefon', dni(3)), { termin: 'tydzien' }, 'u1', TERAZ), true);
  assert.equal(pasujeDoFiltra(z('telefon', dni(9)), { termin: 'tydzien' }, 'u1', TERAZ), false);
});
await t('pasujeDoFiltra: wyszukiwanie tekstowe nie wyrzuca karty (e-maila nie znamy)', () => {
  assert.equal(pasujeDoFiltra(karta(), { q: 'cokolwiek@x.pl' }, 'u1'), true);
});
await t('opisFiltra: czytelny opis powodu zniknięcia', () => {
  assert.equal(opisFiltra({ opiekun: 'ja', termin: 'dzisiaj' }, plan()), 'opiekun: ja, działanie: Dziś');
  assert.equal(opisFiltra({ opiekun: 'u2' }, plan()), 'opiekun: Olek');
});

// ── Sortowanie optymistyczne = kolejność z SQL ───────────────────────────────
await t('komparator: działanie (najbliższe pierwsze, bez terminu na końcu), id jako remis', () => {
  const k = (id, termin) => karta({ id, dzialanie: termin ? { typ: 'inne', termin } : null });
  const lista = [k('c', null), k('b', dni(2)), k('a', dni(1)), k('d', null)].sort(porownajKarty('dzialanie'));
  assert.deepEqual(lista.map((x) => x.id), ['a', 'b', 'c', 'd']);
});
await t('komparator: wartość malejąco z pustymi na końcu; data malejąco', () => {
  const w = [karta({ id: 'a', wartosc: null }), karta({ id: 'b', wartosc: 5 }), karta({ id: 'c', wartosc: 9 })].sort(porownajKarty('wartosc'));
  assert.deepEqual(w.map((x) => x.id), ['c', 'b', 'a']);
  const d = [karta({ id: 'a', zgloszono: dni(-5) }), karta({ id: 'b', zgloszono: dni(-1) })].sort(porownajKarty('data'));
  assert.deepEqual(d.map((x) => x.id), ['b', 'a']);
});
await t('indeksWstawienia: karta trafia tam, gdzie postawiłby ją SQL', () => {
  const lista = [karta({ id: 'a', wartosc: 9 }), karta({ id: 'b', wartosc: 5 }), karta({ id: 'c', wartosc: null })];
  assert.equal(indeksWstawienia(lista, karta({ id: 'x', wartosc: 7 }), 'wartosc'), 1);
  assert.equal(indeksWstawienia(lista, karta({ id: 'x', wartosc: 100 }), 'wartosc'), 0);
  assert.equal(indeksWstawienia(lista, karta({ id: 'x', wartosc: null }), 'wartosc'), 3);
});

// ── Przeniesienie, uprawnienia, menu ─────────────────────────────────────────
await t('czyMoznaPrzeniesc: ten sam etap i zapis w toku są zablokowane z powodem', () => {
  assert.equal(czyMoznaPrzeniesc(karta(), PRZEGRANY).ok, true);
  const ten = czyMoznaPrzeniesc(karta(), OTWARTY);
  assert.equal(ten.ok, false);
  assert.match(ten.powod, /już w etapie „Nowy"/);
  assert.equal(czyMoznaPrzeniesc(karta(), PRZEGRANY, { zapisWToku: true }).ok, false);
});
await t('wymagaPowodu: tylko etap z polem powod_utraty', () => {
  assert.equal(wymagaPowodu(PRZEGRANY), true);
  assert.equal(wymagaPowodu(OTWARTY), false);
  assert.equal(wymagaPowodu(undefined), false);
});
await t('opiekun: agent — wolny i własny tak, cudzy nie (z powodem); administrator zawsze', () => {
  assert.equal(mozeZmienicOpiekuna(plan(), karta({ opiekun_id: null })).ok, true);
  assert.equal(mozeZmienicOpiekuna(plan(), karta({ opiekun_id: 'u1' })).ok, true);
  const cudzy = mozeZmienicOpiekuna(plan(), karta({ opiekun_id: 'u2', opiekun_nazwa: 'Olek' }));
  assert.equal(cudzy.ok, false);
  assert.match(cudzy.powod, /Olek.*administrator/);
  assert.equal(mozeZmienicOpiekuna(plan('admin'), karta({ opiekun_id: 'u2' })).ok, true);
});
await t('opcjeOpiekuna: administrator widzi wszystkich, agent tylko siebie i „bez opiekuna" (gdy to własny)', () => {
  assert.deepEqual(opcjeOpiekuna(plan('admin'), karta()).map((o) => o.nazwa), ['Bez opiekuna', 'Ula (ja)', 'Olek']);
  assert.deepEqual(opcjeOpiekuna(plan(), karta({ opiekun_id: null })).map((o) => o.nazwa), ['Ula (ja)']);
  assert.deepEqual(opcjeOpiekuna(plan(), karta({ opiekun_id: 'u1' })).map((o) => o.nazwa), ['Bez opiekuna', 'Ula (ja)']);
});
await t('akcjeLeada: komplet pozycji, telefon tylko gdy jest, zablokowane z przyczyną', () => {
  const a = akcjeLeada({ karta: karta(), etap: OTWARTY, plan: plan() });
  assert.deepEqual(a.map((x) => x.id), ['otworz', 'przenies', 'dzialanie', 'notatka', 'opiekun', 'zadzwon', 'link', 'archiwizuj']);
  assert.ok(a.every((x) => !x.zablokowana));
  assert.equal(a.find((x) => x.id === 'zadzwon').href, 'tel:500100200');
  assert.ok(!akcjeLeada({ karta: karta({ telefon: null }), etap: OTWARTY, plan: plan() }).some((x) => x.id === 'zadzwon'));
  const cudzy = akcjeLeada({ karta: karta({ opiekun_id: 'u2', opiekun_nazwa: 'Olek' }), etap: OTWARTY, plan: plan() });
  assert.match(cudzy.find((x) => x.id === 'opiekun').zablokowana, /administrator/);
  const zamkniety = akcjeLeada({ karta: karta(), etap: PRZEGRANY, plan: plan() });
  assert.match(zamkniety.find((x) => x.id === 'dzialanie').zablokowana, /zamknięta/);
});
await t('akcjeLeada: zapis w toku blokuje zmiany, ale nie podgląd, notatkę ani link', () => {
  const a = akcjeLeada({ karta: karta(), etap: OTWARTY, plan: plan(), zapisWToku: true });
  const zablokowane = a.filter((x) => x.zablokowana).map((x) => x.id);
  assert.deepEqual(zablokowane.sort(), ['archiwizuj', 'dzialanie', 'opiekun', 'przenies']);
});
await t('akcjeLeada: nie ma pozycji „Usuń" ani „Duplikuj" (poza MVP)', () => {
  const tekst = akcjeLeada({ karta: karta(), etap: OTWARTY, plan: plan() }).map((x) => x.etykieta).join('|');
  assert.ok(!/usuń|duplik/i.test(tekst));
});
await t('akcjeEtapu: zwiń/rozwiń, sortowanie; „dodaj" tylko na pierwszym; brak „Usuń etap"', () => {
  assert.deepEqual(akcjeEtapu({ etap: OTWARTY, zwiniety: false, pierwszy: true }).map((x) => x.id), ['dodaj', 'zwin', 'sortowanie']);
  const z = akcjeEtapu({ etap: OTWARTY, zwiniety: true, pierwszy: false });
  assert.deepEqual(z.map((x) => x.id), ['rozwin', 'sortowanie']);
  assert.ok(z.find((x) => x.id === 'sortowanie').zablokowana);
  assert.ok(!akcjeEtapu({ etap: OTWARTY, zwiniety: false, pierwszy: true }).some((x) => /usuń|przenieś wszystkie/i.test(x.etykieta)));
});
await t('zSeparatorami: separator między grupami, nie na brzegach', () => {
  const w = zSeparatorami(akcjeLeada({ karta: karta(), etap: OTWARTY, plan: plan() }));
  assert.ok(!w[0].separator && !w.at(-1).separator);
  assert.ok(w.some((x) => x.separator));
  assert.ok(!w.some((x, i) => x.separator && w[i + 1]?.separator));
});

// ═══ Klient API: idempotencja, ponawianie, niejednoznaczny wynik ═════════════
const odp = (status, body) => ({ status, json: async () => body });
const bezOczekiwania = () => Promise.resolve();

await t('api: POST niesie JSON, ten sam klucz przy ponowieniu po zerwaniu sieci', async () => {
  const wywolania = [];
  let n = 0;
  const api = utworzApi({
    fetch: async (url, opcje) => {
      wywolania.push({ url, opcje });
      if (++n < 3) throw new TypeError('Failed to fetch');
      return odp(200, { status: 'ok', lead: { id: 'a', wersja: 2 } });
    },
    czekaj: bezOczekiwania,
  });
  const r = await api.zmien({ leadId: 'a', targetStageId: 'e2', expectedVersion: 1, idempotencyKey: 'klucz-1-aaaa' });
  assert.equal(r.status, 200);
  assert.equal(wywolania.length, 3);
  assert.equal(new Set(wywolania.map((w) => JSON.parse(w.opcje.body).idempotencyKey)).size, 1, 'jeden klucz we wszystkich próbach');
  assert.equal(wywolania[0].opcje.headers['content-type'], 'application/json');
  assert.equal(wywolania[0].opcje.method, 'POST');
});
await t('api: po wyczerpaniu prób rzuca BladSieci (stan niejednoznaczny), nie „błąd zapisu"', async () => {
  const api = utworzApi({ fetch: async () => { throw new TypeError('Failed to fetch'); }, czekaj: bezOczekiwania, proby: 3 });
  await assert.rejects(api.zmien({ leadId: 'a' }), (e) => e instanceof BladSieci && e.proby === 3);
});
await t('api: 502/503/504 z ponow → ponawiane; 409/403/422 NIE są ponawiane', async () => {
  let n = 0;
  const api502 = utworzApi({ fetch: async () => (++n < 2 ? odp(502, { status: 'blad', ponow: true }) : odp(200, { status: 'ok' })), czekaj: bezOczekiwania });
  assert.equal((await api502.zmien({ x: 1 })).status, 200);
  assert.equal(n, 2);
  for (const status of [409, 403, 422, 400, 404]) {
    let m = 0;
    const api = utworzApi({ fetch: async () => { m++; return odp(status, { status: 'konflikt' }); }, czekaj: bezOczekiwania });
    const r = await api.zmien({ x: 1 });
    assert.equal(r.status, status);
    assert.equal(m, 1, `${status} nie ponawiamy`);
  }
});
await t('api: odpowiedź nie-JSON (np. strona błędu proxy) → traktowana jak błąd sieci', async () => {
  const api = utworzApi({ fetch: async () => ({ status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }), czekaj: bezOczekiwania, proby: 2 });
  await assert.rejects(api.zmien({}), (e) => e instanceof BladSieci);
});
await t('api: 401 oznaczone jako utrata sesji', async () => {
  const api = utworzApi({ fetch: async () => odp(401, { status: 'blad', sesja: true }), czekaj: bezOczekiwania });
  assert.equal((await api.zmien({})).status, 401);
});
await t('api: GET z filtrem i anulowaniem (AbortSignal przekazany do fetch)', async () => {
  let url; let sygnal;
  const api = utworzApi({ fetch: async (u, o) => { url = u; sygnal = o.signal; return odp(200, { status: 'ok', karty: [], razem: 0 }); }, czekaj: bezOczekiwania });
  const ac = new AbortController();
  await api.kolumna({ etap: 'e1', filtr: { q: 'a b', opiekun: 'ja' }, sort: 'data', offset: 25, pipeline: 'p1' }, ac.signal);
  assert.match(url, /^\/panel\/leady\/api\/kolumna\?/);
  const u = new URL(url, 'http://x');
  assert.equal(u.searchParams.get('etap'), 'e1');
  assert.equal(u.searchParams.get('q'), 'a b');
  assert.equal(u.searchParams.get('opiekun'), 'ja');
  assert.equal(u.searchParams.get('sort'), 'data');
  assert.equal(u.searchParams.get('offset'), '25');
  assert.equal(u.searchParams.get('pipeline'), 'p1');
  assert.equal(sygnal, ac.signal);
});
await t('api: GET anulowany przez AbortController nie jest ponawiany', async () => {
  let n = 0;
  const api = utworzApi({ fetch: async () => { n++; const e = new Error('abort'); e.name = 'AbortError'; throw e; }, czekaj: bezOczekiwania });
  await assert.rejects(api.kolumna({ etap: 'e1', filtr: {}, sort: 'data' }, new AbortController().signal), (e) => e.name === 'AbortError');
  assert.equal(n, 1);
});
await t('api: nazwy ścieżek — baza konfigurowalna, pozostałe operacje', async () => {
  const urle = [];
  const api = utworzApi({ baza: '/x/api', fetch: async (u) => { urle.push(u); return odp(200, { status: 'ok' }); }, czekaj: bezOczekiwania });
  await api.notatka({}); await api.zwin({}); await api.lead('abc'); await api.liczniki({ filtr: {}, sort: 'data' });
  assert.deepEqual(urle.map((u) => u.split('?')[0]), ['/x/api/notatka', '/x/api/zwin', '/x/api/lead/abc', '/x/api/liczniki']);
});

for (const b of bledy) console.log(b);
console.log(`\nModel i API klienta: ${pass} PASS, ${bledy.length} FAIL`);
process.exit(bledy.length === 0 ? 0 : 1);
