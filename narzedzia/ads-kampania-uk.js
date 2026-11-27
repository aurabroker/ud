/**
 * ads-kampania-uk.js — zakłada kampanię w wyszukiwarce dla wersji ukraińskiej (/uk/).
 *
 * Kampania powstaje WSTRZYMANA. Skrypt niczego nie włącza, nie rusza żadnej
 * istniejącej kampanii i drugi raz tej samej nie założy.
 *
 * Gdzie wkleić:
 *   Google Ads → Narzędzia → Działania zbiorcze → Skrypty → „+" →
 *   wklej całość → Autoryzuj → „Podgląd" → czytaj Dziennik.
 *   „Podgląd" niczego nie tworzy: Google tylko sprawdza operacje. Dopiero
 *   „Uruchom" zakłada kampanię — wstrzymaną. Potem obejrzyj reklamy i frazy
 *   w koncie i włącz ją ręcznie.
 *
 * WAŻNE: uruchom w koncie reklamowym, nie w koncie menedżerskim (MCC).
 *
 * Co powstaje:
 *   - budżet dzienny i kampania „tylko wyszukiwarka Google" (bez partnerów
 *     i sieci reklamowej), dla osób PRZEBYWAJĄCYCH w Polsce,
 *   - strategia „Maksymalizacja liczby kliknięć" z górną granicą stawki,
 *   - dwie grupy reklam, w każdej jedna elastyczna reklama po ukraińsku
 *     i frazy w dopasowaniu do wyrażenia,
 *   - słowa wykluczające na poziomie kampanii,
 *   - sufiks adresu z UTM-ami — po nim panel pokazuje wnioski z tej kampanii
 *     w Statystykach („Według źródła") jako Google Ads z jej nazwą.
 *
 * Czego tu NIE MA — i nie dopisuj:
 *   - kryterium języka. Od końca września 2026 kampania w wyszukiwarce nie ma
 *     ustawienia języka (o dopasowaniu decyduje język reklamy i strony),
 *     a API odrzuca próbę jego dodania — razem z całą kampanią, bo wszystko
 *     idzie jednym wywołaniem;
 *   - nowej akcji konwersji. Konwersję „wniosek" zgłasza strona, a Ads sam
 *     przypisuje ją do kampanii, z której było kliknięcie;
 *   - kwot i procentów w tekstach reklam. Kwoty na stronie liczą się ze stawek
 *     i z ZUS-u, zmieniają się, a zastrzeżeń do limitu w reklamie nie zmieścisz.
 *
 * Teksty reklam to zdania ze stron /uk/ (sprawdzonych z polskim źródłem),
 * skrócone do limitów Google. Zasady te same co na stronie: bez „від першого
 * дня", bez gwarancji, „період очікування" (nie „каренція"). Zmieniasz tekst —
 * uruchom test: node --test narzedzia/test/
 *
 * Czego ten skrypt NIE WIE: ile osób szuka tych fraz. W dniu pisania
 * (27.11.2026) nie dało się tego zmierzyć; sprawdź w Planerze słów kluczowych.
 */

/** Ustawienia kampanii. Kwoty w złotych — konto musi być prowadzone w PLN. */
var KAMPANIA = {
  nazwa: 'UK - wyszukiwarka - utrata dochodu',
  budzetDziennyZl: 20,
  maksCpcZl: 4,
  utmCampaign: 'uk_szukaj',
};

/** Polska w słowniku lokalizacji Google Ads. */
var POLSKA = 'geoTargetConstants/2616';

/**
 * Stoi w każdej reklamie na pierwszej pozycji opisu, czyli zawsze. Bez niego
 * płacimy za kliknięcia osób, które odpadną na polskim formularzu albo na
 * polu PESEL.
 */
var OPIS_STALY = 'Заявка й договір — польською мовою, пояснюємо кожен крок українською. Потрібен PESEL.';

var OPIS_POLIS = 'Поліс виплачує щомісячну суму, коли хвороба або нещасний випадок не дають змоги працювати.';
var OPIS_ZUS = 'ZUS рахує допомогу по хворобі від бази внесків, а не від того, скільки ви заробляєте.';
var OPIS_OCZEKIWANIE = 'Виплата — після періоду очікування, визначеного в договорі. Орієнтовний внесок — на сайті.';

