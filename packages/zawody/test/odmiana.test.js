/**
 * Testy deklinacji. Formy oczekiwane są sprawdzone ręcznie — to jest jedyna
 * kontrola, jaką ten kod może mieć, bo nie ma dla polskiego darmowego słownika
 * fleksyjnego, który dałoby się dołożyć do buildu bez licencji.
 *
 * Uruchomienie: node --test packages/zawody/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { odmien, odmiana, rodzaj, MESKI, ZENSKI } from '../src/odmiana.js';

/** [nazwa, dopełniacz, narzędnik, mianownik mnogi] */
const PRZYPADKI_WZORCOWE = [
  // Rzeczowniki jednowyrazowe, po typie odmiany.
  ['Lekarz',        'Lekarza',        'Lekarzem',        'Lekarze'],
  ['Adwokat',       'Adwokata',       'Adwokatem',       'Adwokaci'],
  ['Alergolog',     'Alergologa',     'Alergologiem',    'Alergolodzy'],
  ['Chirurg',       'Chirurga',       'Chirurgiem',      'Chirurdzy'],
  ['Elektryk',      'Elektryka',      'Elektrykiem',     'Elektrycy'],
  ['Dyrektor',      'Dyrektora',      'Dyrektorem',      'Dyrektorzy'],
  ['Copywriter',    'Copywritera',    'Copywriterem',    'Copywriterzy'],
  ['Konsultant',    'Konsultanta',    'Konsultantem',    'Konsultanci'],
  ['Nauczyciel',    'Nauczyciela',    'Nauczycielem',    'Nauczyciele'],
  ['Detektyw',      'Detektywa',      'Detektywem',      'Detektywi'],
  ['Fotograf',      'Fotografa',      'Fotografem',      'Fotografowie'],

  // Rodzaj męski, odmiana żeńska.
  ['Programista',   'Programisty',    'Programistą',     'Programiści'],
  ['Wykładowca',    'Wykładowcy',     'Wykładowcą',      'Wykładowcy'],
  ['Logopeda',      'Logopedy',       'Logopedą',        'Logopedzi'],
  ['Pediatra',      'Pediatry',       'Pediatrą',        'Pediatrzy'],
  ['Terapeuta',     'Terapeuty',      'Terapeutą',       'Terapeuci'],
  ['Geodeta',       'Geodety',        'Geodetą',         'Geodeci'],
  ['Ortodonta',     'Ortodonty',      'Ortodontą',       'Ortodonci'],
  ['Cieśla',        'Cieśli',         'Cieślą',          'Cieśle'],

  // „e" ruchome.
  ['Handlowiec',    'Handlowca',      'Handlowcem',      'Handlowcy'],
  ['Naukowiec',     'Naukowca',       'Naukowcem',       'Naukowcy'],

  // Rzeczownik odprzymiotnikowy.
  ['Księgowy',      'Księgowego',     'Księgowym',       'Księgowi'],

  // Nieregularne.
  ['Sędzia',        'Sędziego',       'Sędzią',          'Sędziowie'],

  // Rodzaj żeński.
  ['Pielęgniarka',  'Pielęgniarki',   'Pielęgniarką',    'Pielęgniarki'],
  ['Kosmetyczka',   'Kosmetyczki',    'Kosmetyczką',     'Kosmetyczki'],
  ['Położna',       'Położnej',       'Położną',         'Położne'],

  // Przydawka przymiotna zgadza się z głową.
  ['Agent Celny',           'Agenta Celnego',           'Agentem Celnym',           'Agenci Celni'],
  ['Aplikant Adwokacki',    'Aplikanta Adwokackiego',   'Aplikantem Adwokackim',    'Aplikanci Adwokaccy'],
  ['Strażnik Miejski',      'Strażnika Miejskiego',     'Strażnikiem Miejskim',     'Strażnicy Miejscy'],
  ['Chirurg Szczękowo-Twarzowy', 'Chirurga Szczękowo-Twarzowego',
   'Chirurgiem Szczękowo-Twarzowym', 'Chirurdzy Szczękowo-Twarzowi'],
  ['Pielęgniarka Operacyjna',    'Pielęgniarki Operacyjnej',
   'Pielęgniarką Operacyjną',      'Pielęgniarki Operacyjne'],

  // Przydawka w dopełniaczu stoi w miejscu.
  ['Analityk Danych',       'Analityka Danych',         'Analitykiem Danych',       'Analitycy Danych'],
  ['Architekt Wnętrz',      'Architekta Wnętrz',        'Architektem Wnętrz',       'Architekci Wnętrz'],
  ['Szef Kuchni',           'Szefa Kuchni',             'Szefem Kuchni',            'Szefowie Kuchni'],
  ['Lekarz Medycyny Sądowej','Lekarza Medycyny Sądowej','Lekarzem Medycyny Sądowej','Lekarze Medycyny Sądowej'],
  ['Inspektor Nadzoru Budowlanego', 'Inspektora Nadzoru Budowlanego',
   'Inspektorem Nadzoru Budowlanego', 'Inspektorzy Nadzoru Budowlanego'],

  // Skróty zostają nietknięte.
  ['Architekt IT',          'Architekta IT',            'Architektem IT',           'Architekci IT'],
  ['Animator 3D',           'Animatora 3D',             'Animatorem 3D',            'Animatorzy 3D'],
  ['Specjalista HR',        'Specjalisty HR',           'Specjalistą HR',           'Specjaliści HR'],

  // Głową frazy angielskiej jest ostatni wyraz.
  ['Backend Developer',     'Backend Developera',       'Backend Developerem',      'Backend Developerzy'],
  ['Product Manager',       'Product Managera',         'Product Managerem',        'Product Managerzy'],
  ['Business Analyst',      'Business Analysta',        'Business Analystem',       'Business Analyści'],
  ['Data Scientist',        'Data Scientista',          'Data Scientistem',         'Data Scientiści'],
  ['Cloud Architect',       'Cloud Architecta',         'Cloud Architectem',        'Cloud Architekci'],
  ['Nail Artist',           'Nail Artysty',             'Nail Artystą',             'Nail Artyści'],
  ['UX Designer',           'UX Designera',             'UX Designerem',            'UX Designerzy'],

  // Apozycja — odmieniają się oba człony.
  ['Technik Elektroradiolog','Technika Elektroradiologa',
   'Technikiem Elektroradiologiem', 'Technicy Elektroradiolodzy'],

  // Ukośnik — każdy człon osobno.
  ['Youtuber / Twórca',     'Youtubera / Twórcy',       'Youtuberem / Twórcą',      'Youtuberzy / Twórcy'],
];

