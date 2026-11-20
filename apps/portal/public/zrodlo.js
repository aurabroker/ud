/* UtrataDochodu — zrodlo.js
   Źródło wizyty jedzie z klientem między podstronami — w ADRESIE, nie
   w urządzeniu.

   Kampania Google Ads kieruje na stronę główną z UTM-ami, a Google dokleja
   identyfikator kliknięcia (gclid, czasem gbraid / wbraid) i gad_*. Do
   20.11.2026 te parametry ginęły przy pierwszym kliknięciu w odnośnik, więc
   wniosek złożony dwie strony dalej nie wiedział, że klient przyszedł
   z reklamy. Ten skrypt dokleja je do odnośników wewnętrznych w chwili
   kliknięcia, a kreator wniosku czyta je z location.search przy wysyłce
   (zrodloZAdresu w @ud/wniosek → form_data.zrodlo).

   Dlaczego adres, a nie sessionStorage ani ciasteczko: zapis w urządzeniu na
   potrzeby pomiaru wymagałby zgody (art. 399 PKE) — ta sama zasada co przy
   linku agenta (?agent=). Skrypt NICZEGO nie zapisuje: bez cookies,
   localStorage, sessionStorage i IndexedDB.

   Dlaczego w chwili kliknięcia, a nie przepisanie odnośników przy wczytaniu:
   odnośniki z wysp Svelte powstają po hydratacji, a kalkulator przepisuje
   swoje przy każdej zmianie kwoty. Delegacja `click` i `auxclick` (środkowy
   przycisk — nowa karta) na document łapie je wszystkie, także te dodane
   później. Roboty nie klikają, więc w HTML-u, który czytają, adresy są
   czyste.

   Czego nie ruszamy: obce domeny, mailto:/tel:/javascript:, same kotwice #,
   odnośniki z `download`, pliki (/owu/, /media/, /pobierz/, .pdf, .md, .txt,
   .xml i inne), /podziekowanie/. Parametru, który odnośnik już ma (?agent=,
   ?dochod=, ?odkladam=, ?z=), nie nadpisujemy, a fragment #… zostaje.

   Reguły wartości to KOPIA reguł z packages/wniosek/src/zrodlo.js — skrypt
   jest samodzielny (bez importów), bo ładuje go każda strona z Baza.astro
   bez bundlera. Zgodność kopii pilnuje test/zrodlo.spec.js.

   Skrypt NIGDY nie rzuca: awaria.js zamienia nieobsłużony błąd z naszej
   domeny w okienko awarii, a źródło wizyty nie jest warte straszenia
   klienta. Stąd try/catch wszędzie, także w obsłudze zdarzeń, i składnia
   ES5 (błąd składni w starej przeglądarce byłby nie do złapania).

   Nawigacje programowe: window.UDZrodlo.adres('/wniosek/') zwraca adres
   z doklejonymi parametrami (albo wejście bez zmian). Przekierowanie na
   /podziekowanie/ po wysyłce wniosku celowo idzie bez nich.

   Skutek uboczny, o którym trzeba wiedzieć przy czytaniu Ads i GA4: sam
   skrypt nic nikomu nie wysyła, ale istniejące tagi (GA4, Ads, Pixel —
   tylko po zgodzie, zgody.js) widzą teraz gclid i utm_* także w adresach
   podstron, nie tylko strony wejścia. Kto zgodzi się na cookies dopiero na
   /wniosek/, ma tam gclid w adresie, więc łącznik konwersji Ads go złapie —
   liczba konwersji z Ads i atrybucja w GA4 mogą po wdrożeniu wzrosnąć (jak
   przy url_passthrough w Consent Mode). Pixel poza TAGI.bezPixela (np.
   /kalkulator/) dostaje w adresie strony identyfikator kliknięcia Google.

   Adres podstrony skopiowany z paska i wysłany dalej niesie gclid i UTM-y
   pierwszej osoby (portal nie ma przycisku „Udostępnij", a arkusze
   udostępniania Safari i Chrome wysyłają canonical, więc tylko ręczne
   kopiowanie). Wniosek odbiorcy będzie wtedy „Google Ads" z cudzym gclid —
   import konwersji offline (etap 2, jeszcze go nie ma) musi wysłać jeden
   gclid najwyżej raz, a ten sam gclid u różnych klientów pominąć.
*/
(function () {
  'use strict';

  var api = { adres: function (href) { return href; } };
  try { window.UDZrodlo = api; } catch (e) { /* nic */ }

  try {
    /* ── reguły (kopia packages/wniosek/src/zrodlo.js) ─────── */

    var PARAMETRY = [
      'gclid', 'gbraid', 'wbraid',
      'gad_source', 'gad_campaignid',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'
    ];
    var IDENTYFIKATORY = ['gclid', 'gbraid', 'wbraid'];
    var IDENTYFIKATOR = /^[A-Za-z0-9_-]{1,200}$/;
    var GAD = /^[A-Za-z0-9_-]{1,32}$/;
    var UTM_MAKS = 100;
    var STERUJACY = /[\u0000-\u001F\u007F]/;

    var poprawna = function (klucz, wartosc) {
      if (typeof wartosc !== 'string') return false;
      if (IDENTYFIKATORY.indexOf(klucz) !== -1) return IDENTYFIKATOR.test(wartosc);
      if (klucz === 'gad_source' || klucz === 'gad_campaignid') return GAD.test(wartosc);
      if (PARAMETRY.indexOf(klucz) === -1) return false;
      return wartosc.length >= 1 && wartosc.length <= UTM_MAKS && !STERUJACY.test(wartosc);
    };

    /* Pierwsze wystąpienie (URLSearchParams.get), po trim, w kolejności PARAMETRY. */
    var zAdresu = function (search) {
      var p = new URLSearchParams(typeof search === 'string' ? search : '');
      var wynik = [];
      for (var i = 0; i < PARAMETRY.length; i++) {
        var surowa = p.get(PARAMETRY[i]);
        if (surowa === null) continue;
        var wartosc = surowa.trim();
        if (poprawna(PARAMETRY[i], wartosc)) wynik.push([PARAMETRY[i], wartosc]);
      }
      return wynik;
    };

    var pary = [];
    try { pary = zAdresu(location.search); } catch (e) { pary = []; }
    if (pary.length === 0) return;      // nic do niesienia — nie słuchamy kliknięć

    /* ── co dekorujemy ─────────────────────────────────────── */

    /* Pliki i adresy plików: robot czy agent, który je zapisze, nie ma
       z kampanią nic wspólnego, a /owu/ i /media/ są buforowane po adresie. */
    var BEZ_PREFIKSU = ['/owu/', '/media/', '/pobierz/', '/podziekowanie/'];
    var PLIK = /\.(?:pdf|md|txt|xml|json|jpe?g|png|gif|webp|avif|svg|ico|js|mjs|css|zip|csv)$/i;

    /** Adres z doklejonymi parametrami albo null, gdy nie dekorujemy. */
    var udekorowany = function (surowy) {
      if (typeof surowy !== 'string') return null;
      var s = surowy.replace(/^\s+|\s+$/g, '');
      if (s === '' || s.charAt(0) === '#') return null;
      var url = new URL(s, document.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (url.origin !== location.origin) return null;
      var sciezka = url.pathname;
      if (sciezka === '/podziekowanie') return null;
      for (var i = 0; i < BEZ_PREFIKSU.length; i++) {
        if (sciezka.indexOf(BEZ_PREFIKSU[i]) === 0) return null;
      }
      if (PLIK.test(sciezka)) return null;

      // Dopisujemy na końcu zapytania zamiast przez searchParams.append:
      // to ostatnie przepisałoby całe istniejące zapytanie (np. %20 → +),
      // a parametry odnośnika mają zostać bajt w bajt.
      var dopisek = [];
      for (var j = 0; j < pary.length; j++) {
        if (url.searchParams.has(pary[j][0])) continue;   // tego nie nadpisujemy
        dopisek.push(encodeURIComponent(pary[j][0]) + '=' + encodeURIComponent(pary[j][1]));
      }
      if (dopisek.length === 0) return null;
      url.search = (url.search ? url.search + '&' : '?') + dopisek.join('&');
      return url.href;                                       // fragment #… zostaje
    };

    api.adres = function (href) {
      try {
        var nowy = udekorowany(href);
        return nowy === null ? href : nowy;
      } catch (e) {
        return href;
      }
    };

    /* ── kliknięcia ────────────────────────────────────────── */

    var naKlik = function (e) {
      try {
        var el = e && e.target;
        if (el && el.nodeType !== 1) el = el.parentElement;    // kliknięty tekst
        if (!el || typeof el.closest !== 'function') return;
        var a = el.closest('a[href]');
        if (!a || a.hasAttribute('download')) return;
        var nowy = udekorowany(a.getAttribute('href'));
        if (nowy !== null) a.setAttribute('href', nowy);
      } catch (err) { /* źródło nie może zepsuć kliknięcia */ }
    };

    // Faza przechwytywania: zanim cokolwiek innego obsłuży kliknięcie, a przed
    // domyślną akcją (przejście), która czyta href dopiero po zdarzeniu.
    document.addEventListener('click', naKlik, true);
    // Środkowy przycisk otwiera nową kartę bez zdarzenia `click`. Prawego nie
    // ruszamy — „Kopiuj adres linku” nie powinien wynosić cudzego gclid.
    document.addEventListener('auxclick', function (e) {
      try { if (e.button === 1) naKlik(e); } catch (err) { /* j.w. */ }
    }, true);
  } catch (e) { /* bez źródła strona działa dalej */ }
})();
