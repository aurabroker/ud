#!/usr/bin/env bash
#
# sprawdz-wdrozenie.sh — kontrola wdrożenia portalu z zewnątrz, samym curlem.
#
#   bash scripts/sprawdz-wdrozenie.sh https://<hash>.utratadochodu.pages.dev
#   bash scripts/sprawdz-wdrozenie.sh https://utratadochodu.pl
#
# Po co, skoro są testy: testy w test/ sprawdzają kod i build na miejscu.
# To, co rozstrzyga o przepięciu domeny, żyje poza repozytorium — sekrety
# w projekcie Pages, reguły _redirects wykonywane przez Cloudflare, nagłówki
# z _headers po przejściu przez middleware. Widać to tylko z zewnątrz.
#
# Tryb wynika z adresu. Kopia na *.pages.dev ma nieść X-Robots-Tag: noindex,
# żeby nie konkurowała z domeną. Na domenie ten sam nagłówek wyrzuca serwis
# z wyszukiwarki, więc tam jest błędem.
#
# Niczego nie zapisuje i nic nie wysyła. Formularz współpracy dostaje
# zgłoszenie bez tokenu Turnstile i odpada na weryfikacji, zanim funkcja
# sięgnie po Resend.
#
# Wymaga tylko bash i curl: macOS, Linux, na Windowsie Git Bash albo WSL.
# Z sandboksa asystenta nie zadziała — proxy nie wpuszcza tam ani
# *.pages.dev, ani domeny.

BAZA=${1%/}
if [ -z "$BAZA" ]; then
  echo "Użycie: bash $0 https://<adres-wdrożenia>" >&2
  exit 2
fi
HOST=$(printf '%s' "$BAZA" | sed -E 's#^[a-zA-Z]+://##; s#[/:].*$##')
DOMENA=https://utratadochodu.pl
case $HOST in
  *.pages.dev) PODGLAD=1; TRYB='podgląd (*.pages.dev)' ;;
  *)           PODGLAD=0; TRYB='domena produkcyjna' ;;
esac

TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT

OK=0
BLEDY=0
dobrze() { OK=$((OK + 1)); printf '  OK    %s\n' "$1"; }
zle()    { BLEDY=$((BLEDY + 1)); printf '  BŁĄD  %s\n        → %s\n' "$1" "$2"; }
info()   { printf '  INFO  %s\n' "$1"; }
sekcja() { printf '\n%s\n' "$1"; }

# pobierz ŚCIEŻKA|ADRES [opcje curla…] → $KOD, nagłówki w $TMP/h, treść w $TMP/b.
# Bez -L: przekierowanie jest tu często tym, co sprawdzamy.
pobierz() {
  local adres=$1
  shift
  case $adres in http*) ;; *) adres=$BAZA$adres ;; esac
  rm -f "$TMP/b" "$TMP/h0"
  KOD=$(curl -sS --max-time 30 -o "$TMP/b" -D "$TMP/h0" -w '%{http_code}' "$@" "$adres" 2>"$TMP/e") || KOD=000
  [ -f "$TMP/b" ] || : >"$TMP/b"
  if [ -f "$TMP/h0" ]; then tr -d '\r' <"$TMP/h0" >"$TMP/h"; else : >"$TMP/h"; fi
}

# Wartość nagłówka; kilka wystąpień (Link, Vary) sklejone przecinkiem.
naglowek() { grep -i "^$1:" "$TMP/h" | sed -E 's/^[^:]+:[[:space:]]*//' | paste -sd ',' -; }

# Czy tekst zawiera fragment — bez rozróżniania wielkości liter.
ma()       { printf '%s' "$1" | grep -qiF -- "$2"; }
tresc_ma() { grep -qiF -- "$1" "$TMP/b"; }

# Status do komunikatu o błędzie; przy braku odpowiedzi — komunikat curla.
status() {
  if [ "$KOD" = 000 ]; then printf 'brak odpowiedzi: %s' "$(head -1 "$TMP/e")"
  else printf 'status %s' "$KOD"; fi
}

# 301 albo 308 — oba są stałe i oba przenoszą wartość adresu. 308 daje
# Pages samo dla adresów z .html, do których w buildzie jest plik.
przekierowanie() {
  pobierz "$1"
  local dokad
  dokad=$(naglowek location)
  if [[ $KOD == 30[18] ]] && { [ "$dokad" = "$2" ] || [[ $dokad == *"$HOST$2" ]]; }; then
    dobrze "$1 → $2 ($KOD)"
  else
    zle "$1 → $2" "$(status)${dokad:+ → $dokad}"
  fi
}

