import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Newsletter (scripts/newsletter.mjs → newsletter/<wydanie>.html).
 *
 * Wysłany mail leży w skrzynkach latami i wskazuje obrazki oraz strony
 * serwisu — tych adresów po wysyłce nie da się już poprawić. Dlatego test
 * sprawdza KAŻDE wydanie w katalogu, także stare: skasowanie obrazka
 * z public/email/ albo przemianowanie artykułu wywali go na wydaniu, które
 * już poszło, a nie dopiero na następnym.
 */

const SERWIS = 'https://utratadochodu.pl';
const wydania = readdirSync('newsletter').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

test('każde wydanie ma zbudowany HTML', () => {
  expect(wydania.length, 'w newsletter/ nie ma żadnego wydania').toBeGreaterThan(0);
  for (const w of wydania) {
    expect(existsSync(`newsletter/${w}.html`), `newsletter/${w}.html — uruchom scripts/newsletter.mjs ${w}`).toBe(true);
  }
});

for (const w of wydania) {
  const html = readFileSync(`newsletter/${w}.html`, 'utf8');
  const dane = JSON.parse(readFileSync(`newsletter/${w}.json`, 'utf8'));
  const adresy = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

  test(`${w}: obrazki leżą w public/email i nie są WebP-em`, () => {
    const obrazki = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(obrazki.length).toBeGreaterThan(0);
    for (const img of obrazki) {
      const src = img.match(/src="([^"]+)"/)?.[1] ?? '';
      // Outlook na Windowsie nie pokazuje WebP-a, a /_astro/ zmienia nazwy z każdym buildem.
      expect(src, `obrazek spoza ${SERWIS}/email/: ${src}`).toMatch(new RegExp(`^${SERWIS}/email/[^"]+\\.(jpg|png)$`));
      const plik = src.slice(SERWIS.length);
      expect(existsSync(join('public', plik)), `public${plik} — obrazek z wydania ${w} zniknął`).toBe(true);
      expect(existsSync(join('dist', plik)), `dist${plik} — nie trafił do builda`).toBe(true);
      expect(img, `${plik} bez opisu alternatywnego`).toMatch(/\balt="[^"]+"/);
      expect(img, `${plik} bez szerokości`).toMatch(/\bwidth="\d+"/);
    }
  });

  test(`${w}: linki do serwisu mają UTM-y i prowadzą do istniejących stron`, () => {
    const nasze = adresy.filter((a) => a.startsWith(SERWIS));
    expect(nasze.length).toBeGreaterThan(0);
    for (const a of nasze) {
      const u = new URL(a);
      expect(u.searchParams.get('utm_source'), a).toBe('newsletter');
      expect(u.searchParams.get('utm_medium'), a).toBe('email');
      expect(u.searchParams.get('utm_campaign'), a).toBe(dane.kampania);
      expect(u.searchParams.get('utm_content'), `${a} — bez utm_content`).toBeTruthy();
      const strona = join('dist', u.pathname, 'index.html');
      expect(existsSync(strona), `${u.pathname} — nie ma takiej strony`).toBe(true);
    }
  });

  test(`${w}: żadnego pustego linku, wypis z Resend jest`, () => {
    for (const a of adresy) {
      expect(a, 'pusty albo zastępczy odnośnik').toMatch(/^(https:\/\/|tel:|\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}$)/);
    }
    // Bez tego Resend nie podstawi linku do wypisu, a mail marketingowy bez
    // niego to i problem prawny, i prosta droga do folderu spam.
    expect(html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
  });

  test(`${w}: mieści się przed progiem obcinania w Gmailu`, () => {
    // Gmail ucina wiadomość powyżej ok. 102 kB HTML-a — razem ze stopką i wypisem.
    expect(Buffer.byteLength(html)).toBeLessThan(90_000);
  });
}

test('obrazki z /email/ nie przechodzą przez funkcję brzegową', () => {
  // Każdy wyświetlony mail to kilka żądań o obrazki; przez middleware byłoby
  // to kilka wywołań funkcji na odbiorcę.
  const trasy = JSON.parse(readFileSync('public/_routes.json', 'utf8'));
  expect(trasy.exclude).toContain('/email/*');
});
