import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'node-html-parser';

/**
 * Każdy <img> w zbudowanym serwisie ma atrybut alt.
 *
 * 08.11.2026 Bing Webmaster Tools zgłosił „Tag <img> nie ma określonego
 * atrybutu ALT" — trzy obrazki wklejone w CMS-ie w treść wpisów (bez opisu,
 * edytor go nie wymaga). Czytnik ekranu czytał wtedy nazwę pliku, a robot
 * grafiki nie wiedział, co jest na zdjęciu.
 *
 * `alt=""` jest dozwolony i znaczy „ozdoba" (ikony przy punktach listy,
 * zdjęcie pod nagłówkiem, który niesie treść). Brak atrybutu — nie. Nowy wpis
 * z obrazkiem bez opisu robi ten test czerwonym: opis dopisz w treści wpisu
 * w repozytorium i w `aura_articles.content` (patrz CLAUDE.md).
 */

function* strony(katalog) {
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const pelna = join(katalog, wpis.name);
    if (wpis.isDirectory()) yield* strony(pelna);
    else if (wpis.name.endsWith('.html')) yield pelna;
  }
}

test('żaden <img> w buildzie nie jest bez atrybutu alt', () => {
  const bez = [];
  let obrazkow = 0;
  for (const plik of strony('dist')) {
    for (const img of parse(readFileSync(plik, 'utf8')).querySelectorAll('img')) {
      obrazkow++;
      if (!img.hasAttribute('alt')) bez.push(`${relative('dist', plik)}: ${img.getAttribute('src')}`);
    }
  }
  expect(obrazkow).toBeGreaterThan(100);
  expect(bez).toEqual([]);
});

test('obrazki w treści wpisów niosą opis, nie pusty alt', () => {
  // Pusty alt w treści wpisu wolno dać tylko ozdobie (lista z ikonami).
  const dane = JSON.parse(readFileSync('src/dane/artykuly.json', 'utf8'));
  const puste = [];
  for (const { slug } of dane.artykuly) {
    const dokument = parse(readFileSync(`src/dane/artykuly/${slug}.html`, 'utf8'));
    for (const img of dokument.querySelectorAll('img')) {
      if (img.closest('ol.ikony')) continue;
      if (!img.getAttribute('alt')?.trim()) puste.push(`${slug}: ${img.getAttribute('src')}`);
    }
  }
  expect(puste).toEqual([]);
});
