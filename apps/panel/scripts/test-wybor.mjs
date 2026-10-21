/**
 * test-wybor.mjs — wybór klienta widoczny w panelu (v.0.72, 20.10.2026).
 * Uruchom: node scripts/test-wybor.mjs
 *
 * Klientka wybrała jeden z czterech wariantów, a panel pokazywał tylko
 * „Wybrano: Utrata dochodu (Leadenhall)" — nazwę wspólną dla wszystkich.
 * Test pilnuje, że opis wariantu niesie numer i kwoty, i że strony panelu
 * pokazują go tam, gdzie właściciel go szuka: na górze oferty i karty klienta.
 * Dane wymyślone, układ jak w prawdziwej ofercie.
 */
import { readFileSync } from 'node:fs';
import { wybranyWariant, opisWariantu, krotkiOpis } from '../src/lib/wybranyWariant.js';
import { zawodKlienta } from '../src/lib/zawodKlienta.js';

let failures = 0;
function check(label, ok, info = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !info ? '' : `  — ${info}`}`);
}
const czytaj = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NBSP = / /g;
const bezNbsp = (s) => s.replace(NBSP, ' ');

// Cztery warianty jednej oferty — ten sam produkt, różne kwoty i okresy wyczekiwania.
const WSPOLNE = { insurer_type: 'leadenhall', product_name: 'Utrata dochodu (Leadenhall)', temp_monthly_benefit: '20000.00' };
const DOKUMENTY = [
  { ...WSPOLNE, id: 'a1', offer_number: 'LHQ1000001/1', indemnity_period: '24 miesiące', wait_accident: 14, wait_illness: 21,
    perm_incapacity_covered: true, perm_sum_insured: '100000.00', death_covered: false, premium_total: '6116.00', premium_monthly: null },
  { ...WSPOLNE, id: 'a2', offer_number: 'LHQ1000002/1', indemnity_period: '24 miesiące', wait_accident: 14, wait_illness: 21,
    perm_incapacity_covered: false, perm_sum_insured: null, death_covered: false, premium_total: '4752.00', premium_monthly: null },
  { ...WSPOLNE, id: 'a3', offer_number: 'LHQ1000003/1', indemnity_period: '24 miesiące', wait_accident: 45, wait_illness: 45,
    perm_incapacity_covered: false, perm_sum_insured: null, death_covered: false, premium_total: '3685.00', premium_monthly: null },
  { ...WSPOLNE, id: 'a4', offer_number: 'LHQ1000004/1', indemnity_period: '36 miesięcy', wait_accident: 45, wait_illness: 45,
    perm_incapacity_covered: false, perm_sum_insured: null, death_covered: false, premium_total: '4598.00', premium_monthly: '383.17' }
];
const WYBOR = { document_id: 'a3', insurer_type: 'leadenhall', insurer_name: 'Utrata dochodu (Leadenhall)',
  offer_number: 'LHQ1000003/1', chosen_at: '2026-10-19T17:13:04.152Z' };

console.log('\nwybranyWariant()');
check('wybór → ten jeden dokument', wybranyWariant(WYBOR, DOKUMENTY)?.id === 'a3');
check('rezygnacja → brak wariantu', wybranyWariant({ rejected: true, document_id: 'a3' }, DOKUMENTY) === null);
check('brak wyboru → brak wariantu', wybranyWariant(null, DOKUMENTY) === null);
check('wariant usunięty z oferty → brak (strona mówi to wprost)', wybranyWariant(WYBOR, DOKUMENTY.filter((d) => d.id !== 'a3')) === null);

console.log('\nopisWariantu() — to, czym warianty się różnią');
const opis = Object.fromEntries(opisWariantu(DOKUMENTY[2]).map(([k, v]) => [k, bezNbsp(v)]));
check('numer bez prefiksu LHQ, jak w tabeli porównania', opis['Numer oferty'] === '1000003/1', opis['Numer oferty']);
check('świadczenie miesięczne', opis['Świadczenie miesięczne'] === '20 000 zł', opis['Świadczenie miesięczne']);
check('okres odszkodowawczy', opis['Okres odszkodowawczy'] === '24 miesiące');
check('okres wyczekiwania wypadek / choroba', opis['Okres wyczekiwania (wypadek / choroba)'] === '45 dni / 45 dni');
check('trwała niezdolność: Nie', opis['Trwała niezdolność do pracy'] === 'Nie');
// Polski format (Intl pl-PL) nie grupuje liczb czterocyfrowych — tak samo jak reszta panelu.
check('składka roczna', opis['Składka roczna (łącznie)'] === '3685 zł', opis['Składka roczna (łącznie)']);
check('rata: — gdy brak', opis['Rata miesięczna'] === '—');
check('trwała z sumą pokazuje kwotę', bezNbsp(opisWariantu(DOKUMENTY[0])[4][1]) === '100 000 zł');
check('nazwa produktu NIE jest opisem (wspólna dla wszystkich)', !Object.values(opis).some((v) => v.includes('Utrata dochodu')));

console.log('\nkrotkiOpis() — karta klienta i mail do agenta');
const krotki = bezNbsp(krotkiOpis(DOKUMENTY[2]));
check('numer, świadczenie, okres, wyczekiwanie, składka', krotki ===
  'nr 1000003/1 · 20 000 zł / mies. · 24 miesiące · wyczekiwanie 45 dni / 45 dni · składka 3685 zł / rok', krotki);
const wszystkie = new Set(DOKUMENTY.map((d) => krotkiOpis(d)));
check('cztery warianty tej samej oferty = cztery różne opisy', wszystkie.size === 4);

console.log('\nStrona oferty');
const oferta = czytaj('src/routes/panel/offer/[id]/+page.svelte');
const poz = (s) => oferta.indexOf(s);
check('stary opis „Wybrano: nazwa produktu" nie wraca', !oferta.includes('Wybrano: {choice.insurer_name'));
check('tabela porównania dostaje wybrany wariant (znaczek „✓ Wybrany")', /<OfferComparison[^>]*chosenId=\{wybrany/.test(oferta));
check('kontakt z klientem przed linkiem dla klienta', poz('of-kontakt') > -1 && poz('of-kontakt') < poz('Link dla klienta'));
check('decyzja klienta przed linkiem dla klienta', poz('Klient wybrał wariant') > -1 && poz('Klient wybrał wariant') < poz('Link dla klienta'));
check('karta decyzji tylko raz (dawna na dole usunięta)', oferta.split('Klient wybrał wariant').length === 2);
const para = oferta.slice(poz('<div class="of-para">'), poz('<!-- Porównanie wariantów -->'));
check('„Link dla klienta" i „Wersja" w jednym rzędzie (.of-para)', para.includes('Link dla klienta') && para.includes('Wersja {data.offer.wersja'));
check('rząd ma dwie kolumny i składa się na wąskim ekranie',
  /\.of-para\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(oferta) && /@media[^{]*\{\s*\.of-para\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/.test(oferta));

console.log('\nZawód na karcie kontaktu (v.0.73, bez zawodu z oferty od v.0.74)');
const z1 = zawodKlienta('Stylistka paznokci', [{ profession: 'Kosmetyczka' }]);
check('zawód podany przez klienta — bez dopisku z oferty („Kosmetyczka" to ten sam zawód)',
  z1.zawod === 'Stylistka paznokci' && !z1.zOferty && !('wOfercie' in z1), JSON.stringify(z1));
const z2 = zawodKlienta('  Pielęgniarka ', [{ profession: 'pielęgniarka' }]);
check('odstępy przycięte', z2.zawod === 'Pielęgniarka' && !z2.zOferty, JSON.stringify(z2));
const z3 = zawodKlienta(null, [{ profession: 'Kosmetyczka' }, { profession: 'kosmetyczka ' }]);
check('klient bez zawodu → zawód z oferty, oznaczony, bez powtórzeń', z3.zawod === 'Kosmetyczka' && z3.zOferty === true, JSON.stringify(z3));
const z4 = zawodKlienta('', [{ profession: null }, {}]);
check('nic nigdzie → brak (strona pokazuje „—")', z4.zawod === null && z4.zOferty === false, JSON.stringify(z4));
const z5 = zawodKlienta('Kierownik', null);
check('oferta bez wariantów', z5.zawod === 'Kierownik' && !z5.zOferty, JSON.stringify(z5));
const kontakt = oferta.slice(poz('of-kontakt'), poz('Klient wybrał wariant'));
check('zawód stoi w karcie kontaktu na górze strony',
  kontakt.includes('Zawód:') && kontakt.includes('{zawod.zawod}') && kontakt.includes('zawod.zOferty'));
check('bez dopisku „w ofercie ubezpieczyciela: …" obok zawodu klienta (decyzja z 21.10.2026)',
  !oferta.includes('w ofercie ubezpieczyciela:') && !oferta.includes('wOfercie'));
check('strona liczy zawód z danych loadera (zawodKlienta + warianty)', oferta.includes('zawodKlienta(data.zawodKlienta, data.documents)'));
const ofertaSerwer = czytaj('src/routes/panel/offer/[id]/+page.server.js');
check('loader czyta zawód tylko przypiętego klienta',
  /from\('ud_clients'\)\.select\('profession'\)\.eq\('id', offer\.client_id\)\.maybeSingle\(\)/.test(ofertaSerwer) && ofertaSerwer.includes('zawodKlienta: przypiety?.profession'));
check('lista wyboru klienta nadal bez zawodu (500 wierszy)', ofertaSerwer.includes("select('id, full_name, email, phone')"));

console.log('\nTabela porównania (wspólna dla panelu i strony klienta)');
const tabela = czytaj('src/lib/components/OfferComparison.svelte');
check('znaczek „✓ Wybrany" także po wyborze (nie tylko w wierszu przycisków)',
  /\{#if chosenId && !selectable\}[\s\S]*?✓ Wybrany/.test(tabela));
check('kolumna wybranego wariantu wyróżniona w każdym wierszu', /class:col-wybrana=\{chosenId != null && documents\[i\]\?\.id === chosenId\}/.test(tabela));
const widokKlienta = czytaj('src/lib/components/OfferView.svelte');
check('klient widzi „Twój wybór", panel „Wybór klienta"', widokKlienta.includes('etykietaWyboru="Twój wybór"') && tabela.includes("etykietaWyboru = 'Wybór klienta'"));

console.log('\nKarta klienta');
const karta = czytaj('src/routes/panel/klienci/[id]/+page.svelte');
check('oferty klienta przed danymi osobowymi', karta.indexOf('Oferty klienta') > -1 && karta.indexOf('Oferty klienta') < karta.indexOf('Dane osobowe / kontakt'));
check('kolumna „Wybór klienta" z opisem wariantu', karta.includes('<th>Wybór klienta</th>') && karta.includes('krotkiOpis(w)'));
const kartaSerwer = czytaj('src/routes/panel/klienci/[id]/+page.server.js');
check('loader czyta wybór i kwoty wybranych wariantów', kartaSerwer.includes('client_choice') && /from\('ud_offer_documents'\)[\s\S]*premium_total[\s\S]*\.in\('id', ids\)/.test(kartaSerwer));
check('loader bez select(*) przy wariantach', !/ud_offer_documents'\)\s*\.select\('\*'\)/.test(kartaSerwer));

console.log('\nMail do agenta o decyzji');
const wybor = czytaj('src/routes/offer/[token]/choice/+server.js');
check('mail niesie opis wariantu (krotkiOpis), nie samą nazwę produktu', wybor.includes('krotkiOpis(wariant)') && !wybor.includes('wybrał wariant: ${choice.insurer_name}'));
check('wartości w HTML maila są escape’owane', /esc\(krotkiOpis\(wariant\)\)/.test(wybor) && /esc\(offer\.name\)/.test(wybor));
check('mail linkuje do oferty w panelu', wybor.includes('/panel/offer/${offer.id}'));

console.log(failures ? `\n✗ ${failures} niezaliczonych` : '\n✓ wszystko zaliczone');
process.exit(failures ? 1 : 0);