/** Grupy reklam: nagłówki do 30 znaków, opisy do 90, frazy małymi literami. */
var GRUPY = [
  {
    nazwa: 'Страхування доходу',
    adres: 'https://utratadochodu.pl/uk/',
    naglowki: [
      'Страхування від втрати доходу',
      'Приватний лікарняний у Польщі',
      'Для JDG і B2B у Польщі',
      'Для самозайнятих у Польщі',
      'Виплата за полісом щомісяця',
      'Орієнтовний розрахунок внеску',
      'Пропозиція за 1-2 робочі дні',
      'Не виходячи з дому',
      'ZUS рахує від бази внесків',
      'Заявка польською мовою',
      'Пояснюємо українською',
      'UtrataDochodu.pl',
    ],
    opisy: [OPIS_STALY, OPIS_POLIS, OPIS_ZUS, OPIS_OCZEKIWANIE],
    frazy: [
      'страхування від втрати доходу',
      'страховка від втрати доходу',
      'страхування доходу',
      'страхування від втрати працездатності',
      'страхування на випадок непрацездатності',
      'страхування для jdg',
      'страхування для фоп в польщі',
      'страхування b2b польща',
      'приватний лікарняний',
    ],
  },
  {
    // Zapytania o zasiłek tylko z dopiskiem JDG / B2B / ФОП. Samo „лікарняний
    // в польщі" wpisują głównie osoby na etacie — to nie nasz klient.
    nazwa: 'Лікарняний на JDG і B2B',
    adres: 'https://utratadochodu.pl/uk/',
    naglowki: [
      'Лікарняний на B2B у Польщі',
      'Скільки ви отримаєте від ZUS?',
      'ZUS рахує від бази внесків',
      'Приватний лікарняний у Польщі',
      'Страхування від втрати доходу',
      'Для JDG і B2B у Польщі',
      'Виплата за полісом щомісяця',
      'Орієнтовний розрахунок внеску',
      'Заявка польською мовою',
      'Пояснюємо українською',
    ],
    opisy: [OPIS_STALY, OPIS_ZUS, OPIS_POLIS, OPIS_OCZEKIWANIE],
    frazy: [
      'лікарняний jdg',
      'лікарняний на b2b',
      'лікарняний для фоп в польщі',
      'лікарняний для самозайнятих',
      'лікарняний zus jdg',
      'допомога по хворобі jdg',
      'хоробове jdg',
    ],
  },
];

/**
 * Słowa wykluczające (dopasowanie do wyrażenia, cała kampania). Wykluczenia nie
 * łapią odmian, stąd kilka form tego samego słowa. Polisa do karty pobytu
 * i do wizy, turystyczna, medyczna, komunikacyjna i od utraty PRACY to inne
 * produkty — a „ubezpieczenie" w ukraińskich zapytaniach w Polsce znaczy
 * najczęściej właśnie je.
 */
var WYKLUCZENIA = [
  'карта побиту',
  'карти побиту',
  'карту побиту',
  'віза',
  'візи',
  'візу',
  'туристичне',
  'туристична',
  'медичне',
  'медична',
  'авто',
  'автомобіля',
  'втрати роботи',
  'безробіття',
  'робота',
  'роботи',
  'вакансії',
];

/** Limity Google Ads dla elastycznej reklamy w wyszukiwarce i fraz. */
var LIMITY = {
  naglowek: 30, opis: 90,
  naglowkiOd: 3, naglowkiDo: 15,
  opisyOd: 2, opisyDo: 4,
  fraza: 80, slowWFrazie: 10,
};

