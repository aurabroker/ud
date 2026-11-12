# Asystentka AI na stronie — co musi być przed uruchomieniem

Agent w ElevenLabs istnieje, ale **testów jeszcze nie przechodzi i na stronie
go nie ma** (stan i wyniki: „Jak testujemy” niżej). Widżet wolno wstawić
dopiero po zielonych testach oraz punktach z części A i B. Źródło listy:
przegląd z 11.11.2026 (trzech recenzentów: fakty, prawo, odporność rozmowy).

## A. Decyzje prawnika (i właściciela)

1. **Dystrybucja ubezpieczeń.** Czy rozmowa z asystentką to „dystrybucja
   ubezpieczeń” (informacje o umowach według kryteriów klienta, przez stronę
   internetową)? Jeśli tak — czy program może to robić w imieniu agenta,
   i które informacje z art. 22 ustawy o dystrybucji ubezpieczeń muszą paść
   w samym czacie.
2. **Doradztwo.** Czy Aura Expert deklaruje doradztwo (rekomendację)? Od tego
   zależy, czy wolno pisać „agent doradza / dobiera wariant” (dziś asystentka
   mówi tylko „agent porównuje warunki Leadenhall i CEU”).
3. **Na rzecz kogo działa agent** (umowa agencyjna, wpis RPU 11229690/A):
   Lloyd’s, Leadenhall, CEU? Jednozakładowy czy wielozakładowy? Jak ma to
   brzmieć w zdaniu asystentki.
4. **Opłata dystrybucyjna** (ok. 10% w ofertach Leadenhall): kto ją pobiera
   i jak ją opisać. Dziś asystentka mówi tylko, że jest wliczona w kwotę do
   zapłaty i widać ją w ofercie.
5. **`/kup-online`.** Kto przy sprzedaży online z naszym kodem robi analizę
   wymagań i potrzeb i obowiązki informacyjne? Czy asystentka może tam kierować?
   Tekst ramki „Zakup online” na `/wniosek/` (`apps/portal/src/lib/kupOnline.ts`)
   prawnik zaakceptował 12.11.2026 — do ustalenia zostaje, co o zakupie online
   może mówić sama asystentka.
6. **„Broker ubezpieczeniowy od 2009 roku”** przy Marku Cieśli (strona
   /o-nas/, w bazie wiedzy asystentki) — otwarte już w CLAUDE.md. Asystentka
   ma zakaz nazywania kogokolwiek z serwisu brokerem.
7. **Reklamacje.** Czy czat to kanał w rozumieniu ustawy o rozpatrywaniu
   reklamacji (fikcja uznania z art. 8)? Wystarczy komunikat „czat nie
   przyjmuje reklamacji”, czy zapisy trzeba przeglądać? Które adresy są
   oficjalne (zgloszenie@auraexpert.pl, biuro@utratadochodu.com,
   info@utratadochodu.pl)?
8. **RODO.** Podstawa zapisu rozmów i 30 dni retencji; dane o zdrowiu podane
   z własnej inicjatywy (art. 9) — wystarczy minimalizacja, czy retencja 0?
   **Maskowania danych w zapisach nie ma**: ElevenLabs udostępnia je tylko
   w planie Enterprise (odmowa API 11.11.2026), więc PESEL albo diagnoza
   wpisane mimo prośby zostają w zapisie tekstowym przez 30 dni. Ocena skutków
   (art. 35)? Wpis w rejestrze czynności (art. 30).
9. **ElevenLabs jako podmiot przetwarzający:** umowa powierzenia (DPA) na
   naszym planie, podprocesorzy, transfer do USA (DPF albo SCC), wykluczenie
   trenowania na rozmowach, ewentualnie dane w UE. Podprocesorzy w tej
   konfiguracji: model rozmowy Claude (Anthropic) i model oceny rozmów po jej
   zakończeniu Gemini (Google) — ElevenLabs nie przyjął innego modelu do
   oceny.
10. **Polityka prywatności i klauzula** — nowy punkt „Asystentka AI na
    stronie” (cel, podstawa, ElevenLabs i podprocesorzy, USA, 30 dni, brak
    nagrań głosu, prawa, kontakt). CLAUDE.md: każda zmiana tych treści wymaga
    akceptacji prawnika. Do tego czasu asystentka **nie odsyła** do polityki
    prywatności w sprawie rozmowy (zasada 13 instrukcji) — w pierwszej wersji
    odsyłała, a polityka o asystentce nic nie mówi. Po publikacji punktu
    można to odesłanie przywrócić.
11. **Regulamin** — paragraf o asystentce (informacja, nie porada ani oferta;
    wymagania techniczne, mikrofon w trybie głosowym; zakaz treści
    bezprawnych; czat nie przyjmuje reklamacji).
