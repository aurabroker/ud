const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = '/home/user/ud';

// CSP z _headers - dokladnie tak, jak serwuje Cloudflare Pages
const HDR_CSP = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8')
  .match(/Content-Security-Policy:\s*(.*)/)[1].trim();

const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
              '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.xml':'application/xml','.txt':'text/plain'};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(ROOT, url);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  const headers = {'Content-Security-Policy': HDR_CSP, 'X-Content-Type-Options': 'nosniff'};
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) {   // 404 jak na produkcji: text/html
    res.writeHead(404, {...headers, 'Content-Type': 'text/html'}); return res.end('<h1>404</h1>');
  }
  res.writeHead(200, {...headers, 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});

// URL-e realnie blokowane w konsoli uzytkownika + reszta zaleznosci
const CONNECT = [
  'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/jsd',
  'https://stats.g.doubleclick.net/g/collect?v=2&tid=G-MGB0RBTCC9',
  'https://ad.doubleclick.net/ccm/s/collect?auid=1',
  'https://region1.analytics.google.com/g/collect?v=2&tid=G-MGB0RBTCC9',
  'https://region1.google-analytics.com/g/collect?v=2',
  'https://www.google-analytics.com/g/collect?v=2',
  'https://analytics.google.com/g/collect?v=2',
  'https://www.google.com/ccm/collect?rcb=11',
  'https://www.google.com/pagead/form-data/18020137303',
  'https://google.com/pagead/form-data/18020137303',
  'https://google.com/ccm/form-data/18020137303',
  'https://www.google.pl/ccm/collect',
  'https://kukvgsjrmrqtzhkszzum.supabase.co/rest/v1/aura_articles?select=id',
  'https://cloudflareinsights.com/cdn-cgi/rum',
  'https://www.facebook.com/tr/',
  'https://connect.facebook.net/signals/config/4299065913693248',
];
const SCRIPTS = [
  'https://challenges.cloudflare.com/turnstile/v0/api.js',
  'https://connect.facebook.net/en_US/fbevents.js',
  'https://www.googletagmanager.com/gtag/js?id=AW-18020137303',
  'https://cdn.tailwindcss.com/',
  'https://unpkg.com/aos@2.3.1/dist/aos.js',
  'https://cdn.jsdelivr.net/npm/x/y.js',
  'https://static.cloudflareinsights.com/beacon.min.js',
  'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/18020137303/',
  'https://www.googleadservices.com/pagead/conversion.js',
];
const FRAMES = ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/',
                'https://td.doubleclick.net/td/ga/rul'];
const STYLES = ['https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap',
                'https://unpkg.com/aos@2.3.1/dist/aos.css'];

const PAGES = ['/index.html','/formularz.html','/blog.html','/opinia.html',
               '/regulamin.html','/polityka-cookies.html','/programista/index.html'];

(async () => {
  await new Promise(r => server.listen(8099, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  let totalViolations = 0, total404 = 0, failedProbes = 0;

  for (const p of PAGES) {
    const ctx = await browser.newContext();
    // wszystkie zewnetrzne hosty stubujemy - CSP jest sprawdzane PRZED warstwa sieciowa,
    // wiec naruszenia i tak sie zaraportuja
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') return route.continue();
      const t = route.request().resourceType();
      const body = t === 'document' ? '<html><body>stub</body></html>' : (t === 'stylesheet' ? '/*stub*/' : '');
      const ct = t === 'document' ? 'text/html' : (t === 'stylesheet' ? 'text/css' : 'text/javascript');
      return route.fulfill({ status: 200, contentType: ct, body,
        headers: {'Access-Control-Allow-Origin': '*', 'Content-Type': ct} });
    });
    const page = await ctx.newPage();
    const violations = [], notFound = [];
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', e =>
        window.__csp.push({ d: e.violatedDirective, u: (e.blockedURI||'').slice(0,90) }));
    });
    page.on('response', r => { if (r.status() === 404) notFound.push(r.url()); });

    await page.goto('http://127.0.0.1:8099' + p, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1200);

    // sondy: realne zapytania z przegladarki przez CSP
    const probes = await page.evaluate(async ({CONNECT, SCRIPTS, FRAMES, STYLES}) => {
      const res = [];
      const seen = () => window.__csp.length;
      for (const u of CONNECT) {
        const n = seen();
        try { await fetch(u, { mode: 'no-cors' }); } catch (e) {}
        await new Promise(r => setTimeout(r, 30));
        res.push({ kind: 'connect', url: u, blocked: window.__csp.length > n });
      }
      const load = (make) => new Promise(resolve => {
        const n = window.__csp.length; const el = make();
        el.onload = el.onerror = () => setTimeout(() => resolve(window.__csp.length > n), 40);
        document.body.appendChild(el);
        setTimeout(() => resolve(window.__csp.length > n), 2500);
      });
      for (const u of SCRIPTS) res.push({ kind:'script', url:u,
        blocked: await load(() => Object.assign(document.createElement('script'), {src:u})) });
      for (const u of STYLES) res.push({ kind:'style', url:u,
        blocked: await load(() => Object.assign(document.createElement('link'), {rel:'stylesheet', href:u})) });
      for (const u of FRAMES) res.push({ kind:'frame', url:u,
        blocked: await load(() => Object.assign(document.createElement('iframe'), {src:u, style:'display:none'})) });
      return res;
    }, {CONNECT, SCRIPTS, FRAMES, STYLES});

    const pageViol = await page.evaluate(() => window.__csp);
    const probeFails = probes.filter(x => x.blocked);
    totalViolations += pageViol.length; total404 += notFound.length; failedProbes += probeFails.length;

    console.log(`\n=== ${p} ===`);
    console.log(`  naruszenia CSP przy ladowaniu strony: ${pageViol.length}`);
    pageViol.forEach(v => console.log(`     BLOKADA ${v.d} -> ${v.u}`));
    console.log(`  sondy (${probes.length} zasobow): zablokowane ${probeFails.length}`);
    probeFails.forEach(v => console.log(`     BLOKADA ${v.kind} -> ${v.url}`));
    console.log(`  odpowiedzi 404: ${notFound.length}`);
    notFound.forEach(u => console.log(`     404 ${u}`));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(`\n================ PODSUMOWANIE ================`);
  console.log(`naruszenia CSP: ${totalViolations} | zablokowane sondy: ${failedProbes} | 404: ${total404}`);
  console.log(totalViolations + failedProbes + total404 === 0 ? 'WYNIK: OK' : 'WYNIK: BLEDY');
  process.exit(totalViolations + failedProbes + total404 ? 1 : 0);
})();