# typ ŚCIEŻKA TYP — 200 i Content-Type zawiera TYP.
typ() {
  pobierz "$1"
  local ct
  ct=$(naglowek content-type)
  if [ "$KOD" = 200 ] && ma "$ct" "$2"; then dobrze "$1 → $2"
  else zle "$1 → 200 $2" "$(status), Content-Type: ${ct:-brak}"; fi
}

printf 'Kontrola wdrożenia: %s\nTryb: %s\nCzas: %s\n' "$BAZA" "$TRYB" "$(date '+%Y-%m-%d %H:%M:%S')"

# ── 1 ──────────────────────────────────────────────────────────────────────
sekcja '1. Strony'
brak=''
for s in / /wniosek/ /podziekowanie/ /kalkulator/ /dokumenty/ /blog/ /zawody/ /programista/; do
  pobierz "$s"
  [ "$KOD" = 200 ] || brak="$brak $s ($(status))"
done
if [ -z "$brak" ]; then dobrze 'osiem kluczowych stron → 200'
else zle 'kluczowe strony → 200' "nie odpowiadają:$brak"; fi

pobierz /blog/
ile=$(grep -oE 'href="/blog/[a-z0-9-]+/"' "$TMP/b" | sort -u | wc -l | tr -d ' ')
if [ "${ile:-0}" -gt 0 ]; then dobrze "/blog/ ma artykuły ($ile)"
else zle '/blog/ ma artykuły' 'lista artykułów jest pusta'; fi

# ── 2 ──────────────────────────────────────────────────────────────────────
sekcja '2. Nagłówki strony głównej'
pobierz /
csp=$(naglowek content-security-policy)
if ma "$csp" 'kukvgsjrmrqtzhkszzum.supabase.co' && ma "$csp" 'challenges.cloudflare.com' \
  && ma "$csp" "frame-ancestors 'none'"; then
  dobrze 'CSP z _headers przechodzi przez middleware (Supabase, Turnstile, frame-ancestors)'
else
  zle 'CSP z _headers przechodzi przez middleware' "${csp:-brak nagłówka Content-Security-Policy}"
fi

if [ -n "$(naglowek strict-transport-security)" ] && ma "$(naglowek x-content-type-options)" nosniff; then
  dobrze 'HSTS i nosniff'
else
  zle 'HSTS i nosniff' 'brak któregoś nagłówka bezpieczeństwa z _headers'
fi

if ma "$(naglowek vary)" accept; then dobrze 'Vary: Accept'
else zle 'Vary: Accept' "Vary: $(naglowek vary)"; fi

link=$(naglowek link)
if ma "$link" 'rel="describedby"' && ma "$link" 'type="text/markdown"'; then
  dobrze 'Link: llms.txt i wariant Markdown'
else
  zle 'Link: llms.txt i wariant Markdown' "Link: ${link:-brak}"
fi

roboty=$(naglowek x-robots-tag)
if [ "$PODGLAD" = 1 ]; then
  if ma "$roboty" noindex; then dobrze "podgląd poza indeksem (X-Robots-Tag: $roboty)"
  else zle 'podgląd poza indeksem' 'brak X-Robots-Tag: noindex — kopia serwisu może trafić do Google'; fi
else
  if ma "$roboty" noindex; then zle 'domena indeksowalna' "X-Robots-Tag: $roboty — serwis wypada z Google"
  else dobrze 'domena indeksowalna (bez noindex)'; fi
fi

kanon=$(grep -oE 'rel="canonical" href="[^"]*"' "$TMP/b" | head -1 | sed -E 's/.*href="([^"]*)"/\1/')
if [ "$kanon" = "$DOMENA/" ]; then dobrze "adres kanoniczny: $kanon"
else zle "adres kanoniczny: $DOMENA/" "jest: ${kanon:-brak}"; fi

# ── 3 ──────────────────────────────────────────────────────────────────────
sekcja '3. Wniosek'
pobierz /wniosek/
if [ "$KOD" = 200 ] && tresc_ma 'functions/v1/form-submit' && tresc_ma '0x4AAAAAADgSxo_FfjvXKO29'; then
  dobrze 'kreator ma adres form-submit i klucz Turnstile'
else
  zle 'kreator ma adres form-submit i klucz Turnstile' "$(status); w HTML-u brakuje jednego z nich"
fi
if [ -n "$(naglowek content-security-policy)" ]; then dobrze 'CSP na stronie wniosku'
else zle 'CSP na stronie wniosku' 'brak nagłówka'; fi

# Wyspa kreatora to osobny plik JS. Gdyby go nie było, strona wygląda
# normalnie, a formularz się nie pojawia.
wyspa=$(grep -oE 'component-url="/_astro/Wniosek[^"]*"' "$TMP/b" | head -1 | sed -E 's/.*="([^"]*)"/\1/')
if [ -z "$wyspa" ]; then
  zle 'wyspa kreatora w HTML-u' 'brak astro-island z komponentem Wniosek'
