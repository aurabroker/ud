# CLAUDE.md — Wytyczne projektu UtrataDochodu.pl

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

## `<meta charset>` musi być w pierwszym 1 KB pliku

Przeglądarka skanuje w poszukiwaniu deklaracji kodowania tylko pierwszy
1024 bajty. W `index.html` i `formularz.html` wpis wylądował za długim
skryptem Meta Pixela (bajt 1812 / 1162) i był ignorowany — polskie znaki
ratował wyłącznie nagłówek `charset=utf-8` od Cloudflare.

**`<meta charset="UTF-8">` ma być pierwszą linią po `<head>`.** Przy dodawaniu
czegokolwiek na początek `<head>` sprawdź, czy nie wypycha deklaracji poza 1 KB:

```
python3 -c "import re;d=open('index.html','rb').read();print(re.search(rb'<meta[^>]*charset',d).start())"
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

Cloudflare ma to samo jako przełącznik na poziomie strefy („Markdown for
Agents") — konwertuje HTML w locie. Robimy to u siebie, bo konwersja z builda
widzi semantyczny HTML zamiast wyniku po CSS-ie i wchodzi do repozytorium razem
z testami. Włączenie przełącznika obok niczego nie psuje.

Pilnuje tego `test/markdown.spec.js` — piętnaście testów, wołających `onRequest`
wprost, bo serwer testowy podaje statyki i nie uruchamia funkcji brzegowych.
Najważniejszy jest ten porównujący `<h1>` ze strony z treścią pliku `.md`:
gdyby konwersja przestała łapać treść, pliki zostałyby z samą nawigacją
i nikt by tego nie zauważył.

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

### Kadr i tekst na zdjęciu

Nagłówek podstrony zawodu i kategorii leży **na zdjęciu**, nie pod nim. To nie
jest wybór estetyczny: gdy zdjęcie było osobnym pasem nad nagłówkiem, musiało
być niskie, żeby nie spychać treści poniżej ekranu — i ucinało bohatera w pół.
Przy tekście na wierzchu pas ma `min-h: clamp(26rem, 34vw, 38rem)`, więc kadr
21:9 traci w pionie ok. jednej piątej zamiast połowy.

Kadruj z zapasem nad i pod bohaterem, a lewą tercję zostaw spokojną — tam stoi
tekst.

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

Zestaw z 2026-08-30 powstał na Artlist (Seedream 5.0, 21:9, 2K) ze style kitu
„UtrataDochodu.pl — zdjęcia kategorii": jasne, przewietrzone wnętrza, chłodna
cyjanowa paleta pod tło serwisu, kadr dokumentalny bez patrzenia w obiektyw.
Kit trzyma spójność serii — kolejne zdjęcia rób z niego, nie od zera.
