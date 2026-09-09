# Testy

## CSP

Sprawdza, czy polityka CSP (`_headers` + metatagi w HTML) nie blokuje żadnego
zasobu używanego przez strony. Uruchamia prawdziwe Chromium, serwuje repo
lokalnie z nagłówkiem CSP z `_headers` (tak jak Cloudflare Pages), a następnie:

1. ładuje 7 stron i zbiera zdarzenia `securitypolicyviolation`,
2. odpala 29 sond na stronę — `fetch()`, `<script>`, `<link rel=stylesheet>`
   i `<iframe>` na wszystkie domeny Turnstile / GA4 / Google Ads / Meta Pixel /
   Supabase / CDN, w tym dokładnie te URL-e, które były blokowane w konsoli,
3. liczy odpowiedzi 404 (martwe zasoby).

Zewnętrzne hosty są stubowane — CSP jest sprawdzane przed warstwą sieciową,
więc naruszenia raportują się tak samo, a test działa bez internetu.

```
NODE_PATH=$(npm root -g) node tests/csp-test.js
```

Kod wyjścia 0 = brak blokad. Po każdej zmianie CSP uruchom ten test.

## Szybki kontakt (`quick-form-test.js`)

Pilnuje, żeby formularz szybkiego kontaktu z `index.html` szedł do Edge Function
`contact-submit`, a nie prosto do PostgREST — to była awaria, przez którą
formularz nie zapisał ani jednego leada od 15.06 do 09.09.2026. Sprawdza też
kształt payloadu, ścieżkę błędu (modal awarii z komunikatem serwera) i reset
widgetu Turnstile po nieudanej próbie.

```
NODE_PATH=$(npm root -g) node tests/quick-form-test.js
```

## Konwersja z wniosku (`wniosek-konwersja-test.js`)

Pilnuje jedynej działającej ścieżki konwersji Google Ads: udana wysyłka wniosku →
redirect na `/thankyou.html` → `gtag('event', 'conversion')`. Sprawdza etykietę
konwersji, konfigurację Google Ads i GA4 na stronie podziękowania, rozróżnienie
między brakiem widgetu Turnstile (awaria konfiguracji) a nierozwiązanym widgetem
(zwykły komunikat) oraz odświeżanie tokenu na ostatnim kroku kreatora.

Regresja, której pilnuje: 07.06.2026 bramka Turnstile trafiła do `style.js`,
a widget tylko do `formularz.html`. Wysyłka z `index.html` przerywała się po cichu
i konwersje stały trzy miesiące.

```
NODE_PATH=$(npm root -g) node tests/wniosek-konwersja-test.js
```

## Modal awarii (`awaria-test.js`)

Symuluje padnięty backend na każdej stronie z formularzem i sprawdza, czy
użytkownik dostaje modal z numerem telefonu.

```
NODE_PATH=$(npm root -g) node tests/awaria-test.js
```