test('dopełniacz, narzędnik i mianownik liczby mnogiej', () => {
  for (const [nazwa, dop, narz, mnoga] of PRZYPADKI_WZORCOWE) {
    assert.equal(odmien(nazwa, 'dopelniacz'), dop, `dopełniacz: ${nazwa}`);
    assert.equal(odmien(nazwa, 'narzednik'), narz, `narzędnik: ${nazwa}`);
    assert.equal(odmien(nazwa, 'mnoga'), mnoga, `mnoga: ${nazwa}`);
  }
});

test('mianownik zostaje nietknięty', () => {
  for (const [nazwa] of PRZYPADKI_WZORCOWE) {
    assert.equal(odmien(nazwa, 'mianownik'), nazwa);
  }
});

test('biernik równa się dopełniaczowi dla rzeczowników męskoosobowych', () => {
  for (const nazwa of ['Lekarz', 'Adwokat', 'Agent Celny', 'Backend Developer']) {
    assert.equal(odmien(nazwa, 'biernik'), odmien(nazwa, 'dopelniacz'), nazwa);
  }
});

test('rodzaj gramatyczny', () => {
  assert.equal(rodzaj('Lekarz'), MESKI);
  assert.equal(rodzaj('Programista'), MESKI);
  assert.equal(rodzaj('Pielęgniarka Operacyjna'), ZENSKI);
  assert.equal(rodzaj('Położna'), ZENSKI);
});

test('żadna forma nie jest pusta ani nie gubi wyrazów', () => {
  const zawody = JSON.parse(readFileSync(new URL('../data/zawody.json', import.meta.url), 'utf8'));
  assert.ok(zawody.length > 200, 'oczekiwano pełnego zbioru zawodów');

  for (const z of zawody) {
    const formy = odmiana(z.nazwa);
    const wyrazow = z.nazwa.split(/\s+/).length;
    for (const [klucz, wartosc] of Object.entries(formy)) {
      assert.ok(wartosc && wartosc.trim(), `pusta forma ${klucz} dla „${z.nazwa}"`);
      assert.equal(wartosc.split(/\s+/).length, wyrazow,
        `zmieniona liczba wyrazów w ${klucz} dla „${z.nazwa}": ${wartosc}`);
    }
  }
});

test('migawka: zapisane formy zgadzają się z silnikiem', () => {
  const zawody = JSON.parse(readFileSync(new URL('../data/zawody.json', import.meta.url), 'utf8'));
  const bezOdmiany = zawody.filter((z) => !z.odmiana);
  assert.equal(bezOdmiany.length, 0,
    `zawody bez zapisanej odmiany: ${bezOdmiany.map((z) => z.slug).join(', ')}`);

  for (const z of zawody) {
    assert.deepEqual(z.odmiana, odmiana(z.nazwa),
      `„${z.nazwa}" — zapisana odmiana rozjechała się z silnikiem; ` +
      'przejrzyj propozycję i przegeneruj: node packages/zawody/scripts/generuj.mjs');
  }
});