12. **AI Act:** czy Aura Expert jest dostawcą czy podmiotem stosującym;
    art. 50 (informacja o AI — jest w pierwszej wiadomości) i art. 4
    (kompetencje osób, które czytają zapisy rozmów).

## Stan agenta w ElevenLabs (11.11.2026)

`agent_8401m75hfzvbefm8thwzfzktybrg`, „UtrataDochodu.pl — asystentka na
stronie (Monika)”. Stary agent (`agent_7401m4ba22wqfthb27mhyj0tfcd0`)
nietknięty.

- Instrukcja = `instrukcja.md` (wersja 3: 21 944 znaki, liczba sprawdzona
  po wgraniu — **wersja nieprzetestowana**, patrz niżej), pierwsza
  wiadomość = `pierwsza-wiadomosc.txt`, bez przerywania.
- Model rozmowy `claude-sonnet-4-6`, temperatura 0,2, strefa Europe/Warsaw.
- **Domyślnie czat tekstowy** (`text_only`): bez przetwarzania głosu, adresy
  klikalne (także `/kup-online?z=asystent`), niższy koszt. Strona może
  włączyć głos nadpisaniem `text_only` (jedyne dozwolone nadpisanie) i musi
  wtedy przekazać `tryb = glos`. Rozmowa najwyżej 15 minut, bez przesyłania
  plików. Przy głosie liczby zamienia na mowę silnik ElevenLabs, nie model —
  przy normalizacji „w instrukcji” model pisał numery słownie także w czacie.
- Baza wiedzy: 23 dokumenty (`baza-wiedzy.json`), odświeżane codziennie,
  wyszukiwanie RAG (multilingual_e5_large_instruct).
- Ochrona: prompt injection i trzymanie tematu włączone; `end_call` tylko po
  pożegnaniu, nigdy przy kryzysie.
- Prywatność: bez nagrań głosu, zapis tekstu 30 dni, bez maskowania (A8).
- Dostęp: rozmowy tylko z `utratadochodu.pl`, wymagany nagłówek Origin;
  limity 10 rozmów naraz i 300 dziennie (koszt nadużycia ma sufit).
- Strona może zmienić wyłącznie tryb „tylko tekst”; instrukcji, pierwszej
  wiadomości, modelu i bazy z zewnątrz nie zmieni.
- Ocena każdej rozmowy: 4 kryteria (bez danych osobowych, bez obietnic,
  następny krok, zgodność z bazą) i 5 pól bez danych osobowych (temat, forma
  pracy, dokąd skierowano, prośba o człowieka, pytanie bez odpowiedzi).
- Testy: 26 rozmów z `testy.json` podpiętych do agenta.

## B. Wstawienie na stronę (praca w repozytorium, po części A)

- **Tylko `/kalkulator/`**, przycisk „Zapytaj asystentkę AI” (nie „porozmawiaj
  z Moniką”), awatar bez zdjęcia człowieka.
- **Skrypt widżetu ładowany dopiero po kliknięciu.** Przed kliknięciem nota:
  „Czat z asystentką AI. Kliknięcie uruchamia usługę ElevenLabs (USA). Treść
  rozmowy zapisujemy jako tekst na 30 dni, nagrania głosu nie zapisujemy.
  Administrator: Aura Expert sp. z o.o. Szczegóły: polityka prywatności. Nie
  podawaj danych osobowych ani informacji o zdrowiu.”
- **CSP:** dopisać host skryptu widżetu do `script-src`, `api.elevenlabs.io`
  i `wss://…` do `connect-src` (w obu miejscach polityki). Test ruchu
  sieciowego: przed kliknięciem zero żądań do ElevenLabs.
- **Meta Pixel na `/kalkulator/`:** przy zgodzie marketingowej startuje,
  a czat zachęca do pisania o zdrowiu. Decyzja właściciela: dopisać
  `/kalkulator/` do `TAGI.bezPixela` albo upewnić się, że Pixel nie widzi
  treści czatu (widżet w shadow DOM/iframe).
- **Pamięć przeglądarki:** sprawdzić, co widżet zapisuje w localStorage
  i ciasteczkach (art. 399 PKE).
- **Tryb rozmowy:** czat tekstowy. Głos tylko po osobnej decyzji: widżet
  nadpisuje `text_only = false`, przekazuje `tryb = glos`, a zestaw testów
  trzeba puścić ponownie w trybie głosowym (symulacje w głosie robiły inne
  błędy niż w tekście).
- **Brama formularza** po wstawieniu (`node test/obciazenie-formularza.mjs`)
  i test, że `/kalkulator/` bez kliknięcia wygląda i działa jak dziś.

## Jak testujemy — dwie warstwy

