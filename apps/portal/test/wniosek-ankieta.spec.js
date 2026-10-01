import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HEALTH_SURVEY_ITEMS, HEALTH_SURVEY_THRESHOLD, PYTANIA_MEDYCZNE, POLA_LOGICZNE,
  doWysylki, sprawdzKrok,
} from '@ud/wniosek';

/**
 * Kontrakt między kreatorem a funkcją brzegową `form-submit` — ankieta rozszerzona.
 *
 * Te testy nie wchodzą do przeglądarki. Sprawdzają kształt ładunku, bo to on
 * rozjechał się z funkcją brzegową i nie widać tego w żadnym teście po DOM-ie:
 * kreator renderował dwadzieścia pytań, klient je wypełniał, a funkcja czytała
 * je z pól, których w ładunku nie było, i odrzucała wniosek z poleceniem
 * wypełnienia ankiety, którą klient właśnie wypełnił. Formularz wyglądał
 * na sprawny na każdym ekranie.
 *
 * Kontrakt czytamy z PLIKU funkcji brzegowej, nie z przepisanej tu kopii —
 * kopia rozjechałaby się przy pierwszej zmianie po tamtej stronie i test
 * pilnowałby wtedy własnego wyobrażenia zamiast produkcji.
 */

const ZRODLO_FUNKCJI = readFileSync(
  fileURLToPath(new URL('../../../supabase/functions/form-submit/index.ts', import.meta.url)),
  'utf8',
);

/** Mapa hs_<klucz> → kolumna, odczytana z funkcji brzegowej. */
function kolumnyAnkiety() {
  const blok = ZRODLO_FUNKCJI.match(
    /const HEALTH_SURVEY_COLUMNS: Record<string, string> = \{([\s\S]*?)\};/,
  );
  expect(blok, 'w funkcji brzegowej nie ma HEALTH_SURVEY_COLUMNS — zmienił się kontrakt').toBeTruthy();
  return Object.fromEntries(
    [...blok[1].matchAll(/^\s*(\w+):\s*'(\w+)',/gm)].map((m) => [m[1], m[2]]),
  );
}

/** Stan kreatora z wypełnioną ankietą. `odp` = 'yes' | 'no'. */
function stanKreatora({ suma, odp = 'no', opis = 'szczegóły' } = {}) {
  const dane = {
    permIncapacitySum: suma,
    riskPermIncapacity: true,
    riskTempIncapacity: true,
    tempIncapacitySum: '8000',
  };
  for (const poz of HEALTH_SURVEY_ITEMS) {
    dane[poz.key] = odp;
    dane[`${poz.key}_notes`] = opis;
  }
  return dane;
}

const PONAD_PROGIEM = String(HEALTH_SURVEY_THRESHOLD + 500_000);
const PONIZEJ_PROGU = String(HEALTH_SURVEY_THRESHOLD - 200_000);

test('każda pozycja ankiety wychodzi jako hs_<klucz> z wartością „tak"/„nie"', () => {
  const body = doWysylki(stanKreatora({ suma: PONAD_PROGIEM, odp: 'yes' }));

  for (const poz of HEALTH_SURVEY_ITEMS) {
    expect(body[`hs_${poz.key}`], `brak pola hs_${poz.key} — funkcja brzegowa nie zobaczy tej odpowiedzi`)
      .toBe('tak');
    expect(body[`hsd_${poz.key}`]).toBe('szczegóły');
  }
});

test('bramka funkcji brzegowej przepuszcza ładunek kreatora', () => {
  // Odtworzony warunek z form-submit: powyżej progu i zero kluczy hs_* → 400.
  const body = doWysylki(stanKreatora({ suma: PONAD_PROGIEM, odp: 'no' }));
  const zebrane = Object.keys(body).filter((k) => k.startsWith('hs_'));

  expect(zebrane.length, 'zero kluczy hs_* — funkcja odrzuci wniosek komunikatem '
    + '„wymagana jest pełna ankieta medyczna", choć klient ją wypełnił').toBeGreaterThan(0);
});

