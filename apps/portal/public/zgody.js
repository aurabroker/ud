/* UtrataDochodu — zgody.js
   Zgoda na cookies i uruchamianie tagów analitycznych.

   Dlaczego samodzielny skrypt, a nie wyspa Svelte: to jest kontrola prawna.
   Musi zadziałać, zanim cokolwiek pobierze pierwszy piksel, i nie może
   zależeć od tego, czy framework zdążył się zahydratować.

   Model „basic": przed zgodą nie leci ŻADNE żądanie do Google ani Meta.
   Alternatywa („advanced") ładuje tagi od razu i wysyła pingi bez
   identyfikatorów — daje modelowanie konwersji w Google Ads, ale oznacza,
   że Google dostaje odsłonę od każdego odwiedzającego, zanim ten cokolwiek
   kliknie. Serwis zbiera dane o zdrowiu, więc wybieramy „basic".
   Przełącznik: TRYB poniżej.

   Czego pilnujemy w interfejsie:
   - odrzucenie jest równie łatwe jak akceptacja (jeden klik, ten sam ciężar
     wizualny) — brak tego jest najczęstszym powodem kar za bannery cookie,
   - zgoda jest granularna: analityka i marketing osobno,
   - brak decyzji ≠ zgoda; baner nie znika po scrollu ani po kliknięciu w tło.
*/
(function () {
  'use strict';

  var TRYB = 'basic';                 // 'basic' | 'advanced'
  var KLUCZ = 'ud_zgody';
  var WERSJA = 2;                     // podbicie = ponowne pytanie o zgodę
  var ID = 'ud-zgody';

  var K = window.UD_TAGI || {};
  var GA4 = K.ga4 || '';
  var ADS = K.ads || '';
  var PIXEL = K.pixel || '';
  /** Ścieżki, na których nie odpalamy Pixela nawet przy zgodzie. */
  var BEZ_PIXELA = K.bezPixela || [];

  /* ── stan ──────────────────────────────────────────────── */

  function odczytaj() {
    try {
      var s = JSON.parse(localStorage.getItem(KLUCZ) || 'null');
      if (!s || s.wersja !== WERSJA) return null;
      return s;
    } catch (e) { return null; }
  }

  function zapisz(analityka, marketing) {
    var s = { wersja: WERSJA, analityka: !!analityka, marketing: !!marketing, data: new Date().toISOString() };
    try { localStorage.setItem(KLUCZ, JSON.stringify(s)); } catch (e) { /* tryb prywatny */ }
    return s;
  }

  /* ── Consent Mode v2 ───────────────────────────────────── */

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  /* Domyślne odmowy muszą wykonać się przed jakimkolwiek tagiem — inaczej
     pierwsza odsłona poleci z pełnymi zgodami, zanim je odrzucimy. */
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  function aktualizujZgode(s) {
    gtag('consent', 'update', {
      ad_storage: s.marketing ? 'granted' : 'denied',
      ad_user_data: s.marketing ? 'granted' : 'denied',
      ad_personalization: s.marketing ? 'granted' : 'denied',
      analytics_storage: s.analityka ? 'granted' : 'denied'
    });
  }

  /* ── ładowanie tagów ───────────────────────────────────── */

  var zaladowane = {};

  function skrypt(url, klucz) {
    if (zaladowane[klucz]) return;
    zaladowane[klucz] = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = url;
    document.head.appendChild(s);
  }

  function wykluczonaSciezka() {
    for (var i = 0; i < BEZ_PIXELA.length; i++) {
      if (location.pathname.indexOf(BEZ_PIXELA[i]) === 0) return true;
    }
    return false;
  }

  function wlaczGoogle(s) {
    if (!GA4 && !ADS) return;
    if (!s.analityka && !s.marketing) return;
    skrypt('https://www.googletagmanager.com/gtag/js?id=' + (GA4 || ADS), 'google');
    gtag('js', new Date());
    if (GA4 && s.analityka) gtag('config', GA4, { anonymize_ip: true });
    if (ADS && s.marketing) gtag('config', ADS);
  }

  function wlaczPixel(s) {
    if (!PIXEL || !s.marketing || zaladowane.pixel) return;
    /* Meta zabrania przesyłania danych wrażliwych, a sam adres strony bywa
       już sygnałem — na wniosku z ankietą medyczną Pixel nie startuje. */
    if (wykluczonaSciezka()) return;
    zaladowane.pixel = true;

    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', PIXEL);
    window.fbq('track', 'PageView');
  }

  function zastosuj(s) {
    aktualizujZgode(s);
    if (TRYB === 'basic' && !s.analityka && !s.marketing) return;
    wlaczGoogle(s);
    wlaczPixel(s);
  }

  /* ── interfejs ─────────────────────────────────────────── */

  function wstrzyknijStyle() {
    if (document.getElementById(ID + '-css')) return;
    var st = document.createElement('style');
    st.id = ID + '-css';
    st.textContent = [
      '#' + ID + '{position:fixed;left:0;right:0;bottom:0;z-index:2147482000;',
      'background:#fff;border-top:1px solid #BEDFF0;box-shadow:0 -8px 32px rgba(15,46,64,.14);',
      'font-family:"Public Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
      'color:#0F2E40;font-size:14px;line-height:1.6}',
      '#' + ID + ' .ud-z-srodek{max-width:1200px;margin:0 auto;padding:20px}',
      '#' + ID + ' h2{margin:0 0 6px;font-size:16px;font-weight:700;color:#0F2E40}',
      '#' + ID + ' p{margin:0;color:#4E6D7D;max-width:60em}',
      '#' + ID + ' a{color:#0B7CAF;text-decoration:underline;text-underline-offset:2px}',
      '#' + ID + ' .ud-z-akcje{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}',
      '#' + ID + ' button{font-family:inherit;font-size:14px;font-weight:700;padding:12px 22px;',
      'border-radius:0;cursor:pointer;border:1.5px solid transparent}',
      '#' + ID + ' .ud-z-tak{background:#0E96D0;color:#fff;border-color:#0E96D0}',
      '#' + ID + ' .ud-z-tak:hover{background:#0B7CAF;border-color:#0B7CAF}',
      /* Odrzucenie musi być równie łatwe i równie widoczne jak akceptacja. */
      '#' + ID + ' .ud-z-nie{background:#fff;color:#0E96D0;border-color:#1BAEE5}',
      '#' + ID + ' .ud-z-nie:hover{background:#F4FBFE}',
      '#' + ID + ' .ud-z-wiecej{background:none;color:#4E6D7D;border-color:#D3E9F4;font-weight:600}',
      '#' + ID + ' .ud-z-wiecej:hover{color:#0F2E40;border-color:#BEDFF0}',
      '#' + ID + ' .ud-z-opcje{margin-top:18px;padding-top:16px;border-top:1px solid #D3E9F4;',
      'display:flex;flex-direction:column;gap:14px;max-width:60em}',
      '#' + ID + ' .ud-z-opcja{display:flex;gap:12px;align-items:flex-start}',
      '#' + ID + ' .ud-z-opcja input{margin-top:3px;width:17px;height:17px;accent-color:#0E96D0;flex-shrink:0}',
      '#' + ID + ' .ud-z-opcja strong{display:block;font-size:14.5px;color:#0F2E40}',
      '#' + ID + ' .ud-z-opcja span{display:block;color:#4E6D7D;font-size:13.5px;margin-top:2px}',
      '#' + ID + ' .ud-z-opcja.ud-z-stala{opacity:.65}',
      '@media(max-width:640px){#' + ID + ' .ud-z-akcje button{flex:1 1 100%}}'
    ].join('');
    document.head.appendChild(st);
  }

  function usun() {
    var el = document.getElementById(ID);
    if (el) el.remove();
  }

  function pokaz(rozwiniete) {
    if (document.getElementById(ID)) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () { pokaz(rozwiniete); });
      return;
    }
    wstrzyknijStyle();
    var zapisane = odczytaj();

    var box = document.createElement('div');
    box.id = ID;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-labelledby', ID + '-tytul');
    box.setAttribute('aria-describedby', ID + '-opis');

    box.innerHTML =
      '<div class="ud-z-srodek">' +
        '<h2 id="' + ID + '-tytul">Pliki cookies</h2>' +
        '<p id="' + ID + '-opis">Niezbędne cookies są potrzebne, żeby strona działała. ' +
        'Analityczne i marketingowe uruchamiamy dopiero wtedy, gdy się zgodzisz — ' +
        'do tego momentu nie wysyłamy żadnych danych do Google ani Meta. ' +
        'Szczegóły w <a href="/polityka-cookies/">polityce cookies</a>.</p>' +
        '<div class="ud-z-opcje" hidden>' +
          '<label class="ud-z-opcja ud-z-stala">' +
            '<input type="checkbox" checked disabled>' +
            '<span><strong>Niezbędne</strong><span>Sesja formularza, zapamiętanie tej decyzji, ochrona przed botami. Zawsze włączone.</span></span>' +
          '</label>' +
          '<label class="ud-z-opcja">' +
            '<input type="checkbox" data-zgoda="analityka">' +
            '<span><strong>Analityczne</strong><span>Zliczanie odwiedzin i sprawdzanie, które podstrony są przydatne (Google Analytics 4).</span></span>' +
          '</label>' +
          '<label class="ud-z-opcja">' +
            '<input type="checkbox" data-zgoda="marketing">' +
            '<span><strong>Marketingowe</strong><span>Pomiar skuteczności reklam i remarketing (Google Ads, Meta Pixel).</span></span>' +
          '</label>' +
        '</div>' +
        '<div class="ud-z-akcje">' +
          '<button type="button" class="ud-z-tak" data-akcja="tak">Akceptuję wszystkie</button>' +
          '<button type="button" class="ud-z-nie" data-akcja="nie">Odrzucam wszystkie</button>' +
          '<button type="button" class="ud-z-wiecej" data-akcja="wiecej">Ustawienia</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(box);

    var opcje = box.querySelector('.ud-z-opcje');
    var pola = box.querySelectorAll('[data-zgoda]');
    var wiecej = box.querySelector('[data-akcja="wiecej"]');

    if (zapisane) {
      for (var i = 0; i < pola.length; i++) {
        pola[i].checked = !!zapisane[pola[i].getAttribute('data-zgoda')];
      }
    }

    function rozwin() {
      opcje.hidden = false;
      wiecej.textContent = 'Zapisz wybrane';
      wiecej.setAttribute('data-akcja', 'zapisz');
    }
    if (rozwiniete) rozwin();

    box.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-akcja]') : null;
      if (!btn) return;
      var akcja = btn.getAttribute('data-akcja');

      if (akcja === 'wiecej') { rozwin(); return; }

      var stan;
      if (akcja === 'tak') stan = zapisz(true, true);
      else if (akcja === 'nie') stan = zapisz(false, false);
      else {
        var a = box.querySelector('[data-zgoda="analityka"]').checked;
        var m = box.querySelector('[data-zgoda="marketing"]').checked;
        stan = zapisz(a, m);
      }

      usun();
      zastosuj(stan);
      document.dispatchEvent(new CustomEvent('ud:zgody', { detail: stan }));
    });
  }

  /* ── start ─────────────────────────────────────────────── */

  var stan = odczytaj();
  if (stan) zastosuj(stan);
  else pokaz(false);

  window.UDCookies = {
    /** Otwiera panel ustawień — używa go przycisk na /polityka-cookies/. */
    otworz: function () { usun(); pokaz(true); },
    stan: odczytaj,
    /** Zdarzenie konwersji; leci tylko, gdy użytkownik wpuścił marketing. */
    konwersja: function (etykieta, dane) {
      var s = odczytaj();
      if (!s || !s.marketing || !ADS) return;
      window.gtag('event', 'conversion', Object.assign(
        { send_to: etykieta ? ADS + '/' + etykieta : ADS }, dane || {}));
    }
  };
})();
