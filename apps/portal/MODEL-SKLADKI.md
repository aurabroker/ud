# Model szacowania składki — kalibracja na ofertach z bazy

Dokument opisuje, skąd biorą się liczby w `src/lib/kalibracja.json`
i `src/lib/symulacja.ts`. Bez niego każda z nich jest umowna, a to jest
dokładnie ten zarzut, który postawił klient stawce 1,5%.

Dwie warstwy: analiza z 17.09.2026 (pierwsza kalibracja, ręczna, na 48
wariantach z 15 ofert — sekcje od „Co w danych jest") i metoda **osoby-v1**
z 14.10.2026, którą liczy funkcja SQL `ud_kalibracja_stawek()` i pilnuje
funkcja brzegowa `kalibrator` (druga część dokumentu). Liczby w pliku
pochodzą z tej drugiej.

## Stan na 14.10.2026 — metoda osoby-v1

| | 17.09 (ręcznie) | 14.10 (osoby-v1) |
|---|---|---|
| jednostka | wariant | **osoba** (PESEL) |
| próba | 10 wariantów | 10 osób, 11 ofert, 22 warianty |
| stawka dół / góra | 2,02% / 2,44% | 2,02% / **3,22%** (surowe 3,217%) |
| środek | 2,2% | 2,2% (mediana osób 2,144%) |
| mnożnik 36 mies. | 1,25 z 6 par | 1,25 z 5 osób (1,2376–1,2549) |
| przedział przy 14 400 zł | 291–351 zł | **291–464 zł** |

Pominięte warianty z okna (14.10): trwała niezdolność albo śmierć 64,
płatność jednorazowa 13, klauzula HIV/WZW 3, okres wyczekiwania ponad 21 dni 2,
spoza okna 21. Anomalii zero.

Co z analizy z 17.09 okazało się nieprawdą — przeczytaj, zanim zaczniesz
porównywać liczby z tabel niżej:

- **Górne 2,44% to wariant z klauzulą HIV/WZW** (LW049, pielęgniarka, 366 zł).
  Klauzula kosztuje osobno (×1,07 w kalkulatorze), więc wariant z nią nie mówi
  nic o stawce bazowej. Osoba-v1 go wyklucza; ta sama osoba bez klauzuli ma
  2,373%.
- **Obie pary pielęgniarki w tabeli mnożnika 36 mają klauzulę po stronie
  36 miesięcy** (ta sama oferta): 1,2432 porównuje klauzulę z klauzulą,
  1,2781 — wariant bez klauzuli z wariantem z nią, stąd zawyżenie. Osoba-v1
  nie bierze żadnej; z pięciu osób wychodzi mediana 1,2453 — mnożnik dalej
  1,25, ale z czystej próby.
- **Wiek przestał być „26–43”.** Czysta próba 24-miesięczna (przed oknem
  48 h) to trzy osoby przed trzydziestką, sześć po trzydziestce, trzy po
  czterdziestce i jedna po pięćdziesiątce. Najdroższa osoba (3,217%) to
  właśnie ta po pięćdziesiątce. To pierwszy ślad gradientu wieku w danych
  i **jedna obserwacja** — współczynnika wieku z tego nie ma (patrz „Wiek”),
  ale górna granica przedziału nie jest błędem pomiaru, tylko realnym
  klientem.

## Co w danych jest, a czego nie ma

| Parametr | Pokrycie | Nadaje się do modelu |
|---|---|---|
| składka roczna i miesięczna | 48 / 48 | tak |
| miesięczne świadczenie | 48 / 48 | tak |
| okres wypłaty | 48 / 48 — ale **tylko 24 i 36 miesięcy** | tak, dla tych dwóch |
| karencja (NW / choroba) | 48 / 48 | tak |
| trwała niezdolność, śmierć | 48 / 48 | tak, jako filtr |
| zawód | 48 / 48 — 14 różnych | nie, zbyt rzadkie |
| klasa ryzyka | 16 / 48 — tylko LW044 | **nie** (patrz niżej) |
| wiek (z PESEL-u klienta) | 48 / 48, zakres 26–43 lat | **nie** (patrz niżej) |
| forma zatrudnienia | 48 / 48 — wszyscy B2B | nie, zero zmienności |
| dochód, data urodzenia w dokumencie | 0 / 48 | nie |

## Co dane potwierdzają

### 1. Składka jest wprost proporcjonalna do świadczenia

Dwa zawody wystąpiły z dwiema sumami przy identycznej reszcie parametrów:

| Zawód | 1. suma | 2. suma | stawka 1. | stawka 2. |
|---|---|---|---|---|
| Elektryk | 10 000 zł | 12 000 zł | 2,120% | 2,117% |
| Kierowca | 6 000 zł | 8 000 zł | 2,333% | 2,338% |

Różnica poniżej pół procenta. Kształt wzoru `składka = świadczenie × stawka`
jest więc poprawny — zmiany wymaga sama stawka.

### 2. Stawka za samą niezdolność okresową to około 2,2%, nie 1,5%

Dziesięć wariantów bez trwałej niezdolności i bez śmierci, płatnych w 12 ratach
(stawka = składka roczna / (świadczenie × 12)):

| Zawód | Świadczenie | Karencja | Składka mies. | Stawka |
|---|---|---|---|---|
| Kosmetolog | 5 000 | 14/21 | 101 zł | 2,020% |
| Kosmetyczka | 5 000 | 14/21 | 102 zł | 2,040% |
| Ratownik medyczny | 12 000 | 14/21 | 253 zł | 2,108% |
| Elektryk | 12 000 | 21/21 | 254 zł | 2,117% |
| Elektryk | 10 000 | 21/21 | 212 zł | 2,120% |
| Kosmetolog | 15 000 | 14/21 | 326 zł | 2,173% |
| Kierowca | 6 000 | 14/21 | 140 zł | 2,333% |
| Kierowca | 8 000 | 14/21 | 187 zł | 2,338% |
| Pielęgniarka | 15 000 | 14/21 | 356 zł | 2,373% |
| Pielęgniarka | 15 000 | 14/21 | 366 zł | 2,440% ¹ |

Mediana 2,147%, średnia 2,206%, rozrzut 2,02–2,44%.

¹ Wariant z klauzulą HIV/WZW (LW049) — wyszło na jaw 14.10.2026. Bez niego
rozrzut z tej tabeli to 2,02–2,37%.

**Stawka 1,5% z `symulacja.ts` leży poniżej najniższej zaobserwowanej oferty.**
Przy świadczeniu 14 400 zł serwis pokazuje 216 zł; najtańsza obserwacja daje
291 zł, najdroższa 351 zł.

### 3. Wydłużenie wypłaty z 24 do 36 miesięcy to około +25%

Sześć par z tej samej oferty, identycznych we wszystkim poza okresem wypłaty
(bez trwałej niezdolności, bez śmierci, 12 rat):

| Zawód | Świadczenie | 24 mies. | 36 mies. | Mnożnik |
|---|---|---|---|---|
| Kosmetolog | 5 000 | 1 212 zł | 1 500 zł | 1,2376 |
| Pielęgniarka | 15 000 | 4 392 zł | 5 460 zł | 1,2432 ¹ |
| Elektryk | 10 000 | 2 544 zł | 3 168 zł | 1,2453 |
| Ratownik medyczny | 12 000 | 3 036 zł | 3 792 zł | 1,2490 |
| Kosmetyczka | 5 000 | 1 224 zł | 1 536 zł | 1,2549 |
| Pielęgniarka | 15 000 | 4 272 zł | 5 460 zł | 1,2781 ¹ |

Mediana 1,2471, rozrzut 1,2376–1,2781. **Mnożnik 1,25.**

¹ Pary z klauzulą HIV/WZW (14.10.2026): 1,2432 ma ją po obu stronach,
1,2781 tylko po stronie 36 miesięcy — porównuje dwie rzeczy naraz. Osoba-v1
nie bierze żadnej z nich; z pięciu osób wychodzi 1,2453 → 1,25.

Warianty z dorzuconą trwałą niezdolnością dają mnożnik niższy (1,13–1,21),
bo część składki za trwałą niezdolność nie zależy od okresu wypłaty. To
potwierdza mechanizm, a przy okazji tłumaczy, czemu mnożnik liczymy wyłącznie
na wariantach bez dodatków.

### 4. Rozłożenie na raty kosztuje 10%

Dziewięć par „ta sama ochrona, raz jednorazowo, raz w 12 ratach": średnio
**1,1012**. Opłata dystrybucyjna (`distribution_fee`) to 8,6–9,1% składki
całkowitej, czyli jest już w `premium_total` — klient płaci tyle, ile stoi
w tej kolumnie.

### 5. Karencja zmienia składkę mocniej niż cokolwiek innego

Ten sam klient, to samo świadczenie 15 000 zł, 24 miesiące, bez dodatków:
karencja 14/21 dni → 3 564 zł rocznie, karencja 60/60 dni → 2 497 zł.
**Dłuższa karencja jest o 30% tańsza.** Kalkulator nie pyta o karencję i tego
nie zmieniamy — ale to znaczy, że jego wynik dotyczy wariantu najkrótszej
karencji, czyli najdroższego.

## Czego z tych danych policzyć się NIE da

### Klasy ryzyka

Klasa jest wypełniona w 16 wierszach na 48 (tylko LW044; MEDICARE jej nie ma).
Po odfiltrowaniu wariantów z trwałą niezdolnością zostają dwie klasy:

- klasa II (Kierowca): 2,333% i 2,338%, karencja 14/21
- klasa III (Elektryk): 2,117% i 2,120%, karencja **21/21**

Klasa III wychodzi tańsza od klasy II, co jest odwrotnie, niż powinno być —
bo różni je też karencja, a ta waży więcej niż klasa. Zostają dwie obserwacje
na klasę, każda od jednej osoby. **Współczynnika klasy z tego nie policzymy.**
Klasy I i IV występują wyłącznie w wariantach z trwałą niezdolnością albo
śmiercią, więc nie da się ich porównać z resztą.

### Wiek

Wiek daje się odtworzyć z PESEL-u klienta dla wszystkich 48 wierszy, ale:

- zakres to 26–43 lata, a serwis kieruje ofertę także do osób po pięćdziesiątce
  (14.10.2026: w próbie jest już jedna taka osoba i to ona wyznacza górną
  granicę — 3,217% wobec 2,37% następnej; jedna obserwacja to wciąż nie
  współczynnik),
- **każdy wiek występuje z innym zawodem** — 14 osób, 14 zawodów. Wiek i zawód
  są w tych danych nierozróżnialne; to, co przypiszemy wiekowi, mogło być
  zawodem, i odwrotnie.

W realnym taryfikowaniu utraty dochodu wiek jest czynnikiem numer jeden.
Model, który go pomija, jest szacunkiem rzędu wielkości i niczym więcej — i tak
musi być opisany na stronie.

### Okresy 48 i 60 miesięcy

**Zero obserwacji.** W bazie są wyłącznie warianty 24- i 36-miesięczne.
Mnożnik dla 48 i 60 nie jest czymś, co można wyliczyć — trzeba go dostać
z tabeli ubezpieczyciela. Ekstrapolacja liniowa z jednego punktu (1,25 na 36)
dałaby 1,50 i 1,75, ale to byłoby zgadywanie udające rachunek.

## Model, który z tego wynika

```
świadczenie = dochód × limit                 (0,80 B2B, 0,65 etat)
składka     = świadczenie × stawka × mnożnik_okresu   — jako przedział

stawka          = dol … gora     (14.10.2026: 0,0202 … 0,0322)
                  dol = najtańsza osoba, gora = najdroższa osoba
                  srodek = mediana osób (0,022) — tylko tam, gdzie musi
                  paść jedna liczba; żadna strona go dziś nie pokazuje
mnożnik_okresu  = 1,00  dla 24 miesięcy
                = 1,25  dla 36 miesięcy
                = brak danych dla 48 i 60
```

Zakres ważności: niezdolność okresowa bez trwałej niezdolności i bez śmierci,
bez klauzuli HIV/WZW i bez płatnych dodatków, okres wyczekiwania do 21 dni,
składka w 12 ratach (brutto, z opłatą dystrybucyjną — tyle płaci klient),
Leadenhall, oferty z ostatnich 12 miesięcy.

Z 17.09 zostało sprawdzenie modelu na 16 obserwacjach: wzór ze stawką 0,022
mylił się od −9,8% do +10,0%. Dlatego strona pokazuje przedział, a nie
„0,022 ± 10%” — przedział od najtańszej do najdroższej osoby obejmuje każdego
klienta z próby z definicji.

### Klauzula HIV/WZW

W próbie kalibracyjnej jej nie ma, ale w bazie są dwie oferty z klauzulą
LW049 (stan 28.09.2026). Jedna daje czystą parę — ten sam wariant MEDICARE
(5 000 zł, 36 miesięcy, 14/21 dni) z klauzulą i bez: składka bazowa
1500 zł wobec 1404 zł, **×1,068**. Druga nie rozstrzyga, bo jej dwa warianty
bez klauzuli różnią się ceną przy identycznych widocznych parametrach
(+3% albo +13%, zależnie od tego, z którym porównać).

`MNOZNIK_HIV_WZW` = **1,07** od 28.09.2026, decyzją właściciela. Wcześniej
stało 1,2 — relacja 1,8% / 1,5% ze starego `Calculator.js`, niczym
niepotwierdzona. Jedna para to wciąż mało: przy kolejnych ofertach z klauzulą
warto policzyć to jeszcze raz, ręcznie.

## Jak tę kalibrację powtórzyć

Od 14.10.2026 nie ręcznie: `select public.ud_kalibracja_stawek();` (tylko
odczyt, wyłącznie `service_role` — w SQL Editorze działa) zwraca stawki,
mnożniki, liczność próby i raport z powodami pominięć. Metoda jest opisana
niżej, w części o kalibratorze.

Filtr z 17.09 (bez trwałej, bez śmierci, 12 rat) był za luźny — przepuszczał
klauzulę HIV/WZW. Mnożnik okresu liczy się na parach z jednej oferty, złączonych
po świadczeniu, okresie wyczekiwania, dodatkach i bazie OWU — inaczej do
porównania wchodzą warianty różniące się czymś jeszcze i mnożnik rozjeżdża się
do 1,13–1,40.

Dziury, które domkną nowe oferty: okres 48 lub 60 miesięcy (kalibrator zgłosi
mnożnik mailem „do decyzji”), drugi ubezpieczyciel (CEU — dziś świadomie poza
próbą), klienci po pięćdziesiątce (dziś jedna osoba).

---

# Kalibrator — stawki przeliczane z ofert (metoda osoby-v1)

Status na 14.10.2026: **kod w repozytorium, na produkcji jeszcze nic.**
Kolejność wdrożenia i kroki właściciela — CLAUDE.md, „Kalibrator stawek".

## Rzecz, która przesądza o kształcie: serwis jest statyczny

Kwoty składek nie są czytane w przeglądarce. Są wpieczone w build: przedział
składki stoi w 191 plikach HTML, 191 plikach `.md` i 188 plikach `llms.txt`.
Kalkulator jest wyspą Svelte, ale renderuje się po stronie serwera, żeby robot
i model językowy zobaczyły liczby, a nie pustą ramkę.

Dlatego kalibrator **nie zapisuje stawek do bazy, z której czytałaby strona**,
tylko proponuje nowy `kalibracja.json` w repozytorium. Build niczego nie pyta
bazy — awaria Supabase nie zepsuje wdrożenia portalu. Historia gita jest przy
okazji dziennikiem: widać, kiedy stawka się zmieniła, o ile i na jakiej próbie
(`zrodlo`). Na produkcie regulowanym to odpowiedź na pytanie „co serwis
pokazywał w marcu i skąd ta liczba".

## Przepływ

```
pg_cron „kalibracja-stawek" (pn–pt 05:40 UTC, powstaje WYŁĄCZONE)
  └─ public.ud_kalibracja_uruchom()          — dokłada x-cron-token z Vaulta
       └─ funkcja brzegowa kalibrator
            ├─ edge_cron_token_matches        — przed czymkolwiek innym
            ├─ ud_kalibracja_ustawienia        — tryb, gałąź, odbiorca, dane_od
            ├─ rpc ud_kalibracja_stawek()      — agregaty, nic osobowego
            ├─ kalibracja.json z gałęzi produkcyjnej (GitHub)
            ├─ /kalkulator/index.md            — czy strona pokazuje plik
            ├─ bramki (niżej)
            └─ tryb:
                 wylaczony  → wpis w dzienniku
                 na_sucho   → mail z porównaniem, codziennie; zero zapisów
                 propozycja → gałąź kalibrator/propozycja + pull request
                              → właściciel scala → Pages buduje portal
```

Każdy przebieg zostawia wiersz w `ud_kalibracja_przebiegi` (wynik, powód,
numer PR, wynik SQL przepuszczony przez białą listę pól).

## Metoda — w SQL, nie w funkcji brzegowej

Cała metoda siedzi w `ud_kalibracja_stawek(p_na_dzien, p_dane_od)`. Funkcja
brzegowa jej nie powtarza: bierze wynik, pilnuje bramek i decyduje, co z nim
zrobić. Dwie wersje metody rozjechałyby się przy pierwszej poprawce.

**Baza:** oferty wysłane (`sent_at`, bez szkiców), także zarchiwizowane,
z okna 365 dni do chwili 48 h przed przebiegiem (oferta wystawiona wczoraj
może jeszcze być poprawiana). Oferta w koszu wypada sama — jej warianty
wychodzą z `ud_offer_documents`. `dane_od` w ustawieniach przycina okno od
dołu (gdyby kiedyś trzeba było odciąć dane sprzed zmiany taryfy).

**Wariant porównywalny z kalkulatorem** — każdy inny dostaje jeden powód
pominięcia (pierwszy pasujący, liczony w `raport.pominiete`):

| Powód | Warunek wykluczenia |
|---|---|
| `poza_oknem` | poza oknem wyżej |
| `inny_ubezpieczyciel` | nie Leadenhall (CEU świadomie poza próbą) |
| `trwala_lub_smierc` | trwała niezdolność, suma trwałej albo śmierć — także `null` (nie wiemy, że ich nie ma) |
| `jednorazowe` | inna liczba rat niż 12 (raty kosztują ~10% więcej, kalkulator mówi o ratach) |
| `hiv` | którykolwiek z trzech sygnałów: `covers_hiv_wzw` różne od `false` (także brak odpowiedzi parsera), `hiv_owu_symbol`, objęta pozycja `hiv_wzw` w `extras` |
| `dodatki` | objęta pozycja w `extras` z symbolem innym niż LW144 |
| `wyczekiwanie` | okres wyczekiwania powyżej 21 dni (NW albo choroba) |
| `brak_kwot` | świadczenie albo składka puste lub zerowe |

LW144 występuje pod kluczami `degenerative_limit` i `lw_lw144` — to ta sama
pozycja, porównujemy po symbolu.

**Składka brutto** (`premium_total`, z opłatą dystrybucyjną). Kalkulator mówi,
ile klient zapłaci. Netto (`ud_skladka_netto`) to podstawa prowizji w panelu —
inna wielkość, a stawka netto byłaby o ~9% niższa od ceny, czyli zaniżona.

**Osoba, nie wariant.** Jedna oferta potrafi mieć sześć wariantów tej samej
osoby; licząc warianty, jeden klient ważyłby sześć razy więcej niż drugi.
Osoba to `md5(PESEL)`, bez PESEL-u — klient, bez klienta — oferta. Stawka
osoby to mediana jej czystych wariantów 24-miesięcznych z jej **najnowszej**
oferty (ponowna oferta zastępuje starą). Ten sam wiersz wczytany dwa razy do
jednej oferty liczy się raz.

**Stawki** — zaokrąglane **w górę**, bo zaniżona cena to najgorszy kierunek
błędu:

- `dol` = najtańsza osoba, w górę do 0,01 p.p. (0,0001),
- `gora` = najdroższa osoba, jw. — decyzja właściciela z 14.10: górą jest
  realny klient, nie percentyl,
- `srodek` = mediana osób, w górę do 0,1 p.p. (0,001), ale nie wyżej niż
  `gora` — przy medianie tuż pod maksimum (0,0321 / 0,0322) dałby 0,033.

**Mnożnik okresu** tylko z par w jednej ofercie (to samo świadczenie,
wyczekiwanie, dodatki i baza OWU), iloraz osoby = mediana jej par. Klucz
powstaje przy **≥ 3 osobach** z parą i rozrzucie ilorazów **≤ 1,05**,
zaokrąglony w górę do 0,01. Mniej osób albo większy rozrzut — klucza nie ma,
a kandydat stoi w raporcie (`okresy_kandydaci`).

**Bramki w SQL:** poniżej **8 osób** status `za_malo_osob` (bez stawek);
anomalia w danych — status `anomalie` (bez stawek, z listą). Anomalia to rata
× 12 różna od składki o ponad złotówkę, „do zapłaty" różne od składki albo
stawka wariantu poza 1–5%. Lista niesie numer oferty **bez członu
z nazwiskiem** (`UD/2026/CE/00038`) i powód — nic się po cichu nie pomija.

**Kontrakt wyniku:** `status`, `metoda`, `na_dzien`, `stawka`, `okresy`,
`zrodlo` (metoda, ubezpieczyciel, okno, osob, ofert, wariantow, par),
`raport` (surowe min/mediana/średnia/max/p10/p90, kandydaci okresów,
pominięte, anomalie). Żadnego PESEL-u, uuid ani skrótu — test to sprawdza.

Funkcja jest `STABLE`, `SECURITY INVOKER`, z pustym `search_path`, wykonać ją
może wyłącznie `service_role`. Plan z 17.09 zakładał `SECURITY DEFINER`
i klucz anonimowy; odpadło, bo funkcja brzegowa i tak ma klucz serwisowy
(zapisuje dziennik), a funkcja wołalna kluczem z każdego źródła strony to
otwarte drzwi do bazy ofert — nawet jeśli zwraca same agregaty.

## Bramki funkcji brzegowej

Propozycja zmiany powstaje tylko wtedy, gdy:

- SQL zwrócił `status = 'ok'`, stawki w 1–5%, `dol < gora`, mnożniki w 1–2;
- obecny plik z gałęzi produkcyjnej przechodzi walidator, a kandydat — ten sam
  walidator co portal (`bledyKalibracji` w funkcji = `sprawdzKalibracje`
  w `symulacja.ts`; test porównuje oba na wspólnej liście przypadków);
- żadna granica nie leży pod surową stawką z raportu (`dol` ≥ surowe
  minimum, `gora` ≥ surowe maksimum) — druga linia obrony, gdyby ktoś zmienił
  zaokrąglenia w SQL;
- zmieniło się `stawka` albo `okresy` — sama zmiana liczności próby
  (`zrodlo`) PR-a nie otwiera;
- tej samej propozycji (skrót SHA-256 ze stawek i okresów, zapisany w opisie
  PR) nie ma już w otwartym PR ani w PR zamkniętym bez scalenia — odrzuconej
  liczby kalibrator nie ponawia.

**Nowych okresów (48, 60) nie dopisuje** — dane, które je pozwalają policzyć,
idą do maila jako „do decyzji", raz na 30 dni. Okres z pliku, którego SQL nie
policzył (za mało par), zostaje stary, z uwagą w mailu.

Plan z 17.09 miał jeszcze bramkę „≤ 15% ruchu na dobę". Odpadła razem
z commitem prosto na produkcję: każda zmiana idzie przez kliknięcie
właściciela, a mail i opis PR pokazują tabelkę „było / będzie" z kwotami.

## Pull request, nie commit na produkcję

Decyzja właściciela z 14.10.2026 — **każda zmiana stawek przez jego
kliknięcie.** Push na gałąź produkcyjną wdraża portal od razu (i trzy inne
projekty Pages), a kalibrator zmienia ceny pokazywane konsumentom.

- Propozycja to **jeden commit, którego rodzicem jest bieżący HEAD gałęzi
  produkcyjnej**, a drzewem — drzewo tego HEAD z podmienionym jednym plikiem
  (Git Data API). Gałąź bota `kalibrator/propozycja` jest przestawiana raz,
  wprost na ten commit (`force`). Scalenie nigdy nie cofnie niczego innego.
- **Gałąź bota nigdy nie stoi na samym HEAD produkcyjnej.** Pierwsza wersja
  najpierw cofała ją na HEAD, a potem dopisywała plik — przez tę chwilę GitHub
  mógł uznać otwarty PR za scalony, choć na stronę nic nie weszło (przegląd
  z 14.10.2026). Nie wracaj do „reset, potem PUT /contents".
- Zanim zapisze, sprawdza, że plik w tym HEAD jest dokładnie tym, który
  właśnie ocenił — inaczej przerywa.
- Twarda lista zapisów (`zapisDozwolony()`), sprawdzana przed każdym
  żądaniem innym niż GET: drzewo z jednym wpisem (plik kalibracji), commit
  z jednym rodzicem, gałąź bota, PR z gałęzi bota do produkcyjnej, tytuł
  i opis istniejącego PR. Nic więcej — ani scalenia, ani zamknięcia, ani
  zmiany bazy PR, ani zapisu przez Contents API.
- **Otwarty PR, którego liczb dane już nie dają** (przebieg „bez zmian" albo
  odmowa), dostaje tytuł z przedrostkiem `[NIEAKTUALNE]` i ostrzeżenie „nie
  scalaj" na początku opisu; skrót propozycji znika z opisu. Gdy dane znowu
  pokażą zmianę, kalibrator przepisze ten sam PR na nowo. Bez tego właściciel
  mógł scalić stawki sprzed zmiany danych — także niższy dół.
- Ręczne poprawki na gałęzi bota przepadają przy następnej propozycji —
  poprawia się dane albo zamyka PR, nie gałąź.
- Podgląd: `https://kalibrator-propozycja.utratadochodu.pages.dev/kalkulator/`.

Token: fine-grained, tylko `aurabroker/ud`, Contents i Pull requests: write.
Kalibrator czyta nagłówek wygaśnięcia i ostrzega mailem 30 dni wcześniej.

## Maile

Odbiorca z ustawień (domyślnie `biuro@utratadochodu.com`). Nadawca
`noreply@utratadochodu.com` kluczem `RESEND2_API_KEY`, a gdy ten odmówi —
`info@utratadochodu.pl` kluczem `RESEND_API_KEY`.

- **na sucho** — codziennie, bez względu na wynik: stawki teraz i według
  danych, kwoty dla dwóch przykładów (14 400 i 11 700 zł), próba, pominięcia,
  anomalie;
- **propozycja** — link do PR i do podglądu, tabelka kwot, poprzednia treść
  pliku (do cofnięcia), ostrzeżenie, gdy spada dolna granica;
- **odmowa** — powody; ta sama odmowa co w poprzednim przebiegu drugiego
  maila nie wysyła, chyba że poprzedni mail nie wyszedł (wtedy ponawia);
- **bez zmian** — raz na 30 dni, żeby cisza nie znaczyła awarii;
- **alarmy** — strona dwa przebiegi z rzędu nie pokazuje przedziału z pliku
  (portal nie przebudował się po scaleniu; przypomnienie co tydzień, dopóki
  tak jest), token wygasa, otwarty PR stał się nieaktualny.

## Czego kalibratorowi nie wolno

- **Dopisywać mnożników dla 48 i 60 miesięcy** — patrz wyżej.
- **Ruszać `MNOZNIK_HIV_WZW`** — jedna czysta para to za mało na przeliczanie
  maszynowe; ustawia się go ręcznie w `symulacja.ts`.
- **Dopisywać współczynnika klasy ryzyka ani wieku** — powody w pierwszej
  części dokumentu.
- **Wpisywać do repozytorium czegokolwiek z danych klientów.** `zrodlo`
  przechodzi przez białą listę pól; numery ofert stoją wyłącznie w mailu.

## Testy

| Co | Gdzie |
|---|---|
| metoda SQL na zamrożonym zestawie z produkcji (127 wariantów, zanonimizowane) i na przypadkach brzegowych; uprawnienia, cron | `pnpm test:kalibracja-sql` w `apps/panel` (`supabase/tests/kalibracja.sql`, 58 przypadków) |
| funkcja brzegowa na atrapach Supabase, GitHuba i Resend; zgodność walidatorów; rozpoznanie przedziału na zbudowanej stronie | `apps/portal/test/kalibrator.spec.js` |
| walidator pliku w portalu, kwoty liczone z `kalibracja.json` | `apps/portal/test/kalkulator.spec.js` |

Oczekiwane liczby z produkcji (10 osób, 0,0202 / 0,022 / 0,0322, 36 → 1,25
z 5 osób) policzyła niezależna implementacja w Pythonie na tych samych
wierszach, nie sama funkcja SQL. Jeśli kiedyś funkcja zwróci co innego na tym
zestawie, to znaczy, że ktoś zmienił metodę, a nie że zmienił się rynek.

Testy przeszły mutacje (44 pogorszone wersje migracji, każda daje czerwony
wynik): każdy filtr z osobna, osoba po kliencie zamiast PESEL-u, najstarsza
oferta zamiast najnowszej, minimum zamiast mediany, składka netto,
zaokrąglenia do najbliższej zamiast w górę, środek ponad górę, progi
3 osób / 1,05 / 8 osób,
anomalie, pełny numer oferty z nazwiskiem, `SECURITY DEFINER`, brak `revoke`,
stan crona po ponownej migracji.