else
  brak=''
  for s in /awaria.js /zgody.js "$wyspa"; do
    pobierz "$s"
    if [ "$KOD" != 200 ] || ! ma "$(naglowek content-type)" javascript; then brak="$brak $s ($(status))"; fi
  done
  if [ -z "$brak" ]; then dobrze 'awaria.js, zgody.js i wyspa kreatora się wczytują'
  else zle 'skrypty strony wniosku' "nie wczytują się:$brak"; fi
fi

# ── 4 ──────────────────────────────────────────────────────────────────────
sekcja '4. Adresy starego serwisu'
przekierowanie /formularz.html /wniosek/
przekierowanie /thankyou.html /podziekowanie/
przekierowanie /blog.html /blog/
przekierowanie /index.html /
przekierowanie /sitemap.xml /sitemap-index.xml
przekierowanie /aktuariusz/ /zawody/finanse/
przekierowanie /nail-artist/ /stylistka-paznokci/
# Reguła z polską literą w źródle — przeglądarka wysyła ją zakodowaną.
przekierowanie /terapeuta-zaj%C4%99ciowy/ /terapeuta-zajeciowy/

# ── 5 ──────────────────────────────────────────────────────────────────────
sekcja '5. Nieznany adres'
pobierz /tego-adresu-nie-ma-kontrola/
if [ "$KOD" = 404 ] && tresc_ma 'Nie ma takiej strony'; then
  dobrze 'nieznany adres → 404 ze stroną błędu'
elif [ "$KOD" = 200 ]; then
  zle 'nieznany adres → 404' '200 — miękki 404, Google zaindeksuje przypadkowe adresy jako stronę główną'
else
  zle 'nieznany adres → 404' "$(status)"
fi

# ── 6 ──────────────────────────────────────────────────────────────────────
sekcja '6. Zasoby dla robotów i agentów'
typ /llms.txt text/markdown
typ /programista/llms.txt text/markdown

pobierz /robots.txt
if [ "$KOD" = 200 ] && tresc_ma "Sitemap: $DOMENA/sitemap-index.xml"; then dobrze 'robots.txt wskazuje mapę na domenie'
else zle 'robots.txt wskazuje mapę na domenie' "$(status)"; fi

pobierz /sitemap-index.xml
if [ "$KOD" = 200 ] && tresc_ma "$DOMENA/"; then dobrze 'sitemap-index.xml z adresami domeny'
else zle 'sitemap-index.xml z adresami domeny' "$(status)"; fi

pobierz /.well-known/security.txt
if [ "$KOD" = 200 ] && tresc_ma 'Contact:' && tresc_ma 'Expires:'; then
  dobrze "security.txt ($(grep -i '^Expires:' "$TMP/b" | tr -d '\r'))"
else
  zle 'security.txt z Contact i Expires' "$(status)"
fi

# ── 7 ──────────────────────────────────────────────────────────────────────
sekcja '7. Negocjacja Markdownu'
pobierz /programista/ -H 'Accept: text/markdown'
ct=$(naglowek content-type)
tokeny=$(naglowek x-markdown-tokens)
if [ "$KOD" = 200 ] && ma "$ct" text/markdown && ! tresc_ma '<html'; then
  dobrze "Accept: text/markdown → Markdown (${tokeny:-?} tokenów)"
else
  zle 'Accept: text/markdown → Markdown' "$(status), Content-Type: ${ct:-brak}"
fi
if ma "$(naglowek vary)" accept && [ -n "$tokeny" ]; then dobrze 'Vary: Accept i x-markdown-tokens'
else zle 'Vary: Accept i x-markdown-tokens' "Vary: $(naglowek vary); x-markdown-tokens: ${tokeny:-brak}"; fi
roboty=$(naglowek x-robots-tag)
if [ "$PODGLAD" = 1 ]; then
  if ma "$roboty" noindex; then dobrze 'Markdown z podglądu poza indeksem'
  else zle 'Markdown z podglądu poza indeksem' 'brak noindex'; fi
else
  # Pod tym adresem indeksowana jest wersja HTML — noindex z pliku .md
  # nie może tu przejść.
  if ma "$roboty" noindex; then zle 'wynegocjowany Markdown bez noindex' "X-Robots-Tag: $roboty — wyrzuci podstronę z indeksu"
  else dobrze 'wynegocjowany Markdown bez noindex'; fi
fi

pobierz /programista/
if ma "$(naglowek content-type)" text/html; then dobrze 'Accept: */* → HTML (przeglądarka nie dostanie Markdownu)'
else zle 'Accept: */* → HTML' "Content-Type: $(naglowek content-type)"; fi

