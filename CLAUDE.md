# CLAUDE.md — Wytyczne projektu UtrataDochodu.pl

---

## ABSOLUTE_RULE — formularz zgłoszeniowy sprawdzasz na końcu KAŻDEJ pracy

**Formularz wniosku (`/wniosek/` → funkcja brzegowa `form-submit`) to jedyna
ścieżka, którą wpływają pieniądze. Nie wolno go zepsuć i nie wolno zakładać,
że jest sprawny.**

Każda praca — bez wyjątku, także taka, która formularza nie dotyka —
kończy się uruchomieniem:

```
cd apps/portal && node test/obciazenie-formularza.mjs
```

Dopiero zielony wynik pozwala uznać robotę za skończoną. Czerwony wynik
zatrzymuje wszystko inne, aż do naprawy.

Dlaczego „także taka, która formularza nie dotyka": kreator jest wyspą
Svelte na stronie zbudowanej przez Astro, bierze schemat z `@ud/wniosek`
i woła funkcję brzegową spoza repozytorium. Zmiana w układzie, w zależności,
w zmiennej środowiskowej albo we współdzielonym pakiecie potrafi go wyłączyć
bez jednej linii różnicy w jego własnym pliku. Zmiana, która „nie mogła tego
ruszyć", jest dokładnie tą, po której nikt nie sprawdza.

Co test mierzy i czego NIE mierzy — patrz nagłówek samego skryptu. Jedna
rzecz wymaga podkreślenia tutaj: **część sieciowa nie działa z tego
środowiska**, bo proxy nie ma `kukvgsjrmrqtzhkszzum.supabase.co` na liście
dozwolonych hostów. Skrypt to wykrywa i mówi wprost, że tej części nie
wykonał. **Pominięta część sieciowa to nie jest wynik zielony** — trzeba ją
uruchomić tam, gdzie jest wyjście do sieci.

---

## Supabase — pobieranie danych

### Zawsze jawnie wymieniaj kolumny w SELECT

Nigdy nie używaj `.select('*')` w widokach publicznych (wydajność, bezpieczeństwo).
Zamiast tego wypisuj każdą potrzebną kolumnę z osobna.

### Kolumny z obrazkami w tabeli `aura_articles`

Tabela ma pięć pól opisujących zdjęcie. Dwa pierwsze wypełnia CMS, trzy
kolejne — funkcja brzegowa `normalize-article-images`:

| Kolumna | Kto wypełnia | Co w niej jest |
|---|---|---|
| `preview_image_url` | CMS | Oryginał prosto z wysyłki — od 300 kB do 15,9 MB |
| `thumbnail_url` | CMS | Zapasowy oryginał, w praktyce zawsze pusty |
| `preview_image_800` | normalizacja | WebP 800 px — do kafelka i listy |
| `preview_image_1600` | normalizacja | WebP 1600 px — do nagłówka artykułu |
| `images_status` | normalizacja | `pending`, `ready` albo `error` |

**Do przeglądarki wysyłaj wyłącznie `preview_image_800` / `preview_image_1600`.**
Adresy z dwóch pierwszych kolumn to pliki z aparatu; jeden z nich waży 15,9 MB
i na łączu komórkowym wczytuje się kilkanaście sekund. Adres surowy nadaje się
najwyżej na wyjście awaryjne, gdy `images_status` to jeszcze `pending`.

`images_status = 'ready'` przy pustym `preview_image_800` znaczy „ten artykuł
naprawdę nie ma zdjęcia" — wtedy renderuj kafelek zastępczy, a nie czekaj.

```js
.select('id, slug, title, excerpt, tags, published_at, created_at, '
      + 'preview_image_800, preview_image_1600, images_status, '
      + 'preview_image_url, thumbnail_url')
```

### Renderowanie zdjęcia — wzorzec obowiązkowy

Nie używaj statycznych emoji ani placeholderów, gdy dostępne są URL-e zdjęć.
Dwie szerokości idą do `srcset` — bez tego ekran gęsty dostaje 800 px
rozciągnięte do 1600 i zdjęcie wygląda na rozmyte.

```js
${art.preview_image_800
  ? `<img src="${art.preview_image_800}"
          srcset="${art.preview_image_800} 800w, ${art.preview_image_1600} 1600w"
          sizes="(max-width: 640px) 100vw, 33vw"
          alt="${art.title}" loading="lazy" decoding="async"
          class="w-full h-full object-cover">`
  : `<span class="text-6xl">${style.emoji}</span>`}
```

Kontener obrazka musi mieć `overflow-hidden`, żeby `object-cover` działał
poprawnie:

```html
<div class="h-48 overflow-hidden ...">
  <!-- img albo kafelek zastępczy -->
</div>
```

`alt` to tytuł artykułu, nigdy pusty ciąg: kafelek jest odnośnikiem, a czytnik
ekranu przeczyta wtedy sam adres.

### Normalizacja zdjęć — jak to działa

Funkcja brzegowa `normalize-article-images` (kod: `supabase/functions/`) robi
przy publikacji trzy rzeczy:

1. Zapisuje okładkę jako WebP 800 i 1600 px w `article-images/normalized/`.
2. Wyciąga z `content` obrazki wklejone jako `data:` URI i podmienia je na
   adresy plików. Jeden taki artykuł miał 1,3 mln znaków HTML-a; po podmianie
   ma 5,5 tysiąca.
3. Gdy artykuł nie ma okładki, ale ma zdjęcie w treści — bierze pierwsze
   z treści. To nie jest podstawianie cudzego zdjęcia: ono w tym artykule jest,
   tylko redakcja nie wypełniła pola.

Kolejkę pilnuje wyzwalacz `aura_articles_images_pending`: zmiana zdjęcia albo
treści przestawia `images_status` na `pending`, a `pg_cron` co dziesięć minut
woła `public.aura_normalize_article_images()`.

**Nie wołaj funkcji brzegowej z gołym `net.http_post`** — token siedzi w Vault
i wyciąga go tamta funkcja SQL-owa. Wpisanie tokenu do zadania cron oznacza, że
przeczyta go każdy z dostępem do bazy.

Dwa ograniczenia, o których warto wiedzieć, zanim ktoś zacznie to zmieniać:

- **Worker ma około dwóch sekund czasu procesora na żądanie.** Rozpakowanie
  JPEG-a z aparatu się w tym nie mieści — pierwsza wersja ginęła z komunikatem
  „CPU Time exceeded”. Dlatego pliki powyżej 1,5 MB idą przez usługę skalowania
  Supabase (`/render/image/`), a nie przez ImageMagick w funkcji. Jedno
  wywołanie bierze jeden artykuł; nie podnoś tego bez ponownego sprawdzenia.
- **`sharp` w Edge Functions nie działa** (biblioteka natywna). Jedyne, co tam
  liczy obrazki, to magick-wasm.

Oryginał treści sprzed podmiany leży w `aura_article_content_backup` — jeden
wiersz na artykuł, zapisywany tylko przy pierwszym przepisaniu.

### Kubełek `article-images` ma limity

`file_size_limit` 5 MB i `allowed_mime_types` ograniczone do jpeg/png/webp/avif.
Wcześniej oba były puste i stąd wzięło się 68 MB w trzynastu plikach. Limit
działa na nowe wysyłki — pliki, które już leżą, zostają.

---

## Znaczniki Google — nie dotykać

> **Zakres: stary serwis w katalogu głównym repozytorium** (`index.html`,
> `formularz.html`, `thankyou.html`, `opinia.html`, `style.js`, `app.js`) —
> ten, który obsługuje domenę do chwili przepięcia. Nowy portal
> (`apps/portal`) liczy konwersje inaczej, z Consent Mode v2 w trybie basic,
> decyzją właściciela z września 2026 — patrz „Zgody na cookies" i „Konwersja
> Ads liczy WNIOSKI". Obie zasady są prawdziwe, każda dla swojego serwisu.

**Zakaz modyfikowania, przenoszenia i usuwania znaczników Google przy okazji innej
pracy.** Dotyczy bloku `<!-- Google tag -->` w `<head>` każdej strony, wywołań
`gtag(...)`, `dataLayer`, identyfikatorów `AW-18020137303` i `G-MGB0RBTCC9`,
etykiety konwersji `_uZeCOTG_KwcENfy1ZBD` oraz przekierowania na `/thankyou.html`
po udanej wysyłce wniosku.

Zmiana w tych miejscach wymaga **wyraźnej zgody właściciela strony** i osobnego
commita, który nie robi nic innego. Nie „przy okazji” refaktoru, porządków w
`<head>`, migracji CSS czy zmian w CSP.

Powód: konwersje z Google Ads zamarły na trzy miesiące (09.06–09.09.2026), bo
kolejne zmiany poboczne po kolei rozbrajały tę ścieżkę. Pełna analiza w
`DIAGNOSTYKA_KONWERSJI.md`. Nikt tego nie zauważył, bo nic się nie wysypuje —
strona wygląda normalnie, po prostu przestają spływać leady.

### Czego pilnować przy każdej zmianie w `<head>`

| Element | Gdzie | Czego nie wolno |
|---|---|---|
| `gtag('config', 'AW-18020137303')` | każda strona | usunąć, zakomentować, przenieść za inne skrypty |
| `gtag('config', 'G-MGB0RBTCC9')` | `index.html`, `formularz.html`, `thankyou.html` | jw. |
| `gtag('event', 'conversion', …)` | tylko `thankyou.html` | usunąć, przenieść na inną stronę, odpalić warunkowo |
| `window.location.href = '/thankyou.html'` | `style.js`, gałąź sukcesu | zamienić z powrotem na modal — to jedyny wyzwalacz konwersji |

### Nie dodawaj bramek przed wysyłką bez sprawdzenia wszystkich stron

