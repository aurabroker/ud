/**
 * og-domyslny.mjs — odtwarza public/og-domyslny.jpg ze źródła
 * scripts/og-domyslny.html.
 *
 *   cd apps/portal && node scripts/og-domyslny.mjs [--strona=https://utratadochodu.pl/]
 *
 * To jest obrazek Open Graph każdej strony bez własnego zdjęcia (Baza.astro).
 * Do 21.10.2026 og:image wskazywał ten plik na 34 stronach, a pliku nie było —
 * podgląd linku w komunikatorach i na Facebooku wychodził bez obrazka.
 *
 * Kroje: Newsreader, Public Sans i IBM Plex Mono z żywej strony
 * (`/_astro/fonts/…`), wklejone jako data URI. Build w sandboksie nie pobiera
 * krojów z Google Fonts, a kroje zastępcze w obrazku to rozjazd z marką,
 * którego nikt nie zauważy przed pierwszym udostępnieniem — dlatego bez
 * krojów skrypt kończy się błędem zamiast zapisać obrazek.
 *
 * Znak marki pochodzi z src/components/Znak.astro (jak w email-logo.mjs):
 * gdy trafi tam oryginalny SVG, wystarczy uruchomić skrypt ponownie.
 *
 * Wynik: JPEG 1200 × 630, poniżej 200 kB (Facebook i LinkedIn odrzucają
 * albo długo pobierają ciężkie obrazki podglądu).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Wbudowany fetch Node'a nie czyta HTTPS_PROXY (patrz obciazenie-formularza.mjs).
// NODE_USE_ENV_PROXY działa tylko od startu procesu, więc startujemy jeszcze raz.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const { status } = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(status ?? 1);
}

const { chromium } = await import('@playwright/test');
const { default: sharp } = await import('sharp');

const PORTAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const SZEROKOSC = 1200;
const WYSOKOSC = 630;
const LIMIT = 200 * 1024;

const strona = process.argv.find((a) => a.startsWith('--strona='))?.split('=')[1]
  ?? 'https://utratadochodu.pl/';

/** Rodziny krojów serwisu → nazwy, których używa og-domyslny.html. */
const RODZINY = ['Newsreader', 'Public Sans', 'IBM Plex Mono'];

async function kroje() {
  const html = await fetch(strona).then((o) => {
    if (!o.ok) throw new Error(`${strona}: HTTP ${o.status}`);
    return o.text();
  });

  // Astro nadaje rodzinie skrót („Public Sans-428e…"); bloki „fallback: Arial"
  // to metryki kroju zastępczego, bez pliku — pomijamy je.
  const bloki = [...html.matchAll(/@font-face\{([^}]*)\}/g)]
    .map((m) => m[1])
    .filter((b) => b.includes('url(') && !b.includes('fallback'));

  const pliki = new Map();
  const wynik = new Set();
  for (const blok of bloki) {
    const rodzina = blok.match(/font-family:"?([^";]+?)-[0-9a-f]{16}"?;/)?.[1];
    if (!RODZINY.includes(rodzina)) continue;
    const adres = blok.match(/url\("?([^")]+)"?\)/)[1];
    if (!pliki.has(adres)) {
      const odp = await fetch(new URL(adres, strona));
      if (!odp.ok) throw new Error(`${adres}: HTTP ${odp.status}`);
      pliki.set(adres, Buffer.from(await odp.arrayBuffer()).toString('base64'));
    }
    wynik.add(`@font-face{${blok
      .replace(/font-family:[^;]+;/, `font-family:'${rodzina}';`)
      .replace(/url\("?[^")]+"?\)/, `url(data:font/woff2;base64,${pliki.get(adres)})`)
      .replace(/font-display:[^;]+;?/, 'font-display:block;')}}`);
  }

  for (const r of RODZINY) {
    if (![...wynik].some((b) => b.includes(`font-family:'${r}'`))) {
      throw new Error(`Na ${strona} nie ma kroju „${r}" — obrazek wyszedłby krojem zastępczym.`);
    }
  }
  return [...wynik].join('\n');
}

const znak = readFileSync(join(PORTAL, 'src/components/Znak.astro'), 'utf8')
  .replace(/^---[\s\S]*?---\s*/, '')
  .replace('width={szerokosc} height={wysokosc}', '')
  .replace(' class={klasa}', '')
  .trim();

const zrodlo = readFileSync(join(PORTAL, 'scripts/og-domyslny.html'), 'utf8');
if (!zrodlo.includes('/* KROJE */') || !zrodlo.includes('<!-- ZNAK -->')) {
  throw new Error('og-domyslny.html bez znaczników /* KROJE */ i <!-- ZNAK -->');
}
const html = zrodlo
  .replace('/* KROJE */', await kroje())
  .replaceAll('<!-- ZNAK -->', znak);

const przegladarka = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
let zrzut;
try {
  const karta = await przegladarka.newPage({
    viewport: { width: SZEROKOSC, height: WYSOKOSC },
    deviceScaleFactor: 1,
  });
  await karta.setContent(html);
  await karta.evaluate(() => document.fonts.ready);
  const brak = await karta.evaluate(() =>
    ['500 72px Newsreader', '700 30px "Public Sans"', '600 20px "IBM Plex Mono"']
      .filter((f) => !document.fonts.check(f)));
  if (brak.length) throw new Error(`Kroje się nie wczytały: ${brak.join(', ')}`);
  zrzut = await karta.screenshot({ type: 'png', clip: { x: 0, y: 0, width: SZEROKOSC, height: WYSOKOSC } });
} finally {
  await przegladarka.close();
}

const jpeg = await sharp(zrzut)
  .flatten({ background: '#ffffff' })
  .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
  .toBuffer();
const { width, height } = await sharp(jpeg).metadata();
if (width !== SZEROKOSC || height !== WYSOKOSC) {
  throw new Error(`Wymiary ${width} × ${height} zamiast ${SZEROKOSC} × ${WYSOKOSC}`);
}
if (jpeg.length > LIMIT) throw new Error(`${jpeg.length} B — powyżej limitu ${LIMIT} B`);

writeFileSync(join(PORTAL, 'public/og-domyslny.jpg'), jpeg);
console.log(`zapisano public/og-domyslny.jpg (${width} × ${height}, ${jpeg.length} B)`);
