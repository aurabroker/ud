# Google Ads — konfiguracja śledzenia konwersji

## Identyfikatory

| Parametr | Wartość |
|---|---|
| Google Ads Conversion ID | `AW-18020137303` |
| Conversion Label | `_uZeCOTG_KwcENfy1ZBD` |
| Pełny `send_to` | `AW-18020137303/_uZeCOTG_KwcENfy1ZBD` |
| GA4 Measurement ID | `G-MGB0RBTCC9` |
| Nazwa konwersji | Przesłanie formularza kontaktowego |

---

## Jak działa śledzenie

### 1. Global tag (gtag.js)

Wstawiony na **każdej stronie** (`*.html` oraz `*/index.html`) za `<head>`:

```html
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18020137303"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'AW-18020137303');
</script>
```

Na `index.html` dodatkowo skonfigurowane jest GA4:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-MGB0RBTCC9"></script>
<script>
  gtag('config', 'G-MGB0RBTCC9');
  gtag('config', 'AW-18020137303');
</script>
```

### 2. Event konwersji — thankyou.html

Zdarzenie konwersji uruchamiane **wyłącznie** na stronie podziękowania (`/thankyou.html`), do której użytkownik trafia po wysłaniu formularza:

```html
<!-- Event snippet for Przesłanie formularza kontaktowego -->
<script>
  gtag('event', 'conversion', {'send_to': 'AW-18020137303/_uZeCOTG_KwcENfy1ZBD'});
</script>
```

### 3. Przekierowanie po wysłaniu formularza

`formularz.html` po pomyślnym wysłaniu przekierowuje użytkownika na `/thankyou.html`, co uruchamia event konwersji.

---

## Content Security Policy (_headers)

Plik `_headers` (Cloudflare Pages) zawiera nagłówki CSP dla wszystkich tras (`/*`).

### Aktualna konfiguracja connect-src

```
connect-src 'self'
  https://kukvgsjrmrqtzhkszzum.supabase.co
  https://www.google-analytics.com
  https://region1.google-analytics.com
  https://analytics.google.com
  https://cloudflareinsights.com
  https://www.google.com
  https://googleads.g.doubleclick.net
  https://www.googleadservices.com;
```

### Wymagane domeny Google Ads

| Domena | Cel |
|---|---|
| `https://www.google.com` | Endpoint `/ccm/collect` — wysyłanie danych konwersji |
| `https://googleads.g.doubleclick.net` | Sieć reklamowa Google Ads |
| `https://www.googleadservices.com` | Usługi Google Ads |
| `https://www.googletagmanager.com` | Ładowanie skryptu gtag.js (script-src) |

### Pełny nagłówek CSP (_headers)

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://kukvgsjrmrqtzhkszzum.supabase.co https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com https://cloudflareinsights.com https://www.google.com https://googleads.g.doubleclick.net https://www.googleadservices.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://kukvgsjrmrqtzhkszzum.supabase.co;
```

---

## Skrypt build_ads.py

Automatyzuje wstrzykiwanie tagów Google Ads do wszystkich plików HTML.

### Uruchomienie

```bash
# podgląd zmian bez zapisu
python3 build_ads.py --dry-run

# faktyczny patch
python3 build_ads.py
```

### Co robi

1. Strony **bez żadnego gtag** → wstawia pełny global tag za `<head>`
2. Strony z **istniejącym GA4 tag** → dopisuje `gtag('config', 'AW-...')` do bloku
3. `thankyou.html` → global tag + event konwersji
4. `build_ud.py` HTML_TEMPLATE → dopisuje global tag (przyszłe buildy)
5. Pliki **już z AW ID** → pomija (idempotentne)

---

## Przepływ konwersji

```
Użytkownik wchodzi na stronę
        ↓
gtag.js ładuje się (global tag na każdej podstronie)
        ↓
Użytkownik wypełnia formularz na formularz.html
        ↓
Po wysłaniu → redirect na /thankyou.html
        ↓
gtag('event', 'conversion', {...}) uruchamia się
        ↓
Żądanie do https://www.google.com/ccm/collect
        ↓
Konwersja zarejestrowana w Google Ads
```
