/* Test szybkiego kontaktu na index.html.
   Pilnuje regresji z 15.06.2026: formularz strzelał prosto do PostgREST
   z polem cf-turnstile-response, którego nie ma w udochodu_contacts —
   każda wysyłka kończyła się błędem 400 i lead przepadał. */
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

(async () => {
  await new Promise(r => server.listen(8098, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* odpowiedz: co Edge Function ma zwrócić w danym scenariuszu */
  async function nowaStrona(odpowiedz) {
    const zapytania = [];
    const ctx = await browser.newContext();
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') return route.continue();
      if (u.hostname.endsWith('supabase.co')) {
        zapytania.push({ url: u.href, ciało: route.request().postData() });
        if (!u.pathname.startsWith('/functions/v1/contact-submit')) return route.abort('failed');
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
      window.turnstile = { reset: () => { window.__turnstileReset = true; } };   // widget jest zastubowany
    });
    await page.goto('http://127.0.0.1:8098/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    return { ctx, page, zapytania };
  }

  const wyslij = page => page.evaluate(() => {
    document.getElementById('quick-name').value  = 'Jan Testowy';
    document.getElementById('quick-email').value = 'jan@example.com';
    document.getElementById('quick-phone').value = '600100200';
    const f = document.getElementById('quick-form');
    const t = document.createElement('input');
    t.type = 'hidden'; t.name = 'cf-turnstile-response'; t.value = 'test-token';
    f.appendChild(t);
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });

  /* ── 1. wysyłka się udaje ── */
  console.log('\n=== szybki kontakt / wysyłka przyjęta ===');
  {
    const { ctx, page, zapytania } = await nowaStrona({ status: 200, body: { status: 'success' } });
    await wyslij(page);
    await page.waitForTimeout(900);

    const doFunkcji = zapytania.filter(z => z.url.includes('/functions/v1/contact-submit'));
    const doRest    = zapytania.filter(z => z.url.includes('/rest/v1/udochodu_contacts'));
    ok('trafia do Edge Function contact-submit', doFunkcji.length === 1, JSON.stringify(zapytania.map(z => z.url)));
    ok('nie strzela prosto do PostgREST', doRest.length === 0, JSON.stringify(doRest.map(z => z.url)));

    const payload = JSON.parse(doFunkcji[0]?.ciało || '{}');
    ok('payload ma komplet danych', payload.name === 'Jan Testowy' && payload.email === 'jan@example.com' && payload.phone === '600100200', JSON.stringify(payload));
    ok('payload niesie token Turnstile', payload['cf-turnstile-response'] === 'test-token');
    ok('payload bez pól spoza kontraktu', Object.keys(payload).sort().join(',') === 'cf-turnstile-response,email,name,phone', Object.keys(payload).join(','));

    const stan = await page.evaluate(() => ({
      sukces: !document.getElementById('quick-success').classList.contains('hidden'),
      formularz: document.getElementById('quick-form').classList.contains('hidden'),
      modal: !!document.getElementById('ud-awaria'),
      csp: window.__csp.length,
    }));
    ok('pokazuje się potwierdzenie', stan.sukces);
    ok('formularz znika', stan.formularz);
    ok('bez modala awarii', !stan.modal);
    ok('zero naruszeń CSP', stan.csp === 0);
    await ctx.close();
  }

  /* ── 2. funkcja odrzuca wysyłkę ── */
  console.log('\n=== szybki kontakt / funkcja zwraca błąd ===');
  {
    const { ctx, page } = await nowaStrona({ status: 400, body: { status: 'error', message: 'Weryfikacja bezpieczeństwa nie powiodła się.' } });
    await wyslij(page);
    await page.waitForTimeout(900);

    const stan = await page.evaluate(() => {
      const m = document.getElementById('ud-awaria');
      return {
        modal: !!m,
        opis: m ? m.querySelector('p').textContent : '',
        szczegoly: m ? (m.querySelector('pre') || {}).textContent || '' : '',
        sukces: !document.getElementById('quick-success').classList.contains('hidden'),
        przyciskOdblokowany: !document.getElementById('quick-submit').disabled,
        turnstileReset: window.__turnstileReset === true,
      };
    });
    ok('modal awarii się pokazał', stan.modal);
    ok('modal niesie komunikat z serwera', /Weryfikacja bezpieczeństwa/.test(stan.opis), stan.opis);
    ok('kod błędu w szczegółach', /SZYBKI_KONTAKT_ODPOWIEDZ/.test(stan.szczegoly), stan.szczegoly.slice(0, 60));
    ok('bez fałszywego potwierdzenia', !stan.sukces);
    ok('przycisk znów aktywny', stan.przyciskOdblokowany);
    ok('widget Turnstile zresetowany', stan.turnstileReset);
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} testów nie przeszło` : '\nWszystkie testy przeszły');
  process.exit(failed ? 1 : 0);
})();
