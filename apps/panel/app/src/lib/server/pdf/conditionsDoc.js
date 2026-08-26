/**
 * conditionsDoc.js — „Istotne informacje o warunkach oferty" jako treść pdfmake.
 * Ta sama treść co w offerConditions.js (wersja HTML dla panelu klienta).
 */

const ul = (items) => ({ ul: items, style: 'ocList' });

const COL_LEFT = [
  { text: 'Z czego składa się zakres ochrony?', style: 'ocSub' },
  { text: 'Podstawę ubezpieczenia stanowią świadczenia na wypadek:', style: 'ocP' },
  ul([
    'utraty dochodu w związku z całkowitą okresową niezdolnością do pracy na skutek choroby lub nieszczęśliwego wypadku,',
    'utraty dochodu w związku z całkowitą okresową i trwałą niezdolnością do pracy na skutek choroby lub nieszczęśliwego wypadku,',
    'śmierci i inwalidztwa wskutek nieszczęśliwego wypadku,',
    'zakażenia wirusem HIV lub WZW podczas pracy.'
  ]),
  { text: 'Dostępne rozszerzenia zakresu ubezpieczenia', style: 'ocSub' },
  { text: 'Pokrywają wyłącznie skutki nieszczęśliwych wypadków:', style: 'ocP' },
  ul([
    'Zwrot kosztów leczenia i rehabilitacji,',
    'Dzienne świadczenie z tytułu pobytu w szpitalu oraz rekonwalescencji w domu,',
    'Zwrot kosztów przystosowania do życia w niepełnosprawności – refundacja uzasadnionych kosztów dostosowania lokalu mieszkalnego lub domu, samochodu oraz zakup protez, wózka inwalidzkiego i innych materiałów ortopedycznych,',
    'Koszty pogrzebu,',
    'Trwałe uszczerbki na zdrowiu – świadczenie wypłacane w systemie % za % w zależności od stopnia uszczerbku określonego przez lekarza.'
  ])
];

const COL_RIGHT = [
  { text: 'Czego nie obejmuje ubezpieczenie?', style: 'ocSub' },
  ul([
    'wypłat ponad limit kwotowy (suma ubezpieczenia) – określony w polisie,',
    'odpowiedzialności ubezpieczyciela z tytułu umowy ubezpieczenia w okresie wyczekiwania,',
    'świadczeń po upływie okresu odszkodowawczego.'
  ]),
  { text: 'Inne ważne parametry polisy?', style: 'ocSub' },
  ul([
    'Ubezpieczenie obowiązuje na całym świecie, 24 godziny na dobę.',
    'Pełna ochrona w zakresie COVID-19.',
    'okres wyczekiwania – rozpoczynający się z chwilą wystąpienia całkowitej okresowej niezdolności do pracy, w którym nie są należne świadczenia z tytułu umowy ubezpieczenia,',
    'okres odszkodowawczy – maksymalny czas wypłaty świadczeń z tytułu całkowitej okresowej niezdolności do pracy,',
    'maksymalne świadczenie miesięczne z tytułu okresowej niezdolności do pracy, standardowo nie wyższe niż 80% średniego przychodu za ostatnie 12 miesięcy, 65% w CEU oraz w przypadku umowy o pracę,',
    'maksymalne świadczenia z tytułu trwałej niezdolności do pracy, śmierci oraz inwalidztwa, standardowo nie wyższe niż zależna od wieku ubezpieczonego, krotność jego rocznego przychodu.'
  ])
];

const EXCLUSIONS = [
  'świadczeń z tytułu całkowitej okresowej niezdolności do pracy, jeżeli Ubezpieczony podjął pracę w zawodzie określonym w polisie lub gdy stan ubezpieczonego przestał spełniać definicję całkowitej okresowej niezdolności do pracy,',
  'w odniesieniu do całkowitej trwałej niezdolności do pracy, warunkiem wypłaty świadczenia jest pisemne zobowiązanie ubezpieczonego do zwrotu ubezpieczycielowi wypłaconego świadczenia w razie podjęcia pracy w zawodzie po otrzymaniu świadczenia; jeżeli nie zostały wskazane we wniosku i potwierdzone w polisie, wyłączenie ochrony dotyczy także ryzyk aktywnego życia takich jak: eksploracja jaskiń, wspinaczka wysokogórska poza szlakami turystycznymi, kolarstwo grawitacyjne, kajakarstwo górskie lub rafting, ryzykowne nurkowanie, żeglarstwo morskie i oceaniczne w charakterze członka załogi, jazda lub skoki konne przez przeszkody, ryzykowne narciarstwo (np. poza trasami), łowiectwo z użyciem broni palnej, jazda na quadzie, podróż lotnicza w charakterze innym niż pasażer komercyjnych linii lotniczych.'
];

