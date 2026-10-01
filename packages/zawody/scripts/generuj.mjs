/**
 * generuj.mjs — dopisuje do zawody.json odmianę i rodzaj gramatyczny.
 *
 * Uruchamiane ręcznie, nie w buildzie: wynik ma trafić do repo jako diff do
 * przejrzenia. Test migawkowy pilnuje, żeby zapisane formy nie rozjechały się
 * z silnikiem — a to znaczy, że zmiana reguły zawsze przechodzi przez czyjeś oczy.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { odmiana, rodzaj } from '../src/odmiana.js';

const SCIEZKA = new URL('../data/zawody.json', import.meta.url);
const zawody = JSON.parse(readFileSync(SCIEZKA, 'utf8'));

let zmienione = 0;
for (const z of zawody) {
  const nowa = odmiana(z.nazwa);
  if (JSON.stringify(z.odmiana) !== JSON.stringify(nowa)) zmienione += 1;
  z.odmiana = nowa;
  z.rodzaj = rodzaj(z.nazwa);
}

writeFileSync(SCIEZKA, JSON.stringify(zawody, null, 2) + '\n', 'utf8');
console.log(`zawodów: ${zawody.length}, zmienionych odmian: ${zmienione}`);
