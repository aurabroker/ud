/**
 * wylaczenia.ts — katalog wyłączeń, jedno źródło dla `/wylaczenia/` i `llms.txt`.
 *
 * Każda pozycja ma `zrodla`: paragrafy z tekstu OWU, z których wynika. Lista
 * była sprawdzana z sześcioma OWU 28.09.2026 i ponownie 23.11.2026 — wtedy
 * okazało się, że brakuje na niej ciąży i porodu, wyłączonych we WSZYSTKICH
 * sześciu OWU, a także zwyrodnień (Leadenhall) i pracy na wysokości (CEU).
 * Pozycja bez paragrafu to pozycja wymyślona — nie dopisuj takiej.
 *
 * OWU, z którymi to porównano (stan 23.11.2026):
 *  - Leadenhall LW044/AD_D_TTD_PTD/PL/5, LW046/MEDICA/PL/4, LW047/MEDICARE/PL/4
 *    (te same numery paragrafów wyłączeń w trzech wariantach),
 *  - CEU „Utrata dochodu” 9.8, „LOI PREMIUM” 1.2, „Utrata dochodu dla
 *    zatrudniających” 2.6 — wszystkie z 1.04.2026 (wyłączenia bezwzględne
 *    w tej samej kolejności: § 18, § 13 i § 18).
 *
 * Czego tu NIE ma i nie ma wrócić: zakażenia HIV/WZW, wad wrodzonych
 * i zabiegów medycyny estetycznej — nie wyłącza ich żadne z sześciu OWU
 * (test/wylaczenia.spec.js).
 */

export interface Pozycja {
  co: string;
  czemu: string;
  zrodla: string;
}

export interface Grupa {
  tytul: string;
  pozycje: Pozycja[];
}

export const SPRAWDZONO = '23.11.2026';

