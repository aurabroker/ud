import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Walidacja formatu llms.txt.
 *
 * Specyfikacja llmstxt.org ma jeden element obowiązkowy: nagłówek H1 jako
 * pierwszy element pliku. Plik bez niego nie jest poprawnym llms.txt i model,
 * który go czyta, dostaje tekst bez punktu zaczepienia.
 *
 * Reszta sprawdzeń dotyczy tego, co łatwo zepsuć generatorem: pusty plik,
 * niedomknięte odnośniki, wycieki znaczników HTML z szablonu.
 */

const DIST = 'dist';

function pliki() {
  const out = [];
  if (existsSync(join(DIST, 'llms.txt'))) out.push(join(DIST, 'llms.txt'));
  for (const wpis of readdirSync(DIST, { withFileTypes: true })) {
    if (!wpis.isDirectory()) continue;
    const p = join(DIST, wpis.name, 'llms.txt');
    if (existsSync(p)) out.push(p);
  }
  return out;
}

test('każdy llms.txt zaczyna się nagłówkiem H1', () => {
  const lista = pliki();
  expect(lista.length).toBeGreaterThan(100);

  for (const p of lista) {
    const linie = readFileSync(p, 'utf8').split('\n');
    const pierwsza = linie.find((l) => l.trim().length > 0);
    expect(pierwsza, `${p} — pusty plik`).toBeTruthy();
    expect(pierwsza, `${p} — pierwszy element musi być nagłówkiem H1`).toMatch(/^# \S/);
    // Dokładnie jeden H1: kolejne poziomy to H2 i niżej.
    const h1 = linie.filter((l) => /^# \S/.test(l));
    expect(h1.length, `${p} — oczekiwano jednego H1, jest ${h1.length}`).toBe(1);
  }
});

test('llms.txt to Markdown, nie HTML', () => {
  for (const p of pliki()) {
    const tresc = readFileSync(p, 'utf8');
    expect(tresc, `${p} — wyciek znacznika HTML z szablonu`).not.toMatch(/<\/?(div|span|p|a|section)\b/i);
    expect(tresc, `${p} — niezastąpiony placeholder`).not.toMatch(/\{\{|\[OBJECT|undefined|\bNaN\b/);
  }
});

test('odnośniki w llms.txt są bezwzględne i domknięte', () => {
  for (const p of pliki()) {
    const tresc = readFileSync(p, 'utf8');
    const odnosniki = [...tresc.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
    expect(odnosniki.length, `${p} — brak jakiegokolwiek odnośnika`).toBeGreaterThan(0);
    for (const [, nazwa, url] of odnosniki) {
      expect(nazwa.trim(), `${p} — pusta nazwa odnośnika`).not.toBe('');
      expect(url, `${p} — adres „${url}" musi być bezwzględny`).toMatch(/^https:\/\//);
    }
  }
});

test('plik główny wymienia wszystkie zawody i sekcje produktowe', () => {
  const tresc = readFileSync(join(DIST, 'llms.txt'), 'utf8');

  for (const naglowek of ['Na czym polega produkt', 'Czego produkt nie obejmuje',
                          'Jak zawiera się umowę', 'Zawody objęte ochroną', 'Kontakt']) {
    expect(tresc, `brak sekcji „${naglowek}"`).toContain(`## ${naglowek}`);
  }

  // Liczy się wyłącznie sekcja zawodów — poza nią są odnośniki do wniosku,
  // kalkulatora i dokumentów, które pasują do tego samego wzorca wiersza.
  const sekcja = tresc.split('## Zawody objęte ochroną')[1]?.split('\n## ')[0] ?? '';
  const zawodyWPliku = [...sekcja.matchAll(/^- \[[^\]]+\]\(https:\/\/utratadochodu\.pl\/([a-z0-9-]+)\/\)/gm)];
  const katalogi = readdirSync(DIST, { withFileTypes: true })
    .filter((w) => w.isDirectory() && existsSync(join(DIST, w.name, 'llms.txt')));
  expect(zawodyWPliku.length, 'liczba zawodów w llms.txt nie zgadza się z liczbą podstron')
    .toBe(katalogi.length);
});

test('wyłączenia są w pliku wymienione, nie przemilczane', () => {
  const tresc = readFileSync(join(DIST, 'llms.txt'), 'utf8');
  for (const wylaczenie of ['wypalenie zawodowe', 'choroby psychiczne',
                            'częściowa niezdolność', '24 miesięcy']) {
    expect(tresc.toLowerCase(), `brak wyłączenia: ${wylaczenie}`).toContain(wylaczenie.toLowerCase());
  }
});
