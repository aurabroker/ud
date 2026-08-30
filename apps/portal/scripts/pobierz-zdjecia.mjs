#!/usr/bin/env node
/**
 * Pobiera zdjęcia wygenerowane na Artliście do src/obrazy/.
 *
 * Powstał, bo sesja, w której zdjęcia zamawiano, nie mogła ich pobrać: polityka
 * sieciowa środowiska blokuje CDN Artlista. Ręczne przeklikanie kilkudziesięciu
 * plików i nadanie im nazw to godzina pracy i pewna literówka, więc adresy
 * wylądowały tutaj.
 *
 *   node scripts/pobierz-zdjecia.mjs           # pobiera brakujące
 *   node scripts/pobierz-zdjecia.mjs --force   # nadpisuje istniejące
 *
 * Nazwa pliku to slug — kategorii albo zawodu, zależnie od katalogu. Zasada
 * jest opisana w CLAUDE.md; test/linki.spec.js pilnuje, żeby nie dało się jej
 * złamać.
 */
import { writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KATEGORIE, ZAWODY } from './zdjecia-adresy.mjs';

const KORZEN = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

/** JPEG zaczyna się od FF D8 FF. Serwer, który zwróci HTML z błędem, tu polegnie. */
const jestJpegiem = (bufor) =>
  bufor.length > 3 && bufor[0] === 0xff && bufor[1] === 0xd8 && bufor[2] === 0xff;

const istnieje = (sciezka) => access(sciezka).then(() => true, () => false);

async function pobierz(katalog, slug, adres) {
  const sciezka = join(KORZEN, 'src/obrazy', katalog, `${slug}.jpg`);

  if (!force && (await istnieje(sciezka))) return { slug, stan: 'jest już' };

  const odpowiedz = await fetch(adres);
  if (!odpowiedz.ok) return { slug, stan: `HTTP ${odpowiedz.status}`, blad: true };

  const bufor = Buffer.from(await odpowiedz.arrayBuffer());
  if (!jestJpegiem(bufor)) {
    return { slug, stan: `to nie JPEG (${bufor.length} B)`, blad: true };
  }

  await mkdir(dirname(sciezka), { recursive: true });
  await writeFile(sciezka, bufor);
  return { slug, stan: `${Math.round(bufor.length / 1024)} kB` };
}

const zadania = [
  ...Object.entries(KATEGORIE).map(([slug, adres]) => ['kategorie', slug, adres]),
  ...Object.entries(ZAWODY).map(([slug, adres]) => ['zawody', slug, adres]),
];

console.log(`Pobieram ${zadania.length} zdjęć do src/obrazy/…\n`);

// Po osiem naraz — CDN nie lubi kilkudziesięciu równoległych połączeń.
const wyniki = [];
for (let i = 0; i < zadania.length; i += 8) {
  const partia = zadania.slice(i, i + 8);
  wyniki.push(...await Promise.all(partia.map((z) => pobierz(...z).catch((e) => ({
    slug: z[1], stan: e.message, blad: true,
  })))));
}

for (const w of wyniki) {
  console.log(`  ${w.blad ? '✗' : '·'} ${w.slug.padEnd(28)} ${w.stan}`);
}

const bledy = wyniki.filter((w) => w.blad);
console.log(`\n${wyniki.length - bledy.length}/${wyniki.length} gotowe.`);
if (bledy.length) {
  console.log('Nieudane:', bledy.map((b) => b.slug).join(', '));
  process.exitCode = 1;
}
