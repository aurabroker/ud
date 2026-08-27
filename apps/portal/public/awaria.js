/* UtrataDochodu — awaria.js
   Modal awarii: gdy coś przestaje działać, pokazuje prośbę o kontakt
   telefoniczny i o zgłoszenie błędu.

   Skrypt jest w pełni samodzielny — własny CSS, zero zależności od Tailwinda
   czy innych bibliotek. To celowe: modal ma się pokazać także wtedy, gdy
   awaria polega na tym, że CDN ze stylami albo inny skrypt się nie wczytał.

   Użycie ręczne:
     Awaria.pokaz({ kod: 'FORMULARZ_WYSYLKA', szczegoly: err });

   Automatycznie: nieobsłużone błędy skryptów z naszej domeny (raz na sesję).
*/
(function () {
  'use strict';

  var TELEFON        = '504 400 901';
  var TELEFON_LINK   = '+48504400901';
  var EMAIL          = 'info@utratadochodu.pl';
  var ID             = 'ud-awaria';
  var pokazany       = false;   // jeden modal na raz
  var autoZuzyty     = false;   // automatyczne błędy: raz na wczytanie strony
  var ostatnioAktywny = null;   // element, do którego wracamy po zamknięciu

  /* ── style ─────────────────────────────────────────────── */
  function wstrzyknijStyle() {
    if (document.getElementById(ID + '-css')) return;
    var s = document.createElement('style');
    s.id = ID + '-css';
    s.textContent = [
      '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;',
      'justify-content:center;padding:16px;font-family:"Public Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
      '#' + ID + ' .ud-aw-tlo{position:absolute;inset:0;background:rgba(15,46,64,.78);backdrop-filter:blur(4px)}',
      '#' + ID + ' .ud-aw-okno{position:relative;background:#fff;border-radius:0;padding:28px 24px;',
      'max-width:420px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,.45);text-align:center;',
      'max-height:90vh;overflow-y:auto;box-sizing:border-box}',
      '#' + ID + ' .ud-aw-ikona{width:60px;height:60px;border-radius:0;background:#FDECEB;color:#D6453D;',
      'font-size:28px;font-weight:700;line-height:60px;margin:0 auto 16px}',
      '#' + ID + ' h2{margin:0 0 8px;font-size:20px;font-weight:800;color:#0F2E40}',
      '#' + ID + ' p{margin:0 0 20px;font-size:14px;line-height:1.6;color:#4E6D7D}',
      '#' + ID + ' .ud-aw-tel{display:flex;align-items:center;justify-content:center;gap:8px;',
      'background:#0E96D0;color:#fff;text-decoration:none;font-weight:800;font-size:19px;',
      'padding:14px 16px;border-radius:0;margin-bottom:10px}',
      '#' + ID + ' .ud-aw-tel:hover{background:#0B7CAF}',
      '#' + ID + ' .ud-aw-zglos{display:block;width:100%;box-sizing:border-box;background:#F4FBFE;color:#0F2E40;',
      'text-decoration:none;font-weight:700;font-size:14px;padding:11px 16px;border-radius:0;margin-bottom:8px}',
      '#' + ID + ' .ud-aw-zglos:hover{background:#DDF1FA}',
      '#' + ID + ' .ud-aw-zamknij{display:block;width:100%;background:none;border:0;color:#8AA3AF;',
      'font-size:13px;padding:8px;cursor:pointer;font-family:inherit}',
      '#' + ID + ' .ud-aw-zamknij:hover{color:#0F2E40}',
      '#' + ID + ' details{margin-top:14px;text-align:left}',
      '#' + ID + ' summary{font-size:12px;color:#8AA3AF;cursor:pointer}',
      '#' + ID + ' pre{margin:8px 0 0;background:#F4FBFE;border:1px solid #D3E9F4;border-radius:0;',
      'padding:10px;font-size:11px;line-height:1.5;color:#4E6D7D;white-space:pre-wrap;word-break:break-word}',
      '#' + ID + ' .ud-aw-kopiuj{margin-top:8px;background:none;border:0;color:#0B7CAF;font-size:12px;',
      'cursor:pointer;padding:0;font-family:inherit;text-decoration:underline}',
      'body.ud-awaria-blokada{overflow:hidden}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── dane techniczne do zgłoszenia ─────────────────────── */
  function opisBledu(opcje) {
    var szcz = opcje.szczegoly;
    if (szcz instanceof Error) szcz = szcz.message;
    else if (szcz && typeof szcz === 'object') { try { szcz = JSON.stringify(szcz); } catch (e) { szcz = String(szcz); } }
    return [
      'Kod: '        + (opcje.kod || 'NIEZNANY'),
      'Strona: '     + location.href,
      'Czas: '       + new Date().toISOString(),
      'Przeglądarka: ' + navigator.userAgent,
      szcz ? 'Szczegóły: ' + String(szcz).slice(0, 300) : null
    ].filter(Boolean).join('\n');
  }

  function zamknij() {
    var el = document.getElementById(ID);
    if (el) el.remove();
    document.body.classList.remove('ud-awaria-blokada');
    document.removeEventListener('keydown', naEsc);
    pokazany = false;
    if (ostatnioAktywny && ostatnioAktywny.focus) { try { ostatnioAktywny.focus(); } catch (e) {} }
  }

  function naEsc(e) { if (e.key === 'Escape') zamknij(); }

  /* ── modal ─────────────────────────────────────────────── */
  function pokaz(opcje) {
    opcje = opcje || {};
    if (pokazany) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { pokaz(opcje); }); return; }
    pokazany = true;
    ostatnioAktywny = document.activeElement;
    wstrzyknijStyle();

    var raport = opisBledu(opcje);
    var temat  = 'Zgłoszenie błędu na stronie (' + (opcje.kod || 'NIEZNANY') + ')';
    var mailto = 'mailto:' + EMAIL +
                 '?subject=' + encodeURIComponent(temat) +
                 '&body='    + encodeURIComponent('Opisz krótko, co robiłeś/aś, gdy pojawił się błąd:\n\n\n' +
                                                  '--- dane techniczne, zostaw bez zmian ---\n' + raport);

    var box = document.createElement('div');
    box.id = ID;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', ID + '-tytul');

    var tlo = document.createElement('div');
    tlo.className = 'ud-aw-tlo';
    tlo.addEventListener('click', zamknij);

    var okno = document.createElement('div');
    okno.className = 'ud-aw-okno';

    var ikona = document.createElement('div');
    ikona.className = 'ud-aw-ikona';
    ikona.setAttribute('aria-hidden', 'true');
    ikona.textContent = '!';

    var tytul = document.createElement('h2');
    tytul.id = ID + '-tytul';
    tytul.textContent = opcje.tytul || 'Coś poszło nie tak';

    var opis = document.createElement('p');
    opis.textContent = opcje.opis ||
      'Strona napotkała problem techniczny i Twoje zgłoszenie mogło do nas nie dotrzeć. ' +
      'Zadzwoń — załatwimy sprawę od ręki. Będziemy też wdzięczni za zgłoszenie tego błędu.';

    var tel = document.createElement('a');
    tel.className = 'ud-aw-tel';
    tel.href = 'tel:' + TELEFON_LINK;
    tel.textContent = '\uD83D\uDCDE ' + TELEFON;
    tel.addEventListener('click', function () { zdarzenieGA('awaria_telefon', opcje.kod); });

    var zglos = document.createElement('a');
    zglos.className = 'ud-aw-zglos';
    zglos.href = mailto;
    zglos.textContent = 'Zgłoś błąd e-mailem';
    zglos.addEventListener('click', function () { zdarzenieGA('awaria_zgloszenie', opcje.kod); });

    var zamknijBtn = document.createElement('button');
    zamknijBtn.type = 'button';
    zamknijBtn.className = 'ud-aw-zamknij';
    zamknijBtn.textContent = 'Zamknij';
    zamknijBtn.addEventListener('click', zamknij);

    var det = document.createElement('details');
    var sum = document.createElement('summary');
    sum.textContent = 'Szczegóły techniczne';
    var pre = document.createElement('pre');
    pre.textContent = raport;
    var kopiuj = document.createElement('button');
    kopiuj.type = 'button';
    kopiuj.className = 'ud-aw-kopiuj';
    kopiuj.textContent = 'Kopiuj szczegóły';
    kopiuj.addEventListener('click', function () {
      var ok = function () { kopiuj.textContent = 'Skopiowano \u2713'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raport).then(ok, function () { zaznacz(pre); });
      } else { zaznacz(pre); }
    });
    det.appendChild(sum); det.appendChild(pre); det.appendChild(kopiuj);

    okno.appendChild(ikona);
    okno.appendChild(tytul);
    okno.appendChild(opis);
    okno.appendChild(tel);
    okno.appendChild(zglos);
    okno.appendChild(zamknijBtn);
    okno.appendChild(det);
    box.appendChild(tlo);
    box.appendChild(okno);
    document.body.appendChild(box);
    document.body.classList.add('ud-awaria-blokada');
    document.addEventListener('keydown', naEsc);
    try { tel.focus(); } catch (e) {}

    zdarzenieGA('awaria_modal', opcje.kod);
    if (window.console && console.warn) console.warn('[awaria] ' + raport);
  }

  function zaznacz(el) {
    try {
      var r = document.createRange(); r.selectNodeContents(el);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch (e) {}
  }

  function zdarzenieGA(nazwa, kod) {
    try { if (typeof window.gtag === 'function') window.gtag('event', nazwa, { kod_bledu: kod || 'NIEZNANY' }); } catch (e) {}
  }

  /* ── automatyczne wychwytywanie awarii ─────────────────── */
  /* Tylko błędy z naszych własnych skryptów. Błędy z GTM-a, Pixela czy
     Turnstile'a raportowane są jako "Script error." bez pliku — te ignorujemy,
     bo nie psują strony użytkownikowi, a modal tylko by straszył. */
  function naszSkrypt(plik) {
    return !!plik && plik.indexOf(location.origin) === 0;
  }

  function auto(kod, szczegoly) {
    if (autoZuzyty) return;
    autoZuzyty = true;
    pokaz({ kod: kod, szczegoly: szczegoly });
  }

  window.addEventListener('error', function (e) {
    if (e && e.target && e.target !== window && e.target.tagName) return; // błąd wczytania zasobu — nie straszymy
    if (!naszSkrypt(e && e.filename)) return;
    auto('SKRYPT', (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    var stack = (r && r.stack) || '';
    if (stack.indexOf(location.origin) === -1) return; // nie nasz kod
    auto('PROMISE', (r && r.message) || String(r));
  });

  window.Awaria = { pokaz: pokaz, zamknij: zamknij, TELEFON: TELEFON };
})();
