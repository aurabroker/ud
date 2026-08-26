/**
 * offerConditions.js — „Istotne informacje o warunkach oferty" (treść z draftu Word).
 * Statyczny blok dołączany do PDF podsumowania (punkt 3 wymagań).
 */
export const OFFER_CONDITIONS_HTML = `
<div class="oc">
  <h2>Istotne informacje o warunkach oferty</h2>

  <table class="oc-2col">
    <tr>
      <td>
        <strong>Z czego składa się zakres ochrony?</strong>
        <p>Podstawę ubezpieczenia stanowią świadczenia na wypadek:</p>
        <ul>
          <li>utraty dochodu w związku z całkowitą okresową niezdolnością do pracy na skutek choroby lub nieszczęśliwego wypadku,</li>
          <li>utraty dochodu w związku z całkowitą okresową i trwałą niezdolnością do pracy na skutek choroby lub nieszczęśliwego wypadku,</li>
          <li>śmierci i inwalidztwa wskutek nieszczęśliwego wypadku,</li>
          <li>zakażenia wirusem HIV lub WZW podczas pracy.</li>
        </ul>
        <strong>Dostępne rozszerzenia zakresu ubezpieczenia</strong>
        <p>Pokrywają wyłącznie skutki nieszczęśliwych wypadków:</p>
        <ul>
          <li>Zwrot kosztów leczenia i rehabilitacji,</li>
          <li>Dzienne świadczenie z tytułu pobytu w szpitalu oraz rekonwalescencji w domu,</li>
          <li>Zwrot kosztów przystosowania do życia w niepełnosprawności – refundacja uzasadnionych kosztów dostosowania lokalu mieszkalnego lub domu, samochodu oraz zakup protez, wózka inwalidzkiego i innych materiałów ortopedycznych,</li>
          <li>Koszty pogrzebu,</li>
          <li>Trwałe uszczerbki na zdrowiu – świadczenie wypłacane w systemie % za % w zależności od stopnia uszczerbku określonego przez lekarza.</li>
        </ul>
      </td>
      <td>
        <strong>Czego nie obejmuje ubezpieczenie?</strong>
        <ul>
          <li>wypłat ponad limit kwotowy (suma ubezpieczenia) – określony w polisie,</li>
          <li>odpowiedzialności ubezpieczyciela z tytułu umowy ubezpieczenia w okresie wyczekiwania,</li>
          <li>świadczeń po upływie okresu odszkodowawczego.</li>
        </ul>
        <strong>Inne ważne parametry polisy?</strong>
        <ul>
          <li>Ubezpieczenie obowiązuje na całym świecie, 24 godziny na dobę.</li>
          <li>Pełna ochrona w zakresie COVID-19.</li>
          <li>okres wyczekiwania – rozpoczynający się z chwilą wystąpienia całkowitej okresowej niezdolności do pracy, w którym nie są należne świadczenia z tytułu umowy ubezpieczenia,</li>
          <li>okres odszkodowawczy – maksymalny czas wypłaty świadczeń z tytułu całkowitej okresowej niezdolności do pracy,</li>
          <li>maksymalne świadczenie miesięczne z tytułu okresowej niezdolności do pracy, standardowo nie wyższe niż 80% średniego przychodu za ostatnie 12 miesięcy, 65% w CEU oraz w przypadku umowy o pracę,</li>
          <li>maksymalne świadczenia z tytułu trwałej niezdolności do pracy, śmierci oraz inwalidztwa, standardowo nie wyższe niż zależna od wieku ubezpieczonego, krotność jego rocznego przychodu.</li>
        </ul>
      </td>
    </tr>
  </table>

  <h3>Czego nie obejmuje ubezpieczenie?</h3>
  <ul>
    <li>świadczeń z tytułu całkowitej okresowej niezdolności do pracy, jeżeli Ubezpieczony podjął pracę w zawodzie określonym w polisie lub gdy stan ubezpieczonego przestał spełniać definicję całkowitej okresowej niezdolności do pracy,</li>
    <li>w odniesieniu do całkowitej trwałej niezdolności do pracy, warunkiem wypłaty świadczenia jest pisemne zobowiązanie ubezpieczonego do zwrotu ubezpieczycielowi wypłaconego świadczenia w razie podjęcia pracy w zawodzie po otrzymaniu świadczenia; jeżeli nie zostały wskazane we wniosku i potwierdzone w polisie, wyłączenie ochrony dotyczy także ryzyk aktywnego życia takich jak: eksploracja jaskiń, wspinaczka wysokogórska poza szlakami turystycznymi, kolarstwo grawitacyjne, kajakarstwo górskie lub rafting, ryzykowne nurkowanie, żeglarstwo morskie i oceaniczne w charakterze członka załogi, jazda lub skoki konne przez przeszkody, ryzykowne narciarstwo (np. poza trasami), łowiectwo z użyciem broni palnej, jazda na quadzie, podróż lotnicza w charakterze innym niż pasażer komercyjnych linii lotniczych.</li>
  </ul>

  <h3>Jakie są ograniczenia ochrony ubezpieczeniowej?</h3>
  <p>Ubezpieczyciel nie pokrywa roszczeń związanych lub do których przyczyniły się:</p>
  <ul>
    <li>wojna, inwazja, działania wojenne lub do nich zbliżone, stan wojenny,</li>
    <li>reakcja jądrowa, promieniowanie lub skażenie radioaktywne,</li>
    <li>akt terrorystyczny związany z bronią nuklearną, użyciem środka lub urządzenia chemicznego albo biologicznego,</li>
    <li>służba w formacjach zbrojnych lub udział w działaniach sił zbrojnych,</li>
    <li>śmierć naturalna ubezpieczonego,</li>
    <li>samobójstwo, jego usiłowanie, celowe samookaleczenie lub stan niepoczytalności ubezpieczonego,</li>
    <li>ciąża lub poród oraz wszelkie powikłania z tym związane,</li>
    <li>celowe narażenie się ubezpieczonego na szczególnie wysokie ryzyko utraty życia (z wyjątkiem usiłowania ratowania ludzkiego życia),</li>
    <li>przestępstwa umyślne popełnione przez ubezpieczonego lub usiłowanie ich popełnienia,</li>
    <li>pozostawanie przez ubezpieczonego pod wpływem alkoholu w stężeniu wyższym niż 0,5 promila lub pod wpływem narkotyków, środków odurzających albo innych substancji farmakologicznych o podobnym działaniu,</li>
    <li>jazda konna w ramach wyścigów, w tym trening do wyścigów,</li>
    <li>udział w rajdach lub wyścigach pojazdów mechanicznych, w tym trening do rajdów i wyścigów,</li>
    <li>sport uprawiany zawodowo, w tym udział w imprezach sportowych z zamiarem zdobycia nagrody pieniężnej,</li>
    <li>praca odpowiadająca wyższej klasie ryzyka zawodowego (od I najniższej do V najwyższej) niż klasa określona w polisie,</li>
    <li>jeżeli wypłata odszkodowania oznaczałaby naruszenie sankcji, zakazu, ograniczenia nałożonego przez ONZ, UE, Wlk. Brytanię lub USA.</li>
  </ul>

  <p>Dodatkowo w przypadku całkowitej trwałej lub okresowej niezdolności do pracy, Ubezpieczyciel nie pokrywa roszczeń związanych lub do których przyczyniły się:</p>
  <ul>
    <li>roszczenia z tytułu chorób lub uszkodzeń ciała ubezpieczonego, albo ich następstw, które w okresie 24 miesięcy przed ustaloną w polisie datą ciągłości były przedmiotem konsultacji lekarskiej lub leczenia pod nadzorem lekarza (za wyjątkiem stanów medycznych uzgodnionych z ubezpieczycielem i potwierdzonych w umowie ubezpieczenia, oraz takich, które ze względu na poprawę nie wymagały konsultacji lekarskiej lub leczenia pod nadzorem lekarza w ciągłym okresie 24 miesięcy rozpoczętym datą ciągłości),</li>
    <li>choroby zwyrodnieniowe kręgosłupa lub stawów, zapalenie stawów lub jakiegokolwiek innego procesu zwyrodnieniowego dotyczącego kręgosłupa, stawów, kości, mięśni, ścięgien lub więzadeł, które w okresie 24 miesięcy przed datą początku okresu ubezpieczenia były przedmiotem konsultacji lekarskiej lub leczenia pod nadzorem lekarza,</li>
    <li>jeżeli jedyną przyczyną niezdolności do pracy jest: neuroza, psychoneuroza, psychopatia lub psychoza, stany lękowe, stres, przemęczenie, choroby umysłowe lub rozstrój emocjonalny.</li>
  </ul>

  <p class="oc-company">Aura Expert spółka z ograniczoną odpowiedzialnością z siedzibą w Warszawie przy ul. Bolkowskiej 2A lokal 28, wpisana do Krajowego Rejestru Sądowego pod numerem 0000599840 przez Sąd Rejonowy dla m.st. Warszawy, XII Wydział Gospodarczy Krajowego Rejestru Sądowego, kapitał zakładowy 5.000 zł. Spółka wpisana jest do Rejestru Pośredników Ubezpieczeniowych pod numerem 11229690/A.<br>ul. Bolkowska 2A/28, 01-466 Warszawa | REGON 363673048 | NIP 5242793544</p>
</div>`;
