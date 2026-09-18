/**
 * Przemianowuje zdjęcia z Artlista na slugi zawodów.
 *
 * Pliki schodzą z generatora jako -t-e-x-t_-t-o_-i-m-a-g-e-<uuid>.jpeg, a
 * obrazy.ts szuka wyłącznie po slugu — bez przemianowania żadne z nich się nie
 * pokaże. Ręczne przepisywanie dwudziestu UUID-ów to dokładnie ta czynność,
 * przy której człowiek podmienia dwa zdjęcia miejscami, a test tego nie złapie,
 * bo nazwa pliku będzie poprawna.
 *
 * Mapowanie czyta ze WSZYSTKICH plików MAPOWANIE-*.txt w tym katalogu, więc
 * kolejna partia to dopisanie pliku, nie zmiana skryptu.
 *
 *     node src/obrazy/zawody/przemianuj.mjs
 */
import { readFileSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KATALOG = dirname(fileURLToPath(import.meta.url));
const MAPOWANIA = readdirSync(KATALOG).filter((p) => /^MAPOWANIE-.*\.txt$/.test(p));

if (!MAPOWANIA.length) {
  console.error(`Nie ma żadnego MAPOWANIE-*.txt w ${KATALOG} — nie ma czego przemianować.`);
  process.exit(1);
}

/** Linie „<uuid>  <slug>”; wszystko inne w pliku to komentarz dla człowieka. */
const pary = MAPOWANIA.flatMap((plik) =>
  readFileSync(join(KATALOG, plik), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+([a-z0-9-]+)\s*$/))
    .filter(Boolean)
    .map((m) => ({ uuid: m[1], slug: m[2], plik })));

if (!pary.length) {
  console.error(`Żaden z plików ${MAPOWANIA.join(', ')} nie zawiera pary uuid → slug.`);
  process.exit(1);
}

/** Ten sam slug w dwóch mapowaniach znaczy, że ktoś zamówił go dwa razy. */
const podwojne = [...new Map(pary.map((p) => [p.slug, p])).keys()]
  .filter((s) => pary.filter((p) => p.slug === s).length > 1);
if (podwojne.length) {
  console.error(`Slug w więcej niż jednym mapowaniu: ${podwojne.join(', ')}`);
  process.exit(1);
}

console.log(`Mapowania: ${MAPOWANIA.join(', ')} — razem ${pary.length} par.\n`);

const pliki = readdirSync(KATALOG);
let przemianowane = 0;
const brakujace = [];

for (const { uuid, slug } of pary) {
  const juzJest = pliki.find((p) => p.startsWith(`${slug}.`));
  if (juzJest) {
    console.log(`  = ${slug} — już jest (${juzJest}), pomijam`);
    continue;
  }

  const zrodlo = pliki.find((p) => p.includes(uuid));
  if (!zrodlo) {
    brakujace.push(slug);
    continue;
  }

  const cel = `${slug}${extname(zrodlo).toLowerCase()}`;
  renameSync(join(KATALOG, zrodlo), join(KATALOG, cel));
  console.log(`  → ${cel}`);
  przemianowane += 1;
}

console.log(`\nPrzemianowane: ${przemianowane} z ${pary.length}.`);
if (brakujace.length) {
  console.log(`Brak pliku dla: ${brakujace.join(', ')}`);
}

/** Pliki z nazwą generatora, których mapowanie nie objęło — te nie zadziałają. */
const osierocone = readdirSync(KATALOG).filter((p) => /-i-m-a-g-e-|^[0-9a-f]{8}-/.test(p));
if (osierocone.length) {
  console.log(`\nUwaga — pliki bez slugu, strona ich nie pokaże:\n  ${osierocone.join('\n  ')}`);
}
