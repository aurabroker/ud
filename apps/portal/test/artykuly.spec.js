import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Testy bazy wiedzy.
 *
 * Dwie rzeczy warto pilnować automatycznie. Pierwsza: treść ma być w HTML-u,
 * bo poprzedni blog dokleał ją skryptem i osiem artykułów było niewidocznych
 * dla wyszukiwarki. Druga: redaktor pisze w CMS-ie, więc do treści regularnie
 * przecieka Markdown i hasztagi — normalizator ma to sprzątać, a nie my ręcznie
 * po każdej publikacji.
 */

const DIST = 'dist/blog';
const zrzut = JSON.parse(readFileSync('src/dane/artykuly.json', 'utf8'));

const strony = readdirSync(DIST, { withFileTypes: true })
  .filter((w) => w.isDirectory())
  .map((w) => ({ slug: w.name, html: readFileSync(join(DIST, w.name, 'index.html'), 'utf8') }));

test('każdy artykuł ze zrzutu ma własny adres', () => {
  const zbudowane = new Set(strony.map((s) => s.slug));
  const brakujace = zrzut.artykuly.filter((a) => !zbudowane.has(a.slug)).map((a) => a.slug);
  expect(brakujace, `artykuły bez podstrony: ${brakujace.join(', ')}`).toHaveLength(0);
});

test('treść jest w HTML-u, nie doklejana skryptem', () => {
  for (const { slug, html } of strony) {
    // Bierzemy sam <article>, żeby nie liczyć nawigacji i stopki.
    const wpis = html.match(/<article[^>]*class="wpis[^>]*>(.*?)<\/article>/s)?.[1] ?? '';
    const slow = wpis.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    expect(slow, `„${slug}" ma w HTML-u tylko ${slow} słów`).toBeGreaterThan(250);
  }
});

test('Markdown nie przecieka do renderowanej treści', () => {
  for (const { slug, html } of strony) {
    expect(html, `„${slug}" — nagłówek Markdown w akapicie`).not.toMatch(/<p>\s*#{2,3}\s/);
    expect(html, `„${slug}" — pozycja listy Markdown w akapicie`).not.toMatch(/<p>\s*-\s+\w/);
  }
});

test('hasztagi z social mediów nie trafiają na stronę', () => {
  for (const { slug, html } of strony) {
    const wpis = html.match(/<article[^>]*class="wpis[^>]*>(.*?)<\/article>/s)?.[1] ?? '';
    const akapity = [...wpis.matchAll(/<p[^>]*>([^<]+)<\/p>/g)].map((m) => m[1].trim());
    const spam = akapity.filter((t) => {
      const slowa = t.split(/\s+/).filter(Boolean);
      return slowa.length > 2 && slowa.every((s) => s.startsWith('#'));
    });
    expect(spam, `„${slug}" — akapit z samymi hasztagami: ${spam[0]?.slice(0, 60)}`).toHaveLength(0);
  }
});

test('nagłówki mają kotwice, do których da się linkować', () => {
  for (const { slug, html } of strony) {
    const wpis = html.match(/<article[^>]*class="wpis[^>]*>(.*?)<\/article>/s)?.[1] ?? '';
    const bezId = [...wpis.matchAll(/<h([23])(?![^>]*\sid=)/g)];
    expect(bezId, `„${slug}" — ${bezId.length} nagłówków bez id`).toHaveLength(0);
  }
});

test('lista artykułów prowadzi do wszystkich wpisów', () => {
  const indeks = readFileSync(join(DIST, 'index.html'), 'utf8');
  for (const a of zrzut.artykuly) {
    expect(indeks, `brak odnośnika do „${a.slug}"`).toContain(`href="/blog/${a.slug}/"`);
  }
});

test('kanał RSS wymienia wszystkie wpisy i jest poprawnym XML-em', () => {
  const rss = readFileSync(join(DIST, 'rss.xml'), 'utf8');
  expect(rss.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(rss).toContain('<atom:link href="https://utratadochodu.pl/blog/rss.xml"');
  expect(rss.match(/<item>/g) ?? []).toHaveLength(zrzut.artykuly.length);
  // Goły ampersand w XML-u to błąd parsowania, nie kosmetyka.
  expect(rss.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, '')).not.toContain('&');
});

test('obrazki w treści nie są wklejone jako data URI', () => {
  // Jeden taki wpis potrafi ważyć 1,3 MB i wjeżdża w kod strony.
  for (const { slug, html } of strony) {
    expect(html, `„${slug}" — obrazek jako data URI w treści`).not.toContain('src="data:image');
  }
});

test('żadne zdjęcie nie idzie do przeglądarki w oryginale z kubełka', () => {
  /**
   * Kubełek `article-images` trzyma pliki prosto z aparatu — najcięższy ma
   * 15,9 MB. Do przeglądarki mają iść wyłącznie warianty z podkatalogu
   * `normalized/` (800 i 1600 px, WebP), które robi funkcja brzegowa
   * `normalize-article-images` albo skrypt synchronizacji.
   *
   * Test patrzy na zbudowany HTML, nie na zrzut JSON: adres surowy potrafi
   * wejść też z treści artykułu, a nie tylko z pola okładki.
   */
  const surowy = /article-images\/(?!normalized\/)[^"']+/g;
  for (const { slug, html } of strony) {
    const trafienia = [...new Set(html.match(surowy) ?? [])];
    expect(trafienia, `„${slug}" pokazuje oryginał z kubełka: ${trafienia.join(', ')}`).toEqual([]);
  }
  const lista = readFileSync(join(DIST, 'index.html'), 'utf8');
  const naLiscie = [...new Set(lista.match(surowy) ?? [])];
  expect(naLiscie, `lista bloga pokazuje oryginał: ${naLiscie.join(', ')}`).toEqual([]);
});

test('kafelek z okładką ma oba warianty szerokości', () => {
  // Bez srcset ekran gęsty dostaje 800 px rozciągnięte do 1600 — rozmyte.
  const lista = readFileSync(join(DIST, 'index.html'), 'utf8');
  const zeZdjeciem = zrzut.artykuly.filter((a) => a.obraz);
  for (const a of zeZdjeciem) {
    expect(a.obrazDuzy, `„${a.slug}" ma okładkę bez wariantu 1600 px`).toBeTruthy();
    expect(lista, `„${a.slug}" — brak srcset w kafelku`).toContain(`${a.obraz} 800w`);
  }
  expect(zeZdjeciem.length, 'zrzut nie ma ani jednej okładki').toBeGreaterThan(0);
});
