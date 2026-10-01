/**
 * ads-konwersje-ga4.js — czy odcięcie właściwości GA4 zepsuje licytacje w Ads.
 *
 * Skrypt TYLKO CZYTA. Nie zmienia ani jednego ustawienia, więc „Uruchom
 * podgląd" wystarczy.
 *
 * Gdzie wkleić:
 *   Google Ads → Narzędzia → Działania zbiorcze → Skrypty → „+" →
 *   wklej całość → Autoryzuj → Uruchom podgląd → czytaj Dziennik.
 *
 * UWAGA na dwa różne „statusy". To, co zwraca API (ENABLED / HIDDEN / REMOVED),
 * mówi tylko, czy akcja nie została usunięta. Interfejs Ads pokazuje obok tego
 * stan diagnostyczny („Rejestrowanie konwersji", „Brak ostatnich konwersji",
 * „Błędna konfiguracja") i tego skrypt nie widzi. Akcja może być ENABLED
 * i jednocześnie zepsuta — po tym skrypcie warto zajrzeć na kartę konwersji.
 *
 * WAŻNE: uruchom w koncie, w którym są konwersje, a nie w koncie menedżerskim
 * (MCC). Z poziomu MCC skrypt zobaczy puste konto i powie, że nie ma nic.
 *
 * Czego ten skrypt NIE POWIE — sprawdzone na surowych rekordach, nie założone:
 * przy konwersji importowanej z GA4 Ads NIE PRZECHOWUJE identyfikatora
 * właściwości. Cały rekord to resourceName, status, type, id, name i origin.
 * Widać, że źródłem jest GA4, i widać nazwę akcji — a nazwy importów GA4 mają
 * zwykle w sobie nazwę właściwości albo strumienia. Dlatego skrypt wypisuje
 * nazwy, a dopasowanie do konkretnej właściwości robisz wzrokiem, ewentualnie
 * sprawdzając w GA4: Administracja → Połączone usługi → Google Ads.
 */

/** Właściwość, którą zamykamy — tylko do opisu w dzienniku. */
var ZAMYKANA = 'G-D9XHPWP5DE';

function main() {
  Logger.log('Konto: ' + AdsApp.currentAccount().getName()
    + ' (' + AdsApp.currentAccount().getCustomerId() + ')');
  Logger.log('Pytanie: czy odcięcie właściwości ' + ZAMYKANA + ' zepsuje licytacje.');
  Logger.log('');

  var akcje = pobierzAkcje();
  if (akcje === null) {
    Logger.log('NIE UDAŁO SIĘ ODCZYTAĆ AKCJI KONWERSJI. Najczęstsza przyczyna:');
    Logger.log('skrypt uruchomiony w koncie menedżerskim zamiast w koncie z konwersjami.');
    return;
  }
  if (akcje.length === 0) {
    Logger.log('To konto nie ma ŻADNEJ akcji konwersji. Jeśli to nieoczekiwane —');
    Logger.log('patrz uwaga o koncie menedżerskim w nagłówku skryptu.');
    return;
  }

  var wolumeny = pobierzWolumeny();

  Logger.log('── WSZYSTKIE AKCJE KONWERSJI ' + kreska(46));
  Logger.log(wiersz('NAZWA', 'TYP (tu widać GA4)', 'STATUS', 'LICZY SIĘ?', 'KONW. 30 DNI'));
  Logger.log(kreska(96));

  var zGa4 = [];
  for (var i = 0; i < akcje.length; i++) {
    var a = akcje[i];
    var ile = wolumeny === null ? '?' : String(wolumeny[a.nazwa] || 0);
    // W kolumnie stoi `type`, nie `origin`: import z GA4 ma origin=WEBSITE
    // (konwersja ZASZŁA na stronie) i to właśnie `type` mówi, skąd Ads ją bierze.
    // Pokazywanie `origin` dawało wiersze opisane WEBSITE i zarazem oznaczone
    // jako GA4 — wynik poprawny, prezentacja myląca.
    Logger.log(wiersz(a.nazwa, a.typ, a.status,
      a.liczySie ? 'TAK' : 'nie', ile));
    if (a.zGa4) zGa4.push({ akcja: a, ile: wolumeny === null ? null : (wolumeny[a.nazwa] || 0) });
  }

  Logger.log('');
  Logger.log('── WERDYKT ' + kreska(62));

  if (zGa4.length === 0) {
    Logger.log('ŻADNA konwersja w tym koncie nie pochodzi z GA4.');
    Logger.log('Odcięcie ruchu od ' + ZAMYKANA + ' NIE RUSZY licytacji —');
    Logger.log('konwersje idą do Ads bezpośrednio z tagu na stronie.');
    return;
  }

  Logger.log('Konwersji pochodzących z GA4: ' + zGa4.length + '. Wypisane niżej.');
  Logger.log('Ads nie mówi, z KTÓREJ właściwości — sprawdź nazwy:');
  Logger.log('');

  var ryzykowne = 0;
  for (var j = 0; j < zGa4.length; j++) {
    var p = zGa4[j];
    var ostrzezenie = '';
    if (p.akcja.liczySie && p.akcja.status === 'ENABLED') {
      ostrzezenie = '  ← LICZY SIĘ DO KOLUMNY „Konwersje", więc steruje licytacjami';
      ryzykowne++;
    }
    Logger.log('  • ' + p.akcja.nazwa + ostrzezenie);
    if (p.ile !== null) Logger.log('      konwersje z ostatnich 30 dni: ' + p.ile);
  }

  Logger.log('');
  if (ryzykowne === 0) {
    Logger.log('Żadna z nich nie liczy się do kolumny „Konwersje", więc nawet gdyby');
    Logger.log('pochodziły z ' + ZAMYKANA + ', licytacje tego nie odczują.');
  } else {
    Logger.log('UWAGA: ' + ryzykowne + ' z nich steruje licytacjami. Jeśli choć jedna pochodzi');
    Logger.log('z ' + ZAMYKANA + ', NIE odcinaj tej właściwości, zanim konwersja nie zostanie');
    Logger.log('przestawiona na właściwość docelową albo na tag Ads na stronie.');
    Logger.log('Odcięcie źródła konwersji przy włączonym Smart Biddingu to nie jest');
    Logger.log('drobna zmiana — algorytm traci sygnał, po którym optymalizuje.');
  }
}

