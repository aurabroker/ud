#!/usr/bin/env node
/**
 * sprawdz-artykul.mjs — zasady z CLAUDE.md sprawdzane na szkicu wpisu,
 * ZANIM trafi do bazy i do repozytorium.
 *
 *   node scripts/blog/sprawdz-artykul.mjs src/dane/artykuly/<slug>.html
 *   node scripts/blog/sprawdz-artykul.mjs --spolecznosci opis.txt   # karuzela, opisy IG/FB
 *
 * Kod wyjścia 1 = błąd (nie publikujemy), 0 = czysto (ostrzeżenia czyta człowiek).
 *
 * Co łapie i dlaczego:
 *  - słowa, które właściciel zakazał w treści dla klienta („karencja”,
 *    „od pierwszego dnia niezdolności”, „minimum przez N miesięcy”, „zł / dzień”,
 *    stare kwoty zasiłku 2 240 i 2 800 zł);
 *  - Leadenhall albo CEU nazwane ubezpieczycielem (to coverholderzy Lloyd’s);
 *  - suma „ZUS + polisa” (zasiłek jest brutto, dochód w kalkulatorze netto);
 *  - obrazek bez opisu (Bing, 08.11.2026), tabela bez nagłówków kolumn,
 *    <h1> w treści (tytuł daje szablon), link zewnętrzny bez nowej karty;
 *  - odnośnik wewnętrzny do strony, której nie ma w dist/ (najpierw pnpm build);
 *  - w trybie --spolecznosci: nazwy towarzystw i symbole OWU, których
 *    w karuzelach i opisach nie podajemy.
 *
 * Nie sprawdza, czy zdanie zgadza się z OWU — to robi człowiek albo osobny
 * agent z tekstem OWU w ręku. Skrypt pilnuje tylko tego, co da się
 * sprawdzić maszynowo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KATALOG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(KATALOG, 'dist');

const args = process.argv.slice(2);
const spolecznosci = args.includes('--spolecznosci');
const pliki = args.filter((a) => !a.startsWith('--'));
if (!pliki.length) {
  console.error('Użycie: node scripts/blog/sprawdz-artykul.mjs [--spolecznosci] <plik> [<plik>…]');
  process.exit(2);
}

/** Zakazy z CLAUDE.md — obowiązują w każdym tekście dla klienta. */
const ZAKAZY = [
  [/karencj/i, '„karencja” — na stronie piszemy „okres wyczekiwania”'],
  [/od\s+pierwszego\s+dnia\s+niezdolno/i, '„od pierwszego dnia niezdolności” nie wraca (decyzja właściciela)'],
  [/minimum\s+przez\s+\d+\s+miesi/i, '„minimum przez N miesięcy” — okres to czas NAJDŁUŻSZY'],
  [/zł\s*\/\s*dzie[nń]/i, '„zł / dzień” — limitu dziennego w ofercie nie ma'],
  [/2[\s  ]?240\s*zł/i, '2 240 zł — stara, błędna kwota zasiłku'],
  [/2[\s  ]?800\s*zł/i, '2 800 zł — płaca minimalna z 2021 r.'],
  [/(Leadenhall|CEU)[^.<]{0,40}\bjest\s+ubezpieczyciel/i, 'Leadenhall i CEU to coverholderzy, ubezpieczycielem jest Lloyd’s'],
  [/ubezpieczyciel(?:em|a|owi)?[\s:]+(?:Leadenhall|CEU)/i, 'Leadenhall i CEU to coverholderzy, ubezpieczycielem jest Lloyd’s'],
  [/ZUS\s*\+\s*polis/i, 'suma „ZUS + polisa” — zasiłek brutto i świadczenie stoją obok siebie, bez sumy'],
];

/** W karuzelach i opisach do sieci społecznościowych nie podajemy nazw towarzystw. */
const ZAKAZY_SPOLECZNOSCI = [
  [/Leadenhall|\bCEU\b|Lloyd|WAGAS|\bLW0\d\d\b|LOI\s*PREMIUM|MEDICA(?:RE)?\b/i, 'nazwa towarzystwa albo symbol OWU w treści do sieci społecznościowych'],
];

