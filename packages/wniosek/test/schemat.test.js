/**
 * Testy walidacji wniosku. PESEL-e są wyliczane, nie wpisywane z palca —
 * ręcznie wymyślony numer prawie zawsze ma złą cyfrę kontrolną i test
 * przechodziłby z przypadkowego powodu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pesekPoprawny, dataZPesel, wiekZPesel, telefonPoprawny, emailPoprawny,
  sprawdzKrok, ankietaRozszerzona, doWysylki, HEALTH_SURVEY_THRESHOLD,
  AKTYWNOSCI_RYZYKOWNE, POLA_LOGICZNE,
} from '../src/schemat.js';

/** Dokleja poprawną cyfrę kontrolną do dziesięciu cyfr. */
function zCyfraKontrolna(dziesiec) {
  const wagi = [9, 7, 3, 1, 9, 7, 3, 1, 9, 7];
  const suma = wagi.reduce((a, w, i) => a + w * Number(dziesiec[i]), 0);
  return dziesiec + String(suma % 10);
}

test('PESEL — cyfra kontrolna', () => {
  const dobry = zCyfraKontrolna('9001011234');
  assert.equal(pesekPoprawny(dobry), true, dobry);

  // Podmiana ostatniej cyfry musi unieważnić numer.
  const zly = dobry.slice(0, 10) + String((Number(dobry[10]) + 1) % 10);
  assert.equal(pesekPoprawny(zly), false, zly);

  assert.equal(pesekPoprawny('1234567890'), false, 'za krótki');
  assert.equal(pesekPoprawny('123456789012'), false, 'za długi');
  assert.equal(pesekPoprawny('abcdefghijk'), false, 'litery');
  assert.equal(pesekPoprawny(''), false);
  assert.equal(pesekPoprawny(null), false);
});

test('PESEL — data urodzenia i stulecie', () => {
  // Miesiąc +20 oznacza rok 2000+, bez dodatku — 1900+.
  const rok1990 = zCyfraKontrolna('9001011234');
  const rok2001 = zCyfraKontrolna('0121011234');

  assert.equal(dataZPesel(rok1990).getUTCFullYear(), 1990);
  assert.equal(dataZPesel(rok1990).getUTCMonth(), 0);
  assert.equal(dataZPesel(rok2001).getUTCFullYear(), 2001);
  assert.equal(dataZPesel(rok2001).getUTCMonth(), 0);
});

test('PESEL — wiek liczony na wskazany dzień', () => {
  const p = zCyfraKontrolna('9006151234'); // 15 czerwca 1990
  assert.equal(wiekZPesel(p, new Date(Date.UTC(2026, 5, 14))), 35, 'dzień przed urodzinami');
  assert.equal(wiekZPesel(p, new Date(Date.UTC(2026, 5, 15))), 36, 'w dniu urodzin');
});

test('telefon i e-mail', () => {
  for (const t of ['504400901', '+48504400901', '48 504 400 901', '504-400-901', '(504) 400901']) {
    assert.equal(telefonPoprawny(t), true, t);
  }
  for (const t of ['50440090', '5044009011', 'abc', '']) {
    assert.equal(telefonPoprawny(t), false, t);
  }
  assert.equal(emailPoprawny('biuro@utratadochodu.com'), true);
  assert.equal(emailPoprawny('biuro@utratadochodu'), false);
  assert.equal(emailPoprawny('biuro'), false);
});

test('krok „dane" — wiek poza zakresem ochrony', () => {
  const maloletni = zCyfraKontrolna('1501011234'); // 2015
  const bledy = sprawdzKrok('dane', { fullName: 'Jan Kowalski', profession: 'Lekarz', pesel: maloletni });
  assert.match(bledy.pesel, /18 do 65/);
});

test('krok „zakres" — wymaga ryzyka i kwoty', () => {
  assert.ok(sprawdzKrok('zakres', {}).ryzyka, 'brak ryzyka powinien być błędem');

  const bezKwoty = sprawdzKrok('zakres', { riskTempIncapacity: true });
  assert.ok(bezKwoty.tempIncapacitySum, 'zaznaczone ryzyko bez kwoty powinno być błędem');

  const ok = sprawdzKrok('zakres', { riskTempIncapacity: true, tempIncapacitySum: 12000 });
  assert.deepEqual(ok, {});
});

test('krok „zdrowie" — TAK wymaga opisu', () => {
  assert.ok(sprawdzKrok('zdrowie', { med_heart: 'yes' }).med_heart_notes);
  assert.deepEqual(sprawdzKrok('zdrowie', { med_heart: 'yes', med_heart_notes: 'nadciśnienie' }), {});
  assert.deepEqual(sprawdzKrok('zdrowie', { med_heart: 'no' }), {});
});

test('krok „zgody" — obie zgody obowiązkowe', () => {
  const pelne = {
    email: 'jan@example.com', phone: '504400901',
    exclusions_accepted: true, informedAccepted: true,
  };
  assert.deepEqual(sprawdzKrok('zgody', pelne), {});
  assert.ok(sprawdzKrok('zgody', { ...pelne, exclusions_accepted: false }).exclusions_accepted);
  assert.ok(sprawdzKrok('zgody', { ...pelne, informedAccepted: false }).informedAccepted);
});

