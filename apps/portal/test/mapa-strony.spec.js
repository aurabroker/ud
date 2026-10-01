import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Daty zmian w mapie strony — tylko prawdziwe.
 *
 * Google korzysta z <lastmod>, żeby wiedzieć, co odwiedzić ponownie, ale
 * wyłącznie wtedy, gdy daty są wiarygodne. Data builda przy każdej stronie
 * zmieniałaby się z każdym wdrożeniem i nauczyłaby robota ignorować nasze
 * daty — łącznie z tymi przy artykułach, które są prawdziwe. Dlatego datę
 * mają artykuły i lista bloga, a reszta stron nie ma jej wcale.
 *
 * Ta sama data stoi w dateModified na stronie artykułu. Rozjazd między mapą
 * a danymi strukturalnymi to dla robota dwie sprzeczne informacje o jednej
 * stronie.
 */

const DIST = 'dist';
const SERWIS = 'https://utratadochodu.pl';

function wpisyMapy() {
  const mapa = readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8');
  return [...mapa.matchAll(/<url>(.*?)<\/url>/g)].map(([, wpis]) => ({
    loc: wpis.match(/<loc>([^<]+)<\/loc>/)[1],
    lastmod: wpis.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? null,
  }));
}

const { artykuly } = JSON.parse(readFileSync('src/dane/artykuly.json', 'utf8'));
const dataArtykulu = (a) => Date.parse(a.zmieniono ?? a.opublikowano);

test('każdy artykuł ma w mapie datę ostatniej zmiany treści', () => {
  const wpisy = wpisyMapy();
  for (const a of artykuly) {
    const wpis = wpisy.find((w) => w.loc === `${SERWIS}/blog/${a.slug}/`);
    expect(wpis, `brak artykułu ${a.slug} w mapie`).toBeTruthy();
    expect(Date.parse(wpis.lastmod), `${a.slug}: zła data w mapie`).toBe(dataArtykulu(a));
  }
});

test('lista bloga ma datę najnowszego artykułu, reszta stron nie ma daty wcale', () => {
  const wpisy = wpisyMapy();
  const blog = wpisy.find((w) => w.loc === `${SERWIS}/blog/`);
  expect(Date.parse(blog.lastmod)).toBe(Math.max(...artykuly.map(dataArtykulu)));

  const zDatą = wpisy.filter((w) => w.lastmod).map((w) => w.loc);
  const oczekiwane = [`${SERWIS}/blog/`, ...artykuly.map((a) => `${SERWIS}/blog/${a.slug}/`)];
  expect(zDatą.sort()).toEqual(oczekiwane.sort());
});

test('dateModified na stronie artykułu zgadza się z datą w mapie', () => {
  for (const a of artykuly) {
    const html = readFileSync(join(DIST, 'blog', a.slug, 'index.html'), 'utf8');
    const data = html.match(/"dateModified":"([^"]+)"/)?.[1];
    expect(data, `${a.slug}: brak dateModified`).toBeTruthy();
    expect(Date.parse(data), `${a.slug}: dateModified inna niż w mapie`).toBe(dataArtykulu(a));
  }
});
