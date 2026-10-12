# Kanban CRM — wytyczne projektowe i wdrożeniowe

Wersja: 1.0  
Data: 2026-10-01  
Zakres: tablica leadów, przeciąganie, zwijanie etapów do lewej, menu kontekstowe, dostępność, zapis i scenariusze odbiorowe.

Dokument opisuje proponowane wymagania produktu. Wymiary i czasy są parametrami startowymi do weryfikacji na prototypie, nie normami technicznymi. Nie zakłada konkretnego frameworka.

## 1. Układ tablicy i zwijanie etapów

### 1.1. Struktura

- Pasek górny: wybór pipeline’u, wyszukiwarka, filtry, przycisk „Dodaj lead”, przełącznik Kanban / Lista.
- Lewy panel: zwinięte etapy.
- Obszar roboczy: rozwinięte kolumny w kolejności pipeline’u.
- Prawy panel: szczegóły wybranego leada, otwierane bez opuszczania tablicy.
- Tablica przewija się poziomo; każda kolumna ma osobne przewijanie pionowe i stale widoczny nagłówek.
- Otwarcie szczegółów nie resetuje filtrów, kolejności ani pozycji przewijania.

| Element | Parametr startowy |
|---|---|
| Szerokość kolumny | 320 px, konfigurowalna w zakresie 300–340 px |
| Odstęp między kolumnami | 12–16 px |
| Wewnętrzny odstęp karty | 12 px |
| Lewy panel zwiniętych etapów | Około 180 px, widoczny tylko gdy istnieją zwinięte etapy |
| Panel szczegółów | Około 420–520 px; na małym ekranie pełny widok |
| Animacje | 120–180 ms; ograniczone przy preferencji reduced motion |

Nagłówek kolumny zawiera nazwę etapu, licznik, opcjonalną sumę wartości, „Dodaj lead”, „Zwiń” i menu „…”. Liczniki oznaczają wszystkie rekordy spełniające filtr, a nie tylko aktualnie załadowane karty. Przy aktywnych filtrach pokazuj np. „8 z 24”. Sumę opisuj jako sumę widocznego zbioru oraz wskaż rodzaj wartości i walutę; nie sumuj różnych walut bez jawnej reguły przeliczenia.

### 1.2. Zwijanie do lewego panelu

1. Użytkownik wybiera „Zwiń etap”.
2. Kolumna znika z obszaru roboczego, a etap pojawia się w lewym panelu.
3. Pozycja w panelu pokazuje numer etapu, poziomą nazwę, licznik i przycisk „Rozwiń”.
4. Kolejność w panelu odpowiada kolejności pipeline’u, nie kolejności zwijania.
5. Rozwinięcie przywraca kolumnę na jej pierwotne miejsce.

- Zwinięcie zmienia wyłącznie osobisty widok, nie dane leadów ani kolejność etapów.
- Zapisuj stan osobno dla użytkownika i pipeline’u.
- Zapewnij akcję „Rozwiń wszystkie”.
- Cała pozycja zwiniętego etapu jest obszarem upuszczenia leada.
- Podczas przeciągania pokazuj nazwę celu i podświetlenie.
- Po około 600 ms zatrzymania nad zwiniętym etapem można otworzyć tymczasowy podgląd. Po zakończeniu operacji przywróć wcześniejszy stan zwinięcia.
- W MVP upuszczenie na zwinięty etap zmienia etap, ale nie wymaga wyboru pozycji między kartami.
- Nie używaj obróconych napisów jako podstawowego sposobu prezentacji nazw.

### 1.3. Karta leada

| Pozycja | Zawartość |
|---|---|
| Nagłówek | Nazwa osoby lub firmy, maksymalnie dwie linie |
| Kontekst | Produkt albo temat zainteresowania |
| Wartość | Opcjonalna kwota z jednoznacznym znaczeniem |
| Najważniejsza informacja | Następne działanie i termin |
| Stopka | Opiekun, źródło, maksymalnie dwa tagi |
| Ostrzeżenia | Przeterminowanie, brak działania, brak opiekuna, długi czas w etapie |
| Akcje | Widoczny przycisk „…” i uchwyt przeciągania |