test('odpowiedź „tak" dociera do kolumny, którą mapuje funkcja brzegowa', () => {
  const kolumny = kolumnyAnkiety();
  const body = doWysylki(stanKreatora({ suma: PONAD_PROGIEM, odp: 'yes' }));

  // Ta pętla jest kopią pętli nadpisującej z form-submit.
  const zapis = {};
  for (const [klucz, kolumna] of Object.entries(kolumny)) {
    const odp = body[`hs_${klucz}`];
    if (odp === 'tak' || odp === 'nie') zapis[kolumna] = odp === 'tak';
  }

  for (const kolumna of Object.values(kolumny)) {
    expect(zapis[kolumna], `kolumna ${kolumna} nie dostaje odpowiedzi z ankiety`).toBe(true);
  }
  // med_locomotor → med_bones: jedyna pozycja, której klucz różni się od kolumny.
  expect(kolumny.med_locomotor, 'zniknęło mapowanie med_locomotor → med_bones').toBe('med_bones');
});

test('poniżej progu ankieta nie idzie i nic się nie dopowiada za klienta', () => {
  const body = doWysylki({ permIncapacitySum: PONIZEJ_PROGU, riskPermIncapacity: true });

  expect(Object.keys(body).filter((k) => k.startsWith('hs_'))).toHaveLength(0);
  // Kolumny ankiety mają zostać puste — „nie pytaliśmy" to nie to samo co „nie".
  for (const nazwa of ['weightChange', 'takesMeds', 'pendingDiagnosis', 'disabilityCongenital',
                       'eventHospitalization', 'eventSickLeave30', 'eventFurtherDiagnosis']) {
    expect(body[nazwa], `${nazwa} wyszło z ładunku jako „${body[nazwa]}" — to oświadczenie, `
      + 'którego klient nie złożył, bo o to pytanie nie padło').toBeUndefined();
  }
});

test('nazwy camelCase ankiety nie wracają do POLA_LOGICZNE', () => {
  // Stały tam i normalizacja wpisywała im „No". Funkcja czyta
  // `body.weightChange ?? body.weight_change`, a „No" nie jest null — więc
  // prawdziwa odpowiedź nigdy nie była czytana.
  for (const nazwa of ['weightChange', 'takesMeds', 'pendingDiagnosis', 'disabilityCongenital',
                       'smoker', 'eventHospitalization', 'eventSickLeave30', 'eventFurtherDiagnosis']) {
    expect(POLA_LOGICZNE, `${nazwa} wróciło do POLA_LOGICZNE — ładunek znów zagłuszy `
      + 'odpowiedź klienta wartością „No"').not.toContain(nazwa);
  }
});

test('pozycja bez odpowiedzi zatrzymuje wniosek, zamiast wyjść jako „nie"', () => {
  const dane = stanKreatora({ suma: PONAD_PROGIEM, odp: 'no' });
  const pozycja = HEALTH_SURVEY_ITEMS.find((i) => !PYTANIA_MEDYCZNE.some((p) => p.klucz === i.key));
  dane[pozycja.key] = '';

  const bledy = sprawdzKrok('zdrowie', dane);
  expect(bledy[pozycja.key], `brak odpowiedzi na „${pozycja.label}" przeszedł walidację`).toBeTruthy();
});

test('„tak" bez opisu zatrzymuje wniosek', () => {
  const dane = stanKreatora({ suma: PONAD_PROGIEM, odp: 'yes', opis: '' });
  const bledy = sprawdzKrok('zdrowie', dane);

  const pozycja = HEALTH_SURVEY_ITEMS[0];
  expect(bledy[`${pozycja.key}_notes`]).toBeTruthy();
});

test('próg w kreatorze i w funkcji brzegowej to ta sama liczba', () => {
  const m = ZRODLO_FUNKCJI.match(/const HEALTH_SURVEY_THRESHOLD = ([\d_]+);/);
  expect(m, 'w funkcji brzegowej nie ma progu ankiety').toBeTruthy();
  expect(Number(m[1].replace(/_/g, '')), 'progi się rozjechały — kreator pokaże ankietę przy innej '
    + 'sumie, niż funkcja jej zażąda').toBe(HEALTH_SURVEY_THRESHOLD);
});
