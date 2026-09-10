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

## Znaczniki Google — nie dotykać

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

Nie jest zaimplementowany i **nie wolno go wprowadzać bez decyzji właściciela** —
włączenie zmienia wolumen raportowanych konwersji. Temat jest świadomie odłożony,
nie jest to przeoczenie do „naprawienia” przy okazji.

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

## Ikona strony (favicon)

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
