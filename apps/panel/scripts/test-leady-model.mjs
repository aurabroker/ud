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
import { stawkaZFormularza } from '../src/lib/prowizja.js';
import { danePolisyZFormularza, dataPL, dataSprzedazyZOchrony, doCsv, dzienPL, pasujeStatus, pasujeSzukanie, przesunDzien, rokOchrony, sortuj, statusPolisy, sumy } from '../src/lib/polisy/model.js';
import { adresFiltra } from '../src/lib/statystyki/filtr.js';
import { dataZPolisy, daneZPolisy, numerZNazwy } from '../src/lib/pdf/polisa.js';
import { akcjaKlienta } from '../src/lib/klienci/akcja.js';
import { coOdczytano, polisaZDokumentu } from '../src/lib/server/leady.js';

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
await t('dane sprzedaży z formularza: kwoty jak w SQL, puste i zero pomija (brak ryzyka), śmieci zgłasza', () => {
  const { sprzedaz, bledne } = daneSprzedazyZFormularza(
    { skladka_roczna: '3 036,50 zł', skladka_mies: '', swiadczenie_okresowa: '10000', swiadczenie_trwala: 'abc', swiadczenie_zgon: '0' }, 'w-1');
  assert.deepEqual(sprzedaz, { skladka_roczna: 3036.5, swiadczenie_okresowa: 10000, wariant_id: 'w-1' });
  assert.deepEqual(bledne, ['swiadczenie_trwala']);
  // Sama okresowa niezdolność: zera w trwałej i zgonie nie są błędem (zgłoszenie z 02.10.2026).
  const okresowa = daneSprzedazyZFormularza(
    { skladka_roczna: '1500', skladka_mies: '0', swiadczenie_okresowa: '4000', swiadczenie_trwala: '0', swiadczenie_zgon: '0,00 zł' });
  assert.deepEqual(okresowa, { sprzedaz: { skladka_roczna: 1500, swiadczenie_okresowa: 4000 }, bledne: [] });
  // Zero w składce rocznej to brak składki — okno i SQL żądają jej osobno.
  assert.deepEqual(daneSprzedazyZFormularza({ skladka_roczna: '0' }).sprzedaz, {});
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
await t('opiekun: przydziela wyłącznie administrator — agent nie przejmuje ani nie zwalnia (z powodem)', () => {
  for (const opiekun_id of [null, 'u1', 'u2']) {
    const r = mozeZmienicOpiekuna(plan(), karta({ opiekun_id }));
    assert.equal(r.ok, false);
    assert.match(r.powod, /administrator/);
  }
  assert.equal(mozeZmienicOpiekuna(plan('admin'), karta({ opiekun_id: 'u2' })).ok, true);
});
await t('opcjeOpiekuna: administrator widzi wszystkich, agent nic', () => {
  assert.deepEqual(opcjeOpiekuna(plan('admin'), karta()).map((o) => o.nazwa), ['Bez opiekuna', 'Ula (ja)', 'Olek']);
  assert.deepEqual(opcjeOpiekuna(plan(), karta({ opiekun_id: 'u1' })), []);
});
await t('akcjeLeada: komplet pozycji, telefon tylko gdy jest, zablokowane z przyczyną', () => {
  const a = akcjeLeada({ karta: karta(), etap: OTWARTY, plan: plan('admin') });
  assert.deepEqual(a.map((x) => x.id), ['otworz', 'przenies', 'dzialanie', 'notatka', 'opiekun', 'zadzwon', 'link', 'archiwizuj']);
  assert.ok(a.every((x) => !x.zablokowana));
  assert.equal(a.find((x) => x.id === 'zadzwon').href, 'tel:500100200');
  assert.ok(!akcjeLeada({ karta: karta({ telefon: null }), etap: OTWARTY, plan: plan() }).some((x) => x.id === 'zadzwon'));
  // Agent: zmiana opiekuna widoczna, ale zablokowana z przyczyną (nawet na własnym leadzie).
  const agent = akcjeLeada({ karta: karta({ opiekun_id: 'u1' }), etap: OTWARTY, plan: plan() });
  assert.match(agent.find((x) => x.id === 'opiekun').zablokowana, /administrator/);
  assert.ok(agent.filter((x) => x.id !== 'opiekun').every((x) => !x.zablokowana));
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
await t('api: polisa — sam plik jako application/pdf, nazwa w nagłówku, JEDNA próba (bez ponawiania)', async () => {
  const wywolania = [];
  const plik = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  plik.name = 'Polisa żółw.pdf';
  const api = utworzApi({ fetch: async (url, opcje) => { wywolania.push({ url, opcje }); return odp(200, { status: 'ok' }); }, czekaj: bezOczekiwania });
  await api.polisa('lead-1', plik);
  assert.equal(wywolania[0].url, '/panel/leady/api/polisa/lead-1');
  assert.equal(wywolania[0].opcje.headers['content-type'], 'application/pdf');
  assert.equal(decodeURIComponent(wywolania[0].opcje.headers['x-nazwa-pliku']), 'Polisa żółw.pdf');
  assert.equal(wywolania[0].opcje.body, plik);
  let n = 0;
  const zerwane = utworzApi({ fetch: async () => { n++; throw new TypeError('Failed to fetch'); }, czekaj: bezOczekiwania, proby: 3 });
  await assert.rejects(() => zerwane.polisa('lead-1', plik), BladSieci);
  assert.equal(n, 1, 'wgranie pliku nie jest idempotentne — bez ponowienia');
  n = 0;
  const blad502 = utworzApi({ fetch: async () => { n++; return odp(502, { status: 'blad', ponow: true }); }, czekaj: bezOczekiwania });
  assert.equal((await blad502.polisa('lead-1', plik)).status, 502);
  assert.equal(n, 1);
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

await t('stawka prowizji z formularza: procent 0–100, przecinek albo kropka, pusto = nieustawiona', () => {
  assert.equal(stawkaZFormularza('20'), 20);
  assert.equal(stawkaZFormularza(' 12,5 % '), 12.5);
  assert.equal(stawkaZFormularza('0'), 0);
  assert.equal(stawkaZFormularza('100'), 100);
  assert.equal(stawkaZFormularza(''), null);
  assert.equal(stawkaZFormularza(null), null);
  for (const zle of ['100,01', '-5', 'abc', '20,555', '1e2', '1000']) assert.equal(stawkaZFormularza(zle), undefined, zle);
});

await t('API klienta: ponowny odczyt polisy leada — POST JSON pod …/polisa/<id>/odczyt', async () => {
  const wolane = [];
  const api = utworzApi({ baza: '/x/api', fetch: async (u, o) => { wolane.push([u, o.method, o.headers['content-type'], o.body]); return odp(200, { status: 'ok' }); }, czekaj: bezOczekiwania });
  await api.odczytPolisy('l 1', 'p1');
  assert.deepEqual(wolane, [['/x/api/polisa/l%201/odczyt', 'POST', 'application/json', JSON.stringify({ plikId: 'p1' })]]);
});

// ── Wykaz polis (część 6) ────────────────────────────────────────────────────
await t('polisy: status na dzień — bez dat, wygasła, przyszła, wygasa (≤ 30 dni), aktywna', () => {
  const dzis = '2026-10-05';
  assert.equal(statusPolisy({ ochrona_od: '2026-01-01' }, dzis).id, 'bez_dat');
  assert.equal(statusPolisy({ ochrona_od: '2025-01-01', ochrona_do: '2026-10-04' }, dzis).id, 'wygasla');
  assert.deepEqual(statusPolisy({ ochrona_od: '2026-11-01', ochrona_do: '2027-10-31' }, dzis), { id: 'przyszla', etykieta: 'Od 01.11.2026' });
  assert.equal(statusPolisy({ ochrona_do: '2026-10-05' }, dzis).etykieta, 'Wygasa dziś');
  assert.equal(statusPolisy({ ochrona_do: '2026-10-06' }, dzis).etykieta, 'Wygasa jutro');
  assert.deepEqual(statusPolisy({ ochrona_do: '2026-11-04' }, dzis), { id: 'wygasa', etykieta: 'Wygasa za 30 dni', dni: 30 });
  assert.equal(statusPolisy({ ochrona_do: '2026-11-05' }, dzis).id, 'aktywna');
  // Chipy: „Aktywne" obejmuje też wygasające i przyszłe.
  assert.ok(pasujeStatus({ id: 'wygasa' }, 'aktywne') && pasujeStatus({ id: 'przyszla' }, 'aktywne') && !pasujeStatus({ id: 'wygasla' }, 'aktywne'));
  assert.ok(pasujeStatus({ id: 'bez_dat' }, 'wszystkie') && !pasujeStatus({ id: 'aktywna' }, 'bez_dat'));
});

await t('polisy: rok ochrony (do = od + rok − 1 dzień; 29 lutego → 28 lutego); daty po polsku', () => {
  assert.equal(rokOchrony('2026-10-05'), '2027-10-04');
  assert.equal(rokOchrony('2026-01-01'), '2026-12-31');
  assert.equal(rokOchrony('2028-02-29'), '2029-02-28');
  assert.equal(rokOchrony('2028-03-01'), '2029-02-28');
  assert.equal(rokOchrony(''), null);
  assert.equal(dataPL('2026-10-05'), '05.10.2026');
  assert.equal(dataPL(null), '—');
  assert.equal(dzienPL('2026-03-31T23:30:00Z'), '2026-04-01', 'data sprzedaży w czasie polskim');
});

await t('polisy: pola z formularza — numer przycięty, daty YYYY-MM-DD, koniec nie przed początkiem', () => {
  assert.deepEqual(danePolisyZFormularza({ numer: '  LHP  1/2026 ', od: '2026-10-01', do: '2027-09-30' }),
    { polisa: { polisa_numer: 'LHP 1/2026', ochrona_od: '2026-10-01', ochrona_do: '2027-09-30' }, bledy: {} });
  assert.deepEqual(danePolisyZFormularza({}), { polisa: {}, bledy: {} });
  assert.ok(danePolisyZFormularza({ od: '2026-10-01', do: '2026-09-30' }).bledy.ochrona_do);
  assert.ok(danePolisyZFormularza({ od: '2026-02-31' }).bledy.ochrona_od, 'dzień, którego nie ma');
  assert.ok(danePolisyZFormularza({ numer: 'X'.repeat(61) }).bledy.polisa_numer);
});

await t('polisy: sumy, szukanie bez ogonków, sortowanie po końcu ochrony (bez dat na końcu)', () => {
  const lista = [
    { lead_id: 'a', klient: 'Łucja Żak', numer: 'P-1', ochrona_do: '2027-01-01', skladka_mies: 100, skladka_roczna: 1200, prowizja: 240, sprzedano: '2026-09-01' },
    { lead_id: 'b', klient: 'Adam Nowak', numer: null, ochrona_do: null, skladka_mies: 50.5, skladka_roczna: 606, prowizja: null, mies_wyliczona: true, sprzedano: '2026-10-01' },
    { lead_id: 'c', klient: 'Ewa Bąk', numer: 'X-9', ochrona_do: '2026-11-01', skladka_mies: null, skladka_roczna: null, prowizja: null, sprzedano: '2026-08-01' },
  ];
  assert.deepEqual(sumy(lista), { liczba: 3, mies: 150.5, roczna: 1806, prowizja: 240, wyliczonych: 1 });
  assert.ok(pasujeSzukanie(lista[0], 'lucja zak') && pasujeSzukanie(lista[2], 'x-9') && !pasujeSzukanie(lista[1], 'p-1'));
  assert.deepEqual(sortuj(lista, 'ochrona_do').map((p) => p.lead_id), ['c', 'a', 'b']);
  assert.deepEqual(sortuj(lista).map((p) => p.lead_id), ['b', 'a', 'c'], 'domyślnie: najnowsza sprzedaż pierwsza');
  assert.deepEqual(sortuj(lista, 'skladka_mies', 'rosnaco').map((p) => p.lead_id), ['c', 'b', 'a']);
});

await t('polisy: CSV dla Excela — BOM, średnik, przecinek dziesiętny, formuła w nazwie unieszkodliwiona, agent tylko u administratora', () => {
  const lista = [{ lead_id: 'a', klient: '=HYPERLINK("x")', numer: 'P;1', ochrona_od: '2026-10-01', ochrona_do: '2027-09-30',
    sprzedano: '2026-09-30T22:30:00Z', skladka_mies: 230.5, skladka_roczna: 2766, prowizja: 553.2, agent: 'Ula' }];
  const csv = doCsv(lista, { admin: true, dzis: '2026-10-05' });
  assert.ok(csv.startsWith('\ufeffKlient;Numer polisy;Ochrona od;Ochrona do;Status;Data sprzedaży;Składka miesięczna;Składka roczna;Prowizja;Agent\r\n'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")";"P;1";2026-10-01;2027-09-30;Aktywna;2026-10-01;230,5;2766;553,2;Ula`), csv);
  assert.ok(!doCsv(lista, { admin: false, dzis: '2026-10-05' }).includes('Agent'));
});

await t('filtry: adres zostawia drugi filtr; „Cały czas" bez parametru', () => {
  assert.equal(adresFiltra({ okres: 'miesiac', agent: 'A' }, { okres: 'rok' }), '?okres=rok&agent=A');
  assert.equal(adresFiltra({ okres: 'miesiac', agent: 'A' }, { agent: null }), '?okres=miesiac');
  assert.equal(adresFiltra({ okres: 'rok', agent: null }, { okres: 'wszystko' }), '?');
});

await t('data sprzedaży = dzień przed początkiem ochrony (przełom miesiąca, roku, 1 marca w roku przestępnym); zła data → null', () => {
  assert.equal(dataSprzedazyZOchrony('2026-02-05'), '2026-02-04');
  assert.equal(dataSprzedazyZOchrony('2026-04-01'), '2026-03-31');
  assert.equal(dataSprzedazyZOchrony('2026-01-01'), '2025-12-31');
  assert.equal(dataSprzedazyZOchrony('2028-03-01'), '2028-02-29');
  assert.equal(dataSprzedazyZOchrony(''), null);
  assert.equal(dataSprzedazyZOchrony('2026-02-31'), null);
  assert.equal(przesunDzien('2026-09-01', 1), '2026-09-02');
});

await t('Klienci → „Akcja": etap leada po polsku, wygasła polisa, powód rezygnacji, archiwum bez odnośnika', () => {
  const e = (klucz, rodzaj = 'otwarty', nazwa = klucz) => ({ klucz, rodzaj, nazwa });
  const L = { id: 'L1' };
  assert.equal(akcjaKlienta(L, e('nowy'), '2026-10-05').etykieta, 'Do kontaktu');
  assert.equal(akcjaKlienta(L, e('oferta'), '2026-10-05').etykieta, 'Oferta wysłana');
  assert.equal(akcjaKlienta(L, e('decyzja'), '2026-10-05').etykieta, 'Czeka na decyzję klienta');
  const ub = akcjaKlienta({ ...L, ochrona_do: '2027-01-01' }, e('wygrany', 'wygrany'), '2026-10-05');
  assert.deepEqual([ub.etykieta, ub.klasa, ub.link], ['Klient ubezpieczony', 'badge-bought', '/panel/leady?lead=L1']);
  assert.equal(akcjaKlienta({ ...L, ochrona_do: '2026-10-05' }, e('wygrany', 'wygrany'), '2026-10-05').etykieta, 'Klient ubezpieczony', 'ostatni dzień ochrony');
  assert.equal(akcjaKlienta({ ...L, ochrona_do: '2026-10-04' }, e('wygrany', 'wygrany'), '2026-10-05').etykieta, 'Polisa wygasła');
  assert.equal(akcjaKlienta(L, e('wygrany', 'wygrany'), '2026-10-05').etykieta, 'Klient ubezpieczony', 'bez dat — ubezpieczony');
  const rez = akcjaKlienta({ ...L, powod_utraty: 'Za drogo' }, e('przegrany', 'przegrany'), '2026-10-05');
  assert.deepEqual([rez.etykieta, rez.tytul], ['Klient zrezygnował', 'Powód: Za drogo']);
  assert.equal(akcjaKlienta(L, e('inny', 'otwarty', 'Etap własny'), '2026-10-05').etykieta, 'Etap własny');
  const arch = akcjaKlienta({ ...L, zarchiwizowano_at: '2026-10-01' }, e('oferta'), '2026-10-05');
  assert.deepEqual([arch.archiwum, arch.link], [true, null]);
  assert.deepEqual([akcjaKlienta(null, null, '2026-10-05').etykieta, akcjaKlienta(null, null, '2026-10-05').link], ['—', null]);
});

// ── Dane polisy z PDF (src/lib/pdf/polisa.js) ────────────────────────────────
// Fragmenty w układzie prawdziwych polis Leadenhall zmapowanych 05.10.2026
// (tekst z unpdf, dane osobowe zmyślone). Pełnych plików w repozytorium nie ma.
const POLISA_MEDICARE = `Leadenhall Insurance S.A., Coverholder at Polisa LHC3100906 Strona z| 1 3
Polisa nr LHC3100906
Leadenhall Medicare
2. Ubezpieczający Jan Testowy
00-001 Warszawa, Testowa 1
PESEL: 00000000000
4. Okres ubezpieczenia 5 lutego 2026 - 4 lutego 2027
5. Świadczenia - Objęta ubezpieczeniemPozycja A
Śmierć i Inwalidztwo wskutek Nieszczęśliwego wypadku
100 000 zł, z zastrzeżeniem postanowień pozycji 6 poniżej
Składka 3 432 zł
Opłata dystrybucyjna 336 zł
3 768 zł płatne w 12 ratach,Łącznie do zapłaty
pierwsza rata płatna najpóźniej w dniu 4 lutego 2026 na rachunek Leadenhall Insurance S.A.:
314 zł płatne do 4 lutego 2026
Warszawa, 4 lutego 2026`;
const POLISA_BEAUTY = `Polisa nr LHC3040875
Ubezpieczenie specjalistów branży ‘Beauty’ od utraty dochodu
3. Okres ubezpieczenia 28 października 2025 - 27 października 2026
4. Zakres ubezpieczenia Całkowita okresowa niezdolność do pracy w zawodzie Kosmetolog
Świadczenie 7\u00a0000 zł miesięcznie, jednak nie więcej niż 80% przychodu miesięcznego w
rozumieniu warunków LW050/TTD/UNIPRO_01/PL/2
Okres wyczekiwania 14 dni dla nieszczęśliwego wypadku i 21 dni dla choroby`;
// Oferta CEU (prawdziwy układ): okres w miesiącach, numer oferty — z polisy nic.
const OFERTA_CEU = `Oferta nr LOIP/2026/000239 z dnia 13-05-2026 ważna do 29-05-2026
1. Ubezpieczyciel Ochrona ubezpieczeniowa w ramach polisy udzielana jest przez Lloyd's Insurance Company S.A.
5. Okres Ubezpieczenia 12 miesięcy
Warszawa, 13-05-2026`;

await t('polisa PDF: Leadenhall MEDICARE — numer i okres ochrony z pozycji 4', () => {
  assert.deepEqual(daneZPolisy(POLISA_MEDICARE),
    { polisa_numer: 'LHC3100906', ochrona_od: '2026-02-05', ochrona_do: '2027-02-04', swiadczenie_okresowa: null });
});

await t('polisa PDF: Leadenhall „Beauty" — okres w pozycji 3, świadczenie zdaniem „Świadczenie 7 000 zł miesięcznie"', () => {
  assert.deepEqual(daneZPolisy(POLISA_BEAUTY),
    { polisa_numer: 'LHC3040875', ochrona_od: '2025-10-28', ochrona_do: '2026-10-27', swiadczenie_okresowa: 7000 });
});

await t('polisa PDF: oferta to nie polisa — numeru oferty i „12 miesięcy" nie bierzemy', () => {
  assert.deepEqual(daneZPolisy(OFERTA_CEU), { polisa_numer: null, ochrona_od: null, ochrona_do: null, swiadczenie_okresowa: null });
  assert.deepEqual(daneZPolisy(''), { polisa_numer: null, ochrona_od: null, ochrona_do: null, swiadczenie_okresowa: null });
});

await t('polisa PDF: ogólne wzorce — „Numer polisy:", „od … do …", daty z kropkami i myślnikami, przełamanie wiersza', () => {
  assert.deepEqual(daneZPolisy('Numer polisy: LOIP/2026/000301\nOkres ubezpieczenia: od 01.06.2026 r. do 31.05.2027'),
    { polisa_numer: 'LOIP/2026/000301', ochrona_od: '2026-06-01', ochrona_do: '2027-05-31', swiadczenie_okresowa: null });
  assert.equal(daneZPolisy('Okres ochrony od 1-6-2026\ndo 31-05-2027').ochrona_do, '2027-05-31');
  assert.equal(daneZPolisy('Okres ubezpieczenia 1 kwietnia\n2026 - 31 marca 2027').ochrona_od, '2026-04-01');
});

await t('polisa PDF: koniec przed początkiem albo nieistniejąca data — obie daty puste, nie zgadujemy', () => {
  const zle = daneZPolisy('Okres ubezpieczenia 5 lutego 2027 - 4 lutego 2026');
  assert.equal(zle.ochrona_od, null);
  assert.equal(zle.ochrona_do, null);
  assert.equal(daneZPolisy('Okres ubezpieczenia 31.02.2026 - 30.01.2027').ochrona_od, null);
  assert.equal(dataZPolisy('29.02.2028'), '2028-02-29');
  assert.equal(dataZPolisy('29.02.2027'), null);
  assert.equal(dataZPolisy('7 Października 2026'), '2026-10-07');
});

await t('polisa PDF: numer awaryjnie z nazwy pliku (tylko LHC…), w treści — pierwszeństwo', () => {
  assert.equal(numerZNazwy('Szubka_LHC3100906_8347.pdf'), 'LHC3100906');
  assert.equal(numerZNazwy('BUZA_POLISA_lhc3179897.pdf'), 'LHC3179897');
  assert.equal(numerZNazwy('polisa_000008.pdf'), null);
  assert.equal(numerZNazwy('XLHC3100906.pdf'), null);
  assert.equal(numerZNazwy(undefined), null);
  assert.deepEqual(polisaZDokumentu({ polisa: { polisa_numer: 'LHC1', ochrona_od: null, ochrona_do: null } }, 'X_LHC3100906.pdf'),
    { polisa_numer: 'LHC1', ochrona_od: null, ochrona_do: null });
  assert.deepEqual(polisaZDokumentu(undefined, 'X_LHC3100906.pdf'), { polisa_numer: 'LHC3100906', ochrona_od: null, ochrona_do: null });
  assert.equal(polisaZDokumentu({}, 'polisa.pdf'), null);
  // Jedna data bez drugiej nie przechodzi.
  assert.equal(polisaZDokumentu({ polisa: { ochrona_od: '2026-01-01', ochrona_do: null } }), null);
});

await t('polisa PDF: komunikat mówi, co odczytano', () => {
  assert.equal(coOdczytano({ kwoty: {}, polisa: { polisa_numer: 'L', ochrona_od: 'x' } }), 'Kwoty, numer polisy i okres ochrony odczytane z pliku');
  assert.equal(coOdczytano({ kwoty: {} }), 'Kwoty odczytane z pliku');
  assert.equal(coOdczytano({ kwoty: null, polisa: { polisa_numer: 'L' } }), 'Numer polisy odczytany z pliku');
  assert.equal(coOdczytano({ kwoty: null, polisa: null }), '');
});

for (const b of bledy) console.log(b);
console.log(`\nModel i API klienta: ${pass} PASS, ${bledy.length} FAIL`);
process.exit(bledy.length === 0 ? 0 : 1);
