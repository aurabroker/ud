import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { NAZWA_PLIKU } from '../functions/media/[plik].js';
import { onRequest } from '../functions/_middleware.js';
import { EKSPERT } from '../src/lib/ekspert.ts';

/**
 * Podgląd linku (Open Graph), autor wpisu i strona 404.
 *
 * Do 21.10.2026 og:image na 34 stronach wskazywał /og-domyslny.jpg, którego
 * nie było — podgląd linku w komunikatorach i na Facebooku wychodził bez
 * obrazka, a nic się nie wysypywało. Wpisy bloga miały og:type „website"
 * i okładkę 800 px, autorem w JSON-LD była firma, a strona 404 ogłaszała
 * kanoniczny adres „/404/", który sam przekierowuje.
 */

const DIST = 'dist';
const SERWIS = 'https://utratadochodu.pl';
const { artykuly } = JSON.parse(readFileSync('src/dane/artykuly.json', 'utf8'));

function plikiHtml(katalog = DIST) {
  const wynik = [];
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const sciezka = join(katalog, wpis.name);
    if (wpis.isDirectory()) wynik.push(...plikiHtml(sciezka));
    else if (wpis.name.endsWith('.html')) wynik.push(sciezka);
  }
  return wynik;
}

const meta = (html, klucz) =>
  [...html.matchAll(new RegExp(`<meta (?:property|name)="${klucz.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`, 'g'))]
    .map((m) => m[1]);

/** Nazwy wariantów zdjęć z danych artykułów — te pliki leżą w kubełku. */
const zdjeciaZDanych = new Set(
  artykuly.flatMap((a) => [a.obraz, a.obrazDuzy]).filter(Boolean).map((u) => u.split('/').at(-1)),
);

test('każdy og:image na naszej domenie wskazuje plik, który istnieje', () => {
  const winne = [];
  let sprawdzonych = 0;
  for (const plik of plikiHtml()) {
    const html = readFileSync(plik, 'utf8');
    for (const adres of [...meta(html, 'og:image'), ...meta(html, 'twitter:image')]) {
      if (!adres.startsWith(`${SERWIS}/`)) continue;
      sprawdzonych++;
      const sciezka = new URL(adres).pathname;
      if (sciezka.startsWith('/media/')) {
        // Zdjęcia bloga podaje funkcja (functions/media/[plik].js), nie dist.
        const nazwa = sciezka.slice('/media/'.length);
        if (!NAZWA_PLIKU.test(nazwa) || !zdjeciaZDanych.has(nazwa)) winne.push(`${plik}: ${adres}`);
      } else if (!existsSync(join(DIST, decodeURIComponent(sciezka)))) {
        winne.push(`${plik}: ${adres}`);
      }
    }
  }
  expect(winne, `og:image bez pliku (podgląd linku bez obrazka):\n${winne.slice(0, 10).join('\n')}`).toEqual([]);
  expect(sprawdzonych, 'żadnego og:image na naszej domenie — test niczego nie sprawdza').toBeGreaterThan(200);
});

