/* Test kontraktu: formularz wniosku ↔ Edge Function form-submit.
 *
 * Pozostałe testy pilnują, żeby wysyłka w ogóle poleciała i żeby odpalił się
 * event konwersji. Żaden nie sprawdza, CO leci w payloadzie i czy funkcja
 * po drugiej stronie to przyjmie. Ten test sprawdza właśnie to.
 *
 * Wzorzec awarii jest zawsze ten sam (patrz CLAUDE.md): strona wygląda
 * normalnie, nic się nie wysypuje, po prostu dane nie docierają albo wniosek
 * nie da się wysłać, a dowiadujemy się o tym z raportu po trzech miesiącach.
 *
 * REFERENCJA WDROŻONEJ FUNKCJI
 * Stan produkcji odczytany 16.09.2026:
 *   projekt  kukvgsjrmrqtzhkszzum
 *   funkcja  form-submit, wersja 20
 *   sha256   05bbd41d1b1969aeee8ffe135466145e10607107986ea9c9812991406fc4c776
 * Wdrożona wersja zawiera dwie reguły biznesowe („spec zmiana_1" i „zmiana_2").
 * Repo było od nich starsze — stąd ten test. Funkcje wdrozona*() to wierny port
 * tych reguł; służą do oceny prawdziwego payloadu zebranego z przeglądarki,
 * a osobna sekcja pilnuje, żeby plik w repo dalej je zawierał.
 *
 * WSZYSTKO SPRAWDZAMY NA OBU STRONACH. style.js obsługuje #insurance-form na
 * index.html i formularz.html — bramka dodana tylko do jednej z nich to
 * dokładnie ten błąd, na którym poległ Turnstile 07.06.2026.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CSP  = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').match(/Content-Security-Policy:\s*(.*)/)[1].trim();
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};

const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  const h = {'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff'};
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, {...h,'Content-Type':'text/html'}); return res.end('404'); }
  res.writeHead(200, {...h, 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});

let failed = 0;
const ok = (name, cond, extra) => {
  console.log(`  ${cond ? 'OK  ' : 'BLAD'} ${name}${!cond && extra ? ' -> ' + extra : ''}`);
  if (!cond) failed++;
};

/* ── port reguł z WDROŻONEJ funkcji (wersja 20) ───────────────────────── */
const wdrozonaYesNo = v => (v === 'Yes' || v === 'yes' || v === true) ? true
                         : (v === 'No'  || v === 'no'  || v === false) ? false : null;

const wdrozonaParseAmount = raw => {
  if (raw == null) return NaN;
  const c = String(raw).replace(/[\s ]/g, '').replace(/z[łl]/gi, '').replace(/pln/gi, '').replace(',', '.');
  const m = c.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};

/* Zwraca komunikat odrzucenia (400) albo null, gdy funkcja przyjmie payload. */
function wdrozonaOdrzuca(body) {
  const perm = wdrozonaYesNo(body.riskPermIncapacity ?? body.risk_perm_incapacity);
  const temp = wdrozonaYesNo(body.riskTempIncapacity ?? body.risk_temp_incapacity);

  /* spec zmiana_1 — „Okresowa" jest ryzykiem podstawowym */
  if (perm === true && temp !== true) return 'zmiana_1: nie można wybrać wyłącznie „Trwałej niezdolności"';

  /* spec zmiana_2 — powyżej 1 000 000 zł wymagana pełna ankieta hs_* */
  const ankieta = Object.keys(body).filter(k => k.startsWith('hs_'));
  const kwota   = wdrozonaParseAmount(body.permIncapacitySum ?? body.perm_incapacity_sum);
  if (perm === true && Number.isFinite(kwota) && kwota > 1_000_000 && ankieta.length === 0)
    return 'zmiana_2: przy sumie trwałej > 1 000 000 zł wymagana jest pełna ankieta medyczna (pola hs_*)';

  return null;
}

