# Plan: niedokończone wnioski — kontakt na początku, lejek i jedno przypomnienie

> Do wykonania w osobnej sesji. **Najpierw przeczytaj `CLAUDE.md`** — zwłaszcza
> ABSOLUTE_RULE (test formularza), „Formularze — wysyłka zawsze przez Edge
> Function", „Funkcje brzegowe — kto może je wołać", „Ankieta rozszerzona"
> i „Zgody na cookies". Kierunek zatwierdził właściciel 01.10.2026; punkty
> z sekcji „Decyzje do potwierdzenia" trzeba z nim ustalić **przed wdrożeniem**.

## Po co

Dziś e-mail i telefon są w **ostatnim** kroku kreatora (`zgody`). Kto odpada
wcześniej, nie zostawia nic: nie wiemy, gdzie odpadł, i nie możemy mu pomóc.
Wniosków jest kilka–kilkanaście miesięcznie (IV–VIII 2026: od 2 do 8; IX: 27,
razem z testowymi z przepięcia domeny), więc każdy porzucony wniosek
z numerem telefonu to realny lead dla doradcy.

Cele:

1. **Lejek** — ile osób zaczyna wniosek i na którym kroku odpada (wąskie gardło).
2. **Jedno przypomnienie** e-mailem i kontakt doradcy — wyłącznie dla tych,
   którzy wyrazili na to zgodę.

## Stan na 01.10.2026