function main() {
  var konto = AdsApp.currentAccount();
  var podglad = czyPodglad();
  Logger.log('Konto: ' + konto.getName() + ' (' + konto.getCustomerId() + ')');
  Logger.log('Zadanie: kampania „' + KAMPANIA.nazwa + '" dla stron /uk/, wstrzymana.');
  if (podglad) Logger.log('PODGLĄD — Google sprawdza operacje, niczego nie tworzy.');
  Logger.log('');

  var usterki = sprawdzTresci();
  if (usterki.length > 0) {
    Logger.log('ZATRZYMANE przed wysłaniem czegokolwiek — teksty nie mieszczą się w limitach:');
    for (var u = 0; u < usterki.length; u++) Logger.log('  • ' + usterki[u]);
    return;
  }

  var stan = stanKonta();
  if (stan === null) {
    Logger.log('ZATRZYMANE: nie udało się odczytać ustawień konta, więc niczego nie zakładam.');
    return;
  }
  if (stan.menedzer) {
    Logger.log('ZATRZYMANE: to konto menedżerskie (MCC). Kampanię zakłada się w koncie');
    Logger.log('reklamowym — otwórz je i wklej skrypt tam.');
    return;
  }
  if (stan.waluta !== 'PLN') {
    Logger.log('ZATRZYMANE: konto jest prowadzone w ' + stan.waluta + ', a budżet i stawka');
    Logger.log('w skrypcie są w złotych. Przelicz KAMPANIA.budzetDziennyZl i maksCpcZl');
    Logger.log('i dopiero wtedy zmień ten warunek.');
    return;
  }

  var jest = kampaniaIstnieje(KAMPANIA.nazwa);
  if (jest === null) {
    Logger.log('ZATRZYMANE: nie udało się sprawdzić, czy kampania już jest. Wolę nie');
    Logger.log('założyć drugiej o tej samej nazwie.');
    return;
  }
  if (jest) {
    Logger.log('Kampania „' + KAMPANIA.nazwa + '" już istnieje — drugi raz jej nie zakładam.');
    Logger.log('Zmiany wprowadź w koncie albo usuń tamtą i uruchom skrypt ponownie.');
    return;
  }

  var bezDeklaracji = kampanieBezDeklaracji();
  if (bezDeklaracji.length > 0) {
    Logger.log('UWAGA: w koncie są kampanie bez deklaracji o reklamie politycznej UE:');
    for (var d = 0; d < bezDeklaracji.length; d++) Logger.log('  • ' + bezDeklaracji[d]);
    Logger.log('Dopóki jej nie mają, Google może odrzucać każdą zmianę w koncie robioną');
    Logger.log('skryptem. Deklarację uzupełnia się w ustawieniach konta albo kampanii.');
    Logger.log('');
  }

  var operacje = zbudujOperacje(String(konto.getCustomerId()).replace(/-/g, ''));
  opiszPlan();

  var wyniki;
  try {
    wyniki = AdsApp.mutateAll(operacje, { partialFailure: false });
  } catch (e) {
    Logger.log('');
    Logger.log(podglad ? 'PODGLĄD: Google odrzuca operacje:' : 'NIC NIE POWSTAŁO — Google odrzucił operacje:');
    Logger.log('  ' + e);
    return;
  }

  var bledy = zbierzBledy(wyniki);
  Logger.log('');
  if (bledy.length > 0) {
    Logger.log(podglad
      ? 'PODGLĄD: Google odrzuca operacje — przy „Uruchom" nic by nie powstało:'
      : 'NIC NIE POWSTAŁO — Google odrzucił operacje (wszystko albo nic):');
    for (var b = 0; b < bledy.length; b++) Logger.log('  • ' + bledy[b]);
    return;
  }
  if (podglad) {
    Logger.log('PODGLĄD zakończony bez błędów: ' + operacje.length + ' operacji sprawdzonych,');
    Logger.log('nic nie zostało utworzone. Żeby założyć kampanię, kliknij „Uruchom".');
    return;
  }

  Logger.log('GOTOWE. Kampania „' + KAMPANIA.nazwa + '" jest w koncie, WSTRZYMANA.');
  Logger.log('Zanim ją włączysz:');
  Logger.log('  1. przeczytaj obie reklamy — nikt znający ukraiński ich jeszcze nie czytał;');
  Logger.log('  2. sprawdź, czy Google nie odrzucił reklam ani fraz (kolumna „Stan");');
  Logger.log('  3. ustaw budżet i górną stawkę po swojemu — w skrypcie to '
    + KAMPANIA.budzetDziennyZl + ' zł dziennie i ' + KAMPANIA.maksCpcZl + ' zł za kliknięcie;');
  Logger.log('  4. włącz kampanię ręcznie.');
}