- Kliknięcie karty otwiera szczegóły.
- Kliknięcie telefonu, e-maila lub przycisku akcji nie otwiera szczegółów i nie rozpoczyna przeciągania.
- Nie pokazuj pełnych notatek ani zbędnych danych osobowych na karcie.
- Oznaczenia mają tekst lub ikonę; sam kolor nie wystarcza.
- Brak działania pokazuj jawnie: „Brak zaplanowanego działania”.
- Cała karta nie powinna być elementem button zawierającym inne przyciski. Zaprojektuj osobny dostępny element otwierania szczegółów oraz oddzielne kontrolki akcji.

## 2. Przeciąganie, sortowanie i urządzenia mobilne

### 2.1. Przeciąganie pojedynczego leada

1. Na desktopie lewy przycisk myszy rozpoczyna przeciąganie dopiero po ruchu około 6–8 px.
2. Wyklucz interaktywne elementy karty oraz obszary edycji tekstu. Uchwyt daje jednoznaczny punkt rozpoczęcia.
3. Pokaż podgląd przeciąganej karty i placeholder w miejscu źródłowym.
4. Podświetl poprawny cel. Niedostępny cel oznacz jako zablokowany i wyjaśnij powód.
5. Zapewnij poziome przewijanie tablicy i pionowe przewijanie kolumn przy krawędziach.
6. Upuszczenie na poprawny cel uruchamia walidację i zapis.
7. Upuszczenie poza celem albo Esc anuluje operację.
8. Po zmianie pokaż komunikat „Anna Kowalska: Nowy → Kontakt”.

- Przeciąganie prawym przyciskiem jest wyłączone; prawy przycisk otwiera menu.
- Cała pusta kolumna jest celem upuszczenia.
- Nie umieszczaj stref „Usuń” ani „Archiwizuj” przy krawędziach tablicy.
- W trakcie przeciągania zamknij istniejące menu i nie otwieraj nowego menu kontekstowego.
- Powtarzające się operacje na tym samym rekordzie muszą być blokowane lub kolejkowane do czasu rozstrzygnięcia zapisu.

### 2.2. Kolejność i sortowanie

- Przeniesienie między kolumnami zmienia etap.
- Przesunięcie w tej samej kolumnie zmienia kolejność tylko w trybie „Kolejność ręczna”.
- Przy sortowaniu po terminie, wartości lub dacie karta zajmuje pozycję wynikającą z sortowania; nie pokazuj wtedy znacznika ręcznego wstawienia.
- Ręczne sortowanie zapisuj jako stabilny klucz pozycji, nie indeks widocznego elementu DOM.
- Przy aktywnym filtrowaniu w MVP wyłącz ręczne przestawianie pozycji: ukryte rekordy uniemożliwiają jednoznaczne wskazanie kolejności całej kolumny.
- Kolejność etapów edytuje administrator w konfiguracji pipeline’u, nie przez przypadkowe przeciąganie nagłówka.
- Gdy po zmianie lead przestaje spełniać filtr, pokaż komunikat z możliwością otwarcia jego szczegółów.

### 2.3. Dostępność i mobile

- Menu „Przenieś do…” zapewnia zmianę etapu bez przeciągania i jest dostępne również kliknięciem przycisku „…”.
- Wszystkie główne operacje są dostępne z klawiatury.
- Ogłaszaj wynik przeniesienia i błąd przez odpowiedni region komunikatów dla technologii asystujących.
- Po zamknięciu szczegółów lub menu przywracaj logiczny fokus.
- Na telefonie używaj jednego etapu z przełącznikiem etapów lub widoku listy.
- Na telefonie podstawą zmiany etapu jest menu; przeciąganie jest opcjonalne.
- Długie przytrzymanie nie jest jedyną drogą dostępu do akcji.

Wymóg alternatywy wskaźnikowej bez przeciągania wynika z [WCAG 2.2, kryterium 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements). Sama alternatywa klawiaturowa nie zastępuje alternatywy obsługiwanej kliknięciem.

## 3. Menu kontekstowe pod prawym przyciskiem

### 3.1. Zasada produktu

TAK: prawy przycisk myszy na karcie może otwierać własne menu operacji CRM. Jest to skrót do tych samych działań, które udostępnia widoczny przycisk „…”, a nie dodatkowy, ukryty zestaw funkcji.