test('ankieta rozszerzona włącza się powyżej progu, nie na progu', () => {
  assert.equal(ankietaRozszerzona({ permIncapacitySum: HEALTH_SURVEY_THRESHOLD }), false);
  assert.equal(ankietaRozszerzona({ permIncapacitySum: HEALTH_SURVEY_THRESHOLD + 1 }), true);
  assert.equal(ankietaRozszerzona({ permIncapacitySum: '1 500 000 zł' }), true);
  assert.equal(ankietaRozszerzona({}), false);
});

test('doWysylki zachowuje kontrakt Yes/No starego backendu', () => {
  const out = doWysylki({
    med_heart: 'yes', med_diabetes: 'no',
    riskTempIncapacity: true, riskPermIncapacity: false,
    employsPeople: true, emp_contribution_slider: 60,
    fullName: 'Jan Kowalski',
  });
  assert.equal(out.med_heart, 'Yes');
  assert.equal(out.med_diabetes, 'No');
  assert.equal(out.riskTempIncapacity, 'Yes');
  assert.equal(out.riskPermIncapacity, 'No');
  assert.equal(out.emp_contribution, '60%');
  assert.equal(out.fullName, 'Jan Kowalski', 'pola nielogiczne przechodzą bez zmian');
  // Pole logiczne, którego użytkownik nie dotknął, musi wyjść jako „No", nie undefined.
  assert.equal(out.smoker, 'No');
});

test('klauzule dodatkowe otwierają się powyżej progu, nie na progu', async () => {
  const { klauzuleDostepne, PROG_KLAUZUL_NW } = await import('../src/schemat.js');

  assert.equal(klauzuleDostepne({ nwDeathSum: 500_000 }), false,
    'bez zaznaczonego ryzyka śmierci i inwalidztwa klauzule są bezprzedmiotowe');
  assert.equal(klauzuleDostepne({ riskDeathInvalidity: true, nwDeathSum: PROG_KLAUZUL_NW }), false,
    'na progu jeszcze nie');
  assert.equal(klauzuleDostepne({ riskDeathInvalidity: true, nwDeathSum: PROG_KLAUZUL_NW + 1 }), true);
  assert.equal(klauzuleDostepne({ riskDeathInvalidity: true, nwDeathSum: '500 000 zł' }), true,
    'kwota z formatowaniem też musi się parsować');
  assert.equal(klauzuleDostepne({}), false);
});

test('klauzule poniżej progu nie idą do wysyłki', async () => {
  const { doWysylki } = await import('../src/schemat.js');

  const ponizej = doWysylki({
    riskDeathInvalidity: true, nwDeathSum: 200_000,
    nwFuneral: 10_000, nwHospitalDaily: 300, nwAdaptation: 50_000,
  });
  assert.equal(ponizej.nwFuneral, 0);
  assert.equal(ponizej.nwHospitalDaily, 0);
  assert.equal(ponizej.nwAdaptation, 0);

  const powyzej = doWysylki({
    riskDeathInvalidity: true, nwDeathSum: 400_000,
    nwFuneral: 10_000, nwHospitalDaily: 300,
  });
  assert.equal(powyzej.nwFuneral, 10_000, 'powyżej progu wybór zostaje');
  assert.equal(powyzej.nwHospitalDaily, 300);
});

test('lista aktywności pokrywa się z kolumnami risk_* w ud_clients', () => {
  /**
   * Kolumny odczytane z bazy 2026-08-28. Formularz pokazywał osiem z piętnastu,
   * więc underwriter dostawał puste pole tam, gdzie klient mógł mieć „tak".
   * Ten test nie sprawdza bazy na żywo — jest zapisem tego, co w niej jest,
   * żeby rozjazd wyszedł przy zmianie schematu, a nie przy odmowie wypłaty.
   */
  const wBazie = [
    'risk_aviation', 'risk_balloon', 'risk_caving', 'risk_climbing', 'risk_diving',
    'risk_extreme_bike_boat', 'risk_gravity_bike', 'risk_horse', 'risk_horse_jumping',
    'risk_hunting', 'risk_paragliding', 'risk_quad', 'risk_sailing', 'risk_skiing',
    'risk_skydiving',
  ];
  const wFormularzu = AKTYWNOSCI_RYZYKOWNE.map((a) => a.klucz).sort();

  assert.deepEqual(wFormularzu, [...wBazie].sort(),
    'formularz i tabela ud_clients wymieniają inne aktywności');
});

test('każda aktywność ma etykietę i trafia do wysyłki', () => {
  for (const a of AKTYWNOSCI_RYZYKOWNE) {
    assert.ok(a.etykieta && a.etykieta.length > 3, `${a.klucz} bez etykiety`);
    assert.ok(POLA_LOGICZNE.includes(a.klucz), `${a.klucz} nie trafia do doWysylki`);
  }
  const wyslane = doWysylki({ risk_skydiving: true, risk_quad: false });
  assert.equal(wyslane.risk_skydiving, 'Yes');
  assert.equal(wyslane.risk_quad, 'No');
});