export const GRUPY: Grupa[] = [
  {
    tytul: 'Ciąża i poród',
    pozycje: [
      {
        co: 'Ciąża, poród i ich powikłania',
        czemu: 'Wszystkie sześć OWU wyłącza niezdolność do pracy, która wynika z ciąży albo '
          + 'porodu: zagrożoną ciążę, poród (także cesarskie cięcie) i dochodzenie do siebie po nim. '
          + 'Leadenhall wyłącza też „wszelkie powikłania wynikające z ciąży i porodu inne niż '
          + 'Uszkodzenia ciała pokryte Umową ubezpieczenia”, więc uraz z wypadku w czasie ciąży '
          + 'ocenia się na zasadach ogólnych. OWU nie przewidują, że polisa może to wyłączenie '
          + 'znieść; CEU umieszcza je wśród wyłączeń bezwzględnych. W ciąży dochód chroni zasiłek '
          + 'z ZUS, a na działalności tylko wtedy, gdy opłacasz dobrowolne ubezpieczenie chorobowe.',
        zrodla: 'Leadenhall LW044, LW046, LW047: § 11 ust. 1 lit. g · CEU Utrata dochodu: § 18 pkt 7, '
          + 'LOI Premium: § 13 pkt 7, dla zatrudniających: § 18 pkt 7',
      },
    ],
  },
  {
    tytul: 'Zdrowie psychiczne',
    pozycje: [
      {
        // Leadenhall: „jeżeli jedyną przyczyną niezdolności do pracy jest…" — depresji
        // nie wymienia z nazwy. CEU: „jeżeli jej przyczyną była depresja…". Stało tu,
        // że wyłączenie obejmuje też zaburzenie wtórne wobec choroby somatycznej —
        // w Leadenhall jest dokładnie odwrotnie.
        co: 'Choroby i zaburzenia psychiczne jako przyczyna niezdolności',
        czemu: 'W Leadenhall świadczenie nie przysługuje, gdy jedyna przyczyna niezdolności to '
          + 'neuroza, psychoneuroza, psychopatia lub psychoza, stany lękowe, stres, przemęczenie, '
          + 'choroby umysłowe albo rozstrój emocjonalny. Jeśli pracować nie pozwala także choroba '
          + 'somatyczna objęta ochroną, liczy się ta choroba. W CEU tego zastrzeżenia nie ma: '
          + 'świadczenie nie przysługuje, jeżeli przyczyną niezdolności była depresja albo któreś '
          + 'z tych rozpoznań.',
        zrodla: 'Leadenhall: § 9 ust. 5 · CEU Utrata dochodu: § 8, LOI Premium: § 7, '
          + 'dla zatrudniających: § 8',
      },
      {
        co: 'Wypalenie zawodowe, stres i przemęczenie',
        czemu: 'Słowa „wypalenie” OWU nie używają, ale stres i przemęczenie wymieniają wśród '
          + 'wyłączeń psychicznych: Leadenhall, gdy to jedyna przyczyna niezdolności, CEU bez '
          + 'tego warunku. Wypalenie zawodowe w klasyfikacji ICD-11 jest opisane jako zjawisko '
          + 'związane z pracą, a nie jako choroba.',
        zrodla: 'Leadenhall: § 9 ust. 5 · CEU Utrata dochodu: § 8',
      },
    ],
  },
  {
    tytul: 'Historia leczenia i zwyrodnienia',
    pozycje: [
      {
        co: 'Choroby i urazy leczone lub konsultowane w ciągu 24 miesięcy przed ubezpieczeniem',
        czemu: 'Leadenhall nie płaci, gdy do niezdolności przyczyniła się choroba albo uraz, '
          + 'które w 24 miesiącach przed datą ciągłości z polisy były przedmiotem konsultacji '
          + 'lekarskiej lub leczenia, chyba że postanowienia szczególne w polisie stanowią '
          + 'inaczej. Wyłączenie wygasa, jeśli po dacie ciągłości przez nieprzerwane 24 miesiące '
          + 'nie było ponownej konsultacji ani leczenia. CEU wyłącza choroby rozpoznane albo '
          + 'konsultowane lub leczone z powodu objawów w ciągu 24 miesięcy przed zawarciem umowy. '
          + 'O wcześniejsze leczenie pyta ankieta. Okoliczności, o które pytano, a które nie '
          + 'zostały podane, mogą przy szkodzie zwolnić ubezpieczyciela z odpowiedzialności '
          + '(art. 815 Kodeksu cywilnego).',
        zrodla: 'Leadenhall: § 9 ust. 1–2 · CEU Utrata dochodu: § 18 pkt 1, LOI Premium: § 13 pkt 1, '
          + 'dla zatrudniających: § 18 pkt 1',
      },
      {
        co: 'Choroby zwyrodnieniowe kręgosłupa i stawów (Leadenhall)',
        czemu: 'Dotyczy choroby zwyrodnieniowej kręgosłupa lub stawów, zapalenia stawów '
          + 'i każdego innego procesu zwyrodnieniowego kości, mięśni, ścięgien lub więzadeł. '
          + 'Przy trwałej niezdolności Leadenhall nie wypłaca świadczenia, jeśli zwyrodnienie '
          + 'ją spowodowało albo się do niej przyczyniło. Przy okresowej nie wypłaca, gdy '
          + 'zwyrodnienie było konsultowane lub leczone w 24 miesiącach przed początkiem '
          + 'ubezpieczenia. W pozostałych przypadkach płaci najdłużej 24 miesiące (LW044), '
          + 'a w MEDICA i MEDICARE 30% świadczenia najdłużej przez 12 miesięcy. OWU CEU '
          + 'osobnego wyłączenia zwyrodnień nie mają.',
        zrodla: 'Leadenhall: § 7 ust. 2, § 9 ust. 3–4',
      },
    ],
  },
  {
    tytul: 'Praca i zakres niezdolności',
    pozycje: [
      {
        co: 'Praca na wysokości, pod ziemią, pod wodą, na morzu i w służbach ratowniczych (CEU)',
        czemu: 'CEU nie pokrywa roszczeń wynikających z jakichkolwiek czynności zawodowych, '
          + 'w ubezpieczonym zawodzie albo poza nim, wykonywanych na morzu, pod wodą, pod ziemią, '
          + 'na wysokości powyżej 2 metrów na zewnątrz budynku, w służbach ratowniczych albo '
          + 'w załodze statku powietrznego. Leadenhall takiego wyłączenia nie ma, ale nie płaci, '
          + 'gdy ubezpieczony pracował w wyższej klasie ryzyka zawodowego niż wpisana w polisę.',
        zrodla: 'CEU Utrata dochodu: § 18 pkt 2, LOI Premium: § 13 pkt 2, dla zatrudniających: '
          + '§ 18 pkt 2 · Leadenhall: § 11 ust. 1 lit. n',
      },
      {
        co: 'Częściowa niezdolność do pracy',
        czemu: 'Polisa płaci za całkowitą niezdolność do wykonywania zawodu wpisanego w polisę. '
          + 'Praca w ograniczonym wymiarze albo przejście na lżejsze obowiązki oznacza, że '
          + 'warunek wypłaty nie jest spełniony. W CEU powrót do zawodu, także zaksięgowanie '
          + 'jakiegokolwiek przychodu, kończy wypłatę. Wyjątek to klauzula opcjonalna 9 w CEU: '
          + 'obejmuje częściową niezdolność, ale tylko po nieszczęśliwym wypadku.',
        zrodla: 'Leadenhall: § 15 pkt 2 · CEU Utrata dochodu: § 9 ust. 2 pkt 4, § 11 ust. 1, '
          + 'klauzula 9',
      },
      {
        co: 'Kwarantanna i izolacja bez niezdolności do pracy',
        czemu: 'Sam nakaz pozostania w domu nie jest niezdolnością do wykonywania zawodu. Jeśli '
          + 'w trakcie izolacji lekarz stwierdzi niezdolność do pracy, liczy się ta niezdolność, '
          + 'a nie sama izolacja.',
        zrodla: 'Wynika z definicji niezdolności: Leadenhall § 15 pkt 2, CEU Utrata dochodu § 7',
      },
      {
        co: 'Przerwa w pracy z powodu braku zleceń',
        czemu: 'Ubezpieczenie chroni przed utratą zdolności do pracy, a nie przed utratą '
          + 'kontraktu. To jest różnica między tym produktem a ubezpieczeniem od utraty pracy.',
        zrodla: 'Wynika z zakresu ubezpieczenia: Leadenhall § 7, CEU Utrata dochodu § 7',
      },
    ],
  },
  {
    tytul: 'Okoliczności zdarzenia',
    pozycje: [
      {
        co: 'Alkohol powyżej 0,5 promila, narkotyki i środki odurzające',
        czemu: 'Wyłączone są skutki pozostawania pod ich wpływem, chyba że środek zażyto zgodnie '
          + 'z zaleceniem lekarza.',
        zrodla: 'Leadenhall: § 11 ust. 1 lit. j · CEU Utrata dochodu: § 18 pkt 5, '
          + 'LOI Premium: § 13 pkt 5, dla zatrudniających: § 18 pkt 5',
      },
      {
        co: 'Samobójstwo, jego usiłowanie, celowe samookaleczenie, niepoczytalność',
        czemu: 'Standardowe wyłączenie w ubezpieczeniach osobowych.',
        zrodla: 'Leadenhall: § 11 ust. 1 lit. e · CEU Utrata dochodu: § 18 pkt 3',
      },
      {
        co: 'Przestępstwo umyślne i celowe narażanie życia',
        czemu: 'Wyłączone jest przestępstwo umyślne popełnione przez ubezpieczonego albo próba '
          + 'jego popełnienia. Leadenhall wyłącza też celowe narażenie się na szczególnie wysokie '
          + 'ryzyko utraty życia, z wyjątkiem ratowania ludzkiego życia.',
        zrodla: 'Leadenhall: § 11 ust. 1 lit. h–i · CEU Utrata dochodu: § 18 pkt 4',
      },
      {
        co: 'Wojna, służba wojskowa, terroryzm z bronią masowego rażenia, skażenie radioaktywne',
        czemu: 'Wyłączone są wojna i działania wojenne, rebelia i rozruchy na skalę powstania, '
          + 'służba w formacjach zbrojnych, akt terrorystyczny z użyciem broni jądrowej, '
          + 'chemicznej albo biologicznej oraz reakcja jądrowa i skażenie radioaktywne.',
        zrodla: 'Leadenhall: § 11 ust. 1 lit. a–d · CEU Utrata dochodu: § 18 pkt 6, 10–12',
      },
      {
        co: 'Sport zawodowy, zawody z nagrodą, wyścigi i rajdy',
        czemu: 'Wyłączony jest sport uprawiany zawodowo (w CEU także zarobkowo), udział '
          + 'w imprezach sportowych z zamiarem zdobycia nagrody pieniężnej (Leadenhall) oraz '
          + 'wyścigi i rajdy pojazdów mechanicznych razem z treningami.',
        zrodla: 'Leadenhall: § 11 ust. 1 lit. k–m · CEU Utrata dochodu: § 18 pkt 8–9',
      },
      {
        co: 'Aktywności podwyższonego ryzyka',
        czemu: 'Obie firmy mają osobne listy. Leadenhall wymienia m.in. eksplorację jaskiń, '
          + 'wspinaczkę wysokogórską poza szlakami, kolarstwo grawitacyjne, rafting, '
          + 'nurkowanie poniżej 30 m, jazdę konną, zjazdy na nartach poza trasami, motocykl '
          + 'powyżej 125 cm³, quad i latanie inaczej niż jako pasażer linii komercyjnych. CEU '
          + 'ma listę aktywności powietrznych, lądowych i wodnych, od skoków spadochronowych po '
          + 'kitesurfing, i liczy także jednorazowe uczestnictwo. Aktywność z listy może być '
          + 'objęta ochroną, jeśli potwierdzi to polisa. Zaznacz ją we wniosku, w kroku o zdrowiu.',
        zrodla: 'Leadenhall: § 12 · CEU Utrata dochodu: § 19 i § 29 pkt 17, LOI Premium: § 14, '
          + 'dla zatrudniających: § 19',
      },
    ],
  },
];

