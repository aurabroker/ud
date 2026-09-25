/* Test ścieżki konwersji Google Ads dla pełnego wniosku.
   Pilnuje regresji z 07.06.2026: bramka Turnstile trafiła do style.js, a widget
   tylko do formularz.html. Na index.html wysyłka przerywała się po cichu, więc
   nie było redirectu na /thankyou.html, a tym samym eventu konwersji.
   Konwersje stały trzy miesiące i nikt tego nie zauważył, bo strona wyglądała OK. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const CSP = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').match(/Content-Security-Policy:\s*(.*)/)[1].trim();
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg'};

const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  const h = {'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff'};
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, {...h,'Content-Type':'text/html'}); return res.end('404'); }
  res.writeHead(200, {...h, 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});

let failed = 0;
const ok = (name, cond, extra) => { console.log(`  ${cond ? 'OK  ' : 'BLAD'} ${name}${extra && !cond ? ' -> ' + extra : ''}`); if (!cond) failed++; };

const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  async function nowaStrona(odpowiedz, strona = '/index.html') {
    const zapytania = [];
    const ctx = await browser.newContext();
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') return route.continue();
      if (u.hostname.endsWith('supabase.co')) {
        zapytania.push({ url: u.href, ciało: route.request().postData() });
        if (!u.pathname.startsWith('/functions/v1/form-submit')) return route.abort('failed');
        return route.fulfill({ status: odpowiedz.status, contentType: 'application/json',
          body: JSON.stringify(odpowiedz.body), headers: {'Access-Control-Allow-Origin':'*'} });
      }
      const t = route.request().resourceType();
      return route.fulfill({ status: 200, contentType: t === 'stylesheet' ? 'text/css' : 'text/javascript',
        body: '', headers: {'Access-Control-Allow-Origin':'*'} });
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
      /* Widget Turnstile jest zastubowany — realny nie wystartuje bez sieci. */
      window.__resety = [];
      window.turnstile = { reset: el => window.__resety.push(el && el.className) };
    });
    await page.goto(BASE + strona, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    return { ctx, page, zapytania };
  }

  const wyslijWniosek = (page, { token = 'test-token', usunWidget = false } = {}) =>
    page.evaluate(({ token, usunWidget }) => {
      const f = document.getElementById('insurance-form');
      if (usunWidget) f.querySelectorAll('.cf-turnstile').forEach(el => el.remove());
      if (token) {
        const t = document.createElement('input');
        t.type = 'hidden'; t.name = 'cf-turnstile-response'; t.value = token;
        f.appendChild(t);
      }
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, { token, usunWidget });

  /* ── 1. udana wysyłka prowadzi na stronę konwersji ── */
  console.log('\n=== wniosek / udana wysyłka → /thankyou.html ===');
  {
    const { ctx, page, zapytania } = await nowaStrona({ status: 200, body: { status: 'success' } });
    await wyslijWniosek(page);
    await page.waitForURL('**/thankyou.html', { timeout: 5000 }).catch(() => {});

    ok('trafia do Edge Function form-submit', zapytania.filter(z => z.url.includes('/functions/v1/form-submit')).length === 1,
       JSON.stringify(zapytania.map(z => z.url)));
    ok('przekierowanie na stronę konwersji', page.url().endsWith('/thankyou.html'), page.url());

    /* thankyou.html buduje własny gtag, który wrzuca argumenty do dataLayer */
    const dl = await page.evaluate(() => (window.dataLayer || []).map(a => Array.from(a)));
    const konwersja = dl.find(a => a[0] === 'event' && a[1] === 'conversion');
    const configi   = dl.filter(a => a[0] === 'config').map(a => a[1]);

    ok('odpala się event konwersji', !!konwersja, JSON.stringify(dl));
    ok('konwersja ma poprawne send_to', konwersja && konwersja[2] &&
       konwersja[2].send_to === 'AW-18020137303/_uZeCOTG_KwcENfy1ZBD', JSON.stringify(konwersja && konwersja[2]));
    ok('strona konwersji konfiguruje Google Ads', configi.includes('AW-18020137303'), configi.join(','));
    ok('strona konwersji konfiguruje GA4', configi.includes('G-MGB0RBTCC9'), configi.join(','));
    ok('zero naruszeń CSP', (await page.evaluate(() => window.__csp.length)) === 0);
    await ctx.close();
  }

  /* ── 2. brak widgetu w DOM = awaria konfiguracji, nie wina użytkownika ── */
  console.log('\n=== wniosek / brak widgetu Turnstile w DOM ===');
  {
    const { ctx, page, zapytania } = await nowaStrona({ status: 200, body: { status: 'success' } });
    await wyslijWniosek(page, { token: null, usunWidget: true });
    await page.waitForTimeout(500);

    const stan = await page.evaluate(() => {
      const m = document.getElementById('ud-awaria');
      return { modal: !!m, tresc: m ? m.textContent : '', url: location.pathname };
    });
    ok('modal awarii się pokazał', stan.modal);
    ok('niesie kod TURNSTILE_BRAK_WIDGETU', /TURNSTILE_BRAK_WIDGETU/.test(stan.tresc), stan.tresc.slice(0, 80));
    const wyslane = zapytania.filter(z => z.url.includes('/functions/v1/form-submit'));
    ok('wysyłka nie poleciała', wyslane.length === 0, JSON.stringify(wyslane.map(z => z.url)));
    ok('bez fałszywego redirectu na konwersję', stan.url !== '/thankyou.html', stan.url);
    await ctx.close();
  }

  /* ── 3. widget jest, token nierozwiązany = zwykły komunikat ── */
  console.log('\n=== wniosek / widget jest, brak tokenu ===');
  {
    const { ctx, page, zapytania } = await nowaStrona({ status: 200, body: { status: 'success' } });
    await wyslijWniosek(page, { token: null });
    await page.waitForTimeout(500);

    const stan = await page.evaluate(() => ({
      awaria: !!document.getElementById('ud-awaria'),
      blad: !document.getElementById('error-modal').classList.contains('hidden'),
      tresc: document.getElementById('error-message').textContent,
    }));
    ok('bez modala awarii', !stan.awaria);
    ok('zwykły komunikat o robocie', stan.blad && /nie jesteś robotem/.test(stan.tresc), stan.tresc);
    ok('wysyłka nie poleciała', zapytania.filter(z => z.url.includes('/functions/v1/form-submit')).length === 0);
    await ctx.close();
  }

  /* ── 4. token odświeżany przy wejściu na ostatni krok kreatora ── */
  console.log('\n=== wniosek / reset Turnstile na ostatnim kroku ===');
  {
    const { ctx, page } = await nowaStrona({ status: 200, body: { status: 'success' } });

    const wynik = await page.evaluate(() => {
      /* zdejmujemy walidację, żeby przejść kreator bez wypełniania wywiadu */
      document.querySelectorAll('#insurance-form [required]').forEach(el => el.removeAttribute('required'));
      document.querySelectorAll('#insurance-form [pattern]').forEach(el => el.removeAttribute('pattern'));
      const przed = window.__resety.length;
      for (let i = 0; i < 10; i++) goNext();
      return {
        przed,
        po: window.__resety.length,
        widoczny: !document.getElementById('turnstile-wrapper').classList.contains('hidden'),
        submitWidoczny: !document.getElementById('submit-btn').classList.contains('hidden'),
      };
    });

    ok('kreator dotarł do ostatniego kroku', wynik.submitWidoczny);
    ok('widget Turnstile odsłonięty', wynik.widoczny);
    ok('token odświeżony dokładnie raz', wynik.po - wynik.przed === 1, `przed ${wynik.przed}, po ${wynik.po}`);
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log('\n' + (failed ? `WYNIK: BLEDY (${failed})` : 'Wszystkie testy przeszły'));
  process.exit(failed ? 1 : 0);
})();
