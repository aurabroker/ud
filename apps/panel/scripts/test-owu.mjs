/**
 * test-owu.mjs — dopasowanie OWU do oferty przy PODMIANIE WERSJI u ubezpieczyciela.
 * Uruchom: node scripts/test-owu.mjs
 *
 * Czego pilnuje: oferta trzyma wskaźnik na konkretny plik OWU i to on obowiązuje
 * polisę zawartą na jego warunkach. Gdy ubezpieczyciel wyda nową wersję, stara
 * jest w bibliotece dezaktywowana — a odświeżanie dokumentów oferty czyta tylko
 * pozycje aktywne i dopasowuje po samej bazie (LW044), więc bez filtra dokleiłoby
 * klientowi obok jego wersji tę, która jego umowy nie dotyczy. Nic by nie zginęło
 * i nic by się nie zapaliło — klient dostałby dwa OWU i sam musiałby zgadywać.
 *
 * Trudność jest w tym, że OWU i karta produktu tej SAMEJ wersji mają w bibliotece
 * identyczny symbol, a kolejna wersja tego samego OWU różni się ostatnim członem.
 * Po samej bazie te przypadki wyglądają jednakowo — a jeden wolno dołożyć, drugiego nie.
 */
import { resolveOwus, pokryteBazy, bezInnychWersji, baseFromSymbol } from '../src/lib/server/owuMatch.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(58)} = ${JSON.stringify(actual)}${ok ? '' : `  (oczekiwano ${JSON.stringify(expected)})`}`);
}

const doc = (symbol, raw = {}) => ({ owu_symbol: symbol, insurer_type: 'leadenhall', parsed_raw: raw });
const wiersz = (symbol, plik) => ({ symbol, storage_path: `leadenhall/${plik}`, file_name: plik, title: plik });

// Biblioteka PO podmianie: LW044 w wersji 5, wersja 4 wycofana (nieaktywna, więc jej tu nie ma).
const PO_PODMIANIE = [
  wiersz('LW044/AD_D_TTD_PTD/PL/5', 'LW_044_AD_D_TTD_PTD_PL_5.pdf'),
  wiersz('LW046/MEDICA/PL/4', 'LW_046_MEDICA_PL_4.pdf'),
  wiersz('LW046/MEDICA/PL/4', 'Karta_produktu_LH_Medica_LW_046_v4.pdf'),
  wiersz('LW048/NS_MEDICA/PL/2', 'LW_048_NS_MEDICA_PL_2.pdf'),
];
const sciezki = (lista) => lista.map((r) => r.storage_path.replace('leadenhall/', ''));

console.log('\nBaza z symbolu');
check('pełny symbol → baza', baseFromSymbol('LW044/AD_D_TTD_PTD/PL/5'), 'LW044');
check('inna wersja → ta sama baza', baseFromSymbol('LW044/AD_D_TTD_PTD/PL/4'), 'LW044');
check('śmieci → null', baseFromSymbol('jakiś tekst'), null);

console.log('\nOferta historyczna na wersji 4, biblioteka ma już tylko wersję 5');
{
  const stara = doc('LW044/AD_D_TTD_PTD/PL/4');
  const bez = resolveOwus(PO_PODMIANIE, stara);
  // Bez filtra dopasowanie po bazie wciąga wersję 5 — to jest ten błąd.
  check('samo resolveOwus podaje wersję 5', sciezki(bez), ['LW_044_AD_D_TTD_PTD_PL_5.pdf']);

  const pokryte = pokryteBazy(['LW044/AD_D_TTD_PTD/PL/4']);
  check('z filtrem nie podaje niczego', sciezki(bezInnychWersji(bez, pokryte)), []);
}

console.log('\nOferta nowa — filtr niczego nie blokuje');
{
  const nowa = doc('LW044/AD_D_TTD_PTD/PL/5');
  const owus = bezInnychWersji(resolveOwus(PO_PODMIANIE, nowa), pokryteBazy([]));
  check('dostaje wersję 5', sciezki(owus), ['LW_044_AD_D_TTD_PTD_PL_5.pdf']);
}

console.log('\nKarta produktu do już podpiętego OWU — ten sam symbol, wolno dołożyć');
{
  const d = doc('LW046/MEDICA/PL/4');
  const pokryte = pokryteBazy(['LW046/MEDICA/PL/4']); // oferta ma samo OWU
  const owus = bezInnychWersji(resolveOwus(PO_PODMIANIE, d), pokryte);
  check('OWU i karta przechodzą', sciezki(owus),
    ['LW_046_MEDICA_PL_4.pdf', 'Karta_produktu_LH_Medica_LW_046_v4.pdf']);
}

console.log('\nRider HIV/WZW — inna baza, filtr go nie dotyczy');
{
  const d = doc('LW046/MEDICA/PL/4', { owu_base: 'LW046', covers_hiv_wzw: true, hiv_owu_symbol: 'LW048' });
  const pokryte = pokryteBazy(['LW046/MEDICA/PL/4']);
  const owus = bezInnychWersji(resolveOwus(PO_PODMIANIE, d), pokryte);
  check('LW048 dochodzi', sciezki(owus).includes('LW_048_NS_MEDICA_PL_2.pdf'), true);
}

console.log('\nOferta bez żadnego OWU — naprawa ma działać jak dotąd');
{
  const d = doc('LW046/MEDICA/PL/4');
  const owus = bezInnychWersji(resolveOwus(PO_PODMIANIE, d), pokryteBazy([]));
  check('podpina komplet dla bazy', sciezki(owus).length, 2);
}

console.log(`\n${failures === 0 ? '✅ WSZYSTKIE ASERCJE OK' : `❌ ${failures} ASERCJI NIE PRZESZŁO`}`);
process.exit(failures === 0 ? 0 : 1);