- Prawy klik na karcie: menu danego leada.
- Prawy klik na nagłówku kolumny: menu etapu.
- Prawy klik na pozycji zwiniętego etapu: menu tego etapu.
- Prawy klik na pustym obszarze, linku, zaznaczonym tekście lub w polu edycji: natywne menu przeglądarki w MVP.
- Nie przechwytuj menu globalnie na całej stronie.
- Prawy klik na innym leadzie otwiera menu dla tego leada, bez przypadkowego uruchamiania operacji na poprzednio aktywnym rekordzie.
- MVP nie ma masowych akcji; menu zawsze dotyczy jednego jawnie wskazanego rekordu.

### 3.2. Menu leada

| Grupa | Pozycja | Zachowanie |
|---|---|---|
| Podgląd | Otwórz szczegóły | Otwiera prawy panel |
| Proces | Przenieś do… | Otwiera wybór etapu; bieżący etap jest oznaczony |
| Obsługa | Zaplanuj działanie… | Formularz typu działania i terminu |
| Obsługa | Dodaj notatkę… | Formularz notatki |
| Przypisanie | Zmień opiekuna… | Wybór użytkownika z odpowiednimi uprawnieniami |
| Udostępnianie | Kopiuj link do leada | Kopiuje adres; dostęp nadal wymaga autoryzacji |
| Porządkowanie | Archiwizuj… | Potwierdzenie z nazwą leada |

- Dla kolumn „Wygrany” i „Przegrany” używaj „Przenieś do…” z odpowiednim etapem; nie twórz osobnego, rozbieżnego mechanizmu statusu.
- W MVP nie dodawaj duplikowania leadów ani trwałego usuwania z szybkiego menu.
- „Zadzwoń” i „Napisz e-mail” mogą być dodatkowymi akcjami, jeśli istnieją właściwe dane. Ich uruchomienie otwiera dialer lub formularz; nie wysyła wiadomości bez świadomego działania użytkownika.
- Akcje wymagające danych mają wielokropek w etykiecie.
- Nie pokazuj operacji, do których użytkownik nie ma prawa. Widoczną, czasowo zablokowaną akcję opisz przyczyną.
- Nie pokazuj danych ani dostępnych działań na podstawie samego identyfikatora bez weryfikacji uprawnień.

### 3.3. Menu etapu

| Pozycja | Zachowanie |
|---|---|
| Dodaj lead w tym etapie | Otwiera formularz z ustawionym etapem |
| Zwiń etap / Rozwiń etap | Zmienia osobisty widok |
| Sortowanie… | Wybór sposobu sortowania, jeśli produkt wspiera ustawienie dla kolumny |
| Konfiguruj etap… | Tylko uprawniony administrator; przejście do konfiguracji |

Nie dodawaj w MVP „Usuń etap” ani „Przenieś wszystkie leady” do szybkiego menu. To operacje administracyjne o większym ryzyku.

### 3.4. Zachowanie wizualne i klawiatura

- Menu otwiera się przy wskaźniku, ale mieści się w viewportcie; przy krawędzi zmienia kierunek otwarcia.
- Otwarcie klawiaturą pozycjonuje menu przy aktywnej karcie lub przycisku.
- Menu ma krótki, nieinteraktywny opis kontekstu, np. nazwę leada.
- Jednocześnie otwarte jest tylko jedno menu.
- Kliknięcie poza menu oraz Esc zamykają menu.
- Wybranie akcji zamyka menu; jeśli otwiera formularz, fokus przechodzi do formularza.
- Strzałki góra/dół zmieniają aktywną pozycję; Enter aktywuje; Home/End wybierają pierwszą/ostatnią pozycję.
- Shift+F10 lub klawisz menu kontekstowego otwiera menu dla elementu z fokusem.
- Tab zamyka menu i pozwala kontynuować nawigację, bez pułapki fokusu.
- Po anulowaniu fokus wraca do elementu, dla którego otwarto menu.
- Nie buduj głębokich podmenu. „Przenieś do…” może otwierać prosty selektor etapów z wyszukiwaniem.
- Przycisk „…” ma dostępną nazwę, np. „Akcje leada Anna Kowalska”, oraz właściwe aria-haspopup i aria-expanded.
- Dla menu poleceń stosuj role menu/menuitem i pełny model klawiaturowy, nie same atrybuty ARIA.