/** Akcje konwersji z metadanymi. `null`, gdy zapytanie w ogóle nie przeszło. */
function pobierzAkcje() {
  // Pełny zestaw pól; przy starszej wersji API któreś może nie istnieć,
  // więc jest wersja zapasowa z samym minimum.
  var pelne = 'SELECT conversion_action.id, conversion_action.name, conversion_action.type, '
    + 'conversion_action.status, conversion_action.category, conversion_action.origin, '
    + 'conversion_action.include_in_conversions_metric FROM conversion_action';
  var minimalne = 'SELECT conversion_action.id, conversion_action.name, '
    + 'conversion_action.type, conversion_action.status FROM conversion_action';

  var wiersze = sprobuj(pelne);
  if (wiersze === null) {
    Logger.log('(pełne zapytanie odrzucone — lecę wersją minimalną)');
    wiersze = sprobuj(minimalne);
  }
  if (wiersze === null) return null;

  var out = [];
  for (var i = 0; i < wiersze.length; i++) {
    var ca = wiersze[i].conversionAction || {};
    var typ = String(ca.type || '');
    var origin = String(ca.origin || '');
    // Import z GA4 rozpoznajemy po jednym z dwóch: źródle albo typie.
    // Typ wystarczy, gdy `origin` nie wszedł do wyniku.
    var zGa4 = origin.indexOf('GOOGLE_ANALYTICS') === 0
      || typ.indexOf('GOOGLE_ANALYTICS') === 0;
    out.push({
      nazwa: String(ca.name || '(bez nazwy)'),
      typ: typ || origin || '?',
      status: String(ca.status || '?'),
      // Brak pola = nie wiemy; zakładamy, że liczy się, bo to gorszy przypadek.
      liczySie: ca.includeInConversionsMetric === undefined
        ? true : !!ca.includeInConversionsMetric,
      zGa4: zGa4,
    });
  }
  out.sort(function (a, b) { return a.nazwa < b.nazwa ? -1 : 1; });
  return out;
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

/** Konwersje z 30 dni w rozbiciu na akcje. `null`, gdy się nie udało. */
function pobierzWolumeny() {
  try {
    var it = AdsApp.search(
      'SELECT segments.conversion_action_name, metrics.all_conversions '
      + 'FROM campaign WHERE segments.date DURING LAST_30_DAYS');
    var suma = {};
    while (it.hasNext()) {
      var w = it.next();
      var nazwa = w.segments && w.segments.conversionActionName;
      if (!nazwa) continue;
      var ile = Number((w.metrics && w.metrics.allConversions) || 0);
      suma[nazwa] = (suma[nazwa] || 0) + ile;
    }
    // Zaokrąglenie: all_conversions bywa ułamkowe przy modelach atrybucji.
    for (var k in suma) suma[k] = Math.round(suma[k] * 10) / 10;
    return suma;
  } catch (e) {
    Logger.log('(nie udało się policzyć konwersji z 30 dni: ' + e + ')');
    return null;
  }
}

function wiersz(a, b, c, d, e) {
  return dopelnij(a, 38) + dopelnij(b, 22) + dopelnij(c, 10) + dopelnij(d, 12) + e;
}
function dopelnij(t, n) {
  t = String(t);
  if (t.length > n - 1) t = t.substring(0, n - 2) + '…';
  while (t.length < n) t += ' ';
  return t;
}
function kreska(n) {
  var s = '';
  while (s.length < n) s += '─';
  return s;
}
