/**
 * obciazenie-formularza.mjs — brama, przez którą przechodzi każda praca.
 *
 * Reguła jest w CLAUDE.md pod nagłówkiem ABSOLUTE_RULE: formularz wniosku to
 * jedyna ścieżka, którą wpływają pieniądze, więc sprawdza się go na końcu
 * KAŻDEJ roboty — także takiej, która go nie dotyka. Kreator jest wyspą Svelte
 * na stronie z Astro, bierze schemat z @ud/wniosek i woła funkcję brzegową
 * spoza repozytorium; zmiana w układzie, w zależności albo we współdzielonym
 * pakiecie potrafi go wyłączyć bez jednej linii różnicy w jego własnym pliku.
 *
 *     node test/obciazenie-formularza.mjs [--n=60] [--rownolegle=12]
 *
 * CO MIERZY
 *   A. Wydajność strony wniosku — ile trwa wczytanie i ile waży JavaScript.
 *   B. Przejście kreatora do przycisku wysyłki, bez błędów w konsoli.
 *   C. Zachowanie przy awarii i spowolnieniu funkcji brzegowej — cztery
 *      scenariusze. To jest sedno: nie „czy wysyłka działa", tylko „co widzi
 *      klient, gdy nie działa". Formularz, który po błędzie zostaje z
 *      zablokowanym przyciskiem albo gubi wypełnione dane, jest stracony tak
 *      samo jak formularz, który się nie wyświetla.
 *   D. Obciążenie funkcji brzegowej — równoległe żądania z niepoprawnym
 *      tokenem Turnstile.
 *
 * CZEGO NIE MIERZY
 *   Przepustowości zapisu do bazy i czasu GetResponse. `form-submit`
 *   weryfikuje Turnstile (linia ~101) ZANIM cokolwiek zapisze (~217), więc
 *   część D obciąża wyłącznie wejście: zimny start, równoległość i poprawność
 *   odrzucania. To celowe — test nie może zakładać śmieciowych leadów w
 *   produkcji ani powiadomień do doradcy przy każdym uruchomieniu.
 *
 * Część D wymaga wyjścia do sieci. Gdy go nie ma, skrypt to wykrywa i mówi
 * wprost, że tej części nie wykonał. POMINIĘTA CZĘŚĆ D TO NIE JEST WYNIK
 * ZIELONY.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

// Wbudowany fetch Node'a nie czyta HTTPS_PROXY. Tam, gdzie ruch wychodzi
// wyłącznie przez proxy (środowisko agenta), sonda części D padała i test
// ogłaszał brak sieci, choć host Supabase był dozwolony. NODE_USE_ENV_PROXY
// (Node ≥ 22.21) działa tylko od startu procesu, więc startujemy jeszcze raz
// z tą zmienną. Kod wyjścia przechodzi bez zmian.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const { status } = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(status ?? 1);
}

const arg = (nazwa, domyslna) => {
  const m = process.argv.find((a) => a.startsWith(`--${nazwa}=`));
  return m ? Number(m.split('=')[1]) : domyslna;
};

const ZADAN = arg('n', 60);
const ROWNOLEGLE = arg('rownolegle', 12);
const DIST = new URL('../dist/', import.meta.url).pathname;
const PORT = 4488;
const FUNKCJA = 'https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/form-submit';

/** PESEL z poprawną cyfrą kontrolną — ten sam, którego używa wniosek.spec.js. */
const PESEL = '90010112349';

/** Progi. Przekroczenie któregokolwiek kończy się czerwonym wynikiem. */
const PROGI = {
  wczytanie: 3000,      // ms, DOMContentLoaded
  hydratacja: 3000,     // ms, od wejścia do pierwszego pola kreatora
  javascript: 500,      // kB przesłane
  odpowiedzP95: 2500,   // ms, funkcja brzegowa
  bledySerwera: 0,      // liczba odpowiedzi 5xx
};