Model interakcji opisuje [WAI-ARIA APG: Menu and Menubar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/).

### 3.5. Obsługa techniczna

- Obsłuż zdarzenie contextmenu na konkretnym celu.
- Wywołuj preventDefault wyłącznie wtedy, gdy aplikacja rzeczywiście otwiera własne menu.
- Nie blokuj natywnego menu na linkach, zaznaczonym tekście i polach formularza.
- Przycisk „…” i prawy klik korzystają z jednego modelu akcji i tych samych handlerów.
- Kontekst menu zawiera stabilny leadId albo stageId; nie używaj indeksu karty w tablicy.
- Stan otwartego menu obejmuje typ celu, identyfikator celu, punkt zakotwiczenia i element do przywrócenia fokusu.
- Zamknij menu, jeśli rekord został usunięty, zarchiwizowany, utracił uprawnienia lub zniknął z aktualnego widoku.
- Nie zakładaj, że aplikacja zawsze może zastąpić menu przeglądarki. Firefox przy Shift + prawy klik może pokazać natywne menu bez zdarzenia contextmenu.

Zachowanie zdarzenia i wyjątek Firefoksa opisuje [MDN: contextmenu](https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event).

## 4. Zapis, uprawnienia i wydajność

### 4.1. Jedna ścieżka zmiany etapu

Przeciąganie, menu kontekstowe i formularz szczegółów korzystają z tej samej operacji domenowej zmiany etapu.

Przykładowy kontrakt logiczny, nie narzucony format API:

```ts
type MoveLeadCommand = {
  leadId: string;
  targetStageId: string;
  expectedVersion: number;
  idempotencyKey: string;
  targetPosition?: string; // tylko dla kolejności ręcznej
  transitionData?: Record<string, unknown>; // walidowane zgodnie ze schematem etapu
};
```

- Backend ustala tożsamość użytkownika z sesji/tokena, nie z dowolnego pola przesłanego przez klienta.
- Backend sprawdza dostęp do rekordu, workspace’u, pipeline’u i etapu docelowego.
- Aktualizacja etapu i pozycji jest atomowa.
- expectedVersion zabezpiecza przed cichym nadpisaniem równoległej zmiany.
- idempotencyKey pozwala bezpiecznie ponowić to samo żądanie.
- Odpowiedź zwraca kanoniczny stan rekordu i jego nową wersję.

### 4.2. Stany operacji

| Stan | Zachowanie |
|---|---|
| Gotowy | Normalna karta |
| Zapis w toku | Dyskretne oznaczenie; kontrola kolejnych zmian |
| Sukces | Usunięcie oznaczenia i komunikat wyniku |
| Błąd | Powrót do poprzedniego stanu, jeśli wersja nie została zastąpiona nowszą; inaczej pobranie stanu serwera |
| Konflikt | Odświeżenie danych i komunikat o zmianie przez inną osobę |
| Brak danych | Formularz uzupełnienia; anulowanie nie zmienia etapu |
| Brak uprawnień | Brak zmiany i czytelny komunikat |

- Dla przejść bez dodatkowego formularza dopuszczalna jest aktualizacja optymistyczna.
- Dla znanych przejść wymagających danych najpierw zbierz dane, potem zatwierdź zmianę.
- Przy niejednoznacznym wyniku sieci sprawdź stan operacji albo ponów z tym samym kluczem; nie zakładaj automatycznie, że zapis się nie odbył.
- „Przegrany” może wymagać powodu utraty, a „Wygrany” danych zamknięcia.
- Automatyzacje uruchamiaj po zatwierdzeniu zmiany. Konsumenci zdarzeń również muszą obsługiwać duplikaty.
- Historia obejmuje rekord, poprzedni i nowy etap, wykonawcę oraz czas.
- Cofnięcie zmiany etapu jest nową walidowaną operacją. Nie obiecuj cofnięcia wysłanego e-maila ani innych efektów zewnętrznych.

### 4.3. Skalowanie