pobierz /programista/index.md
if [ "$KOD" = 200 ] && ma "$(naglowek content-type)" text/markdown && ma "$(naglowek x-robots-tag)" noindex; then
  dobrze '/programista/index.md → Markdown z noindex'
else
  zle '/programista/index.md → Markdown z noindex' "$(status), Content-Type: $(naglowek content-type), X-Robots-Tag: $(naglowek x-robots-tag)"
fi

# ── 8 ──────────────────────────────────────────────────────────────────────
sekcja '8. Dokumenty OWU (klucz serwisowy w projekcie Pages)'
pobierz /owu-adresy.json
wpis=$(grep -oE '"[a-z0-9-]+":\{"id":"[0-9a-f-]{36}"' "$TMP/b" | head -1)
slug=$(printf '%s' "$wpis" | sed -E 's/^"([^"]+)".*/\1/')
id=$(printf '%s' "$wpis" | sed -E 's/.*"id":"([^"]+)"$/\1/')
if [ -z "$slug" ]; then
  zle '/owu-adresy.json' "$(status) — bez mapy /owu/ nie poda żadnego pliku"
else
  pobierz "/owu/$slug.pdf"
  ct=$(naglowek content-type)
  if [ "$KOD" = 200 ] && ma "$ct" application/pdf && ma "$(naglowek content-disposition)" inline \
    && [ "$(head -c 4 "$TMP/b")" = '%PDF' ]; then
    dobrze "/owu/$slug.pdf → PDF, $(wc -c <"$TMP/b" | tr -d ' ') B, inline"
  else
    case $KOD in
      503) powod='503: brak SUPABASE_SERVICE_ROLE_KEY — albo wdrożenie jest starsze niż sekret (zmienne działają od następnego wdrożenia: Deployments → Retry deployment)' ;;
      404) powod='404: dokument wycofany w bibliotece OWU albo mapa z builda nieaktualna' ;;
      502) powod='502: klucz jest, ale kubełek nie oddał pliku — zły klucz albo brak obiektu' ;;
      *)   powod="$(status), Content-Type: ${ct:-brak}" ;;
    esac
    zle "/owu/$slug.pdf → PDF" "$powod"
  fi
  przekierowanie "/pobierz/$id" "/owu/$slug.pdf"
fi

# ── 9 ──────────────────────────────────────────────────────────────────────
sekcja '9. Sekret Turnstile w projekcie Pages (/wspolpraca)'
pobierz /wspolpraca -X POST -H 'Content-Type: application/json' \
  --data '{"name":"Kontrola wdrozenia","email":"kontrola@example.com","phone":"500000000","rodo_consent":true}'
if [ "$KOD" = 400 ] && tresc_ma 'Weryfikacja'; then
  dobrze 'sekret jest — zgłoszenie bez tokenu odrzucone na weryfikacji, nic nie wysłano'
elif [ "$KOD" = 503 ]; then
  zle 'TURNSTILE_SECRET_KEY w projekcie Pages' '503: brak sekretu — albo wdrożenie jest starsze niż sekret (Deployments → Retry deployment)'
else
  zle 'TURNSTILE_SECRET_KEY w projekcie Pages' "$(status): $(head -c 200 "$TMP/b")"
fi

# ── 10 ─────────────────────────────────────────────────────────────────────
if [ "$PODGLAD" = 0 ]; then
  sekcja '10. Domena'
  pobierz "http://$HOST/"
  dokad=$(naglowek location)
  if [[ $KOD == 30[1278] && $dokad == "https://$HOST/"* ]]; then dobrze "http → https ($KOD)"
  else zle 'http → https' "$(status)${dokad:+ → $dokad}"; fi

  case $HOST in
    www.*) ;;
    *)
      pobierz "https://www.$HOST/"
      dokad=$(naglowek location)
      if [[ $KOD == 30[18] && $dokad == "https://$HOST/"* ]]; then
        dobrze "www → $HOST ($KOD)"
      elif [ "$KOD" = 200 ]; then
        zle "www → $HOST" '200 — www podaje drugą kopię serwisu zamiast przekierowania'
      else
        zle "www → $HOST (stałe)" "$(status)${dokad:+ → $dokad}"
      fi
      ;;
  esac
else
  sekcja '10. Domena dziś (informacyjnie — stoi tam jeszcze stary serwis)'
  for u in "$DOMENA/" "https://www.utratadochodu.pl/" "http://utratadochodu.pl/"; do
    pobierz "$u"
    dokad=$(naglowek location)
    info "$u → $(status)${dokad:+ → $dokad}"
  done
fi

printf '\nWynik: OK %d, BŁĄD %d\n' "$OK" "$BLEDY"
[ "$BLEDY" -eq 0 ]