/* ── yesNo z REPO — wczytane z prawdziwego pliku, nie przepisane ───────── */
function repoYesNo() {
  const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/form-submit/index.ts'), 'utf8');
  const m = src.match(/function yesNo\(val: unknown\): boolean \| null \{([\s\S]*?)\n\}/);
  if (!m) throw new Error('nie znalazłem yesNo() w supabase/functions/form-submit/index.ts');
  return new Function('val', m[1].replace(/: unknown/g, ''));
}

/* Pola bool wysyłane przez formularz jako radio (yes/no) — pełna lista z DOM. */
const POLA_RADIO = [
  'med_heart','med_diabetes','med_bones','med_stomach','med_neuro','med_surgery','med_aids',
  'weightChange','takesMeds','pendingDiagnosis','disabilityCongenital','smoker',
  'eventHospitalization','eventSickLeave30','eventFurtherDiagnosis','nwPermanentDamage',
];

const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  async function nowaStrona(odpowiedz, strona) {
    const payloady = [];
    const ctx = await browser.newContext();
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') return route.continue();
      if (u.hostname.endsWith('supabase.co') && u.pathname.includes('/functions/v1/form-submit')) {
        payloady.push(route.request().postData());
        return route.fulfill({ status: odpowiedz.status, contentType: 'application/json',
          body: JSON.stringify(odpowiedz.body), headers: {'Access-Control-Allow-Origin':'*'} });
      }
      if (u.hostname.endsWith('supabase.co')) return route.abort('failed');
      const t = route.request().resourceType();
      return route.fulfill({ status: 200, contentType: t === 'stylesheet' ? 'text/css' : 'text/javascript',
        body: '', headers: {'Access-Control-Allow-Origin':'*'} });
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__resety = [];
      window.turnstile = { reset: el => window.__resety.push(el ? (el.className || '(element bez klasy)') : '(bez argumentu)') };
    });
    await page.goto(BASE + strona, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    return { ctx, page, payloady };
  }

  /* Wypełnia wniosek tak, jak zrobiłby to klient, i wysyła. */
  const wypelnijIWyslij = (page, opcje) => page.evaluate(o => {
    const f = document.getElementById('insurance-form');
    const set = (sel, val) => { const e = f.querySelector(sel); if (!e) return false;
      e.value = val; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); return true; };
    const radio = (name, val) => { const e = f.querySelector(`[name="${name}"][value="${val}"]`);
      if (e) { e.checked = true; e.dispatchEvent(new Event('change', {bubbles:true})); } return !!e; };
    const check = (name, on) => { const e = f.querySelector(`[name="${name}"]`);
      if (e) { e.checked = on; e.dispatchEvent(new Event('change', {bubbles:true})); } return !!e; };

    set('[name="fullName"]', 'Jan Testowy');
    set('[name="email"]', 'jan@example.com');
    set('[name="phone"]', '500100200');
    set('[name="pesel"]', '44051401359');
    set('[name="profession"]', 'programista');
    set('[name="weight"]', '80');
    set('[name="height"]', '180');

    /* Klient deklaruje chorobę serca — to musi dojechać do bazy. */
    radio('med_heart', 'yes');
    set('[name="med_heart_notes"]', 'Arytmia, leczona od 2024');
    radio('smoker', 'yes');

    check('riskTempIncapacity', o.okresowa);
    if (o.okresowa) set('[name="tempIncapacitySum"]', '8000');
    check('riskPermIncapacity', true);
    set('[name="permIncapacitySum"]', o.sumaTrwalej);

    check('exclusions_accepted', true);
    check('informedAccepted', true);

    const t = document.createElement('input');
    t.type = 'hidden'; t.name = 'cf-turnstile-response'; t.value = 'token-testowy';
    f.appendChild(t);
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, opcje);

  /* ── 1. repo vs produkcja: czy repo zrozumie to, co wysyła formularz ── */
  console.log('\n=== wniosek / odpowiedzi medyczne dojeżdżają do bazy ===');
  {
    const { ctx, page, payloady } = await nowaStrona(
      { status: 200, body: { status: 'success' } }, '/formularz.html');
    await wypelnijIWyslij(page, { okresowa: true, sumaTrwalej: '500000' });
    await page.waitForTimeout(600);

    ok('wysyłka poleciała', payloady.length === 1, 'payloadów: ' + payloady.length);
    const body = JSON.parse(payloady[0] || '{}');

    ok('deklaracja choroby serca jest w payloadzie', body.med_heart !== undefined, JSON.stringify(body.med_heart));

    /* Formularz wysyła radio jako 'yes'/'no' (małą literą — tak są w HTML).
       yesNo() w repo rozumie wyłącznie 'Yes'/'No', więc zwraca null, rekord
       jest czyszczony z nulli, a kolumna med_* ma DEFAULT false. Efekt: klient
       deklaruje chorobę, a w bazie ląduje „brak choroby". */
    const yesNo = repoYesNo();
    const gubione = POLA_RADIO.filter(f => body[f] !== undefined && yesNo(body[f]) === null);
    ok('repo rozumie każdą odpowiedź tak/nie z formularza', gubione.length === 0,
       `funkcja z repo gubi ${gubione.length} pól: ${gubione.join(', ')}`);
    ok('deklaracja „choroba serca: TAK" zapisuje się jako true', yesNo(body.med_heart) === true,
       `yesNo(${JSON.stringify(body.med_heart)}) = ${yesNo(body.med_heart)} → kolumna med_heart przyjmie DEFAULT false`);

    /* Opisy chorób z ankiety — w repo nie ma ich w mapowaniu kolumn ani w form_data. */
    const opisy = Object.keys(body).filter(k => k.endsWith('_notes') && body[k]);
    const repoSrc = fs.readFileSync(path.join(ROOT, 'supabase/functions/form-submit/index.ts'), 'utf8');
    ok('opisy chorób (med_*_notes) mają gdzie się zapisać w wersji z repo',
       opisy.length === 0 || /_notes|form_data/.test(repoSrc),
       `formularz wysyła ${opisy.join(', ')}, a funkcja z repo nie mapuje ich na żadną kolumnę`);

    await ctx.close();
  }

  /* ── 2. reguły wdrożonej funkcji mają odpowiednik w formularzu — na OBU stronach ── */
  for (const strona of ['/formularz.html', '/index.html']) {
    console.log(`\n=== ${strona} / wniosek nie do przyjęcia przez produkcję ===`);

    /* sam wybór „Trwałej" — musi zostać zatrzymany w formularzu, z komunikatem */
    {
      const { ctx, page, payloady } = await nowaStrona(
        { status: 200, body: { status: 'success' } }, strona);
      await wypelnijIWyslij(page, { okresowa: false, sumaTrwalej: '300000' });
      await page.waitForTimeout(600);

      const body = JSON.parse(payloady[0] || '{}');
      ok('sam wybór „Trwałej" nie idzie na serwer',
         payloady.length === 0 || wdrozonaOdrzuca(body) === null,
         'wdrożona funkcja odwraca to błędem 400: ' + wdrozonaOdrzuca(body));

      /* Cicha blokada jest gorsza niż błąd 400 — klient musi wiedzieć, co poprawić. */
      const komunikat = await page.evaluate(() => {
        const e = document.getElementById('risks-error');
        return e ? { jest: !e.classList.contains('hidden'), tekst: e.textContent } : null;
      });
      ok('strona ma element #risks-error', komunikat !== null,
         'brak elementu — bramka w style.js nie ma gdzie pokazać powodu');
      ok('klient widzi powód zatrzymania', !!(komunikat && komunikat.jest && /Okresow/.test(komunikat.tekst)),
         JSON.stringify(komunikat));

      /* Token musi zostać nietknięty — nie było wysyłki, nie ma czego palić. */
      const resety = await page.evaluate(() => window.__resety);
      ok('token Turnstile nie został spalony', resety.length === 0, JSON.stringify(resety));
      await ctx.close();
    }

    /* Bramka bez miejsca na komunikat nie może zatrzymywać klienta po cichu —
       to dokładnie ten błąd, na którym poległ Turnstile 07.06.2026. */
    {
      const { ctx, page, payloady } = await nowaStrona(
        { status: 200, body: { status: 'success' } }, strona);
      await page.evaluate(() => document.getElementById('risks-error')?.remove());
      await wypelnijIWyslij(page, { okresowa: false, sumaTrwalej: '300000' });
      await page.waitForTimeout(600);

      const widoczny = await page.evaluate(() => {
        const m = document.getElementById('error-modal');
        return {
          modal: m && !m.classList.contains('hidden'),
          tekst: document.getElementById('error-message').textContent,
          awaria: !!document.getElementById('ud-awaria'),
        };
      });
      ok('bez #risks-error klient i tak dostaje powód',
         !!(widoczny.modal && /Okresow/.test(widoczny.tekst)) || widoczny.awaria,
         JSON.stringify(widoczny));
      ok('wniosek dalej nie leci na pewne 400', payloady.length === 0, 'payloadów: ' + payloady.length);
      await ctx.close();
    }

    /* suma powyżej progu — payload musi nieść ankietę hs_* */
    {
      const { ctx, page, payloady } = await nowaStrona(
        { status: 200, body: { status: 'success' } }, strona);
      await wypelnijIWyslij(page, { okresowa: true, sumaTrwalej: '1500000' });
      await page.waitForTimeout(600);

      const body = JSON.parse(payloady[0] || '{}');
      const ankieta = Object.keys(body).filter(k => k.startsWith('hs_'));
      ok('suma trwałej > 1 000 000 zł niesie ankietę medyczną hs_*', ankieta.length > 0,
         'payload bez pól hs_ — wdrożona funkcja odrzuca taki wniosek: ' + wdrozonaOdrzuca(body));
      ok('wdrożona funkcja przyjmuje ten payload', wdrozonaOdrzuca(body) === null, wdrozonaOdrzuca(body));

      /* Funkcja czyta wyłącznie 'tak'/'nie'; cokolwiek innego jest po cichu
         pomijane i wniosek znów wpada w wymóg ankiety. */
      const zleWartosci = ankieta.filter(k => body[k] !== 'tak' && body[k] !== 'nie');
      ok('odpowiedzi ankiety są w formacie tak/nie', zleWartosci.length === 0,
         zleWartosci.map(k => `${k}=${body[k]}`).join(', '));

      /* Ankieta nadpisuje kolumny płaskie — musi mówić to samo co reszta payloadu,
         inaczej deklaracja klienta zmienia się po drodze. */
      ok('ankieta zgadza się z odpowiedziami z kreatora',
         body.hs_med_heart === 'tak' && body.med_heart === 'yes' &&
         body.hs_smoker === 'tak' && body.smoker === 'yes',
         `hs_med_heart=${body.hs_med_heart} med_heart=${body.med_heart} hs_smoker=${body.hs_smoker}`);
      /* index.html nie ma pól med_*_notes — pyta o choroby, ale nie daje ich opisać
         (formularz.html ma 7 takich pól). Różnica jest starsza niż ten test i czeka
         na decyzję właściciela, bo dokładanie pól na stronie głównej dotyka ścieżki
         konwersji. Funkcja przyjmuje ankietę bez opisów, więc to nie blokada. */
      const maPolaOpisu = await page.evaluate(() =>
        !!document.querySelector('#insurance-form [name="med_heart_notes"]'));
      ok('opis choroby jedzie z odpowiedzią „tak" (o ile strona go zbiera)',
         !maPolaOpisu || /Arytmia/.test(body.hsd_med_heart || ''),
         JSON.stringify(body.hsd_med_heart));
      await ctx.close();
    }

    /* ── 3. nieudana wysyłka: reset tokenu i komunikat adekwatny do przyczyny ── */
    {
      const { ctx, page, payloady } = await nowaStrona(
        { status: 500, body: { status: 'error', message: 'Błąd zapisu. Spróbuj ponownie.' } }, strona);
      await wypelnijIWyslij(page, { okresowa: true, sumaTrwalej: '500000' });
      await page.waitForTimeout(600);

      ok('wysyłka poleciała', payloady.length === 1, 'payloadów: ' + payloady.length);
      /* Token Turnstile jest jednorazowy. Bez resetu druga próba leci zużytym
         tokenem i funkcja odbija ją komunikatem o weryfikacji bezpieczeństwa —
         klient widzi wtedy błąd, którego nie da się obejść inaczej niż F5. */
      const resety = await page.evaluate(() => window.__resety);
      ok('widget Turnstile zresetowany po błędzie', resety.length > 0,
         'style.js nie woła turnstile.reset() — app.js (szybki kontakt) robi to poprawnie');
      /* Na index.html są dwa widgety; reset bez argumentu trafiłby w szybki kontakt. */
      ok('zresetowany widget z formularza wniosku, nie inny',
         resety.every(k => k !== '(bez argumentu)'), JSON.stringify(resety));
      ok('awaria serwera → modal z prośbą o telefon',
         await page.evaluate(() => !!document.getElementById('ud-awaria')));
      await ctx.close();
    }

    /* Odpowiedź walidacyjna to nie awaria — klient ma co poprawić sam. */
    {
      const { ctx, page } = await nowaStrona(
        { status: 400, body: { status: 'error', message: 'Nieprawidłowy PESEL.' } }, strona);
      await wypelnijIWyslij(page, { okresowa: true, sumaTrwalej: '500000' });
      await page.waitForTimeout(600);

      const stan = await page.evaluate(() => ({
        awaria: !!document.getElementById('ud-awaria'),
        modal:  !document.getElementById('error-modal').classList.contains('hidden'),
        tekst:  document.getElementById('error-message').textContent,
      }));
      ok('błąd walidacji nie udaje awarii', !stan.awaria, 'wyskoczył modal awarii');
      ok('klient dostaje komunikat serwera', stan.modal && /PESEL/.test(stan.tekst), JSON.stringify(stan));
      const resety = await page.evaluate(() => window.__resety);
      ok('token zresetowany także po błędzie walidacji', resety.length > 0, JSON.stringify(resety));
      await ctx.close();
    }
  }

  /* ── 4. repo nie może się rozjechać z produkcją ── */
  console.log('\n=== form-submit w repo odwzorowuje wdrożoną wersję 20 ===');
  {
    const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/form-submit/index.ts'), 'utf8');
    ok('yesNo rozumie małe litery', /val === 'yes'/.test(src) && /val === 'no'/.test(src));
    ok('reguła zmiana_1 (Okresowa wymagana)', /risk_temp_incapacity !== true/.test(src));
    ok('reguła zmiana_2 (próg ankiety)', /HEALTH_SURVEY_THRESHOLD\s*=\s*1_000_000/.test(src));
    ok('zbieranie ankiety hs_*', /startsWith\('hs_'\)/.test(src));
    ok('pierwszeństwo ankiety nad checkboxami', /HEALTH_SURVEY_COLUMNS/.test(src));
    ok('zapis całego payloadu do form_data', /record\.form_data = formData/.test(src));
    ok("source domyślnie 'form'", /\?\? 'form'/.test(src));
  }

  await browser.close();
  server.close();

  console.log('\n================ PODSUMOWANIE ================');
  console.log(failed ? `WYNIK: ${failed} sprawdzeń nie przeszło` : 'WYNIK: OK');
  process.exit(failed ? 1 : 0);
})();