/** Wszystkie operacje w kolejności, w jakiej jedne odwołują się do drugich. */
function zbudujOperacje(idKonta) {
  var licznik = 0;
  function tymczasowa(rodzaj) {
    licznik++;
    return 'customers/' + idKonta + '/' + rodzaj + '/-' + licznik;
  }

  var operacje = [];
  var budzet = tymczasowa('campaignBudgets');
  var kampania = tymczasowa('campaigns');

  operacje.push({
    campaignBudgetOperation: {
      create: {
        resourceName: budzet,
        amountMicros: mikro(KAMPANIA.budzetDziennyZl),
        explicitlyShared: false,
      },
    },
  });

  operacje.push({
    campaignOperation: {
      create: {
        resourceName: kampania,
        name: KAMPANIA.nazwa,
        status: 'PAUSED',
        advertisingChannelType: 'SEARCH',
        campaignBudget: budzet,
        targetSpend: { cpcBidCeilingMicros: mikro(KAMPANIA.maksCpcZl) },
        networkSettings: {
          targetGoogleSearch: true,
          targetSearchNetwork: false,
          targetContentNetwork: false,
          targetPartnerSearchNetwork: false,
        },
        // PRESENCE: osoby, które są w Polsce. Domyślne „obecność lub
        // zainteresowanie" pokazywałoby reklamy także w Ukrainie.
        geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' },
        finalUrlSuffix: 'utm_source=google&utm_medium=cpc&utm_campaign=' + KAMPANIA.utmCampaign
          + '&utm_term={keyword}',
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      },
    },
  });

  operacje.push({
    campaignCriterionOperation: {
      create: { campaign: kampania, location: { geoTargetConstant: POLSKA } },
    },
  });

  for (var w = 0; w < WYKLUCZENIA.length; w++) {
    operacje.push({
      campaignCriterionOperation: {
        create: {
          campaign: kampania,
          negative: true,
          keyword: { text: WYKLUCZENIA[w], matchType: 'PHRASE' },
        },
      },
    });
  }

  for (var g = 0; g < GRUPY.length; g++) {
    var grupa = GRUPY[g];
    var idGrupy = tymczasowa('adGroups');

    operacje.push({
      adGroupOperation: {
        create: {
          resourceName: idGrupy,
          campaign: kampania,
          name: grupa.nazwa,
          status: 'ENABLED',
          type: 'SEARCH_STANDARD',
        },
      },
    });

    operacje.push({
      adGroupAdOperation: {
        create: {
          adGroup: idGrupy,
          status: 'ENABLED',
          ad: {
            finalUrls: [grupa.adres],
            responsiveSearchAd: {
              headlines: grupa.naglowki.map(function (t) { return { text: t }; }),
              descriptions: grupa.opisy.map(function (t) {
                return t === OPIS_STALY ? { text: t, pinnedField: 'DESCRIPTION_1' } : { text: t };
              }),
            },
          },
        },
      },
    });

    for (var f = 0; f < grupa.frazy.length; f++) {
      operacje.push({
        adGroupCriterionOperation: {
          create: {
            adGroup: idGrupy,
            status: 'ENABLED',
            keyword: { text: grupa.frazy[f], matchType: 'PHRASE' },
          },
        },
      });
    }
  }

  return operacje;
}

/** Lista usterek w tekstach; pusta, gdy wszystko mieści się w limitach Google. */
function sprawdzTresci() {
  var usterki = [];
  var frazy = {};
  for (var g = 0; g < GRUPY.length; g++) {
    var grupa = GRUPY[g];
    var gdzie = 'grupa „' + grupa.nazwa + '": ';

    if (grupa.naglowki.length < LIMITY.naglowkiOd || grupa.naglowki.length > LIMITY.naglowkiDo) {
      usterki.push(gdzie + 'nagłówków ' + grupa.naglowki.length + ', ma być '
        + LIMITY.naglowkiOd + '–' + LIMITY.naglowkiDo);
    }
    if (grupa.opisy.length < LIMITY.opisyOd || grupa.opisy.length > LIMITY.opisyDo) {
      usterki.push(gdzie + 'opisów ' + grupa.opisy.length + ', ma być '
        + LIMITY.opisyOd + '–' + LIMITY.opisyDo);
    }
    if (grupa.opisy.indexOf(OPIS_STALY) === -1) {
      usterki.push(gdzie + 'brak opisu o polskim wniosku i PESEL-u (OPIS_STALY)');
    }
    zaDlugie(grupa.naglowki, LIMITY.naglowek, gdzie + 'nagłówek', usterki);
    zaDlugie(grupa.opisy, LIMITY.opis, gdzie + 'opis', usterki);
    powtorzone(grupa.naglowki, gdzie + 'powtórzony nagłówek', usterki);
    powtorzone(grupa.opisy, gdzie + 'powtórzony opis', usterki);

    if (grupa.frazy.length === 0) usterki.push(gdzie + 'brak fraz');
    for (var f = 0; f < grupa.frazy.length; f++) {
      var fraza = grupa.frazy[f];
      if (znakow(fraza) > LIMITY.fraza || fraza.split(/\s+/).length > LIMITY.slowWFrazie) {
        usterki.push(gdzie + 'fraza za długa: „' + fraza + '"');
      }
      if (frazy[fraza]) usterki.push(gdzie + 'fraza „' + fraza + '" stoi już w innej grupie');
      frazy[fraza] = true;
    }
  }
  return usterki;
}