`style.js` obsługuje formularz `#insurance-form` na **dwóch** stronach:
`index.html` i `formularz.html`. `app.js` obsługuje `#quick-form` na `index.html`.
Każdy nowy warunek, który potrafi przerwać `submit`, trzeba wprowadzić razem
z odpowiednim markupem na **wszystkich** stronach korzystających z danego pliku.
Dokładnie na tym poległ Turnstile 07.06.2026: bramka trafiła do `style.js`,
a widget tylko do `formularz.html`.

Warunek, który przerywa wysyłkę z powodu brakującego elementu strony, ma zgłaszać
awarię przez `Awaria.pokaz()` (kod `TURNSTILE_BRAK_WIDGETU`), a nie pokazywać
użytkownikowi prośbę o kliknięcie w coś, czego nie ma.

### Test

```
NODE_PATH=$(npm root -g) node tests/wniosek-konwersja-test.js
```

Sprawdza całą ścieżkę: wysyłka → redirect → event konwersji z poprawną etykietą,
plus rozróżnienie braku widgetu od nierozwiązanego widgetu. Uruchom po każdej
zmianie w `style.js`, `app.js`, `thankyou.html` i w CSP.

### Consent Mode

W starym serwisie nie jest zaimplementowany i **nie wolno go tam wprowadzać bez
decyzji właściciela** — włączenie zmienia wolumen raportowanych konwersji. Temat
jest świadomie odłożony, nie jest to przeoczenie do „naprawienia” przy okazji.