test('og:image wskazuje adres bezwzględny na każdej stronie', () => {
  for (const plik of plikiHtml()) {
    const html = readFileSync(plik, 'utf8');
    const obrazy = meta(html, 'og:image');
    expect(obrazy, `${plik}: og:image powinien być dokładnie jeden`).toHaveLength(1);
    expect(obrazy[0], `${plik}: względny og:image`).toMatch(/^https:\/\//);
  }
});

test('domyślna karta: JPEG 1200 × 630, poniżej 200 kB, z opisanymi wymiarami', async () => {
  const plik = 'public/og-domyslny.jpg';
  expect(existsSync(plik), 'brak public/og-domyslny.jpg — odtwórz: node scripts/og-domyslny.mjs').toBe(true);
  const { format, width, height } = await sharp(plik).metadata();
  expect(format).toBe('jpeg');
  expect([width, height]).toEqual([1200, 630]);
  expect(statSync(plik).size, 'karta cięższa niż 200 kB').toBeLessThan(200 * 1024);
  expect(existsSync(join(DIST, 'og-domyslny.jpg')), 'karta nie trafiła do dist').toBe(true);

  // Strona z kartą domyślną mówi, jakie ma wymiary — podgląd rysuje się od
  // razu, bez pobierania obrazka do zmierzenia.
  const html = readFileSync(join(DIST, 'kontakt', 'index.html'), 'utf8');
  expect(meta(html, 'og:image')).toEqual([`${SERWIS}/og-domyslny.jpg`]);
  expect(meta(html, 'og:image:width')).toEqual(['1200']);
  expect(meta(html, 'og:image:height')).toEqual(['630']);
  expect(meta(html, 'og:image:type')).toEqual(['image/jpeg']);
  expect(meta(html, 'og:image:alt')[0]).toContain('UtrataDochodu.pl');
});

test('wymiary podajemy tylko dla karty domyślnej, nie dla cudzego obrazka', () => {
  const html = readFileSync(join(DIST, 'programista', 'index.html'), 'utf8');
  expect(meta(html, 'og:image')[0]).not.toContain('og-domyslny');
  expect(meta(html, 'og:image:width')).toEqual([]);
});

test.describe('wpisy bazy wiedzy', () => {
  const strony = artykuly.map((a) => ({
    a,
    html: readFileSync(join(DIST, 'blog', a.slug, 'index.html'), 'utf8'),
  }));
  const graf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])['@graph'];
  const nazwa = (adres) => adres.split('/').at(-1);

  test('og:type „article" z datą publikacji i zmiany', () => {
    for (const { a, html } of strony) {
      expect(meta(html, 'og:type'), a.slug).toEqual(['article']);
      expect(meta(html, 'article:published_time'), a.slug).toEqual([a.opublikowano]);
      expect(meta(html, 'article:modified_time'), a.slug).toEqual([a.zmieniono ?? a.opublikowano]);
    }
    // Pozostałe strony to nie artykuły.
    for (const sciezka of ['index.html', 'blog/index.html', 'programista/index.html']) {
      const html = readFileSync(join(DIST, sciezka), 'utf8');
      expect(meta(html, 'og:type'), sciezka).toEqual(['website']);
      expect(meta(html, 'article:published_time'), sciezka).toEqual([]);
    }
  });

  test('podgląd linku i JSON-LD biorą okładkę 1600 px, nie 800', () => {
    let zOkladka = 0;
    for (const { a, html } of strony) {
      const wpis = graf(html).find((w) => w['@type'] === 'BlogPosting');
      if (!a.obraz) {
        expect(meta(html, 'og:image'), a.slug).toEqual([`${SERWIS}/og-domyslny.jpg`]);
        expect(wpis.image, a.slug).toBeUndefined();
        continue;
      }
      zOkladka++;
      const oczekiwany = `${SERWIS}/media/${nazwa(a.obrazDuzy ?? a.obraz)}`;
      expect(meta(html, 'og:image'), a.slug).toEqual([oczekiwany]);
      expect(meta(html, 'twitter:image'), a.slug).toEqual([oczekiwany]);
      expect(wpis.image, `${a.slug}: BlogPosting.image`).toBe(oczekiwany);
      expect(oczekiwany, a.slug).toMatch(/-1600\.webp$/);
    }
    expect(zOkladka).toBeGreaterThan(0);
  });

  test('autorem jest ekspert z lib/ekspert.ts, wydawcą — firma', () => {
    for (const { a, html } of strony) {
      const wezly = graf(html);
      const wpis = wezly.find((w) => w['@type'] === 'BlogPosting');
      const osoba = wezly.find((w) => w['@id'] === wpis.author?.['@id']);

      expect(osoba, `${a.slug}: author nie wskazuje węzła w grafie`).toBeTruthy();
      expect(osoba['@type'], a.slug).toBe('Person');
      expect(osoba.name).toBe(EKSPERT.imie);
      expect(osoba.description).toBe(EKSPERT.opis);
      expect(EKSPERT.rola.startsWith(osoba.jobTitle), `jobTitle „${osoba.jobTitle}" spoza EKSPERT.rola`).toBe(true);
      expect(osoba.worksFor).toEqual({ '@id': `${SERWIS}/#organizacja` });
      expect(osoba.url).toBe(`${SERWIS}/o-nas/`);
      // Nic, czego właściciel nie podał: profile, zdjęcie, uprawnienia.
      for (const pole of ['sameAs', 'image', 'hasCredential', 'award', 'alumniOf']) {
        expect(osoba[pole], `${a.slug}: Person.${pole} — tego w EKSPERT nie ma`).toBeUndefined();
      }
      expect(wpis.publisher).toEqual({ '@id': `${SERWIS}/#organizacja` });
    }
  });

  test('pod wpisem widać autora i odnośnik do /o-nas/', () => {
    for (const { a, html } of strony) {
      const ramka = html.match(/<section aria-label="Autor wpisu"[^>]*>(.*?)<\/section>/s)?.[1];
      expect(ramka, `${a.slug}: brak ramki autora`).toBeTruthy();
      const tekst = ramka.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
      expect(tekst, a.slug).toContain(`Autor: ${EKSPERT.opis}`);
      expect(ramka, `${a.slug}: ramka autora bez odnośnika do /o-nas/`).toMatch(/<a href="\/o-nas\/"/);
      // Ramka stoi po treści wpisu, nie przed nią.
      expect(html.indexOf('aria-label="Autor wpisu"')).toBeGreaterThan(html.indexOf('</article>'));
    }
  });
});