const LIMITS = [
  'wojna, inwazja, działania wojenne lub do nich zbliżone, stan wojenny,',
  'reakcja jądrowa, promieniowanie lub skażenie radioaktywne,',
  'akt terrorystyczny związany z bronią nuklearną, użyciem środka lub urządzenia chemicznego albo biologicznego,',
  'służba w formacjach zbrojnych lub udział w działaniach sił zbrojnych,',
  'śmierć naturalna ubezpieczonego,',
  'samobójstwo, jego usiłowanie, celowe samookaleczenie lub stan niepoczytalności ubezpieczonego,',
  'ciąża lub poród oraz wszelkie powikłania z tym związane,',
  'celowe narażenie się ubezpieczonego na szczególnie wysokie ryzyko utraty życia (z wyjątkiem usiłowania ratowania ludzkiego życia),',
  'przestępstwa umyślne popełnione przez ubezpieczonego lub usiłowanie ich popełnienia,',
  'pozostawanie przez ubezpieczonego pod wpływem alkoholu w stężeniu wyższym niż 0,5 promila lub pod wpływem narkotyków, środków odurzających albo innych substancji farmakologicznych o podobnym działaniu,',
  'jazda konna w ramach wyścigów, w tym trening do wyścigów,',
  'udział w rajdach lub wyścigach pojazdów mechanicznych, w tym trening do rajdów i wyścigów,',
  'sport uprawiany zawodowo, w tym udział w imprezach sportowych z zamiarem zdobycia nagrody pieniężnej,',
  'praca odpowiadająca wyższej klasie ryzyka zawodowego (od I najniższej do V najwyższej) niż klasa określona w polisie,',
  'jeżeli wypłata odszkodowania oznaczałaby naruszenie sankcji, zakazu, ograniczenia nałożonego przez ONZ, UE, Wlk. Brytanię lub USA.'
];

const EXTRA = [
  'roszczenia z tytułu chorób lub uszkodzeń ciała ubezpieczonego, albo ich następstw, które w okresie 24 miesięcy przed ustaloną w polisie datą ciągłości były przedmiotem konsultacji lekarskiej lub leczenia pod nadzorem lekarza (za wyjątkiem stanów medycznych uzgodnionych z ubezpieczycielem i potwierdzonych w umowie ubezpieczenia, oraz takich, które ze względu na poprawę nie wymagały konsultacji lekarskiej lub leczenia pod nadzorem lekarza w ciągłym okresie 24 miesięcy rozpoczętym datą ciągłości),',
  'choroby zwyrodnieniowe kręgosłupa lub stawów, zapalenie stawów lub jakiegokolwiek innego procesu zwyrodnieniowego dotyczącego kręgosłupa, stawów, kości, mięśni, ścięgien lub więzadeł, które w okresie 24 miesięcy przed datą początku okresu ubezpieczenia były przedmiotem konsultacji lekarskiej lub leczenia pod nadzorem lekarza,',
  'jeżeli jedyną przyczyną niezdolności do pracy jest: neuroza, psychoneuroza, psychopatia lub psychoza, stany lękowe, stres, przemęczenie, choroby umysłowe lub rozstrój emocjonalny.'
];

export const COMPANY_FOOTER =
  'Aura Expert spółka z ograniczoną odpowiedzialnością z siedzibą w Warszawie przy ul. Bolkowskiej 2A lokal 28, ' +
  'wpisana do Krajowego Rejestru Sądowego pod numerem 0000599840 przez Sąd Rejonowy dla m.st. Warszawy, ' +
  'XII Wydział Gospodarczy Krajowego Rejestru Sądowego, kapitał zakładowy 5.000 zł. Spółka wpisana jest do ' +
  'Rejestru Pośredników Ubezpieczeniowych pod numerem 11229690/A.\n' +
  'ul. Bolkowska 2A/28, 01-466 Warszawa | REGON 363673048 | NIP 5242793544';

/**
 * Treść sekcji warunków (tablica elementów pdfmake).
 * @param {string} [footerText] - stopka z ustawień; gdy pusta, używamy domyślnej.
 */
export function conditionsContent(footerText) {
  return [
    { text: 'Istotne informacje o warunkach oferty', style: 'ocH2', margin: [0, 16, 0, 8] },
    {
      table: { widths: ['50%', '50%'], body: [[{ stack: COL_LEFT }, { stack: COL_RIGHT }]] },
      layout: 'ocBox'
    },
    { text: 'Czego nie obejmuje ubezpieczenie?', style: 'ocH3' },
    ul(EXCLUSIONS),
    { text: 'Jakie są ograniczenia ochrony ubezpieczeniowej?', style: 'ocH3' },
    { text: 'Ubezpieczyciel nie pokrywa roszczeń związanych lub do których przyczyniły się:', style: 'ocP' },
    ul(LIMITS),
    {
      text: 'Dodatkowo w przypadku całkowitej trwałej lub okresowej niezdolności do pracy, Ubezpieczyciel nie pokrywa roszczeń związanych lub do których przyczyniły się:',
      style: 'ocP'
    },
    ul(EXTRA),
    { text: String(footerText || '').trim() || COMPANY_FOOTER, style: 'ocCompany', margin: [0, 12, 0, 0] }
  ];
}