/** Krótka lista do llms.txt — te same pozycje, jednym zdaniem. */
export const WYLACZENIA_KROTKO: string[] = [
  'ciąża, poród i ich powikłania — we wszystkich sześciu OWU (Leadenhall § 11 ust. 1 lit. g, CEU § 18 pkt 7 / LOI Premium § 13 pkt 7)',
  'choroby psychiczne — w Leadenhall, gdy są jedyną przyczyną niezdolności; w CEU depresja i podobne rozpoznania bez tego zastrzeżenia',
  'wypalenie zawodowe, stres i przemęczenie',
  'choroby i urazy konsultowane lub leczone w ciągu 24 miesięcy przed ubezpieczeniem (w Leadenhall: chyba że polisa stanowi inaczej)',
  'choroby zwyrodnieniowe kręgosłupa i stawów w Leadenhall: przy trwałej niezdolności bez świadczenia; przy okresowej wyłączone, gdy leczone w 24 miesiącach przed ubezpieczeniem, a poza tym wypłacane krócej (w MEDICA i MEDICARE także w niższej kwocie)',
  'w CEU praca na wysokości powyżej 2 m na zewnątrz budynku, pod ziemią, pod wodą, na morzu i w służbach ratowniczych',
  'częściowa niezdolność do pracy (w CEU wyjątek: klauzula 9, tylko po nieszczęśliwym wypadku)',
  'alkohol powyżej 0,5 promila i narkotyki, samobójstwo i samookaleczenie, przestępstwo umyślne, wojna i służba wojskowa',
  'sport zawodowy, wyścigi i rajdy oraz aktywności podwyższonego ryzyka z list w OWU, chyba że potwierdzono je w polisie',
];

export const ILE_POZYCJI = GRUPY.reduce((suma, g) => suma + g.pozycje.length, 0);
