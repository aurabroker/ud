# CLAUDE.md — Wytyczne projektu UtrataDochodu.pl

## Supabase — pobieranie danych

### Zawsze jawnie wymieniaj kolumny w SELECT

Nigdy nie używaj `.select('*')` w widokach publicznych (wydajność, bezpieczeństwo).
Zamiast tego wypisuj każdą potrzebną kolumnę z osobna.

### Kolumny z obrazkami w tabeli `aura_articles`

Tabela posiada dwa pola z URL-ami zdjęć:

| Kolumna | Opis |
|---|---|
| `preview_image_url` | Główne zdjęcie ilustracyjne artykułu (preferowane) |
| `thumbnail_url` | Miniatura (fallback gdy brak `preview_image_url`) |

**Zawsze dołączaj oba pola do SELECT**, nawet jeśli strona docelowo ma je tylko wyświetlać:

```js
.select('id, slug, title, excerpt, tags, published_at, created_at, preview_image_url, thumbnail_url')
```

### Renderowanie zdjęcia — wzorzec obowiązkowy

Nie używaj statycznych emoji ani placeholderów gdy dostępne są URL-e zdjęć.
Stosuj ten wzorzec w każdym szablonie karty / kafelka artykułu:

```js
${art.preview_image_url || art.thumbnail_url
  ? `<img src="${art.preview_image_url || art.thumbnail_url}" alt="${art.title}" class="w-full h-full object-cover">`
  : `<span class="text-6xl">${style.emoji}</span>`}
```

Kontener obrazka musi mieć `overflow-hidden`, żeby `object-cover` działał poprawnie:

```html
<div class="h-48 overflow-hidden ...">
  <!-- img lub emoji -->
</div>
```

### Strony, które wymagają weryfikacji tego wzorca

- [ ] `blog.html` / `blog.js` — **naprawione** (2026-05-19)
- [ ] Inne strony z listą artykułów / kart — do sprawdzenia

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
- **Tabela artykułów:** `aura_articles`
- **Storage bucket:** `article-images`
- **Filtr platformy:** `.contains('platforms', ['UtrataDochodu.pl'])`
- **Filtr statusu:** `.eq('status', 'published')`

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
| `src/obrazy/zawody/` | `<slug-zawodu>.jpg` | `/<slug>/` |
| `src/obrazy/kategorie/` | `<slug-kategorii>.jpg` | `/zawody/<slug>/`, kafelki na `/`, oraz `/<slug>/` gdy zawód nie ma własnego |

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