const TYPY = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serwer() {
  return new Promise((gotowy) => {
    const s = createServer(async (req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const plik = join(DIST, p);
      try {
        const dane = await readFile(plik);
        res.writeHead(200, { 'content-type': TYPY[extname(plik)] ?? 'application/octet-stream' });
        res.end(dane);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('404');
      }
    });
    s.listen(PORT, () => gotowy(s));
  });
}

const wyniki = [];
const zapisz = (czesc, nazwa, ok, szczegol) => {
  wyniki.push({ czesc, nazwa, ok, szczegol });
  const znak = ok === null ? '—' : ok ? '✓' : '✗';
  console.log(`  ${znak} ${nazwa}${szczegol ? `  (${szczegol})` : ''}`);
};

/**
 * Wypełnia to, co jest widoczne i puste, i przechodzi dalej — aż do wysyłki.
 *
 * Celowo bez sztywnej listy pól. Ten skrypt ma przeżyć zmiany w kreatorze:
 * gate, który psuje się przy każdym dodanym polu, przestaje być uruchamiany
 * po trzecim fałszywym alarmie, a wtedy nie chroni już niczego. Na pytania
 * medyczne odpowiada „Nie", bo „Tak" odsłania pole na opis.
 */
async function wypelnijWidoczne(page) {
  await page.evaluate(() => {
    const widoczne = (e) => e.offsetParent !== null && !e.disabled;
    const ustaw = (e, v) => {
      const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(e, v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };

    for (const e of document.querySelectorAll('input, textarea')) {
      if (!widoczne(e)) continue;

      if (e.type === 'radio') {
        const grupa = [...document.querySelectorAll(`input[type=radio][name="${e.name}"]`)];
        if (grupa.some((r) => r.checked)) continue;
        (grupa.find((r) => r.value === 'no') ?? grupa[0])?.click();
        continue;
      }

      if (e.type === 'checkbox') {
        // Zgody zaznaczamy zawsze; ryzyka — jedno, żeby przejść dalej.
        if (/ccepted|zgod/i.test(e.name) && !e.checked) e.click();
        continue;
      }

      if (e.value) continue;
      if (e.type === 'number') { ustaw(e, /sum/i.test(e.name) ? '300000' : '15000'); continue; }
      if (e.type === 'email') { ustaw(e, 'jan.kowalski@example.com'); continue; }
      if (e.type === 'tel') { ustaw(e, '500100200'); continue; }
      if (e.type === 'text' || e.tagName === 'TEXTAREA') {
        ustaw(e, /pesel/i.test(e.name) ? '' : /zaw|profession/i.test(e.name) ? 'Lekarz' : 'Jan Kowalski');
      }
    }
  });
}

async function przejdzKreator(page) {
  await page.waitForSelector('input[name="fullName"]', { timeout: 15000 });
  await page.fill('input[name="fullName"]', 'Jan Kowalski');
  await page.fill('input[name="profession"]', 'Lekarz');
  await page.fill('input[name="pesel"]', PESEL);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.waitForTimeout(250);

  // Krok „zakres" wymaga co najmniej jednego ryzyka — reszta domyka się sama.
  if (await page.locator('input[name="riskTempIncapacity"]').count()) {
    await page.check('input[name="riskTempIncapacity"]').catch(() => {});
  }

  for (let i = 0; i < 14; i++) {
    // Ostatni krok też trzeba wypełnić — samo dojście do przycisku nie wystarczy.
    // Na tym się ten test już raz wyłożył: e-mail, telefon i dwie zgody zostawały
    // puste, `wyslij()` kończył na walidacji i nie dochodziło do żadnego żądania.
    await wypelnijWidoczne(page);
    await page.waitForTimeout(120);
    if (await page.getByRole('button', { name: /Wyślij wniosek|Wysyłam/ }).count()) return true;
    const dalej = page.getByRole('button', { name: 'Dalej' });
    if (!(await dalej.count())) break;
    await dalej.click();
    await page.waitForTimeout(250);
  }
  return (await page.getByRole('button', { name: /Wyślij wniosek|Wysyłam/ }).count()) > 0;
}

/**
 * Błędy wczytania zasobów z obcych domen nie są usterką formularza.
 * `awaria.js` ignoruje je z tego samego powodu: Turnstile, GTM czy Pixel
 * potrafią nie wstać, a strona i tak działa. W sandboksie nie wstają nigdy.
 */
const OBCE = /challenges\.cloudflare|googletagmanager|googleadservices|doubleclick|connect\.facebook|cloudflareinsights|net::ERR_/;

// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ TEST FORMULARZA ZGŁOSZENIOWEGO ══\n');

if (!(await stat(join(DIST, 'wniosek/index.html')).catch(() => null))) {
  console.error('BŁĄD: brak dist/wniosek/index.html — najpierw `pnpm build`.\n');
  process.exit(1);
}

const srv = await serwer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ADRES = `http://localhost:${PORT}/wniosek/`;

// ── A. Wydajność strony ──────────────────────────────────────────────────────
console.log('A. Wydajność strony wniosku');
{
  const page = await browser.newPage();
  let bajtyJs = 0;
  page.on('response', async (r) => {
    if (/javascript/.test(r.headers()['content-type'] ?? '')) {
      bajtyJs += Number(r.headers()['content-length'] ?? 0)
        || (await r.body().then((b) => b.length).catch(() => 0));
    }
  });

  const start = Date.now();
  await page.goto(ADRES, { waitUntil: 'domcontentloaded' });
  const wczytanie = Date.now() - start;

  await page.waitForSelector('input[name="fullName"]', { timeout: 20000 });
  const hydratacja = Date.now() - start;

  zapisz('A', 'wczytanie strony', wczytanie <= PROGI.wczytanie, `${wczytanie} ms / próg ${PROGI.wczytanie}`);
  zapisz('A', 'kreator gotowy do pisania', hydratacja <= PROGI.hydratacja, `${hydratacja} ms / próg ${PROGI.hydratacja}`);
  const kb = Math.round(bajtyJs / 1024);
  zapisz('A', 'waga JavaScriptu', kb <= PROGI.javascript, `${kb} kB / próg ${PROGI.javascript}`);
  await page.close();
}

// ── B. Przejście kreatora ────────────────────────────────────────────────────
console.log('\nB. Kreator do przycisku wysyłki');
{
  const page = await browser.newPage();
  const bledy = [];
  page.on('console', (m) => { if (m.type() === 'error' && !OBCE.test(m.text())) bledy.push(m.text()); });
  page.on('pageerror', (e) => bledy.push(String(e)));  // wyjątki JS liczą się zawsze

  await page.goto(ADRES, { waitUntil: 'domcontentloaded' });
  const doszedl = await przejdzKreator(page);

  zapisz('B', 'kreator dochodzi do wysyłki', doszedl, doszedl ? '' : 'nie znaleziono przycisku „Wyślij wniosek"');
  zapisz('B', 'bez błędów w konsoli', bledy.length === 0, bledy.length ? bledy[0].slice(0, 90) : '');
  await page.close();
}

// ── C. Zachowanie przy awarii backendu ───────────────────────────────────────
console.log('\nC. Co widzi klient, gdy funkcja brzegowa nie działa');
{
  const scenariusze = [
    ['awaria serwera (500)', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"status":"error","message":"boom"}' })],
    ['odmowa z komunikatem (400)', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{"status":"error","message":"Weryfikacja bezpieczeństwa nie powiodła się."}' })],
    ['zerwane połączenie', (route) => route.abort('connectionfailed')],
    ['odpowiedź po 5 sekundach', async (route) => {
      await new Promise((r) => setTimeout(r, 5000));
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"status":"error","message":"wolno"}' });
    }],
  ];

  for (const [nazwa, handler] of scenariusze) {
    const page = await browser.newPage();
    let wywolan = 0;

    // Bez sieci skrypt Cloudflare nie wstanie, a wtedy `wyslij()` kończy się na
    // „Potwierdź, że nie jesteś robotem" i nigdy nie dochodzi do fetch — czyli
    // testowalibyśmy bramkę Turnstile zamiast zachowania przy awarii backendu.
    // Atrapa musi być przed startem strony, bo widget montuje się w $effect.
    await page.addInitScript(() => {
      window.turnstile = {
        render: () => 'widget-testowy',
        getResponse: () => 'token-testowy',
        reset() {},
      };
    });

    await page.route('**/functions/v1/form-submit', (route) => { wywolan += 1; return handler(route); });
    await page.goto(ADRES, { waitUntil: 'domcontentloaded' });

    if (!(await przejdzKreator(page))) { zapisz('C', nazwa, false, 'nie doszedł do wysyłki'); await page.close(); continue; }

    const przycisk = page.getByRole('button', { name: /Wyślij wniosek|Wysyłam/ });
    await przycisk.click();
    await page.waitForTimeout(600);
    const zablokowanyWTrakcie = await przycisk.isDisabled().catch(() => false);

    // Drugie kliknięcie w trakcie wysyłki nie może wystrzelić drugiego żądania.
    await przycisk.click({ force: true }).catch(() => {});
    await page.waitForTimeout(nazwa.includes('5 sekund') ? 6500 : 1500);

    const odblokowany = !(await przycisk.isDisabled().catch(() => true));
    const daneSaNadal = await page.inputValue('input[name="email"]').catch(() => '');
    const widacBlad = (await page.locator('text=/Nie udało się|błąd|Błąd|boom|wolno|Weryfikacja/').count()) > 0
      || (await page.locator('.awaria, [class*="awaria"], [id*="awaria"]').count()) > 0;

    // Blokadę „w trakcie" da się zaobserwować tylko przy wolnej odpowiedzi —
    // przy błędzie w 200 ms żądanie jest już po wszystkim, gdy pytamy o stan.
    // Dlatego liczy się ona wyłącznie w scenariuszu pięciosekundowym.
    const wolny = nazwa.includes('5 sekund');
    const ok = odblokowany && wywolan === 1
      && (daneSaNadal !== '' || nazwa.includes('zerwane'))
      && (!wolny || zablokowanyWTrakcie);
    zapisz('C', nazwa, ok,
      `żądań: ${wywolan}` +
      (wolny ? (zablokowanyWTrakcie ? ', blokada w trakcie ✓' : ', BRAK blokady — grozi podwójną wysyłką') : '') +
      `, przycisk ${odblokowany ? 'odblokowany' : 'ZOSTAŁ ZABLOKOWANY'}` +
      `, dane ${daneSaNadal ? 'zachowane' : 'UTRACONE'}${widacBlad ? ', komunikat ✓' : ', BRAK komunikatu'}`);
    await page.close();
  }
}

// ── C2. Udana wysyłka ────────────────────────────────────────────────────────
//
// Nie o samo przekierowanie tu chodzi, tylko o znacznik, który kreator zapisuje
// tuż przed nim. Strona podziękowania zgłasza konwersję Google Ads WYŁĄCZNIE
// przy tym znaczniku — bez niego wniosek wpłynie, a w Ads go nie będzie.
// To jest ten rodzaj awarii, którego nie widać: formularz działa, baza się
// zapełnia, a kampania wygląda, jakby nie sprzedawała.
console.log('\nC2. Co się dzieje po udanej wysyłce');
{
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.turnstile = {
      render: () => 'widget-testowy',
      getResponse: () => 'token-testowy',
      reset() {},
    };
  });
  await page.route('**/functions/v1/form-submit', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"status":"success"}',
  }));
  await page.goto(ADRES, { waitUntil: 'domcontentloaded' });

  let ok = false;
  let opis = 'nie doszedł do wysyłki';
  if (await przejdzKreator(page)) {
    await page.getByRole('button', { name: /Wyślij wniosek|Wysyłam/ }).click();
    await page.waitForURL('**/podziekowanie/', { timeout: 8000 }).catch(() => {});

    const naPodziekowaniu = page.url().includes('/podziekowanie/');
    const znacznik = await page.evaluate(() => {
      try { return sessionStorage.getItem('ud:wniosek'); } catch { return null; }
    });

    ok = naPodziekowaniu && !!znacznik && znacznik.length >= 8;
    opis = (naPodziekowaniu ? 'przekierowanie ✓' : 'BRAK przekierowania na /podziekowanie/')
      + (znacznik
        ? ', znacznik konwersji zapisany ✓'
        : ', BRAK ZNACZNIKA — konwersja nie zostanie policzona w Ads');
  }
  zapisz('C2', 'wniosek ląduje na podziękowaniu ze znacznikiem konwersji', ok, opis);
  await page.close();
}

