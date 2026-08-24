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