const zTagow = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');

const istniejeWDist = (sciezka) => {
  const bez = sciezka.split('#')[0].split('?')[0];
  if (bez.startsWith('/owu/')) {
    const mapa = join(DIST, 'owu-adresy.json');
    if (!existsSync(mapa)) return null;
    const slug = bez.replace(/^\/owu\//, '').replace(/\.pdf$/, '');
    return Object.hasOwn(JSON.parse(readFileSync(mapa, 'utf8')), slug);
  }
  if (bez.startsWith('/media/')) return true; // warianty z kubełka — sprawdza test/media.spec.js
  const kandydaci = bez.endsWith('/')
    ? [join(DIST, bez, 'index.html')]
    : [join(DIST, bez), join(DIST, bez, 'index.html')];
  return kandydaci.some((k) => existsSync(k));
};

let bledy = 0;
let ostrzezenia = 0;
const blad = (plik, msg) => { bledy++; console.log(`  ✗ ${msg}`); };
const uwaga = (plik, msg) => { ostrzezenia++; console.log(`  ! ${msg}`); };

for (const plik of pliki) {
  const surowy = readFileSync(plik, 'utf8');
  const tekst = spolecznosci ? surowy : zTagow(surowy);
  console.log(`\n${plik}`);

  for (const [wzor, opis] of [...ZAKAZY, ...(spolecznosci ? ZAKAZY_SPOLECZNOSCI : [])]) {
    const m = tekst.match(wzor);
    if (m) {
      const i = m.index ?? 0;
      blad(plik, `${opis}: „…${tekst.slice(Math.max(0, i - 40), i + m[0].length + 40).trim()}…”`);
    }
  }

  if (spolecznosci) continue;

  if (/<h1[\s>]/i.test(surowy)) blad(plik, '<h1> w treści — tytuł wstawia szablon wpisu');

  for (const img of surowy.match(/<img\b[^>]*>/gi) ?? []) {
    const alt = img.match(/\balt\s*=\s*"([^"]*)"/i);
    if (!alt) blad(plik, `obrazek bez atrybutu alt: ${img.slice(0, 80)}`);
    else if (!alt[1].trim()) uwaga(plik, `pusty alt — dopuszczalny tylko dla ozdób (ol.ikony): ${img.slice(0, 80)}`);
  }

  for (const tabela of surowy.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    if (!/<th\b[^>]*scope="col"/i.test(tabela)) blad(plik, 'tabela bez <th scope="col">');
  }

  for (const a of surowy.match(/<a\b[^>]*>/gi) ?? []) {
    const href = (a.match(/\bhref\s*=\s*"([^"]*)"/i) ?? [])[1];
    if (!href) { blad(plik, `odnośnik bez href: ${a}`); continue; }
    if (/^https?:\/\//i.test(href)) {
      if (/utratadochodu\.pl/i.test(href)) uwaga(plik, `własna domena w pełnym adresie (lepiej ścieżka): ${href}`);
      if (!/target="_blank"/.test(a) || !/rel="[^"]*noopener[^"]*"/.test(a)) {
        blad(plik, `link zewnętrzny bez target="_blank" rel="noopener noreferrer": ${href}`);
      }
    } else if (href.startsWith('/')) {
      const jest = istniejeWDist(href);
      if (jest === null) uwaga(plik, `nie sprawdzę ${href} — brak dist/ (pnpm build)`);
      else if (!jest) blad(plik, `odnośnik do strony, której nie ma w buildzie: ${href}`);
    }
  }

  if (!/<h2>\s*Źródła\s*<\/h2>/i.test(surowy)) uwaga(plik, 'brak sekcji „Źródła”');
  if (/OWU|§/.test(tekst) && !/\/owu\/[a-z0-9-]+\.pdf/.test(surowy)) {
    uwaga(plik, 'tekst powołuje się na OWU, ale nie linkuje do /owu/<slug>.pdf');
  }

  const slowa = tekst.trim().split(/\s+/).length;
  console.log(`  słów: ${slowa}`);
}

console.log(`\nBłędy: ${bledy}, ostrzeżenia: ${ostrzezenia}`);
process.exit(bledy ? 1 : 0);