await browser.close();
srv.close();

// ── D. Obciążenie funkcji brzegowej ──────────────────────────────────────────
console.log(`\nD. Funkcja brzegowa — ${ZADAN} żądań, po ${ROWNOLEGLE} równolegle`);
{
  const sonda = await fetch(FUNKCJA, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }).then(async (r) => ({ status: r.status, tresc: (await r.text()).slice(0, 200) }))
    .catch((e) => ({ status: 0, tresc: e.message }));

  if (sonda.status === 0 || /not in allowlist|egress/i.test(sonda.tresc)) {
    zapisz('D', 'obciążenie funkcji brzegowej', null,
      'POMINIĘTE — brak wyjścia do sieci z tego środowiska. Uruchom tam, gdzie jest.');
  } else {
    const czasy = [];
    const kody = new Map();
    const jedno = async () => {
      const t = Date.now();
      try {
        const r = await fetch(FUNKCJA, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ 'cf-turnstile-response': 'niepoprawny-token-testowy', pesel: PESEL }),
        });
        czasy.push(Date.now() - t);
        kody.set(r.status, (kody.get(r.status) ?? 0) + 1);
      } catch (e) {
        czasy.push(Date.now() - t);
        kody.set('błąd sieci', (kody.get('błąd sieci') ?? 0) + 1);
      }
    };

    const kolejka = Array.from({ length: ZADAN }, () => jedno);
    for (let i = 0; i < kolejka.length; i += ROWNOLEGLE) {
      await Promise.all(kolejka.slice(i, i + ROWNOLEGLE).map((f) => f()));
    }

    czasy.sort((a, b) => a - b);
    const p = (q) => czasy[Math.min(czasy.length - 1, Math.floor(czasy.length * q))];
    const bledy5xx = [...kody].filter(([k]) => typeof k === 'number' && k >= 500)
      .reduce((a, [, v]) => a + v, 0) + (kody.get('błąd sieci') ?? 0);

    console.log(`     kody odpowiedzi: ${[...kody].map(([k, v]) => `${k}×${v}`).join(', ')}`);
    zapisz('D', 'brak błędów serwera', bledy5xx <= PROGI.bledySerwera, `5xx i zerwane: ${bledy5xx}`);
    zapisz('D', 'czas odpowiedzi p95', p(0.95) <= PROGI.odpowiedzP95,
      `p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${czasy.at(-1)} ms / próg ${PROGI.odpowiedzP95}`);
    zapisz('D', 'odrzuca niepoprawny token', (kody.get(400) ?? 0) === ZADAN,
      `400×${kody.get(400) ?? 0} z ${ZADAN}`);
  }
}

// ── Wynik ────────────────────────────────────────────────────────────────────
const upadle = wyniki.filter((w) => w.ok === false);
const pominiete = wyniki.filter((w) => w.ok === null);

console.log('\n══ WYNIK ══');
console.log(`  zaliczone: ${wyniki.filter((w) => w.ok === true).length}`);
console.log(`  upadłe:    ${upadle.length}`);
console.log(`  pominięte: ${pominiete.length}`);

if (upadle.length) {
  console.log('\nFORMULARZ NIE PRZESZEDŁ — napraw, zanim uznasz pracę za skończoną:');
  for (const w of upadle) console.log(`  ✗ [${w.czesc}] ${w.nazwa} — ${w.szczegol}`);
  process.exit(1);
}
if (pominiete.length) {
  console.log('\nCzęść mierzalna przeszła, ale POMINIĘTO część sieciową.');
  console.log('To NIE jest pełny wynik — uruchom skrypt tam, gdzie jest wyjście do sieci.\n');
  process.exit(2);
}
console.log('\nFormularz przeszedł w komplecie.\n');
