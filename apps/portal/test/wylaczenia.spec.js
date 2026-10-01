import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Zakażenie HIV/WZW NIE jest wyłączone — i serwis nie może twierdzić inaczej.
 *
 * OWU LW044, LW046 i LW047 zakażenia nie wyłączają: niezdolność do pracy,
 * do której doprowadzi, ocenia się na zasadach ogólnych. Warunki szczególne
 * LW048 (MEDICA) i LW049 (MEDICARE) dokładają osobne świadczenie za samo
 * zakażenie po kontakcie z krwią w pracy — nie są warunkiem ochrony.
 *
 * Serwis twierdził odwrotnie w trzech miejscach naraz: na liście /wylaczenia/,
 * w llms.txt i w opisach dwudziestu czterech zawodów medycznych. Lekarz, który
 * to przeczytał, mógł uznać polisę bez klauzuli za bezużyteczną przy ekspozycji.
 * Na tamtych tekstach ten test wywala się na szesnastu zdaniach.
 *
 * Test czyta pliki .md i llms.txt z builda, bo to z nich cytują modele
 * językowe — i bo w nich jest ta sama treść, co na stronach.
 */

const DIST = 'dist';

/**
 * Zdanie mówiące, że coś „jest wyłączone" / „pozostaje nieobjęte" — bez „nie" przed.
 * „nie" musi być osobnym słowem: „zakażenie jest wyłączone" kończy się na „nie ",
 * a to jest właśnie zdanie, które ma zostać złapane.
 */
const WYLACZONE = /(?<!(?:^|[^\p{L}])nie )(?:jest|są|pozostaje|pozostają) (?:z ochrony )?(?:wyłączon|nieobjęt)/iu;
/** Stare konstrukcje „objęte polisą wyłącznie z klauzulą", „obejmuje to wyłącznie z klauzulą". */
const TYLKO_Z_KLAUZULA = /(?:objęt|obejmuj)\p{L}*(?: \p{L}+){0,3} wyłącznie (?:z|przy|osobn)/iu;

function plikiTekstowe() {
  return readdirSync(DIST, { recursive: true })
    .map(String)
    .filter((p) => p.endsWith('index.md') || p.endsWith('llms.txt'))
    .map((p) => join(DIST, p));
}

test('żaden tekst nie opisuje zakażenia HIV/WZW jako wyłączonego', () => {
  const pliki = plikiTekstowe();
  expect(pliki.length, 'brak plików .md — czy build się wykonał?').toBeGreaterThan(100);

  const naruszenia = [];
  for (const plik of pliki) {
    // Bez gwiazdek Markdownu — „**nie** jest wyłączone" ma się liczyć jako „nie jest".
    const tekst = readFileSync(plik, 'utf8').replace(/\*/g, '');
    for (const zdanie of tekst.split(/(?<=[.!?])\s+/)) {
      if (!/HIV|WZW|zakaże/i.test(zdanie)) continue;
      if (WYLACZONE.test(zdanie) || TYLKO_Z_KLAUZULA.test(zdanie)) {
        naruszenia.push(`${plik}: ${zdanie.trim().slice(0, 200)}`);
      }
    }
  }
  expect(naruszenia).toEqual([]);
});

test('lista wyłączeń trzyma się OWU: bez HIV/WZW, wad wrodzonych i medycyny estetycznej', () => {
  const plik = join(DIST, 'wylaczenia', 'index.md');
  expect(existsSync(plik)).toBe(true);
  const [lista, pytania = ''] = readFileSync(plik, 'utf8').split(/^#+ Najczęstsze pytania/m);

  expect(lista, 'HIV/WZW na liście wyłączeń').not.toMatch(/HIV|WZW/);
  expect(pytania).toMatch(/Samo zakażenie nie jest wyłączone/);
  expect(pytania).toMatch(/LW048/);
  expect(pytania).toMatch(/LW049/);

  // Tych pozycji nie ma w żadnym z sześciu OWU (Leadenhall i CEU), a psychiatria
  // w Leadenhall wyłącza tylko jako JEDYNA przyczyna — stało tu odwrotnie.
  expect(lista).not.toMatch(/wad wrodzonych|medycyny estetycznej|wtórne wobec/i);
  expect(lista).toMatch(/jedyna przyczyna niezdolności/);

  const llms = readFileSync(join(DIST, 'llms.txt'), 'utf8');
  const sekcja = llms.split('## Czego produkt nie obejmuje')[1]?.split('\n## ')[0] ?? '';
  const pozycje = sekcja.match(/^- .*(?:\n {2}.*)*/gm) ?? [];
  expect(pozycje.length).toBeGreaterThan(3);
  for (const p of pozycje) expect(p, 'HIV/WZW na liście wyłączeń w llms.txt').not.toMatch(/HIV|WZW/);
});