Decyzja dla nowego portalu zapadła osobno: tam Consent Mode v2 jest, a spadek
liczby konwersji po przepięciu jest oczekiwany (patrz „Zgody na cookies").

---

## Formularze — wysyłka zawsze przez Edge Function

Żaden formularz publiczny nie strzela z przeglądarki prosto do PostgREST
(`/rest/v1/<tabela>`). Wysyłka idzie do Edge Function, która weryfikuje token
Turnstile i dopiero wtedy zapisuje rekord kluczem `service_role`.

| Formularz | Endpoint | Tabela |
|---|---|---|
| Szybki kontakt (`index.html`) | `/functions/v1/contact-submit` | `udochodu_contacts` |
| Pełny wniosek (`index.html`, `formularz.html`) | `/functions/v1/form-submit` | `ud_clients` |
| Opinia (`opinia.html`) | `/functions/v1/review-submit` | `ud_review` |

Dwa powody — oba wynikają z realnej awarii (formularz szybkiego kontaktu był
martwy od 15.06.2026 do 09.09.2026, zero leadów przez trzy miesiące):

1. **Token nie jest kolumną.** Payload z polem `cf-turnstile-response` leci do
   PostgREST jako nieistniejąca kolumna i cały INSERT wraca błędem 400
   (`PGRST204`). Do bazy wolno wysyłać wyłącznie kolumny, które w niej są.
2. **Tokenu nie ma kto sprawdzić.** PostgREST nie rozmawia z Cloudflare, więc
   widget bez Edge Function jest wyłącznie dekoracją — bot i tak wejdzie
   bezpośrednio na REST API.

### Po nieudanej wysyłce zresetuj widget Turnstile

Token jest jednorazowy. Bez `turnstile.reset(widget)` druga próba poleci ze
zużytym tokenem i też się wywali. Resetuj wskazując element kontenera
(`form.querySelector('.cf-turnstile')`) — na `index.html` są dwa widgety
(szybki kontakt i wniosek), więc gołe `reset()` bez argumentu trafi
w niewłaściwy.

### Test

```
NODE_PATH=$(npm root -g) node tests/quick-form-test.js
```

---

## CSP (Content-Security-Policy)

Zdjęcia z Supabase Storage są serwowane z domeny:

```
https://kukvgsjrmrqtzhkszzum.supabase.co
```

Dyrektywa `img-src` w `<meta http-equiv="Content-Security-Policy">` musi zawierać `https:` (lub jawnie tę domenę), inaczej obrazki zostaną zablokowane przez przeglądarkę.

Obecna konfiguracja w `blog.html` (poprawna):
```
img-src 'self' data: https:;
```

### Gdzie żyje polityka CSP

Polityka jest zdefiniowana w **dwóch miejscach i musi być w nich identyczna** —
przeglądarka egzekwuje **część wspólną** wszystkich polityk, więc brak domeny
w którymkolwiek z nich = zablokowany zasób:

1. `_headers` — nagłówek dla całej domeny (jedyna polityka na podstronach zawodów,
   `formularz.html`, `opinia.html`).
2. `<meta http-equiv="Content-Security-Policy">` w: `index.html`, `blog.html`,
   `polityka-cookies.html`, `regulamin.html`.

Różnica: `frame-ancestors` działa tylko w nagłówku (w `<meta>` jest ignorowane
i generuje ostrzeżenie w konsoli) — dlatego występuje wyłącznie w `_headers`.

Domeny wymagane przez zewnętrzne skrypty:

| Usługa | Dyrektywy |
|---|---|
| Cloudflare Turnstile | `script-src` + `frame-src` + `connect-src`: `https://challenges.cloudflare.com` |
| GTM / GA4 / Google Ads | `script-src`: `https://*.googletagmanager.com`, `https://*.googleadservices.com`, `https://*.doubleclick.net`; `connect-src`: dodatkowo `https://*.analytics.google.com`, `https://*.doubleclick.net`, `https://google.com`, `https://*.google.com`, `https://google.pl`, `https://*.google.pl` |
| Meta Pixel | `script-src` + `connect-src`: `https://connect.facebook.net`, `https://*.facebook.com` |
| Cloudflare Insights | `script-src` + `connect-src`: `https://*.cloudflareinsights.com`, `https://cloudflareinsights.com` |
| Tailwind CDN / AOS | `script-src` + `style-src`: `https://cdn.tailwindcss.com`, `https://unpkg.com`, `https://cdn.jsdelivr.net` |

Uwaga: `https://*.google.com` **nie** obejmuje gołej domeny `https://google.com` —
obie muszą być wymienione osobno.

---

## Struktura Supabase

- **Projekt:** `kukvgsjrmrqtzhkszzum`
- **Tabela artykułów:** `aura_articles` — **wspólna dla jedenastu serwisów**
- **Rejestr wariantów zdjęć:** `aura_article_images` (zapisuje tylko funkcja brzegowa)
- **Kopia treści sprzed przepisania:** `aura_article_content_backup`
- **Storage bucket:** `article-images`, podkatalog `normalized/` na warianty
- **Filtr platformy:** `.contains('platforms', ['UtrataDochodu.pl'])`
- **Filtr statusu:** `.eq('status', 'published')`

`aura_articles` obsługuje AuraBenefits, AuraConsulting.pl, Grupowe.pro,
Gwarancje.pro, Idzik.org.pl, Zarzad, cztery serwisy rozwodowe
i UtrataDochodu.pl. Zmiana schematu tej tabeli dotyka ich wszystkich —
dokładaj kolumny, nie zmieniaj znaczenia istniejących.

Migracje z 2026-09-03 leżą w `supabase/migrations/`. Starsze są wyłącznie
w panelu Supabase.

---

## Funkcje brzegowe — kto może je wołać

Dziewięć z dwunastu funkcji ma `verify_jwt = false`, więc platforma wpuszcza
do nich każdego, kto zna adres — a roboty te adresy znajdują (17.09 SemrushBot
zapukał GET-em do `div-send-email`). Bramka musi siedzieć w kodzie funkcji.
Stan po audycie z 24.09.2026:

| Funkcja | Kto woła | Bramka |
|---|---|---|
| `form-submit`, `contact-submit`, `review-submit` | formularze publiczne | Turnstile; bez sekretu 503 + wpis w `ud_errors` |
| `send-digest-email`, `sync-beauty-companies` | pg_cron | nagłówek `x-cron-token` z Vaulta |
| `normalize-article-images` | pg_cron | nagłówek `x-blog-token` z Vaulta |
| `review-admin` | panel opinii | JWT + `profiles.rola = 'admin'` |
| `send-offer-email` | stary `js/client.js` w udapp — w praktyce nikt | treść wyłącznie z bazy, wysyłka tylko do 30 min po wyborze |
| `div-send-email` | formularz kancelarii (rozwod.waw.pl) | **żadna** — patrz niżej |
| pozostałe trzy | — | `verify_jwt = true` |

### Funkcja wołana przez cron dostaje token z Vaulta, nie z treści zadania

Wzorzec z migracji `20260924191031_edge_cron_token.sql`: sekret
`edge_cron_token` powstaje w Vaulcie i bazy nie opuszcza, zadanie cron woła
funkcję SQL-ową (`ud_send_digest_email()`, `aura_sync_beauty_companies()`),
a ta dokłada nagłówek. Funkcja brzegowa sprawdza go przez
`edge_cron_token_matches()` **przed** pierwszym odczytem. Nową funkcję
cronową podpinaj tak samo — nie gołym `net.http_post` i nigdy z tokenem
wpisanym w treść zadania.

Do przeniesienia na ten wzorzec: oba wyzwalacze `send-confirmation-email-*`
(na `ud_clients` i `udochodu_contacts`) mają w definicji jawnym tekstem JWT
z rolą `service_role`. Z zewnątrz tego nie widać, ale główny klucz projektu
trafia do każdego zrzutu schematu — **nie commituj zrzutów schematu**.

### Turnstile: sekret z tego samego widżetu, co klucz na stronie

Do 24.09.2026 `TURNSTILE_SECRET_KEY` w projekcie nie było, a funkcje miały
`if (!secret) return true` — CAPTCHA była dekoracją i nic tego nie zgłaszało.
Teraz brak sekretu kończy się odmową 503 z telefonem i wpisem w `ud_errors`.

Sekret musi pochodzić z widżetu o kluczu `0x4AAAAAADgSxo_FfjvXKO29` (ten stoi
na stronach i w `uslugi.ts` portalu). Sekret z innego widżetu też odrzuci
fałszywy token, ale odrzuci i prawdziwych klientów — dlatego po każdej zmianie
sekretu potrzebne są dwa sprawdzenia:

1. sonda przez `net.http_post` z fałszywym tokenem i bez danych (nic nie
   zapisuje) → ma wrócić „Weryfikacja bezpieczeństwa nie powiodła się",
2. **jedno prawdziwe zgłoszenie z żywej strony** — tylko ono dowodzi, że
   sekret pasuje do widżetu.

### Co zostało otwarte świadomie

- **`div-send-email`** — formularz kancelarii: bez Turnstile, bez limitu,
  a adres odbiorcy potwierdzenia bierze z żądania, czyli rozsyła list
  z `no-reply@rozwod.waw.pl` na dowolny adres. Zamknięcie wymaga widżetu na
  stronach kancelarii, których nie ma w tym repozytorium.
- **`review-admin` w repozytorium jest starszy i słabszy od wdrożonego**
  (wspólne hasło w ciele żądania zamiast JWT + roli, inna tabela). Nie wdrażaj
  go z repo.
- **`sync-beauty-companies` od czerwca nie przenosi osób kontaktowych**:
  `crm_client_contacts` nie ma unikalnego ograniczenia na
  `(tenant_id, beauty_id)`, więc każda paczka kończy się błędem 42P10, który
  trafia tylko do logu funkcji.
- **Ta sama synchronizacja codziennie nadpisuje `crm_clients.rodo_zgoda`**
  wartością z BEAUTY — tam pole jest puste, więc wszędzie ląduje `false`.
  Zgoda wpisana ręcznie w CRM przetrwa tylko do najbliższej synchronizacji
  (9:00); trzeba ją zapisywać w BEAUTY albo wyłączyć pola RODO z upsertu.

### Wdrażanie przez MCP

Funkcja z `import … from '../_shared/logger.ts'` idzie jako dwa pliki:
`source/index.ts` i `_shared/logger.ts`, z `entrypoint_path: source/index.ts`.
Treść do wdrożenia generuj skryptem (`json.dumps`) z pliku w repo, zamiast
przepisywać — w `form-submit` stoi twarda spacja (U+00A0) w `parseAmount()`,
która przy przepisywaniu znika bez śladu.

Pilnuje tego `test/funkcje-brzegowe.spec.js` — czyta źródła i sprawdza, że
bramki stoją przed pierwszym odczytem. Na wersjach sprzed 24.09 wywala się
w dziewięciu z dziesięciu testów.

---

## Modal awarii (`awaria.js`)

Gdy coś się wysypie, użytkownik dostaje modal z prośbą o telefon
(**504 400 901**) i o zgłoszenie błędu e-mailem na `info@utratadochodu.pl`.

Zasady:

- Skrypt jest **samodzielny** — własny CSS, zero zależności od Tailwinda.
  To celowe: ma działać także wtedy, gdy awaria polega na niewczytaniu CDN-a.
- Ładowany **jako pierwszy w `<head>`, bez `defer`** — inaczej nie złapie błędu
  skryptu, który wysypie się wcześniej.
- Ręcznie: `Awaria.pokaz({ kod: 'MOJ_KOD', szczegoly: err })`.
- Automatycznie: nieobsłużone błędy skryptów **z naszej domeny** (raz na
  wczytanie strony). Błędy z GTM-a, Pixela czy Turnstile'a są ignorowane —
  nie psują strony użytkownikowi, a modal tylko by straszył.
- Podpięty w: `style.js` (wniosek), `app.js` (szybki kontakt),
  `opinia.html` (opinie). Nową ścieżkę wysyłki podpinaj tak samo.
- Test: `NODE_PATH=$(npm root -g) node tests/awaria-test.js`.

## Ikona strony (favicon)

Zakres: stary serwis w katalogu głównym. Nowy portal ma własną ikonę:
`apps/portal/public/favicon.svg`.

Master to **`favicon.svg`** — zwykły plik tekstowy, edytowalny ręcznie. Rastry są
z niego odtwarzane:

```
python3 build_favicon.py
```

Nie poprawiaj `favicon.png`, `favicon.ico` ani `apple-touch-icon.png` w edytorze
graficznym — przy następnym uruchomieniu skryptu zmiany przepadną. Popraw SVG.

| Plik | Rozmiar | Do czego |
|---|---|---|
| `favicon.svg` | wektor | główna ikona nowoczesnych przeglądarek |
| `favicon.ico` | 16 / 32 / 48 | starsze przeglądarki i automatyczne zapytanie o `/favicon.ico` |
| `favicon.png` | 32 | fallback dla `type="image/png"` |
| `apple-touch-icon.png` | 180 | ekran główny iOS, **musi być nieprzezroczysty** i bez zaokrąglonych rogów |

Linki są w `index.html`, `formularz.html` i `opinia.html`. Pozostałe 235 podstron
nie ma tagów i nie potrzebuje ich — przeglądarka sama pyta o `/favicon.ico`
w katalogu głównym i go znajduje.

Kolejność linków ma znaczenie: przeglądarka bierze **ostatni** format, który zna,
więc SVG idzie na końcu.

Test CSP liczy odpowiedzi 404, więc usunięcie któregokolwiek z tych plików
wywali `tests/csp-test.js`.

---

## `<meta charset>` musi być w pierwszym 1 KB pliku

Przeglądarka skanuje w poszukiwaniu deklaracji kodowania tylko pierwszy
1024 bajty. W `index.html` i `formularz.html` wpis wylądował za długim
skryptem Meta Pixela (bajt 1812 / 1162) i był ignorowany — polskie znaki
ratował wyłącznie nagłówek `charset=utf-8` od Cloudflare.

`thankyou.html` miał ten sam problem w wersji utajonej: deklaracja siedziała na
bajcie **1020**, czyli cztery bajty przed limitem. Dopisanie jednej linijki do
bloku gtag wypchnęłoby ją poza 1 KB. Naprawione 09.09.2026 — wszystkie trzy pliki
mają teraz `charset` na bajcie 62.

**`<meta charset="UTF-8">` ma być pierwszą linią po `<head>`.** Przy dodawaniu
czegokolwiek na początek `<head>` sprawdź, czy nie wypycha deklaracji poza 1 KB:

```
for f in index.html formularz.html thankyou.html; do
  python3 -c "import re,sys;d=open('$f','rb').read();print('$f', re.search(rb'<meta[^>]*charset',d).start())"
done
```

---

## Zgody na cookies — analityka NIE startuje przed zgodą

W starym serwisie baner zgód był atrapą i nie wolno tego powtórzyć:

- Meta Pixel, GA4 (`G-MGB0RBTCC9`) i Google Ads (`AW-18020137303`) ładowały się
  **bezwarunkowo w `<head>`**, zanim baner zdążył się wyrenderować.
- `cookie-consent.js` gatował **inną** właściwość GA4 (`G-D9XHPWP5DE`), z której
  nic innego nie korzystało.
- Baner był wpięty tylko w `index.html` i `blog.html`. W `formularz.html` —
  z ankietą medyczną — nie było go wcale, a Pixel i GA4 działały.
- Treść banera („analityka uruchamiana wyłącznie po Twojej zgodzie") była
  nieprawdziwa, na serwisie zbierającym dane o zdrowiu.

Nowy portal (`apps/portal`):

- `public/zgody.js` — ładowany **jako drugi w `<head>`, bez `defer`**, zaraz po
  `awaria.js`. Uruchomiony później oznacza, że pierwsza odsłona leci do Google,
  zanim ktokolwiek się zgodzi.
- Consent Mode v2: `gtag('consent','default', …)` ze wszystkim `denied` przed
  jakimkolwiek tagiem.
- Tryb **basic** — przed zgodą nie leci żadne żądanie do Google ani Meta.
  Przełącznik: stała `TRYB` w `zgody.js`. Zmiana na `advanced` daje modelowanie
  konwersji w Ads kosztem odsłony wysyłanej do Google od każdego odwiedzającego.
- Zgoda granularna: analityka i marketing osobno.
- **Odrzucenie musi być jednym kliknięciem, o tym samym ciężarze wizualnym co
  akceptacja.** Brak tego jest najczęstszym powodem kar za bannery cookie.
- Pixel nie startuje na ścieżkach z `TAGI.bezPixela` (`/wniosek/`,
  `/podziekowanie/`) nawet przy zgodzie na marketing — Meta zabrania danych
  wrażliwych, a sam adres strony z ankietą medyczną już nim jest.
- Konwersje wysyłaj przez `window.UDCookies.konwersja(etykieta)`, nigdy przez
  gołe `gtag('event','conversion', …)` — ta pierwsza sama sprawdza zgodę.

Test: `npx playwright test test/zgody.spec.js`. Sprawdza ruch sieciowy, a nie
obecność banera — atrapa przechodzi każdy test oparty na DOM-ie.

Do zamknięcia po stronie klienta: druga właściwość GA4 (`G-D9XHPWP5DE`) —
inaczej historia ruchu zostaje rozbita na dwie niepełne właściwości.

### Konwersja Ads liczy WNIOSKI, nie odsłony podziękowania

Stary `thankyou.html` miał w treści goły strzał:

```js
gtag('event', 'conversion', {'send_to': 'AW-18020137303/_uZeCOTG_KwcENfy1ZBD'});
```

Bez `transaction_id` i bez żadnego warunku, więc konwersję liczyło **każde
wczytanie strony**: odświeżenie, powrót przyciskiem wstecz, adres wklejony
z zakładki. Liczba w Ads znaczyła „tyle razy ktoś zobaczył tę stronę" i nie
dało się odczytać, o ile jest zawyżona.

Nowy portal ma trzy zabezpieczenia i **każde jest potrzebne**:

1. **Zgoda.** Zdarzenie idzie przez `UDCookies.konwersja()`, więc leci wyłącznie
   przy zgodzie na marketing.
2. **Znacznik wniosku.** Kreator zapisuje do `sessionStorage` klucz
   `ud:wniosek` (UUID) tuż przed przekierowaniem, a `/podziekowanie/` **bez
   tego znacznika nie zgłasza nic**. To wycina odsłony bez złożonego wniosku.
3. **`transaction_id`.** Znacznik idzie w zdarzeniu jako klucz deduplikacji —
   odświeżenie strony i zgoda udzielona dopiero na niej dają Ads **tę samą**
   konwersję.

**Znacznika nie kasuj po wysłaniu zdarzenia.** Klient, który zgodzi się na
cookies dopiero na stronie podziękowania, musi zostać policzony; przed
podwójnym liczeniem broni `transaction_id`, nie skasowanie klucza. Znacznik
znika razem z sesją karty.

Etykieta `konwersjaWniosek` w `analityka.ts` należy do akcji **„Przesłanie
formularza kontaktowego"** (kategoria `SUBMIT_LEAD_FORM`) — sprawdzone przez
`tag_snippets` w Ads. Nazwa akcji kłamie: liczy złożone wnioski, nie formularze
kontaktowe. Szybki kontakt nie zgłasza konwersji w ogóle, ani w starym
serwisie, ani w nowym.

W koncie Ads licytowalne są tylko dwie kategorie: `SUBMIT_LEAD_FORM`
i `PHONE_CALL_LEAD`. `REQUEST_QUOTE` i `ENGAGEMENT` mają `biddable: false`,
więc nic z importów GA4 nie steruje stawkami — to dlatego zamknięcie drugiej
właściwości jest bezpieczne. Sprawdzić to potrafi `narzedzia/ads-konwersje-ga4.js`.

**Po przepięciu domeny liczba konwersji spadnie i to jest poprawne** — stary
baner zgód był atrapą i tagi startowały bezwarunkowo.

Pilnują tego trzy testy w `test/zgody.spec.js` (zgoda, brak znacznika,
odświeżenie) i scenariusz C2 w bramie obciążeniowej, który przechodzi kreator
do końca i sprawdza, że znacznik faktycznie się zapisał. Bez C2 mielibyśmy
awarię niewidoczną: formularz działa, baza się zapełnia, a kampania wygląda,
jakby nie sprzedawała.

---

## Markdown dla agentów — negocjacja nagłówkiem Accept

Każda z 227 podstron ma bliźniaczy plik `.md` z tą samą treścią bez nawigacji,
stopki, skryptów i wysp Svelte. Podstrona zawodu schodzi z 38 kB HTML-a do
5,8 kB tekstu; cały serwis z 8,0 MB do 1,1 MB.

Dwie drogi do tego samego:

| Sposób | Adres | Kiedy |
|---|---|---|
| Nagłówek `Accept: text/markdown` | adres strony | agent negocjuje treść |
| Adres wprost | `/<slug>/index.md` | gdy negocjacja jest niewygodna |

Odpowiedź w Markdownie niesie `Content-Type: text/markdown; charset=utf-8`,
`Vary: Accept` i `x-markdown-tokens` z liczbą tokenów (kodowanie o200k_base).

### Trzy pliki, każdy z inną robotą

| Plik | Co robi |
|---|---|
| `integracje/markdown.mjs` | po buildzie konwertuje `<main id="tresc">` na `index.md` i liczy tokeny do `tokeny-markdown.json` |
| `functions/_middleware.js` | czyta Accept i podaje wariant, który klient chce bardziej |
| `public/_routes.json` | wyłącza zasoby statyczne spod funkcji, żeby nie wołać workera po każdy plik |

Konwersja idzie z **gotowego HTML-a, nie z osobnych szablonów**. Ręcznie pisany
wariant markdownowy rozjechałby się przy pierwszej edycji, której ktoś nie
powtórzy w dwóch miejscach.

To nie zastępuje `llms.txt`: tamten plik jest indeksem i streszczeniem serwisu
w formacie llmstxt.org, ten — wierną kopią jednej podstrony.

### Rzeczy, o które łatwo się potknąć

- **`Accept: */*` ma dostać HTML.** Markdown wychodzi tylko wtedy, gdy klient
  chce go *bardziej* niż HTML-a — porównujemy wagi `q`, a przy remisie wygrywa
  typ wymieniony imiennie. Naiwne „czy nagłówek zawiera markdown" wysłałoby
  Markdown przeglądarce, bo jej Accept kończy się typem zbiorczym.
- **Brak pliku `.md` nie daje 404.** Warstwa zasobów Pages podaje wtedy stronę
  główną ze statusem 200. Samo `response.ok` tego nie odsiewa, więc middleware
  sprawdza typ MIME odpowiedzi — inaczej agent dostaje HTML opisany jako
  `text/markdown`. Sprawdzone na wranglerze, nie zgadnięte.
- **`Vary: Accept` musi być na KAŻDEJ odpowiedzi HTML**, nie tylko na
  wynegocjowanej — inaczej bufor pośredni poda przeglądarce zapisany wcześniej
  Markdown.
- **Pliki `.md` mają `X-Robots-Tag: noindex`**, bo pod adresem strony stoi ta
  sama treść. Wynegocjowana odpowiedź tego nagłówka **nie** dziedziczy —
  przeszedłby wtedy na adres, pod którym indeksowana jest wersja HTML.
- **Middleware odpala się przy każdym żądaniu strony.** Statyki są wyłączone
  w `_routes.json`, ale każda odsłona HTML to jedno wywołanie funkcji.
- **`llms.txt` to Markdown, mimo rozszerzenia `.txt`.** Format llmstxt.org
  narzuca nazwę pliku, ale treść to nagłówki, listy i odnośniki. Warstwa
  zasobów Pages przypisuje typ po rozszerzeniu i wysyłała `text/plain`.
  Deklaracja `Content-Type` w `src/pages/llms.txt.ts` tego **nie ratuje**:
  build jest statyczny, endpoint jest prerenderowany do pliku na dysku
  i nagłówki ustawione w jego `Response` nigdy nie wychodzą. Typ stawia
  middleware dla każdej ścieżki kończącej się na `/llms.txt`, a `/llms.txt`
  został **wypisany z `_routes.json`** — inaczej korzeniowy plik omijałby
  funkcję i jako jedyny zostawałby przy `text/plain`. `_headers` tu nie
  wystarczy, bo nie dotyczy odpowiedzi generowanych przez funkcje, a pliki
  zawodów przez funkcję przechodzą.

Cloudflare ma to samo jako przełącznik na poziomie strefy („Markdown for
Agents") — konwertuje HTML w locie. Robimy to u siebie, bo konwersja z builda
widzi semantyczny HTML zamiast wyniku po CSS-ie i wchodzi do repozytorium razem
z testami. Włączenie przełącznika obok niczego nie psuje.

Pilnuje tego `test/markdown.spec.js` — piętnaście testów, wołających `onRequest`
wprost, bo serwer testowy podaje statyki i nie uruchamia funkcji brzegowych.
Najważniejszy jest ten porównujący `<h1>` ze strony z treścią pliku `.md`:
gdyby konwersja przestała łapać treść, pliki zostałyby z samą nawigacją
i nikt by tego nie zauważył.

### Dokumenty OWU pod stałym adresem `/owu/<slug>.pdf`

Pliki leżą w prywatnym kubełku `ud-owu`, ale wychodzą spod stałego adresu
na naszej domenie. Funkcja `functions/owu/[plik].js` **strumieniuje** plik
z kubełka kluczem serwisowym.

**Strumieniuje, nie przekierowuje — i to jest sedno.** Wcześniej
`/pobierz/<id>` przekierowywał na adres podpisany na 300 sekund. Człowiekowi
to wystarcza, robotowi nie: zaindeksować treść PDF-a można tylko pod adresem,
który będzie żył jutro. Przekierowanie ma jeszcze drugą wadę — oddaje adres
końcowy domenie `supabase.co`, więc do indeksu trafia cudzy host z naszą
treścią. Warunki ubezpieczenia to najbardziej merytoryczna rzecz, jaką serwis
ma; były niewidoczne dla wyszukiwarek i modeli językowych.

**Slug bierze się z TYTUŁU, nie z symbolu.** Symbol niesie numer wersji
(`LW044/AD_D_TTD_PTD/PL/5`), więc adres umierałby przy każdej nowej wersji
razem z zaindeksowanym odnośnikiem. Tytuł zostaje ten sam, więc
`/owu/leadenhall-utrata-dochodu.pdf` zawsze podaje warunki **obowiązujące** —
i o to w publicznej bibliotece chodzi. Numer wersji stoi na stronie i w samym
dokumencie.

Skutek uboczny jest pożądany: gdyby w bibliotece zostały aktywne dwie wersje
tego samego OWU, dwa wiersze dałyby ten sam adres, a generator mapy
(`src/pages/owu-adresy.json.ts`) **wywala build** z nazwami obu. To jest
ta pomyłka, którą trzeba złapać przed wdrożeniem.

Trzy rzeczy, których nie upraszczaj:

- **Dwa zapytania, nie jedno.** Mapa slug → id pochodzi z builda, ale `active`
  sprawdzamy na żywo w bazie. Gdyby aktywność brać z mapy, wycofane OWU byłoby
  serwowane aż do następnego wdrożenia portalu.
- **Bufor liczy się w minutach** (`s-maxage=600`), nie w godzinach. Dłuższy
  oszczędziłby wywołań, ale wycofany dokument wisiałby pod publicznym adresem
  tyle, ile trwa wpis w buforze — a to dokument, na który klient się powołuje.
- **`Content-Disposition: inline`**, nie `attachment`. Plik ma się otworzyć,
  a nie spaść na dysk; nazwa idzie w dwóch zapisach (ASCII + RFC 5987), bo
  w nazwach CEU są polskie znaki i spacje.

`/pobierz/<id>` został jako **301** na nowy adres — siedzi w cudzych zakładkach
i w wysłanych e-mailach. 301, nie 302: wartość starego adresu ma przejść na
nowy, a nie żyć obok.

**Do mapy sitemap tych plików nie dodajemy.** Strona `/dokumenty/` jest
zaindeksowana i linkuje do wszystkich trzynastu z opisowym tekstem odnośnika —
to wystarczająca ścieżka odkrycia, a wpis w mapie zestarzałby się przy zmianie
tytułu i zostawił w niej adres dający 404. `robots.txt` niczego tu nie blokuje.

Pilnuje tego `test/owu.spec.js` — jedenaście testów z podstawionym `fetch`,
bez ruchu sieciowego. Najważniejsze: że odpowiedź ma status 200 i typ
`application/pdf`, a nie przekierowanie, i że zapytanie do bazy niesie filtr
`active=is.true`.

### Nagłówek Link — co wskazujemy, czego nie

Każda odpowiedź HTML niesie `Link` (RFC 8288) z zasobami maszynowymi serwisu:
`describedby` na `llms.txt`, `alternate` na kanał RSS i na wariant markdownowy
tej podstrony, `privacy-policy`, `terms-of-service`, `author`. Lista siedzi
w stałej `ZASOBY` w `functions/_middleware.js`.

**Nie ma tam `api-catalog`, `service-desc` ani `service-doc` i nie mają wrócić.**
Serwis nie wystawia publicznego API. Odnośnik do katalogu, którego nie ma,
kosztuje agenta jedno żądanie i kończy się błędem zamiast odpowiedzią — jest
więc gorszy niż jego brak. Skanery zgodności lubią te trzy relacje, ale
wpisanie ich na sucho oznaczałoby, że dokument opisuje interfejs nieistniejący.
Gdyby kiedyś powstało prawdziwe API, katalog RFC 9727 i te relacje mają sens —
wcześniej nie. Test na to jest.

Mapy strony w nagłówku nie ma, bo deklaruje ją `robots.txt` — ten mechanizm
rozumie każdy robot i nie ma powodu mówić tego samego dwa razy.

---

## Przepięcie domeny — co musi być, zanim pójdzie

### Stare adresy mają dokąd prowadzić

240 adresów starego serwisu, 227 podstron nowego, 53 reguły przekierowań,
zero osieroconych. Pilnuje tego test w `linki.spec.js`, który dodatkowo
sprawdza, że cel każdej reguły naprawdę istnieje.

Reguły stoją w dwóch miejscach i kolejność ma znaczenie, bo Cloudflare bierze
pierwsze trafienie:

1. `public/_redirects` — strony najwyższego poziomu starego serwisu
   (`/blog.html`, `/formularz.html`, stare mapy strony). Ręczne, bo nie ma ich
   skąd wyliczyć.
2. Dopisywane w buildzie przez integrację `ud:przekierowania` — podstrony
   zawodów, z danych.

### `404.astro` musi istnieć

Bez pliku `404.html` w katalogu wyjściowym Pages na nieznany adres **nie
odpowiada błędem, tylko podaje stronę główną ze statusem 200**. Google czyta
to jako miękki 404 i wciąga adres do indeksu jako duplikat strony głównej.

Ta strona jest zbudowana jako `404.html`, a nie `404/index.html`, więc nie ma
bliźniaczego pliku `.md` — dlatego dostaje `wariantMarkdown={false}`. Bez tego
układ ogłasza wariant markdownowy, którego nie ma.

### Podgląd nie może konkurować z domeną

Każde wdrożenie ma adres `<hash>.utratadochodu.pages.dev` z kopią całego
serwisu. Middleware dokłada tam `X-Robots-Tag: noindex, nofollow` na każdą
odpowiedź. Kanoniczne odnośniki w HTML-u to za mało — są podpowiedzią, nagłówek
jest wiążący.

### Kontrola z zewnątrz — przed przepięciem i zaraz po nim

```
bash apps/portal/scripts/sprawdz-wdrozenie.sh https://<hash>.utratadochodu.pages.dev
bash apps/portal/scripts/sprawdz-wdrozenie.sh https://utratadochodu.pl
```

Testy w `test/` sprawdzają kod i build na miejscu. Sekretów w projekcie Pages,
reguł `_redirects` wykonywanych przez Cloudflare i nagłówków po przejściu przez
middleware stamtąd nie widać — skrypt sprawdza je żądaniami z zewnątrz. Niczego
nie zapisuje i sam rozpoznaje tryb po adresie: na podglądzie wymaga `noindex`,
na domenie traktuje go jako błąd.

**Z sandboksa asystenta nie zadziała** — proxy nie wpuszcza ani `*.pages.dev`,
ani domeny. Uruchamia go człowiek, na zwykłym komputerze.

**Zmienne i sekrety w Pages działają od następnego wdrożenia.** Wdrożenie
zbudowane przed ich dodaniem odpowiada 503 na `/owu/…` i `/wspolpraca` — wtedy
Deployments → Retry deployment, a nie szukanie błędu w kodzie.

### Czego nie da się zrobić z repozytorium

To są ustawienia w panelu Cloudflare i decyzje klienta:

- Root directory `apps/portal`, build command `pnpm install && pnpm build`.
- `SUPABASE_SERVICE_ROLE_KEY` jako **Encrypt**, nigdy Plain — bez niego
  `/owu/<slug>.pdf` nie poda żadnego dokumentu OWU.
- `TURNSTILE_SECRET_KEY` i `RESEND_API_KEY` też jako Secret — bez nich
  formularz współpracy (`/wspolpraca`) odpowiada 503.
- Zmienne `PUBLIC_*` odwrotnie: muszą być Plain, inaczej nie dojdą do builda.
  Nie są sekretami, widać je w źródle strony.
- Podpis prawnika pod regulaminem, polityką prywatności i klauzulą
  informacyjną oraz okresy retencji danych.

---

## Kalkulator — okres wypłaty świadczenia

Okresy w ofercie: **24, 36, 48 i 60 miesięcy**. Najkrótszy to 24.

Kalkulator miał tu przełącznik „Wypłata przez 24 miesiące zamiast 12" z dopłatą
10% i stał domyślnie na 12. Wariantu 12-miesięcznego nie ma i nie było —
przełącznik proponował okres, którego nie da się kupić, w pozycji domyślnej.
Nie przywracaj go.

Lista okresów siedzi w stałej `OKRESY` w `src/lib/symulacja.ts` i stamtąd idzie
do kalkulatora, do pytań na `/kalkulator/`, do `llms.txt` serwisu i do `llms.txt`
każdego zawodu. Nie wpisuj tych liczb drugi raz w szablonie.

**Okres jest informacją, nie przełącznikiem — dopóki nie ma tabeli stawek.**
Dłuższa wypłata kosztuje więcej, ale współczynników z tabeli ubezpieczyciela
jeszcze nie dostaliśmy. Przełącznik bez nich pokazywałby cenę wariantu
24-miesięcznego pod etykietą 60-miesięcznego, czyli ten sam błąd co poprzednio,
tylko w drugą stronę. Gdy współczynniki przyjdą: wracają jako mapa
okres → mnożnik obok `OKRESY`, a `symuluj()` bierze `okres` w założeniach.

Pilnuje tego `test/kalkulator.spec.js`: okresy muszą być wymienione
w komplecie, przy składce musi stać, którego wariantu dotyczy, a ciąg
„zamiast 12" nie może wrócić na stronę.

## Kalkulator — stawka pochodzi z ofert, nie z sufitu

Stawka 1,5% ze starego `Calculator.js` leżała **poniżej najtańszej oferty,
jaką realnie wystawiliśmy**. Przy sumie 14 400 zł serwis obiecywał 216 zł,
podczas gdy faktyczne oferty dawały 291–351 zł. Nie przywracaj jej i nie
wpisuj żadnej stawki „na oko" — na stronie sprzedażowej zaniżona cena to
najgorszy możliwy kierunek błędu.

Liczby siedzą w **`src/lib/kalibracja.json`** i tylko tam. `symulacja.ts` je
importuje, reszta serwisu bierze je z `symulacja.ts`. Ten plik jest pomyślany
tak, żeby dało się go przeliczyć maszynowo — nie wpisuj wartości bezpośrednio
w kodzie.

| Pole | Skąd |
|---|---|
| `stawka.dol` / `stawka.gora` | najtańsza i najdroższa zaobserwowana oferta (2,02% / 2,44%) |
| `stawka.srodek` | mediana zaokrąglona do 2,2% — tam, gdzie musi paść jedna liczba |
| `okresy` | mnożniki policzone z par ofert: 24 → 1,00, 36 → 1,25 |
| `zrodlo` | ile ofert i wariantów stoi za tymi liczbami — metryczka kalibracji, nie treść strony |

**Składka jest przedziałem, nie liczbą.** Rozrzut 2,02–2,44% jest prawdziwy
i bierze się z wieku, klasy ryzyka i okresu wyczekiwania, o które kalkulator
nie pyta. Jedna liczba udawałaby precyzję, której w tym produkcie nie ma.

**W treści na stronie nie ma liczby ofert ani wariantów.** Stoi tam „przedział
z ostatnio wystawionych ofert" i „ze wszystkich wariantów we wszystkich
ofertach". To nie jest ogólnikowość dla samej ogólnikowości: konkretna liczba
zestarzeje się przy pierwszej nowej ofercie, a wtedy albo ktoś ją poprawia
ręcznie w trzech miejscach, albo worker `ud-kalibrator` musi przepisywać
treść zamiast samych stawek. Pola `zrodlo` używaj w dokumentacji i w bramkach
workera, nie w zdaniu na stronie.

Na stronie mówimy **„okres wyczekiwania"**, nie „karencja" — w kolumnach bazy
(`wait_accident`, `wait_illness`) i w MODEL-SKLADKI.md termin techniczny
zostaje, ale w treści dla klienta ma być jedno słowo i to właśnie to.

Metoda, dane źródłowe i — ważniejsze — **czego z tych danych policzyć się nie
da** (współczynnika klasy ryzyka, współczynnika wieku, mnożników dla 48 i 60
miesięcy) siedzą w `apps/portal/MODEL-SKLADKI.md`. Zanim ktoś dopisze
któryś z tych współczynników, ma tam przeczytać, dlaczego go nie ma.

Mnożnik klauzuli HIV/WZW (1,2) to jedyna liczba w tym zestawie bez pokrycia
w danych — pochodzi z relacji 1,8/1,5 ze starego kalkulatora, a w ofertach
z bazy klauzuli nie ma wcale.

---

## Ankieta rozszerzona — kontrakt z funkcją brzegową to `hs_<klucz>`

Przy sumie „trwałej niezdolności" **powyżej 1 000 000 zł** kreator pokazuje
dodatkowe dwadzieścia pytań (`HEALTH_SURVEY_GROUPS` w `packages/wniosek/src/ankieta.js`).

**Funkcja brzegowa czyta je WYŁĄCZNIE z pól `hs_<klucz>` o wartości `tak`/`nie`,
a szczegóły z `hsd_<klucz>`.** Inne nazwy są dla niej niewidzialne. Tak samo
wysyła ankietę panel przy ręcznym wprowadzaniu klienta — to jeden kontrakt,
nie dwa.

Co się dzieje, gdy kreator wyśle gołe `weight_change: 'yes'`:

1. `form-submit` zbiera ankietę po prefiksie `hs_` → zero trafień.
2. Bramka „suma powyżej progu i pusta ankieta" → **HTTP 400** z komunikatem
   „wymagana jest pełna ankieta medyczna. Odśwież formularz i wypełnij
   wszystkie pytania".
3. Klient, który właśnie wypełnił dwadzieścia pytań, dostaje polecenie
   wypełnienia ich jeszcze raz. **Wniosku nie da się złożyć** — i to przy
   najwyższych sumach, czyli najdroższych wnioskach.

Formularz wygląda przy tym na sprawny na każdym ekranie, więc żaden test
oparty na DOM-ie tego nie łapie. Pilnuje tego `test/wniosek-ankieta.spec.js`,
który czyta kontrakt **z pliku funkcji brzegowej**, a nie z przepisanej kopii —
kopia rozjechałaby się przy pierwszej zmianie po tamtej stronie i test
pilnowałby własnego wyobrażenia zamiast produkcji.

### Czego nie wolno dopisać do `POLA_LOGICZNE`

Ośmiu nazw ze starego formularza: `weightChange`, `takesMeds`,
`pendingDiagnosis`, `disabilityCongenital`, `smoker`, `eventHospitalization`,
`eventSickLeave30`, `eventFurtherDiagnosis`.

Nowy kreator nie ma pól o tych nazwach — pyta o to samo pod kluczami
`weight_change`, `takes_meds` i tak dalej. Dopóki stały w `POLA_LOGICZNE`,
normalizacja w `doWysylki()` wpisywała im `"No"`, bo pola o takiej nazwie
w stanie kreatora nie ma. Funkcja czyta `body.weightChange ?? body.weight_change`,
a `??` przepuszcza `"No"` — to nie jest `null` ani `undefined` — i po prawdziwą
odpowiedź nigdy nie sięgała. Klient zaznaczał „tak" przy hospitalizacji,
a do bazy szło „nie".

**Fałszywe „nie" na deklaracji zdrowotnej jest gorsze niż puste pole.** Puste
underwriter dopyta; „nie" przyjmie, a przy szkodzie zrobi się z niego zarzut
zatajenia.

Z tego samego powodu pozycje ankiety **startują puste, nie na „nie"**,
a walidacja wymaga świadomej odpowiedzi na każdą z dwudziestu. Wyjątkiem są
cztery klucze wspólne z podstawową siódemką (`med_heart`, `med_diabetes`,
`med_stomach`, `med_neuro`) — to jedno pytanie zadane w dwóch miejscach,
związane jednym stanem, więc dziedziczy domyślne „no" stamtąd i nie zbiera
drugiego opisu.

### Siedem pozycji bez własnej kolumny — to nie jest brak

`med_thyroid`, `med_urinary`, `med_respiratory`, `med_oncology`,
`med_spine_degenerative`, `med_allergy`, `med_other` nie mają kolumny boolean
i mieć nie muszą. Komplet dwudziestu odpowiedzi razem z opisami ląduje
w `ud_clients.form_data.health_survey`; kolumny płaskie to skrót dla
underwritera na trzynaście pozycji, które miały je wcześniej.

Mapa `HEALTH_SURVEY_COLUMNS` w funkcji brzegowej trzyma jeden wyjątek:
`med_locomotor` → `med_bones`. **Nie zmieniaj klucza `med_locomotor`
w `ankieta.js` na `med_bones`** — mapa go wtedy nie rozpozna i ankieta straci
pierwszeństwo nad odpowiedzią z podstawowej siódemki.

### Funkcja brzegowa w repozytorium bywa starsza niż wdrożona

Zanim cokolwiek wdrożysz z `supabase/functions/`, porównaj z produkcją przez
`get_edge_function` — **treść, nie numer wersji**. W repozytorium leżała kopia
`form-submit` sprzed v20, bez `form_data`, bez zbiórki `hs_*`, bez obu bramek
walidacyjnych i z `yesNo()`, który nie przyjmował małych liter. Jej wdrożenie
skasowałoby to wszystko na produkcji. To samo dotyczy dziś `review-admin`
(patrz „Funkcje brzegowe — kto może je wołać").

Numer wersji rośnie także wtedy, gdy nikt nie wdraża kodu: wpisanie sekretu
w Edge Functions → Secrets podbiło 24.09 licznik **wszystkim** funkcjom o jeden,
przy identycznym `ezbr_sha256`. Stan na 24.09 wieczorem: `form-submit` v22.

---

## Panel — kod dostępu do oferty to 4 ostatnie cyfry PESEL-u

**SMS-ów nie wysyłamy.** Klient dostaje sam e-mail z linkiem, a hasłem są
cztery ostatnie cyfry jego PESEL-u — ten sam ciąg, którym Leadenhall szyfruje
pliki oferty. Klient zna go z dowodu, więc nie ma czego dowozić drugim kanałem.
Sprawdzone na danych: wszystkie 17 ofert z ustawionym kodem miało go równy
`right(pesel, 4)`, zero wyjątków.

Wcześniej `sendOfferToClient()` przy braku kodu losowało PIN i wysyłało go
SMS-em. Bez SMS-a losowy kod to oferta, której klient nie ma jak otworzyć,
a e-mail obiecujący PESEL byłby nieprawdą — dlatego zamiast fallbacku są dwie
bramki i **wysyłka się nie odbywa**, gdy:

- klient nie ma PESEL-u w kartotece (`ud_clients.pesel`),
- kod przy ofercie jest inny niż `right(pesel, 4)`.

Obie rzucają wyjątek z instrukcją dla agenta; `+page.server.js` pokazuje go
jako `fail(400)`. To jest celowe: lepiej, żeby agent poprawił kartotekę, niż
żeby klient dostał list z hasłem, którego nie zna.

Treść mówiąca o haśle stoi w **trzech miejscach i musi być zgodna**:

| Plik | Co tam jest |
|---|---|
| `src/lib/server/templates.js` | e-mail do klienta — wersja HTML i tekstowa, obie |
| `src/routes/offer/[token]/+page.svelte` | podpowiedź nad polem na stronie oferty |
| `src/routes/panel/offer/[id]/+page.svelte` | opis kodu dla agenta |

Zostało po SMS-ach, celowo nieruszone: `lib/server/sms.js`, test wysyłki
w Ustawieniach, sonda w `health.js` i filtr kanału w Wysyłkach. Pierwsze trzy
to narzędzia diagnostyczne SMSAPI, ostatni pokazuje **historię** wysyłek sprzed
zmiany. Usunięcie ich to osobna decyzja — nie kasuj przy okazji.

---

## Panel — cykl życia oferty

Statusy: `draft` → `sent` → `viewed` → `chosen` → **`bought`** / `rejected`.

**`chosen` to nie sprzedaż.** Znaczy „klient wskazał wariant w portalu";
`bought` znaczy „umowa podpisana". Mieszanie ich sprawiało, że z panelu nie
dało się odczytać, ile ofert faktycznie się sprzedało — dlatego `bought` ma
na liście mocniejszą plakietkę niż `chosen`.

**Archiwum to `archived_at`, nie status.** Kupiona oferta ma zostać kupiona
także w archiwum; gdyby archiwizacja nadpisywała status, statystyka sprzedaży
kasowałaby się przy sprzątaniu listy. Lista bieżąca filtruje
`archived_at is null` i ma na to indeks częściowy.

**Wersję podbija wysyłka, nie dokładanie dokumentów.** `ud_offers.wersja`
rośnie wyłącznie w `sendOfferToClient()` i tylko wtedy, gdy `sent_at` już
jest — liczy się to, co klient faktycznie zobaczył. Każdy wpis
w `ud_send_log` niesie `wersja`, więc widać, którą wersję klient dostał
którego dnia. Daty były tam od początku (`created_at` zapisuje też nieudane
próby); brakowało samego numeru.

Nieudana wysyłka **nie** przepala numeru: wersja zapisuje się przy ofercie
dopiero po `email.sent`, a w logu zostaje ślad próby z tym numerem.

Migracja: `supabase/migrations/20260917200000_oferty_archiwum_wersje.sql`.

### Podmiana wersji OWU — co wolno, a co urywa dostęp

Na stronie pokazujemy **tylko aktualne OWU**. Wgląd w wersje historyczne idzie
przez oferty: `createOfferFromPdfs`, `addDocumentsToOffer`
i `refreshOfferDocuments` kopiują `storage_bucket` i `storage_path`
do `ud_offer_files` w chwili wystawienia. Oferta trzyma wskaźnik na **plik**,
nie odpytuje biblioteki przy otwarciu — więc dezaktywacja starej wersji nie
rusza ofert historycznych.

**Wycofuje się przełącznikiem `active`, nigdy przyciskiem usuwania.** Akcja
`delete` w Panel → OWU kasuje obiekt z kubełka, a wtedy urywa się każda oferta
wskazująca na ten plik. To jest cała podstawa modelu opisanego wyżej.

**Nowa wersja i dezaktywacja starej idą razem, nie w dwóch podejściach.**
`resolveOwus()` dopasowuje po prefiksie bazowym (`LW044`), nie po pełnym
symbolu z numerem wersji — przy dwóch aktywnych wersjach podpina do wariantu
obie i klient dostaje OWU w dwóch wersjach bez wskazówki, która go dotyczy.

`bezInnychWersji()` w `owuMatch.js` pilnuje, żeby odświeżanie dokumentów nie
dokładało ofercie innej wersji bazy, którą już ma. Bez tego jedno kliknięcie
„odśwież wszystkie" (pętla po dwustu ofertach) dołożyłoby po podmianie każdej
historycznej ofercie wersję, która jej nie dotyczy — obok tej, która dotyczy.
Nic by nie zginęło i nic by się nie zapaliło; klient dostałby dwa OWU i sam
musiałby zgadnąć.

Rozróżnienie, na którym to stoi: **OWU i karta produktu tej samej wersji mają
w bibliotece identyczny `symbol`** (oba `LW046/MEDICA/PL/4`), a kolejna wersja
tego samego OWU różni się ostatnim członem (`…/PL/5`). Po samej bazie te dwa
przypadki wyglądają jednakowo — kartę produktu wolno dołożyć, nowej wersji OWU
nie. Dlatego filtr porównuje symbole w obrębie bazy, a pokrycie liczone jest
**raz, przed pętlą**: aktualizowane w trakcie kasowałoby kartę produktu zaraz
po podpięciu OWU o tym samym symbolu.

Bibliotekę do ustalenia pokrycia pytamy **bez filtra `active`** — wycofane OWU
nadal obowiązuje polisy zawarte na jego warunkach, więc jego baza ma się liczyć
jako pokryta.

Test: `pnpm test:owu` w `apps/panel`. `test:parser` z tego samego katalogu to
narzędzie ręczne — bierze dwa pliki PDF jako argumenty i bez nich się wywala;
to nie jest regres.

---

## Serwis jest jasny — bez trybu ciemnego

Decyzja klienta, 2026-08-28. Nie proponuj ponownie i nie dokładaj wariantu
ciemnego „przy okazji".

Paleta w `apps/portal/src/styles/global.css` to jeden zestaw tokenów bez
odpowiedników dla `prefers-color-scheme: dark`. Ciemny bywa tylko tekst.
Dodanie drugiego zestawu to nie jest zmiana kosmetyczna: wymaga ponownego
sprawdzenia kontrastów wszystkich par kolor–tło, bo wartości policzone dla
bieli nie przenoszą się na ciemne tło.

Kontrasty, które już policzyliśmy dla tła białego:

| Token | Na bieli | Wymóg WCAG |
|---|---|---|
| `--color-linia-pole` (krawędź pola) | 3,09:1 | 3:1 dla elementów interfejsu |
| `--color-tekst-drugi` | 5,52:1 | 4,5:1 dla drobnego tekstu |
| `--color-tekst-trzeci` | 2,65:1 | **za mało na tekst** — tylko do ozdobników |

`--color-tekst-trzeci` nie nadaje się na treść, którą ktoś ma przeczytać.
Etykiety typu „Jednorazowe świadczenie" trafiły tam przez pomyłkę i wróciły
na `--color-tekst-drugi`.

---

## Zdjęcia — nazwa pliku to slug adresu, który ma je pokazać

Dwie warstwy, obie w `src/lib/obrazy.ts`:

| Katalog | Nazwa pliku | Widać na |
|---|---|---|
| `src/obrazy/zawody/` | `<slug-zawodu>` | `/<slug>/` |
| `src/obrazy/kategorie/` | `<slug-kategorii>` | `/zawody/<slug>/`, kafelki na `/`, oraz `/<slug>/` gdy zawód nie ma własnego |

Rozszerzenie nie ma znaczenia — `jpg`, `jpeg`, `png` i `webp` działają tak samo,
bo zestaw powstaje w różnych narzędziach i wymuszanie konwersji przed wrzuceniem
kończyło się plikiem, którego strona nie widzi. Serwowany jest i tak WebP,
niezależnie od formatu źródła. Ten sam slug w dwóch formatach naraz to błąd —
test go wyłapuje, bo `obrazy.ts` wybrałby jeden po kolejności rozszerzeń.

**Pliki idą do `src/`, nigdy do `public/`.** Tylko `src/` przechodzi przez
optymalizację; z `public/` plik leci do przeglądarki taki, jaki jest.

Podstrona zawodu bierze `zdjecieZawodu()`: własne zdjęcie, jeśli plik istnieje,
w przeciwnym razie zdjęcie kategorii. Dzięki temu zestaw zawodowy można
uzupełniać zawód po zawodzie — nie ma etapu, w którym część podstron stoi
pusta. Opis alternatywny idzie za tym, co widać: własne zdjęcie opisujemy
zawodem, odziedziczone — branżą.

Strona kategorii i kafelki na stronie głównej biorą **wyłącznie** zdjęcie
kategorii. Nigdy nie pożyczaj kategorii zdjęcia od któregoś z jej zawodów —
to była dokładnie ta pomyłka, którą opisuje akapit niżej.

Brak pliku to `null` i szablon po prostu nie renderuje pasa ze zdjęciem.

Wcześniej zdjęcie wisiało przy **każdym zawodzie z osobna** (pole `obraz`
w `zawody.json`), a strona kategorii brała je od pierwszego zawodu
alfabetycznie. Skutki: Budownictwo ilustrował biurowiec (bo Architekt),
Transport też biurowiec (bo Agent Celny), a dwóch prawników i informatyk
dostali `bezpieczenstwo.jpg` — zdjęcie mężczyzny z niemowlęciem na białym tle.
Pole `obraz` zostało usunięte z danych; nie przywracaj go.

Pilnuje tego `test/linki.spec.js`:
- żaden plik w żadnym z katalogów nie może mieć nazwy spoza slugów (kategorii
  albo zawodów — zależnie od katalogu),
- zawód z własnym plikiem faktycznie go pokazuje; test sprawdza to po opisie
  alternatywnym, bo Vite scala pliki o identycznej zawartości pod jedną nazwą
  assetu i sama nazwa nie rozstrzyga, którą gałęzią poszedł szablon,
- każda kategoria poza wymienionymi w `BEZ_ZDJECIA` musi mieć plik,
- **`BEZ_ZDJECIA` sprząta po sobie** — gdy plik się pojawi, test wywala się na
  nieaktualnym wpisie.

### Zdjęcie strony głównej ma inny układ niż reszta serii

Plik: `src/obrazy/hero.<jpg|jpeg|png|webp>`, wczytywany przez `obrazHero()`.
Brak pliku to sam gradient — pas nie renderuje ani obrazu, ani zasłony.

**Nie zamawiaj go według wzorca „bohater po prawej".** W pasie strony głównej
po prawej stoi karta kalkulatora (`lg:w-[26em]`, nieprzezroczysta) i zasłania
dokładnie ten fragment kadru, w którym na podstronach zawodu siedzi bohater.
Po lewej jest nagłówek i lead.

**Bohater ma stać na lewo od środka — jego prawa krawędź najdalej na 55%
szerokości kadru.** Wcześniej stało tu „mniej więcej na 58%" i to była pomyłka:
58% kadru to dokładnie miejsce, w którym stoi lewa krawędź karty.

Arytmetyka, bo bez niej ta wytyczna wygląda na widzimisię. Wysokość pasa
dyktuje karta kalkulatora — **1355 px, niezależnie od szerokości okna**. Lewa
krawędź karty to `szerokość/2 + 164` px, więc im szersze okno, tym bliżej
środka ekranu:

| Okno | Lewa krawędź karty | Zapas poziomy przy kadrze 3:2 |
|---|---|---|
| 1280 px | 63% | 753 px |
| 1440 px | 61% | 593 px |
| 1920 px | 59% | **113 px — za mało przy każdym `object-position`** |
| 2560 px | 56% | **0 — kadr skaluje się po szerokości, `object-position` bezczynne** |

Dlatego **przesunięcie `object-position` tego nie naprawia** i nie próbuj tego
drugi raz: powyżej okna `1355 × proporcje kadru` zdjęcie skaluje się po
szerokości i pozioma składowa `object-position` nie robi już nic.

Proporcje: **węższe niż 3:2, docelowo około 1,1:1**. Plik w repo ma 2808×2496
(1,125:1) — to oryginał 3744×2496 z Artlista przycięty o 25% z lewej, bo
bohaterka stała na 56% i karta ucinała jej pół głowy. Przy proporcjach ≤ 1,2:1
całą szerokość zdjęcia widać już od okna 1626 px, więc pozycja bohatera
przestaje zależeć od szerokości okna.

Kadr z generatora przychodzi szeroki (3:2 albo 21:9) i **trzeba go przyciąć
z lewej przed wrzuceniem do repo** — albo od razu zamówić bohatera po lewej.

Skutek uboczny, o którym warto wiedzieć: przesunięcie bohatera w lewo wsuwa go
pod mocniejszą część `.zaslona-hero` (95% bieli do 46% szerokości), więc zdjęcie
czyta się bardziej jako tło niż jako portret. To jest wymuszone układem —
między prawą krawędzią tekstu a lewą krawędzią karty jest zawsze 56 px
(`gap-14`), a głowa ma na ekranie ze 250 px. Nie ma pozycji, w której bohater
omija i tekst, i kartę. Rozjaśnienie zasłony wymaga przeliczenia kontrastów
z tabeli wyżej — lead ma 4,6:1 przy wymaganych 4,5:1, czyli zero zapasu.

Pilnuje tego `test/linki.spec.js`:
- bez pliku pas nie może mieć `zaslona-hero` (zasłona bez zdjęcia to ciemna
  plama, przez którą nie prześwituje nic),
- z plikiem pas musi mieć zasłonę i `object-[50%_25%]`,
- kadr źródłowy mieści się w 0,9–1,2:1; test czyta wymiary z `width`/`height`
  w zbudowanym znaczniku. **Nie sprawdza, gdzie w kadrze stoi bohater** — tego
  z pliku odczytać się nie da, więc po podmianie zdjęcia obejrzyj pas przy
  1440 i 1920 px,
- kafelki kategorii na stronie głównej liczone są **po opisie alternatywnym**,
  nie po wszystkich `<img>` — zdjęcie nagłówka też jest `<img>`, tylko z pustym
  `alt`, bo znaczenie niesie nagłówek leżący na nim.

### Kadr i tekst na zdjęciu

Nagłówek podstrony zawodu i kategorii leży **na zdjęciu**, nie pod nim. To nie
jest wybór estetyczny: gdy zdjęcie było osobnym pasem nad nagłówkiem, musiało
być niskie, żeby nie spychać treści poniżej ekranu — i ucinało bohatera w pół.
Przy tekście na wierzchu pas ma `min-h: clamp(26rem, 34vw, 38rem)`, więc kadr
21:9 traci w pionie ok. jednej piątej zamiast połowy.

Kadruj z zapasem nad i pod bohaterem, a lewą tercję zostaw spokojną — tam stoi
tekst.

**Pas przycina kadr od 25% wysokości, nie od środka** (`object-[50%_25%]`).
Domyślne `object-cover` tnie symetrycznie, a zdjęcia w tym zestawie mają twarz
w górnej tercji — przy oknie 1440 px widoczny fragment farmacji zaczynał się
na y≈346, podczas gdy oczy są na y≈300. Na stronie zostawał sam uśmiech.
Medycyna (oczy 270, kadr od 314) i budownictwo (oczy 350, kadr od 408) miały
to samo, tylko nikt tam nie zajrzał.

Zanim zmienisz tę wartość, przelicz, który fragment oryginału zostaje przy
oknie 1440 i 1920 px — wysokość pasa to `clamp(26rem, 34vw, 38rem)`, więc
nadmiar do przycięcia zmienia się razem z szerokością okna. Ta sama klasa
stoi na pasie zawodu, pasie kategorii, pasie strony głównej i na kafelkach
kategorii; test w `linki.spec.js` sprawdza trzy pierwsze.

Czytelność trzyma `.zaslona-hero` w `global.css`. Policzone nad najciemniejszym
możliwym zdjęciem (czerń pod spodem), w obrębie kolumny tekstu:

| Element | Kontrast | Wymóg |
|---|---|---|
| `h1` (`--color-tekst`) | 11,8–13,7:1 | 3:1 (duży tekst) |
| lead (`--color-tekst-drugi`) | 4,6–5,4:1 | 4,5:1 |
| etykieta (`--color-akcent-tekst`) | 5,0–5,8:1 | 4,5:1 |

Dwie rzeczy, których nie ruszaj bez ponownego przeliczenia:

- **Etykieta mono nie może wrócić na `--color-akcent-ciemny`** — ten daje na
  czystej bieli 3,34:1, czyli za mało dla 12 px. Stąd `--color-akcent-tekst`
  (#0A6A96, 5,97:1). `--color-akcent-hover` też nie wystarczy (4,65:1 zostawia
  zero zapasu, gdy tłem jest zasłona, a nie biel).
- **Wersja mobilna zasłony liczy stopnie w pikselach, nie w procentach.**
  Wysokość pasa zależy od długości tekstu, a ten jest inny na każdej ze 188
  podstron; przy procentach tekst potrafiłby wypaść tam, gdzie zasłona jeszcze
  przepuszcza zdjęcie. Szablon odsuwa tekst o 17 rem od góry, zasłona osiąga
  pełną siłę na 260 px.

Pilnuje tego `test/linki.spec.js` — sprawdza, że obraz, zasłona i `h1` siedzą
w jednym bloku, i że bez zdjęcia nie ma ani zasłony, ani odsunięcia od góry.

### Styl serii — i pułapka w style kicie na Artliście

Zestaw, który faktycznie leży w repo, wygląda tak: jasne, wysokie światło,
chłodna cyjanowa paleta pod tło serwisu, bohater **po prawej stronie kadru,
patrzący w obiektyw, z naturalnym ciepłym uśmiechem**, tło miękko rozmyte,
lewa tercja spokojna pod nagłówek. Kategorie mają 1920×1280 (3:2), zawody
1915×821 (21:9) — pas i tak przycina przez `object-cover`.

**Style kit „UtrataDochodu.pl — zdjęcia kategorii" na Artliście zawiera
przeciwną instrukcję i nie wolno go użyć bez poprawki.** W jego tekście stoi
„never smiling at the camera" i „No face looking into the lens". To jest
dokładnie ta wytyczna, która wyprodukowała pierwszy zestaw — odrzucony przez
klienta jako martwy. Paleta w kicie jest dobra, tekst nie.

Dopóki tekst kitu nie zostanie podmieniony, kolejne zdjęcia rób **bez kitu**,
z pełnym opisem w promptcie. Rzeczy, które muszą się w nim znaleźć:

- kontakt wzrokowy z obiektywem i szczery, swobodny uśmiech — to jest ten
  element, którego brak zabił pierwszy zestaw,
- wysokie światło, przewietrzone wnętrze, biele zostają bielami,
- paleta: `#1BAEE5`, `#CBE9F8`, `#F4FBFE`, stalowy błękit; bez ciepłego
  bursztynu, bez gradu teal-and-orange, bez HDR,
- bohater po prawej, lewa tercja pusta,
- pełna klatka, 50 mm, f/2.8, płytka głębia, naturalna skóra i dłonie,
- zero tekstu, napisów, logotypów i czytelnych ekranów.

Przy zawodach z budownictwa dopisz jeszcze, czego **nie** chcesz: nie biurowiec
z zewnątrz i nie architekt przy desce kreślarskiej — to była pierwotna pomyłka
opisana wyżej.

### Ile to kosztuje i czego nie zamawiać drugi raz

**Kredyty liczą się od sztuki, nie od rozdzielczości.** Sto za ujęcie,
niezależnie od tego, czy to 2K czy 3K. Wniosek: zawsze bierz najwyższą
rozdzielczość, a koszt kontroluj liczbą ujęć. Cztery sztuki „na wszelki
wypadek" to czterysta kredytów — przed każdym zleceniem sprawdź cenę przez
wycenę, jest darmowa.

Trzy rzeczy, które trzeba dopisać wprost, bo model sam ich nie zgadnie:

- **Uroda środkowoeuropejska.** Bez tego wychodzą rysy azjatyckie. Serwis jest
  polski i zdjęcia mają wyglądać na zrobione tutaj.
- **Przysłona f/5.6, nie f/2.8.** Przy f/2.8 tło robi się kremową plamą.
  Ma być czytelne: widać, że to jasne biuro z oknem. Dopisz wprost
  „background clearly recognisable, avoid heavy blur".
- **Kto jest na zdjęciu.** Płeć, wiek, kolor włosów. Zostawione modelowi
  kończy się losowaniem i drugim zleceniem za te same pieniądze.

Zdjęć wygenerowanych na Artliście **nie da się pobrać z tego środowiska** —
proxy blokuje `cms-toolkit-artifacts.artlist.io`, `ai-toolkit-generations.imgix.net`
i `mcp.artlist.io`. Wyniki widać w kliencie i pobiera je człowiek. Cała domena
`artlist.io` też jest zablokowana, więc panelu nie da się stąd obejrzeć — nie
zgaduj nazw zakładek, podaj znaczniki: datę, godzinę, model i liczbę sztuk.

### Pobrany plik gubi nazwę — i wtedy mapowanie po uuid nic nie daje

Pliki pobrane z panelu przychodzą nazwane **`_Seedream_50_<liczba>.jpg`**.
W tej nazwie nie ma ani identyfikatora pliku, ani generacji. `przemianuj.mjs`
dopasowuje po uuid w nazwie, więc **zadziała tylko wtedy, gdy pliki zachowają
nazwę z generatora** (`-t-e-x-t_-t-o_-i-m-a-g-e-<uuid>.jpeg`). Obie formy się
zdarzają, zależnie od tego, jak plik został pobrany.

Gdy przyjdą przemianowane, dopasowanie robi się tak: **`get_generation_status`
na identyfikatorze generacji zwraca gotowy obraz**. Mając parę
generationId → slug widać, jak wygląda każdy zamówiony zawód, i porównuje się
to z wgranymi plikami. Dlatego w pliku mapowania trzymaj **identyfikatory
generacji**, nie tylko uuid plików — te pierwsze pozwalają odtworzyć obraz,
drugie są bezużyteczne, gdy nazwa przepadnie.

**Nie dopasowuj specjalizacji medycznych po wyglądzie.** Przy partii wrześniowej
dwóch mężczyzn w identycznych niebieskich fartuchach okazało się weterynarzem
i neurochirurgiem — różnica była wyłącznie w tle (gabinet zabiegowy kontra
korytarz szpitalny). Zawody biurowe rozpoznaje się pewnie, bo prompt daje im
rekwizyt: kalkulator u księgowej, otwarta księga u audytora, kartony
w pustym mieszkaniu u agenta nieruchomości, monitory z wykresami u maklera.
Specjalizacje lekarskie takiego rekwizytu zwykle nie dostają.

### Jasność — instrukcja ekspozycji działa, ale nie do końca

Prośba „zdjęcia mogłyby być ciemniejsze" **nie przechodzi**, jeśli napiszesz ją
wprost — partia medyczna wyszła o 28% jaśniejsza od pierwszej serii. Działa
dopiero opis fotograficzny: „expose about a third of a stop under: bright but
NOT blown out, mid-tones stay rich, walls read as a faint tint rather than
paper white, highlights just below clipping". Z nim partia Prawo/Finanse/IT
wyszła o 13% jaśniejsza od pierwszej serii zamiast 28%.

Do parytetu z pierwszą serią to wciąż za mało. Jasność mierz, nie oceniaj okiem:

```
sharp(plik).stats() → średnia z channels[0..2].mean
```

Pierwsza seria ma około 171, partia medyczna 219, Prawo/Finanse/IT 193.