Oceniający ElevenLabs sam nie wystarcza. W pierwszym przebiegu (11.11.2026,
46 rozmów w trybie głosowym) zaliczył 37, a niezależny przegląd zapisów
względem stron i OWU, z próbą obalenia każdego zarzutu, potwierdził 42
usterki. Wśród nich: klauzula wypłaty od pierwszego dnia przypisana
Leadenhall (jest tylko w CEU), „ZUS przy B2B płaci od pierwszego dnia” bez
warunku chorobowego, potwierdzenie, że po trzech miesiącach niezdolności
polisa nic nie da, ocena roszczenia klienta z polisą, odesłanie do polityki
prywatności, która o asystentce milczy. Oceniający nie widzi bazy wiedzy
i ocenia słowa, nie fakty — raz uznał za błąd liczbę, która stoi w artykule.

Dlatego po każdej zmianie instrukcji: (1) cały zestaw `testy.json`
w ElevenLabs, każdy test dwa razy, (2) niezależny przegląd zapisów względem
stron i OWU (tekst OWU: `pdftotext` z `/owu/<slug>.pdf`), z weryfikacją
zarzutów przez drugiego recenzenta. Dopiero oba wyniki razem mówią, czy
wersja jest gotowa.

### Wyniki (11.11.2026)

| Przebieg | Instrukcja | Oceniający ElevenLabs | Przegląd zapisów (potwierdzone) |
|---|---|---|---|
| 1 | v1, tryb głosowy | 37/46 | 42 usterki |
| 2 | v2, czat tekstowy | 33/52 | 44 (5 blokujących, 33 poważne, 6 do poprawy w samych testach) |
| 3 | v3 | **nie uruchomiony** — w koncie ElevenLabs skończyły się kredyty („Insufficient credits”) | — |

Blokujące z przebiegu 2, każde wpisane do v3 jako gotowa formuła:
czat kryzysowy z adresem strony zamiast trzech numerów; wymyślony warunek
świadczenia HIV; okres wyczekiwania przy etacie powiązany z końcem
zasiłku; wyłączenie „kręgosłupa i stawów” zamiast chorób
zwyrodnieniowych; pytanie o zdrowie klienta, który zgłasza szkodę z polisy.
Najwięcej usterek: ZUS obok polisy (od którego dnia płaci, co pokrywa okres
wyczekiwania), klient z istniejącą polisą, kryzys.

**v3 nie jest sprawdzona.** Po odnowieniu kredytów: przebieg 3 (26 testów
× 2) i przegląd zapisów. Zanim się go uruchomi, warto poprawić warunki
testów wskazane w przeglądzie 2 (`od-pierwszego-dnia` warunek 6,
`zus-plus-polisa`, `po-angielsku`, `juz-po-wypadku`, `tryb-testowy`,
`dochod-spoza-tabeli`) — inaczej oceniający dalej będzie zaliczał błędy
i odrzucał poprawne odpowiedzi. Gdy v3 nie zejdzie do zera blokujących,
do decyzji właściciela: mocniejszy model rozmowy (droższy) albo węższy
zakres asystentki (np. tylko kalkulator i odesłanie do wniosku).

Koszt: dwa przebiegi zużyły około 119 tys. kredytów. Konto jest wspólne
z agentem Beauty — dopóki kredyty się nie odnowią, on też nie odpowiada.

## Do poprawy na stronie (wyszło przy przeglądzie, nie ruszone)

- **`ZUS_TEKST.etat` w `apps/portal/src/lib/zus.ts`**: „Na umowie o pracę
  ZUS wypłaca co najmniej 80% pensji przez 182 dni. Polisa chroni dochód przy
  dłuższej niezdolności.” Nieprecyzyjne: zasiłek to 80% podstawy wymiaru, nie
  pensji, za pobyt w szpitalu 70%, część okresu płaci pracodawca
  (wynagrodzenie chorobowe), a drugie zdanie sugeruje, że polisa płaci dopiero
  po zasiłku. Zdanie stoi w kalkulatorze, w FAQ `/kalkulator/` i w
  `llms.txt` (baza wiedzy asystentki). Brzmienie wybrał właściciel 21.10.2026,
  więc zmiana czeka na jego decyzję; propozycja: „Na umowie o pracę zasiłek
  chorobowy zależy od wynagrodzenia i przysługuje najdłużej 182 dni; część
  tego okresu wypłaca pracodawca.” Do tego czasu instrukcja zabrania
  asystentce podawać procent zasiłku na etacie.

## C. Utrzymanie

- Baza wiedzy odświeża się z żywej strony (auto-sync). Po scaleniu propozycji
  kalibratora i po styczniowej zmianie `zus.ts` — wymusić odświeżenie
  dokumentów (kalkulator, jak-to-dziala, llms.txt) i uruchomić testy ponownie.
- Zmiana `asystent/instrukcja.md` = ta sama treść w ElevenLabs i cały zestaw
  `asystent/testy.json` od nowa.
