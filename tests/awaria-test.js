/* Test modala awarii: symuluje padnięty backend i sprawdza, czy użytkownik
   dostaje modal z numerem telefonu — na każdej stronie z formularzem. */
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

const SUPABASE_SHIM = `
  (function(){ function chain(){ return new Proxy(function(){}, {
      get: function(t,k){ if(k==='then') return function(res){ res({data:[],error:null}); };
                          return function(){ return chain(); }; },
      apply: function(){ return chain(); } }); }
    window.supabase = { createClient: function(){ return chain(); } }; })();
`;

let failed = 0;
const ok = (name, cond, extra) => { console.log(`  ${cond ? 'OK  ' : 'BLAD'} ${name}${extra && !cond ? ' -> ' + extra : ''}`); if (!cond) failed++; };

(async () => {
  await new Promise(r => server.listen(8097, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  const opcjeCDN = { zabijSupabaseJs: false };

  async function nowaStrona(sciezka) {
    const ctx = await browser.newContext();
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') return route.continue();
      if (u.hostname.endsWith('supabase.co')) return route.abort('failed');   // AWARIA BACKENDU
      if (opcjeCDN.zabijSupabaseJs && u.href.includes('supabase-js')) return route.abort('failed');
      const t = route.request().resourceType();
      const body = u.href.includes('supabase-js') ? SUPABASE_SHIM : '';
      return route.fulfill({ status: 200, contentType: t === 'stylesheet' ? 'text/css' : 'text/javascript',
        body: body, headers: {'Access-Control-Allow-Origin':'*'} });
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.__csp = [];
      document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
    await page.goto('http://127.0.0.1:8097' + sciezka, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    return { ctx, page };
  }

  const stanModala = page => page.evaluate(() => {
    const m = document.getElementById('ud-awaria');
    if (!m) return { jest: false };
    const tel = m.querySelector('.ud-aw-tel');
    const okno = m.querySelector('.ud-aw-okno').getBoundingClientRect();
    return { jest: true, widoczny: okno.width > 200 && okno.height > 100,
      telHref: tel && tel.getAttribute('href'), telTekst: tel && tel.textContent.trim(),
      mailto: (m.querySelector('.ud-aw-zglos')||{}).getAttribute && m.querySelector('.ud-aw-zglos').getAttribute('href').slice(0, 60),
      szczegoly: (m.querySelector('pre')||{}).textContent || '',
      focusNaTel: document.activeElement === tel, scrollZablokowany: document.body.classList.contains('ud-awaria-blokada'),
      rola: m.getAttribute('role'), aria: m.getAttribute('aria-modal') };
  });

  /* ── 1. index.html — szybki kontakt przy padniętym Supabase ── */
  console.log('\n=== index.html / szybki kontakt (Supabase nie odpowiada) ===');
  {
    const { ctx, page } = await nowaStrona('/index.html');
    await page.evaluate(() => {
      document.getElementById('quick-name').value = 'Jan Testowy';
      document.getElementById('quick-email').value = 'jan@example.com';
      document.getElementById('quick-phone').value = '600100200';
      const f = document.getElementById('quick-form');
      const t = document.createElement('input');           // Turnstile jest zastubowany
      t.type = 'hidden'; t.name = 'cf-turnstile-response'; t.value = 'test-token';
      f.appendChild(t);
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await page.waitForTimeout(900);
    const m = await stanModala(page);
    ok('modal się pokazał', m.jest);
    ok('modal jest widoczny', !!m.widoczny);
    ok('numer telefonu klikalny', m.telHref === 'tel:+48504400901', m.telHref);
    ok('numer widoczny w treści', /504 400 901/.test(m.telTekst || ''), m.telTekst);
    ok('przycisk zgłoszenia błędu (mailto)', /^mailto:info@utratadochodu\.pl/.test(m.mailto || ''), m.mailto);
    ok('szczegóły zawierają kod błędu', /SZYBKI_KONTAKT/.test(m.szczegoly), m.szczegoly.slice(0,60));
    ok('szczegóły zawierają adres strony', /index\.html/.test(m.szczegoly));
    ok('focus na przycisku telefonu', m.focusNaTel);
    ok('scroll strony zablokowany', m.scrollZablokowany);
    ok('role=dialog + aria-modal', m.rola === 'dialog' && m.aria === 'true');
    ok('zero naruszeń CSP', (await page.evaluate(() => window.__csp)).length === 0);
    // zamykanie
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok('Escape zamyka modal', !(await stanModala(page)).jest);
    await ctx.close();
  }

  /* ── 2. formularz.html — wniosek przy padniętym backendzie ── */
  console.log('\n=== formularz.html / wniosek (backend nie odpowiada) ===');
  {
    const { ctx, page } = await nowaStrona('/formularz.html');
    await page.evaluate(() => {
      const f = document.getElementById('insurance-form');
      const t = document.createElement('input');
      t.type = 'hidden'; t.name = 'cf-turnstile-response'; t.value = 'test-token';
      f.appendChild(t);
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await page.waitForTimeout(900);
    const m = await stanModala(page);
    ok('modal się pokazał', m.jest);
    ok('numer telefonu klikalny', m.telHref === 'tel:+48504400901', m.telHref);
    ok('kod błędu wniosku w szczegółach', /WNIOSEK_/.test(m.szczegoly), m.szczegoly.slice(0,60));
    ok('zero naruszeń CSP', (await page.evaluate(() => window.__csp)).length === 0);
    // klik w tło zamyka
    await page.click('#ud-awaria .ud-aw-tlo', { position: { x: 5, y: 5 } }).catch(()=>{});
    await page.waitForTimeout(200);
    ok('kliknięcie w tło zamyka modal', !(await stanModala(page)).jest);
    await ctx.close();
  }

  /* ── 3. opinia.html — wysyłka opinii ── */
  console.log('\n=== opinia.html / opinia (backend nie odpowiada) ===');
  {
    const { ctx, page } = await nowaStrona('/opinia.html');
    const wynik = await page.evaluate(async () => {
      const f = document.getElementById('review-form');
      if (!f) return 'brak formularza';
      const t = document.createElement('input');
      t.type = 'hidden'; t.name = 'cf-turnstile-response'; t.value = 'test-token'; f.appendChild(t);
      document.getElementById('r-name').value   = 'Jan Testowy';
      document.getElementById('r-city').value   = 'Warszawa';
      document.getElementById('r-zawod').value  = 'programista';
      document.getElementById('r-rating').value = '5';
      document.getElementById('r-comment').value = 'Testowa opinia.';
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      return 'wyslano';
    });
    await page.waitForTimeout(1200);
    const m = await stanModala(page);
    ok('formularz opinii znaleziony', wynik === 'wyslano', wynik);
    ok('modal się pokazał', m.jest);
    ok('numer telefonu klikalny', m.telHref === 'tel:+48504400901', m.telHref);
    ok('zero naruszeń CSP', (await page.evaluate(() => window.__csp)).length === 0);
    await ctx.close();
  }

  /* ── 4. brak fałszywych alarmów: strona działa = brak modala ── */
  console.log('\n=== brak fałszywych alarmów (backend działa) ===');
  {
    const ctx = await browser.newContext();
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') return route.continue();
      const t = route.request().resourceType();
      const body = u.href.includes('supabase-js') ? SUPABASE_SHIM : (t === 'xhr' || t === 'fetch' ? '[]' : '');
      return route.fulfill({ status: 200, contentType: t === 'stylesheet' ? 'text/css' : 'text/javascript',
        body: body, headers: {'Access-Control-Allow-Origin':'*'} });
    });
    const page = await ctx.newPage();
    for (const p of ['/index.html', '/formularz.html', '/opinia.html', '/blog.html']) {
      await page.goto('http://127.0.0.1:8097' + p, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      ok(`${p}: modal NIE wyskoczył`, await page.evaluate(() => !document.getElementById('ud-awaria')));
    }
    await ctx.close();
  }

  /* ── 5. padnięty CDN z biblioteką — strona się wysypuje, modal ma to złapać ── */
  console.log('\n=== opinia.html / nie wczytał się supabase-js z CDN ===');
  {
    opcjeCDN.zabijSupabaseJs = true;
    const { ctx, page } = await nowaStrona('/opinia.html');
    await page.waitForTimeout(800);
    const m = await stanModala(page);
    ok('modal wyskoczył automatycznie', m.jest);
    ok('numer telefonu klikalny', m.telHref === 'tel:+48504400901', m.telHref);
    ok('kod błędu SKRYPT', /Kod: SKRYPT/.test(m.szczegoly || ''), (m.szczegoly||'').slice(0,80));
    opcjeCDN.zabijSupabaseJs = false;
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(`\n================ PODSUMOWANIE ================\n${failed === 0 ? 'WYNIK: OK — wszystkie sprawdzenia przeszły' : 'WYNIK: ' + failed + ' BLEDOW'}`);
  process.exit(failed ? 1 : 0);
})();
