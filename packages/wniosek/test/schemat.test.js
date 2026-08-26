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
