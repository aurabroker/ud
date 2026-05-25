================================================================================
  UTRATADOCHODU.PL — Dokumentacja projektu
  Aura Expert Sp. z o.o.
================================================================================

SPIS TREŚCI
-----------
1. O projekcie
2. Struktura plików
3. Formularze i przepływ danych
4. Backend — Supabase
5. Edge Functions
6. Powiadomienia (email + WhatsApp)
7. Kalkulator składki
8. Blog
9. Strony zawodowe (SEO)
10. Zmienne środowiskowe i sekrety
11. Deployment
12. Kontakt i dane firmy


================================================================================
1. O PROJEKCIE
================================================================================

UtrataDochodu.pl to serwis informacyjno-ofertowy poświęcony ubezpieczeniom
na wypadek utraty dochodu. Skierowany do osób pracujących na B2B, wolnych
zawodów i zatrudnionych — wszystkich, którzy nie mają ochrony ZUS-owskiej
adekwatnej do swoich dochodów.

Firma: Aura Expert Sp. z o.o.
       Agent ubezpieczeniowy wpisany do rejestru KNF

Partnerzy (ubezpieczyciele):
  - CEU sp. z o.o.
  - Leadenhall Insurance SA

Domena:   https://utratadochodu.pl
Email:    biuro@utratadochodu.com
Telefon:  +48 504 400 901


================================================================================
2. STRUKTURA PLIKÓW
================================================================================

  index.html              — Strona główna (szybki formularz, kalkulator, pełny wniosek)
  formularz.html          — Dedykowana strona z pełnym wnioskiem ubezpieczeniowym
  formularz.css           — Style specyficzne dla formularza
  blog.html               — Lista artykułów (pobierana z Supabase)
  blog.js                 — Logika bloga (fetch artykułów, renderowanie)
  o-nas.html              — Strona "O nas"
  pracuj-z-nami.html      — Oferty pracy / współpracy
  thankyou.html           — Strona po wysłaniu pełnego wniosku
  polityka-prywatnosci.html
  polityka-cookies.html
  regulamin.html

  app.js                  — Inicjalizacja UI: nawigacja mobilna, smooth scroll,
                            losowy wpis blogowy z Supabase, szybki formularz kontaktowy,
                            zakładki segmentów (Beauty / Medycy / B2B)

  style.js                — Wizard wielokrokowy (pełny wniosek), walidacja PESEL,
                            wysyłka do Edge Function form-submit, obsługa modali

  Calculator.js           — Kalkulator składki ubezpieczeniowej (slider zawód + dochód)

  cookie-consent.js       — Baner zgody na cookies

  supabase/
    functions/
      form-submit/            — Obsługa pełnego wniosku (→ ud_clients + GetResponse)
      send-confirmation-email/ — Wysyłka emaila (Resend) + powiadomienie WhatsApp

  <zawod>/index.html      — Ponad 200 stron landing page per zawód (SEO)
                            Generowane przez build_ud.py / build.py

  build.py                — Generator stron zawodowych z szablonu
  build_ud.py             — Wariant buildera dla utratadochodu.pl
  build_ads.py            — Builder wariantu reklamowego
  professions-metadata.json — Dane zawodów (slug, nazwa, opis SEO)
  llms.txt                — Opis serwisu dla crawlerów AI
  robots.txt / sitemap.xml / sitemap_professions.xml


================================================================================
3. FORMULARZE I PRZEPŁYW DANYCH
================================================================================

--- SZYBKI FORMULARZ (szybki kontakt) ---

Lokalizacja: index.html — sekcja na samej górze strony (nad nawigacją)
Pola: Imię i nazwisko | Adres e-mail | Numer telefonu
Tabela Supabase: udochodu_contacts
Wysyłka: fetch() → Supabase REST API (anon key, RLS policy: anon INSERT)

Przepływ po wysłaniu:
  1. Rekord trafia do udochodu_contacts
  2. Database Webhook (INSERT) → Edge Function send-confirmation-email
  3. Klient dostaje email z podziękowaniem + link do pełnego wniosku
  4. Doradca dostaje powiadomienie WhatsApp z danymi klienta

--- PEŁNY WNIOSEK (ubezpieczeniowy) ---