- `packages/wniosek/src/schemat.js` — `KROKI`: `dane` (imię i nazwisko,
  PESEL, zawód, forma zatrudnienia i opodatkowania, dochód) → `zakres` →
  `zdrowie` (ankieta medyczna) → `zgody` (e-mail, telefon,
  `exclusions_accepted`, `informedAccepted`). `sprawdzKrok()` waliduje krok,
  `doWysylki()` normalizuje dane do wysyłki, `POLA_LOGICZNE` — patrz zakaz
  w CLAUDE.md („Czego nie wolno dopisać do POLA_LOGICZNE").
- `KROKI[].opis` zasila klauzulę informacyjną (art. 13 RODO) — zmiana kroków
  to zmiana klauzuli, w tym samym commicie.
- `apps/portal/src/components/Wniosek.svelte` — kreator (wyspa Svelte na
  `/wniosek/`). Turnstile renderowany jawnie: `zamontujTurnstile()`,
  `odswiezTurnstile()`. Wysyłka jednym żądaniem do `form-submit` na końcu; po
  sukcesie znacznik `ud:wniosek` w `sessionStorage` i przekierowanie na
  `/podziekowanie/` — to jest ścieżka konwersji Ads, nie ruszać.
- `form-submit` (v23 na produkcji) — jedyna ścieżka, którą wpływają pieniądze.
  Kopia w repo bywa starsza od wdrożonej (CLAUDE.md). **Ten plan nie wymaga
  żadnej zmiany w `form-submit`** i tak ma zostać — kontrakt pól się nie
  zmienia, e-mail i telefon nadal lecą w tej samej wysyłce.
- Maile: `send-offer-email` wysyła z `UtrataDochodu <noreply@utratadochodu.com>`
  przez Resend; `send-confirmation-email` jest wołana wyzwalaczem na
  `ud_clients`. Sprawdź, skąd funkcje biorą klucz Resend w Supabase.
- Cron do funkcji brzegowych: wzorzec z migracji
  `supabase/migrations/20260924191031_edge_cron_token.sql` — token z Vaulta,
  funkcja SQL-owa dokłada nagłówek, funkcja brzegowa sprawdza go przez
  `edge_cron_token_matches()` **przed pierwszym odczytem**. Nigdy gołe
  `net.http_post` z tokenem w treści zadania.
- Stopka firmy do maila: `COMPANY_FOOTER` w
  `apps/panel/src/lib/server/pdf/conditionsDoc.js` (Aura Expert sp. z o.o.,
  KRS, RPU). Telefon w treściach: **504 400 901**, adres: `info@utratadochodu.pl`.

## Projekt

### 1. Nowa kolejność kroków

`kontakt` → `dane` → `zakres` → `zdrowie` → `zgody`

- **`kontakt`** (nowy, pierwszy): imię i nazwisko (`fullName` przeniesione
  z `dane`), e-mail, telefon oraz **opcjonalna, niezaznaczona** zgoda na
  kontakt w sprawie wniosku (treść w sekcji „Prawo"). Walidacja e-maila
  i telefonu przechodzi tu z kroku `zgody` (`emailPoprawny`,
  `telefonPoprawny`). Zgoda **nie** jest wymagana do przejścia dalej.
- **`dane`**: PESEL, zawód, zatrudnienie, opodatkowanie, dochód — bez
  zmian poza zabraniem `fullName`.
- **`zgody`**: zostają `exclusions_accepted`, `informedAccepted` i pozostałe
  zgody; e-maila i telefonu już tu nie ma.
- **PESEL zostaje w kroku `dane` — świadomie.** Dziś pierwszy ekran zaczyna
  się od PESEL-u i to podejrzany numer jeden w roli wąskiego gardła. Po
  zmianie lejek to pokaże czarno na białym (odpadnięcia na kroku `dane`).
  O przeniesieniu PESEL-u na koniec decyduje właściciel po 2–4 tygodniach
  danych — nie w tej sesji.

### 2. Szkic wniosku — tabela `ud_wnioski_szkice`

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | uuid, PK, `gen_random_uuid()` | nie do zgadnięcia — po nim idą aktualizacje |
| `created_at`, `updated_at` | timestamptz | |
| `ostatni_krok` | text | `kontakt` / `dane` / `zakres` / `zdrowie` / `zgody` |
| `ukonczony_at` | timestamptz | po udanej wysyłce wniosku |
| `client_id` | uuid → `ud_clients(id)` | gdy uda się powiązać |
| `zgoda_kontakt` | boolean not null default false | |
| `zgoda_tresc`, `zgoda_at` | text, timestamptz | dokładna treść pokazana klientowi — rozliczalność (art. 7 ust. 1 RODO) |
| `imie`, `email`, `phone` | text, **null bez zgody** | |
| `przypomnienie_wyslane_at` | timestamptz | |

- Wiersz powstaje po zaliczeniu kroku `kontakt` **dla każdego** — ale dane
  kontaktowe zapisujemy wyłącznie przy zaznaczonej zgodzie. Bez zgody
  `imie` / `email` / `phone` = null i wiersz służy tylko lejkowi.
- **Nigdy nie zapisujemy w szkicu PESEL-u ani odpowiedzi z ankiety medycznej**
  (`med_*`, `hs_*`, `hsd_*`). Dane o zdrowiu z wniosku, którego ktoś nie
  wysłał, nie mają podstawy prawnej — zgoda z art. 9 RODO pada na końcu.
- `id` szkicu trzymamy **w pamięci komponentu** (zmienna w `Wniosek.svelte`),
  nie w `sessionStorage` ani w ciasteczku. Kreator to jedna strona, więc pamięć
  wystarcza, a zapis w urządzeniu na potrzeby lejka wymagałby zgody
  (art. 399 Prawa komunikacji elektronicznej). Przeładowanie strony = nowy
  szkic — akceptowalne.
- RLS włączone, **bez polityk**: zapis i odczyt wyłącznie kluczem serwisowym
  (funkcja brzegowa, panel przez `createAdminClient`).

### 3. Funkcja brzegowa `wniosek-szkic`

- **Utworzenie szkicu wymaga tokenu Turnstile** (ten sam widżet
  `0x4AAAAAADgSxo_FfjvXKO29`, sekret `TURNSTILE_SECRET_KEY`); bez sekretu
  → 503 i wpis w `ud_errors`, jak w `form-submit`. Bez tej bramki funkcja
  byłaby kanałem do rozsyłania naszych maili na cudze adresy.
- Tokeny są jednorazowe i ważne 300 s. Po użyciu tokenu na szkic kreator
  robi `turnstile.reset(widget)`, żeby na końcu był świeży token do
  `form-submit`. Sprawdź, jak dziś `odswiezTurnstile()` obsługuje wygaśnięcie,
  i nie zepsuj tego.
- Aktualizacja kroku i oznaczenie „ukończony" — po `id`; dopuszczalny tylko
  ruch do przodu.
- Limit na IP (np. 10 szkiców na godzinę).
- Wycofanie zgody: link z maila (id + podpis HMAC) — jedno kliknięcie usuwa
  dane kontaktowe szkicu i ustawia `zgoda_kontakt = false`.
- Dopisz funkcję do tabeli w CLAUDE.md („Funkcje brzegowe — kto może je
  wołać") i do `apps/portal/test/funkcje-brzegowe.spec.js` (bramka przed
  pierwszym zapisem). Wdrożenie przez MCP — treść generuj skryptem z pliku
  w repo (CLAUDE.md, „Wdrażanie przez MCP").

### 4. Kreator — wywołania „wystrzel i zapomnij"

- Po kroku `kontakt`: utwórz szkic. Po każdym kolejnym kroku: zaktualizuj
  `ostatni_krok`. Po udanej wysyłce do `form-submit`: oznacz ukończony.
- **Żadne z tych wywołań nie może zablokować ani opóźnić formularza**: bez
  `await` na ścieżce przejścia do kolejnego kroku, timeout ~3 s, błąd
  połykany. Kolejność przy wysyłce bez zmian: `form-submit` → znacznik
  `ud:wniosek` → `/podziekowanie/`. Oznaczenie szkicu nigdy nie jest
  warunkiem przekierowania.

### 5. Przypomnienie — jeden e-mail

- Cron co godzinę (wzorzec z Vaultem). Wybiera szkice: `zgoda_kontakt`,
  nieukończone, `przypomnienie_wyslane_at is null`, ostatnia aktywność
  starsza niż **N godzin** (decyzja niżej), utworzone w ciągu 7 dni.
- Przed wysyłką sprawdza, czy w `ud_clients` nie ma już wniosku z tym samym
  e-mailem (porównanie po `lower()`) po dacie szkicu — jeśli jest, oznacza
  szkic jako ukończony i **nie wysyła**. To bezpiecznik na wypadek, gdyby
  oznaczenie z kreatora nie doszło.
- **Jeden mail na adres na 30 dni**, niezależnie od liczby szkiców.
- Treść: propozycja pomocy, telefon 504 400 901, link
  `https://utratadochodu.pl/wniosek/?utm_source=przypomnienie&utm_medium=email&utm_campaign=niedokonczony-wniosek`,
  link do wycofania zgody, stopka firmy (`COMPANY_FOOTER`).
  - **Bez imienia z formularza** albo wyłącznie po escape i skróceniu —
    pole wpisuje użytkownik, a inaczej to kanał do rozsyłania cudzych treści
    naszym nadawcą (por. `div-send-email` w CLAUDE.md).
  - **Bez informacji, na którym kroku przerwał** — „zatrzymał się na ankiecie
    zdrowotnej" to już informacja o zdrowiu.
- Nadawca jak w `send-offer-email`, reply-to `info@utratadochodu.pl`.

### 6. Panel — „Niedokończone wnioski"

Lista szkiców **ze zgodą**: imię, e-mail, telefon, ostatni krok, data, czy
wysłano przypomnienie; bez ukończonych; przycisk „oznacz jako obsłużony".
Kto widzi listę — decyzja właściciela.

### 7. Lejek

Widok SQL `ud_lejek_wniosku`: tydzień × `ostatni_krok` → liczba szkiców,
bez danych osobowych. Pokazany w panelu (albo choćby do odczytu w Supabase).
To jest odpowiedź na pytanie „gdzie jest wąskie gardło".

### 8. Retencja

pg_cron codziennie: usuń szkice starsze niż 30 dni. Przy ukończonym wniosku
dane kontaktowe szkicu usuwamy od razu po powiązaniu z `ud_clients` — do
lejka zostaje sam krok.

### 9. Teksty i dokumenty

- „cztery kroki" → „pięć kroków" w: `apps/portal/src/pages/wniosek/index.astro`
  (opis i tekst „Cztery kroki, około pięciu minut"),
  `apps/portal/src/pages/jak-to-dziala/index.astro` (opis „Cztery kroki: …"),
  `apps/portal/src/pages/llms.txt.ts` („cztery kroki, około pięciu minut"),
  komentarz w `Wniosek.svelte`. Lepiej liczyć z `KROKI.length`, żeby liczba
  nie rozjechała się drugi raz.
- Klauzula informacyjna i polityka prywatności: nowy cel (kontakt w sprawie
  niedokończonego wniosku — zgoda, art. 6 ust. 1 lit. a RODO; lejek —
  anonimowo), okres przechowywania 30 dni, prawo wycofania zgody. Dokumenty
  prawne i tak czekają na podpis prawnika — dołożyć to do tej samej paczki.
- `CLAUDE.md`: nowa sekcja o szkicach — co wolno zapisywać, czego nigdy,
  „wystrzel i zapomnij", testy.

## Prawo — dlaczego tak, a nie prościej

- E-mail zachęcający do dokończenia zakupu to **marketing bezpośredni**, więc
  wymaga **uprzedniej zgody** — także na telefon (art. 398 Prawa komunikacji
  elektronicznej). Bez zgody: nie wysyłamy i nie dzwonimy; zostaje anonimowy
  lejek.
- Zgoda: osobny checkbox, niezaznaczony, niewarunkujący dalszej części
  wniosku; zapisujemy jej dokładną treść i czas; wycofanie ma być tak łatwe
  jak udzielenie (art. 7 ust. 3 RODO) — link w mailu.
- Proponowana treść zgody (**do akceptacji prawnika**):
  > Zgadzam się na kontakt e-mailowy i telefoniczny ze strony Aura Expert
  > sp. z o.o. w sprawie mojego wniosku — także wtedy, gdy go nie dokończę.
  > Zgodę mogę wycofać w każdej chwili.
- Ankieta medyczna to dane szczególnej kategorii; zgoda na ich przetwarzanie
  pada na końcu — dlatego szkic nigdy ich nie zawiera.

## Decyzje do potwierdzenia u właściciela (na starcie sesji)

1. Treść zgody — powyższa, czy najpierw do prawnika.
2. Po ilu godzinach od porzucenia wysyłamy przypomnienie (np. 3 h czy 24 h).
3. Kto w panelu widzi niedokończone wnioski (tylko admin czy każdy agent).
4. Adres nadawcy i reply-to.

## Decyzje właściciela (01.10.2026) i stan realizacji

Odpowiedzi na „Decyzje do potwierdzenia":

1. **Treść zgody** — z planu, wysyłka dopiero po prawniku. Wszystkie etapy są
   zbudowane z tą treścią; zadanie `wnioski-przypomnienia` w pg_cron jest
   założone **wyłączone**, a panel pokazuje ostrzeżenie (`ZGODA_ZATWIERDZONA`).
2. **Opóźnienie przypomnienia** — **3 godziny**.
3. **Kto widzi listę w panelu** — **każdy agent z dostępem do panelu**.
4. **Nadawca i reply-to** — **`info@utratadochodu.pl`** (nadawca i reply-to).
   Domena musi być zweryfikowana w Resend.

Odstępstwa od planu (z powodem):

- **Dwa widgety Turnstile zamiast `reset()` jednego.** Krok `kontakt` ma własny
  widget (token na szkic), krok `zgody` — własny (token na wniosek). Ścieżka
  wysyłki zostaje dokładnie taka jak przed szkicami. Przy okazji naprawiony
  istniejący błąd: po `Wstecz` → `Dalej` kontener ostatniego kroku był pusty.
- **`ostatni_krok` = ostatni zaliczony krok** (`zgody` tylko po wysyłce).
- **Dodatkowe kolumny:** `zgoda_wersja` (treść zgody dopisuje serwer z mapy
  wersja → tekst), `zgoda_wycofana_at`, `obsluzony_at` (przycisk w panelu),
  `ip_hash` (skrót IP do limitu 10 szkiców/h, zerowany po dobie).
- **Archiwum lejka** (`ud_lejek_wniosku_archiwum`): retencja 30 dni usuwa szkice,
  ale suma tydzień × krok zostaje, żeby lejek nie urywał się po miesiącu.
- **Link wycofania** niesie id i podpis we fragmencie (`#`), nie w zapytaniu,
  i uzupełnia go nagłówek `List-Unsubscribe-Post` (RFC 8058).
- Retencja liczona od **ostatniej aktywności** (`updated_at`), nie od utworzenia —
  inaczej reguła „jeden mail na adres na 30 dni" traciłaby pamięć po usunięciu wiersza.

Stan: etapy 1–7 zrealizowane w repozytorium. **Niewykonane (wymaga właściciela):**
wdrożenie migracji i funkcji na produkcję, sekret `SZKIC_HMAC_SECRET`,
weryfikacja domeny `utratadochodu.pl` w Resend, akceptacja treści zgody przez
prawnika, włączenie crona. Kolejność — CLAUDE.md, „Szkice wniosków".

## Testy i kryteria odbioru

- `packages/wniosek`: `sprawdzKrok` dla nowego kroku `kontakt` (e-mail,
  telefon, zgoda opcjonalna) i dla `zgody` bez e-maila i telefonu.
- `apps/portal/test/wniosek.spec.js`, `wniosek-ryzyka.spec.js`,
  `wniosek-ankieta.spec.js` — nowa kolejność kroków.
- **`cd apps/portal && node test/obciazenie-formularza.mjs` — 13/13** po
  aktualizacji przejścia kreatora, plus nowy scenariusz: endpoint szkicu
  zwraca 500 albo nie odpowiada → wniosek i tak przechodzi do końca
  i zapisuje znacznik konwersji (C2).
- `apps/portal/test/funkcje-brzegowe.spec.js` — nowa funkcja: Turnstile przed
  pierwszym zapisem; funkcja przypomnień: token z Vaulta przed pierwszym
  odczytem.
- Test, że szkic bez zgody nie ma e-maila ani telefonu i że żaden szkic nie
  zawiera PESEL-u ani pól `med_*` / `hs_*` / `hsd_*`.
- Po wdrożeniu ręcznie: **jeden prawdziwy przebieg z żywej strony** (sonda
  z fałszywym tokenem nie dowodzi, że sekret Turnstile pasuje do widżetu),
  porzucenie na kroku 3, mail po N godzinach, link wycofania usuwa dane.

## Kolejność pracy

1. Migracja: tabela, RLS, widok lejka, retencja (pg_cron).
2. Funkcja `wniosek-szkic` + testy bramek.
3. Kreator: nowy krok `kontakt`, wywołania „wystrzel i zapomnij", testy
   (w tym 500 z endpointu szkicu).
4. Teksty „pięć kroków" i projekt zmian w klauzuli (do prawnika).
5. Przypomnienie: funkcja, cron z Vaultem, szablon maila.
6. Panel: lista niedokończonych wniosków.
7. CLAUDE.md, test formularza, wdrożenie, prawdziwy przebieg.

Etapy 1–4 dają już lejek i można je wdrożyć osobno. Etapy 5–6 (przypomnienie
i lista w panelu) wchodzą dopiero po zatwierdzeniu treści zgody.
