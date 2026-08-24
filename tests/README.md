# Test CSP

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
