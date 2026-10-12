/**
 * email-logo.mjs — logo do maili: znak z Znak.astro i napis „UtrataDochodu"
 * krojem serwisu, jako PNG w trzykrotnej rozdzielczości.
 *
 *   node scripts/email-logo.mjs <public-sans.woff2>
 *
 * Krój: Public Sans z /_astro/fonts/ na żywej stronie (plik z zakresem
 * „latin" — w nazwie nie ma polskich znaków). Wynik: public/email/
 * logo-utratadochodu.png, w mailu 207 × 44 px.
 *
 * PNG, bo SVG w poczcie nie działa (Gmail, Outlook). Tło białe, nie
 * przezroczyste: klient pocztowy w trybie ciemnym przyciemnia tło maila, a
 * granatowy napis na przezroczystym tle by w nim zniknął.
 *
 * Odpal ponownie, gdy zmieni się znak (Znak.astro to odrys — patrz komentarz
 * w tamtym pliku). Nazwa pliku zostaje ta sama: stare maile pokażą nowe logo.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const PORTAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const krojPlik = process.argv[2];
if (!krojPlik) {
  console.error('Podaj plik kroju Public Sans (.woff2) z /_astro/fonts/ na utratadochodu.pl');
  process.exit(1);
}

const kroj = readFileSync(krojPlik).toString('base64');
const znak = readFileSync(join(PORTAL, 'src/components/Znak.astro'), 'utf8')
  .replace(/^---[\s\S]*?---\s*/, '')
  .replace('width={szerokosc} height={wysokosc}', 'width="27" height="32"')
  .replace(' class={klasa}', '');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:PS;src:url(data:font/woff2;base64,${kroj}) format('woff2');font-weight:100 900}
html,body{margin:0;background:#fff}
#logo{display:inline-flex;align-items:center;gap:10px;padding:6px 8px;background:#fff;
  font-family:PS;font-weight:700;font-size:22px;letter-spacing:-0.025em;color:#0F2E40;line-height:1}
#logo b{font-weight:700;color:#1BAEE5}
</style></head><body><div id="logo">${znak}<span>Utrata<b>Dochodu</b></span></div></body></html>`;

const przegladarka = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const strona = await przegladarka.newPage({ deviceScaleFactor: 3 });
await strona.setContent(html);
await strona.evaluate(() => document.fonts.ready);
const zrzut = await strona.locator('#logo').screenshot();
await przegladarka.close();

const wynik = join(PORTAL, 'public/email/logo-utratadochodu.png');
const info = await sharp(zrzut)
  .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colors: 128, dither: 0 })
  .toFile(wynik);
console.log(`zapisano public/email/logo-utratadochodu.png (${info.width} × ${info.height}, ${info.size} B)`);
