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

---

## Struktura Supabase

- **Projekt:** `kukvgsjrmrqtzhkszzum`
- **Tabela artykułów:** `aura_articles`
- **Storage bucket:** `article-images`
- **Filtr platformy:** `.contains('platforms', ['UtrataDochodu.pl'])`
- **Filtr statusu:** `.eq('status', 'published')`