- Pobieraj dane etapami i stronicuj karty; nie pobieraj całej bazy do przeglądarki.
- Liczniki i agregaty obliczaj dla całego filtrowanego zbioru po stronie backendu.
- Wirtualizację wprowadzaj przy dużych zbiorach po testach z biblioteką drag-and-drop, pustymi kolumnami i przewijaniem.
- Podczas przeciągania zachowaj stabilność celów i placeholderów; nie pozwalaj, by aktualizacja w tle przypadkowo zmieniła cel pod wskaźnikiem.
- Wyszukiwanie może mieć debounce około 250 ms; anuluj lub ignoruj nieaktualne odpowiedzi.
- Rozdziel stan danych od stanu widoku: zwinięcia, scroll, panel szczegółów, menu i zaznaczenie.

## 5. Zakres MVP i kryteria odbioru

### 5.1. MVP

- Kolumny, karty, liczniki i wyszukiwanie.
- Filtry: opiekun, źródło, produkt, termin działania.
- Przenoszenie jednego leada między etapami.
- Zwijanie etapów do lewego panelu i zapamiętywanie ustawień.
- Upuszczanie na pusty i zwinięty etap.
- Panel szczegółów.
- Menu leada pod „…” i prawym przyciskiem.
- Menu etapu pod „…” i prawym przyciskiem.
- Zmiana etapu bez przeciągania, obsługa klawiatury i komunikaty dostępności.
- Walidacja, uprawnienia, historia, obsługa błędów i konfliktów.
- Sortowanie po następnym działaniu, dacie lub wartości.

Poza MVP: masowe przenoszenie, wielokrotne zaznaczanie, ręczna kolejność jeśli nie jest niezbędna, grupowanie według opiekuna, duplikowanie, rozbudowane podmenu i administracyjne operacje zbiorcze.

### 5.2. Scenariusze akceptacyjne

| ID | Scenariusz | Oczekiwany wynik |
|---|---|---|
| K01 | Zwykły klik w kartę | Szczegóły, bez przeciągania |
| K02 | Klik w menu „…” | Menu bez otwarcia szczegółów |
| K03 | Przeniesienie do innego etapu | Zapis, liczniki i historia zgodne |
| K04 | Upuszczenie do pustej kolumny | Poprawna zmiana etapu |
| K05 | Upuszczenie na zwinięty etap | Zmiana etapu bez trwałego rozwinięcia |
| K06 | Zwinięcie i ponowne rozwinięcie | Oryginalne miejsce kolumny |
| K07 | Esc podczas przeciągania | Brak zmiany danych |
| K08 | Upuszczenie poza tablicą | Brak zmiany danych |
| K09 | Błąd zapisu | Spójny powrót albo odświeżenie stanu i komunikat |
| K10 | Równoległa zmiana przez inną osobę | Konflikt wykryty, brak cichego nadpisania |
| K11 | Brak wymaganego pola | Formularz; anulowanie pozostawia stary etap |
| K12 | Niedozwolony etap | Brak zmiany także przy bezpośrednim wywołaniu API |
| K13 | Filtr wyklucza lead po przeniesieniu | Lead znika z wyjaśnieniem i akcją otwarcia |
| K14 | Prawy klik na karcie | Menu właściwego leada |
| K15 | Prawy klik na nagłówku | Menu właściwego etapu |
| K16 | Prawy klik na linku lub polu tekstowym | Natywne menu przeglądarki |
| K17 | Menu przy krawędzi ekranu | Całe menu mieści się w viewportcie |
| K18 | Shift+F10 na karcie | Menu dostępne bez myszy |
| K19 | Strzałki, Enter i Esc w menu | Pełna obsługa i prawidłowy fokus |
| K20 | Obsługa telefonu | Wszystkie główne akcje przez widoczne kontrolki |
| K21 | Ponowione żądanie po utracie odpowiedzi | Brak podwójnego efektu automatyzacji |
| K22 | Zmiana sortowania | Pozycja zgodna z wybranym sortowaniem |
| K23 | Filtry i częściowo załadowana kolumna | Licznik i suma dotyczą całego filtrowanego zbioru |
| K24 | Firefox: Shift + prawy klik | Natywne menu akceptowane, aplikacja nadal działa |
| K25 | Odświeżenie aplikacji | Przywrócony osobisty stan zwinięcia etapów |

Warunek odbioru: wszystkie operacje zmiany etapu, niezależnie od sposobu uruchomienia, podlegają identycznej walidacji i autoryzacji; prawy przycisk jest ułatwieniem, nigdy jedynym dostępem do funkcji.
