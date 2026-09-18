/**
 * Przemianowuje zdjęcia z Artlista na slugi zawodów.
 *
 * Pliki schodzą z generatora jako -t-e-x-t_-t-o_-i-m-a-g-e-<uuid>.jpeg, a
 * obrazy.ts szuka wyłącznie po slugu — bez przemianowania żadne z nich się nie
 * pokaże. Ręczne przepisywanie dwudziestu UUID-ów to dokładnie ta czynność,
 * przy której człowiek podmienia dwa zdjęcia miejscami, a test tego nie złapie,
 * bo nazwa pliku będzie poprawna.
 *
 * Mapowanie czyta z MAPOWANIE-medycyna.txt, żeby lista stała w jednym miejscu.
 *
 *     node src/obrazy/zawody/przemianuj-medycyne.mjs
 */
import { readFileSync, readdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KATALOG = dirname(fileURLToPath(import.meta.url));
const MAPOWANIE = join(KATALOG, 'MAPOWANIE-medycyna.txt');

if (!existsSync(MAPOWANIE)) {
  console.error(`Nie ma ${MAPOWANIE} — bez mapowania nie ma czego przemianować.`);
  process.exit(1);
}

/** Linie „<uuid>  <slug>”; wszystko inne w pliku to komentarz dla człowieka. */
const pary = readFileSync(MAPOWANIE, 'utf8')
  .split('\n')
  .map((l) => l.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+([a-z0-9-]+)\s*$/))
  .filter(Boolean)
  .map((m) => ({ uuid: m[1], slug: m[2] }));

if (!pary.length) {
  console.error('Mapowanie nie zawiera żadnej pary uuid → slug.');
  process.exit(1);
}

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