Lokalizacja: index.html (#wniosek) oraz formularz.html
Kroki wizarda:
  1. Dane podstawowe (imię, PESEL, zawód, forma zatrudnienia, dochód)
  2. Opcjonalnie: dane pracodawcy (jeśli zatrudnia pracowników)
  3. Parametry ubezpieczenia (ryzyka: śmierć/inwalidztwo, temp./stałe)
  4. Pytania medyczne (12 bloków tak/nie z możliwością opisu)
  5. Klauzula informacyjna (zgoda ubezpieczonego)
  6. Dane kontaktowe (email, telefon)

Tabela Supabase: ud_clients
Wysyłka: fetch() → Edge Function form-submit (service_role, bypass RLS)

Przepływ po wysłaniu:
  1. Edge Function form-submit waliduje PESEL i mapuje pola
  2. Rekord trafia do ud_clients
  3. Kontakt synchronizowany z GetResponse (lista mailingowa)
  4. Database Webhook (INSERT) → Edge Function send-confirmation-email
  5. Klient dostaje email z informacją o weryfikacji (1-2 dni robocze)
  6. Doradca dostaje powiadomienie WhatsApp z danymi + zawodem


================================================================================
4. BACKEND — SUPABASE
================================================================================

Projekt: kukvgsjrmrqtzhkszzum
URL:     https://kukvgsjrmrqtzhkszzum.supabase.co

Tabele:

  udochodu_contacts
    id          bigint PK
    created_at  timestamptz
    name        text
    email       text
    phone       text
  RLS: SELECT zablokowany, INSERT dostępny dla anon

  ud_clients
    Pełna struktura wniosku ubezpieczeniowego:
    dane osobowe, PESEL, zawód, forma zatrudnienia, dochód,
    ryzyka (boolean), pytania medyczne (boolean + opis),
    ryzyka sportowe, klauzule NW, email, telefon
  RLS: tylko service_role (Edge Function)

  aura_articles
    id, slug, title, excerpt, tags, status, platforms,
    published_at, created_at, preview_image_url, thumbnail_url
  Filtr: platforms @> '{"UtrataDochodu.pl"}' AND status = 'published'
  RLS: SELECT publiczny

Database Webhooks:
  - ON INSERT → udochodu_contacts → send-confirmation-email
  - ON INSERT → ud_clients        → send-confirmation-email

Storage bucket: article-images
  Obrazki dostępne z: https://kukvgsjrmrqtzhkszzum.supabase.co/storage/...


================================================================================
5. EDGE FUNCTIONS
================================================================================

--- form-submit ---
Wyzwalacz: POST z przeglądarki (fetch w style.js)
Autoryzacja: brak JWT (publiczny endpoint z CORS)
Działanie:
  1. Walidacja PESEL (11 cyfr + suma kontrolna)
  2. Mapowanie pól formularza na kolumny ud_clients
  3. INSERT do ud_clients (createClient z service_role key)
  4. Sync kontaktu z GetResponse API
  5. Zwraca { status: 'success' } lub { status: 'error', message: '...' }

Zmienne środowiskowe:
  SUPABASE_URL              — auto-inject
  SUPABASE_SERVICE_ROLE_KEY — auto-inject
  GETRESPONSE_API_KEY
  GETRESPONSE_LIST_ID

--- send-confirmation-email ---
Wyzwalacz: Database Webhook (Supabase → POST przy INSERT)
Autoryzacja: verify_jwt: true (Supabase wysyła service_role JWT automatycznie)
Działanie:
  1. Parsuje WebhookPayload { type, table, record }
  2. Ignoruje UPDATE i DELETE
  3. Określa typ formularza: udochodu_contacts = szybki, ud_clients = pełny
  4. Generuje HTML email (inny dla każdego typu)
  5. Wysyła email przez Resend API
  6. Wysyła powiadomienie WhatsApp przez CallMeBot API
  7. Loguje wynik

Zmienne środowiskowe:
  RESEND2_API_KEY — klucz API Resend

Stałe w kodzie:
  FROM_EMAIL = "UtrataDochodu.pl <noreply@utratadochodu.com>"
  REPLY_TO   = "biuro@utratadochodu.com"
  WA_PHONE   = numer doradcy (format: 48XXXXXXXXX)
  WA_APIKEY  = klucz CallMeBot


================================================================================
6. POWIADOMIENIA
================================================================================

--- Email do klienta (Resend) ---

Domena nadawcy: utratadochodu.com (zweryfikowana w Resend)
Adres nadawcy: UtrataDochodu.pl <noreply@utratadochodu.com>
Reply-To:      biuro@utratadochodu.com
Temat:         "UtrataDochodu.pl - Twoje prywatne L4"

Szybki formularz:
  - Podziękowanie za kontakt
  - Info o oddzwonieniu w 24h roboczych
  - CTA: wypełnij pełny wniosek → formularz.html
  - Stopka z danymi Aura Expert + ubezpieczycielami

Pełny wniosek:
  - Potwierdzenie przyjęcia wniosku
  - 3 kroki: weryfikacja (1-2 dni) → oferta emailem → ewentualny telefon
  - Stopka z danymi Aura Expert + ubezpieczycielami

--- WhatsApp dla doradcy (CallMeBot) ---

Serwis: https://api.callmebot.com
Aktywacja: jednorazowa — wysłanie "I allow callmebot to send me messages"
           na numer CallMeBot (aktualny numer na callmebot.com)

Szybki formularz: "📱 Nowy kontakt! Imię: X / Tel: X / Email: X"
Pełny wniosek:    "📋 Nowy wniosek! Imię: X / Tel: X / Email: X / Zawód: X"


================================================================================
7. KALKULATOR SKŁADKI
================================================================================

Plik: Calculator.js
Lokalizacja na stronie: sekcja #kalkulator

Parametry:
  - Zawód (6 kategorii ryzyka: IT/biuro, lekarz, kosmetolog, prawnik, architekt, fizyczne)
  - Miesięczny dochód netto (slider 3 000 – 60 000 zł)
  - Okres wypłaty (12 lub 24 miesiące)
  - Opcja HIV/WZW (dla medyków i branży beauty)

Wyniki:
  - Szacunkowa składka miesięczna
  - Suma ubezpieczenia miesięczna (80% dochodu)
  - Świadczenie za 1 dzień

Przycisk "Przejdź do Wniosku" przewija do sekcji #wniosek.

Symulator luki dochodowej (hero):
  - Porównanie: tylko ZUS vs ZUS + polisa
  - Parametry: dochód miesięczny + czas trwania L4
  - Uwzględnia 21 dni karencji


================================================================================
8. BLOG
================================================================================

Plik: blog.html + blog.js
Artykuły pobierane z Supabase (tabela aura_articles)
Filtr: status='published' AND platforms @> '{"UtrataDochodu.pl"}'

Funkcje:
  - Lista artykułów z obrazkami (preview_image_url lub thumbnail_url)
  - Stronicowanie
  - Filtrowanie po tagach
  - Losowy artykuł w sidebarze strony głównej (app.js → initRandomBlogPost)

Obrazki: serwowane z Supabase Storage (kukvgsjrmrqtzhkszzum.supabase.co)
CSP img-src: musi zawierać https: lub jawną domenę Supabase


================================================================================
9. STRONY ZAWODOWE (SEO)
================================================================================

Ponad 200 podstron dla konkretnych zawodów, np.:
  /lekarz/, /programista/, /adwokat/, /fryzjer/, /kosmetolog/ itd.

Każda strona zawiera:
  - Nagłówek H1 z nazwą zawodu
  - Opis ryzyk specyficznych dla zawodu
  - Kalkulator składki (Calculator.js)
  - Pełny formularz ubezpieczeniowy (style.js)
  - Metadane SEO (title, description, canonical, schema.org)

Generator: build_ud.py + professions-metadata.json
  python3 build_ud.py   — generuje wszystkie strony zawodowe
  python3 build.py      — wariant bazowy
  python3 build_ads.py  — wariant z kampaniami Google Ads


================================================================================
10. ZMIENNE ŚRODOWISKOWE I SEKRETY
================================================================================

Supabase Edge Function Secrets (ustawiać przez Supabase Dashboard):
  RESEND2_API_KEY        — klucz API Resend (wysyłka emaili)
  GETRESPONSE_API_KEY    — klucz API GetResponse (sync listy mailingowej)
  GETRESPONSE_LIST_ID    — ID listy w GetResponse

Auto-inject przez Supabase (nie trzeba ustawiać ręcznie):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_ANON_KEY

Frontend (hardcoded w app.js — dane publiczne):
  _SB_URL = https://kukvgsjrmrqtzhkszzum.supabase.co
  _SB_KEY = <anon key> (tylko SELECT na aura_articles + INSERT na udochodu_contacts)

Edge Function send-confirmation-email (hardcoded):
  WA_PHONE   — numer WhatsApp doradcy (format 48XXXXXXXXX)
  WA_APIKEY  — klucz CallMeBot doradcy


================================================================================
11. DEPLOYMENT
================================================================================

Hosting: strony statyczne (GitHub Pages / Cloudflare Pages / własny serwer)
Branch produkcyjny: main

Git workflow:
  - Zmiany na gałęzi feature (np. claude/xxx)
  - PR → squash merge do main
  - Deploy automatyczny po push do main (zależnie od konfiguracji hostingu)

Edge Functions deployment:
  - Przez Supabase MCP lub CLI: supabase functions deploy <nazwa>
  - Aktualna wersja send-confirmation-email: v12
  - Aktualna wersja form-submit: v4

Database Webhooks (Supabase Dashboard → Database → Webhooks):
  - webhook_udochodu_contacts: INSERT → send-confirmation-email
  - webhook_ud_clients:        INSERT → send-confirmation-email
  Oba używają service_role JWT — verify_jwt: true w Edge Function


================================================================================
12. KONTAKT I DANE FIRMY
================================================================================

Aura Expert Sp. z o.o.
Agent ubezpieczeniowy wpisany do rejestru KNF

Email:    biuro@utratadochodu.com
Telefon:  +48 504 400 901
WWW:      https://utratadochodu.pl

Ubezpieczyciele:
  CEU sp. z o.o.
  Leadenhall Insurance SA

================================================================================