function zaDlugie(teksty, limit, opis, usterki) {
  for (var i = 0; i < teksty.length; i++) {
    var n = znakow(teksty[i]);
    if (n > limit) usterki.push(opis + ' ma ' + n + ' znaków (limit ' + limit + '): „' + teksty[i] + '"');
  }
}

function powtorzone(teksty, opis, usterki) {
  var byly = {};
  for (var i = 0; i < teksty.length; i++) {
    if (byly[teksty[i]]) usterki.push(opis + ': „' + teksty[i] + '"');
    byly[teksty[i]] = true;
  }
}

/** Liczba znaków tak, jak liczy ją Google: znak, nie jednostka UTF-16. */
function znakow(tekst) {
  return Array.from(String(tekst)).length;
}

/** Złote → mikrojednostki, zaokrąglone do grosza. */
function mikro(zlote) {
  return Math.round(Number(zlote) * 100) * 10000;
}

function czyPodglad() {
  try {
    return AdsApp.getExecutionInfo().isPreview() === true;
  } catch (e) {
    return false;
  }
}

/** `{ menedzer, waluta }` albo `null`, gdy konta nie dało się odczytać. */
function stanKonta() {
  var wiersze = sprobuj('SELECT customer.id, customer.manager, customer.currency_code FROM customer LIMIT 1');
  if (wiersze === null || wiersze.length === 0) return null;
  var c = wiersze[0].customer || {};
  return { menedzer: c.manager === true, waluta: String(c.currencyCode || '') };
}

/** `true` / `false`, a `null`, gdy zapytanie nie przeszło. Usunięte się nie liczą. */
function kampaniaIstnieje(nazwa) {
  var wiersze = sprobuj('SELECT campaign.id, campaign.name, campaign.status FROM campaign '
    + "WHERE campaign.name = '" + String(nazwa).replace(/['\\]/g, '') + "' "
    + "AND campaign.status != 'REMOVED'");
  if (wiersze === null) return null;
  return wiersze.length > 0;
}

/** Nazwy kampanii bez deklaracji UE; pusta lista także wtedy, gdy nie da się sprawdzić. */
function kampanieBezDeklaracji() {
  var wiersze = sprobuj('SELECT campaign.id, campaign.name FROM campaign '
    + 'WHERE campaign.missing_eu_political_advertising_declaration = true');
  var nazwy = [];
  if (wiersze === null) return nazwy;
  for (var i = 0; i < wiersze.length; i++) {
    var k = wiersze[i].campaign || {};
    nazwy.push(String(k.name || k.id || '(bez nazwy)'));
  }
  return nazwy;
}

function sprobuj(zapytanie) {
  try {
    var it = AdsApp.search(zapytanie);
    var out = [];
    while (it.hasNext()) out.push(it.next());
    return out;
  } catch (e) {
    return null;
  }
}

/** Komunikaty błędów z wyników `mutateAll`, bez powtórzeń. */
function zbierzBledy(wyniki) {
  var bledy = [];
  var byly = {};
  if (!wyniki || typeof wyniki.length !== 'number') return ['Google nie oddał wyników operacji.'];
  for (var i = 0; i < wyniki.length; i++) {
    if (wyniki[i].isSuccessful()) continue;
    var komunikaty = wyniki[i].getErrorMessages() || [];
    if (komunikaty.length === 0) komunikaty = ['operacja nr ' + (i + 1) + ' odrzucona bez komunikatu'];
    for (var k = 0; k < komunikaty.length; k++) {
      var tekst = String(komunikaty[k]);
      if (byly[tekst]) continue;
      byly[tekst] = true;
      bledy.push(tekst);
    }
  }
  return bledy;
}

function opiszPlan() {
  var fraz = 0;
  for (var g = 0; g < GRUPY.length; g++) fraz += GRUPY[g].frazy.length;
  Logger.log('Do założenia:');
  Logger.log('  budżet ' + KAMPANIA.budzetDziennyZl + ' zł dziennie, stawka najwyżej '
    + KAMPANIA.maksCpcZl + ' zł za kliknięcie');
  Logger.log('  tylko wyszukiwarka Google, osoby przebywające w Polsce');
  Logger.log('  grup reklam: ' + GRUPY.length + ', fraz: ' + fraz
    + ', słów wykluczających: ' + WYKLUCZENIA.length);
  for (var i = 0; i < GRUPY.length; i++) {
    Logger.log('  • ' + GRUPY[i].nazwa + ' → ' + GRUPY[i].adres);
  }
}