test.describe('strona 404', () => {
  const html = readFileSync(join(DIST, '404.html'), 'utf8');

  test('bez adresu kanonicznego i og:url, z noindex', () => {
    expect(html, 'kanoniczny „/404/" wskazuje adres, który przekierowuje').not.toMatch(/<link rel="canonical"/);
    expect(meta(html, 'og:url')).toEqual([]);
    expect(meta(html, 'robots')[0]).toContain('noindex');
  });

  /** Atrapa warstwy zasobów Pages: istniejący plik albo 404.html ze statusem 404. */
  async function zDysku(wejscie) {
    const sciezka = new URL(typeof wejscie === 'string' ? wejscie : wejscie.url).pathname;
    const plik = join(DIST, sciezka.endsWith('/') ? `${sciezka}index.html` : sciezka);
    if (!existsSync(plik)) {
      return new Response(readFileSync(join(DIST, '404.html')), {
        status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response(readFileSync(plik), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const pobierz = (sciezka) => {
    const request = new Request(`${SERWIS}${sciezka}`, { headers: { Accept: 'text/html' } });
    return onRequest({ request, next: (w) => zDysku(w ?? request) });
  };

  test('nieznany adres nie ogłasza wariantu markdownowego, którego nie ma', async () => {
    const odp = await pobierz('/nie-ma-takiej-strony/');
    expect(odp.status).toBe(404);
    expect(existsSync(join(DIST, 'nie-ma-takiej-strony', 'index.md'))).toBe(false);
    const link = odp.headers.get('link') ?? '';
    expect(link, 'Link na 404 wskazuje nieistniejący plik .md').not.toContain('index.md');
    // Reszta zostaje: Vary na KAŻDEJ odpowiedzi HTML i zasoby serwisu.
    expect(odp.headers.get('vary')).toContain('Accept');
    expect(link).toContain('rel="describedby"');
  });

  test('istniejąca strona dalej ogłasza swój wariant markdownowy', async () => {
    const odp = await pobierz('/kontakt/');
    expect(odp.status).toBe(200);
    expect(odp.headers.get('link')).toContain('</kontakt/index.md>; rel="alternate"; type="text/markdown"');
  });
});

test('źródło karty leży w repozytorium razem ze skryptem', () => {
  // Bez źródła karta da się tylko podmienić „na oko" w edytorze grafiki.
  for (const plik of ['scripts/og-domyslny.html', 'scripts/og-domyslny.mjs']) {
    expect(existsSync(plik), plik).toBe(true);
  }
  const zrodlo = readFileSync('scripts/og-domyslny.html', 'utf8');
  expect(zrodlo).toContain('/* KROJE */');
  expect(zrodlo).toContain('<!-- ZNAK -->');
  // Karta jest jasna jak serwis (bez trybu ciemnego, decyzja z 28.08.2026).
  expect(zrodlo).not.toContain('prefers-color-scheme');
});
