# Diagnostyka śledzenia konwersji Google Ads — utratadochodu.pl

Data analizy: 2026-09-09
Zakres: dlaczego cel „Przesłanie formularza kontaktowego” (AW-18020137303) przestał
rejestrować konwersje po 09.06.2026 i dlaczego cel „Prośba o wycenę” (import z GA4)
nie zarejestrował ich nigdy.

**Status: diagnoza. Żadna zmiana w kodzie produkcyjnym nie została wykonana.**

---

## (a) Podsumowanie — co się zepsuło i kiedy

### Jak w ogóle działa konwersja na tej stronie

Konwersja nie jest wysyłana z formularza. Jest wysyłana przez odsłonę strony
podziękowania:

```
wysłanie wniosku → style.js: showSuccessModal() → window.location.href = '/thankyou.html'
                 → thankyou.html:86 → gtag('event', 'conversion', {send_to: 'AW-18020137303/_uZeCOTG_KwcENfy1ZBD'})
```

Cały mechanizm ma jeden punkt wejścia: `style.js` → `initFormSubmit()` → formularz
o `id="insurance-form"`. Ten sam plik `style.js` obsługuje **dwie strony**:
`index.html` (linia 1307) oraz `formularz.html`.

Krótki formularz („Zostaw kontakt — oddzwonimy!”) nie uczestniczy w tym przepływie
w ogóle — nie przekierowuje i nie wysyła żadnego zdarzenia. Szczegóły w punkcie (b).

### Przyczyna źródłowa: commit 67f66ee z 2026-06-07

```
67f66ee | 2026-06-07 16:13:50 +0000 | Dodaj Cloudflare Turnstile do formularza ubezpieczeniowego
```

Commit dodał do `style.js` twardą bramkę przed wysyłką:

```js
const turnstileToken = form.querySelector('[name="cf-turnstile-response"]')?.value;
if (!turnstileToken) {
  showErrorModal('Proszę potwierdzić, że nie jesteś robotem.');
  return;                      // ← wyjście z handlera, brak wysyłki i brak redirectu
}
```

Widget Turnstile ten sam commit dodał **wyłącznie do `formularz.html`**. Plik
`index.html` — czyli strona docelowa kampanii — dostał widget dopiero osiem dni
później, w commicie `3cf32e8` z 15.06.

Skutek: od 07.06 na stronie głównej `form.querySelector('[name="cf-turnstile-response"]')`
zwraca `null`, bramka przerywa obsługę zdarzenia, `fetch` do Edge Function nigdy nie
leci, `window.location.href = '/thankyou.html'` nigdy się nie wykonuje, event
konwersji nigdy nie odpala. Każda próba wysłania wniosku ze strony głównej kończy się
modalem „Proszę potwierdzić, że nie jesteś robotem” przy braku jakiegokolwiek widgetu
do potwierdzenia — użytkownik nie ma jak przejść dalej.

To jest zgodne z danymi z Google Ads: deploy 07.06 wieczorem, ostatnie konwersje
09.06, potem zero.

### Dlaczego naprawa z 15.06 nie pomogła

```
3cf32e8 | 2026-06-15 10:01:04 +0000 | Dodaj widget Turnstile do formularza wniosek na stronie głównej
```

Widget trafił do `index.html`, ale polityka CSP w `<meta>` na tej stronie w tamtym
momencie wyglądała tak:

```
script-src 'self' 'unsafe-inline' https://unpkg.com https://www.googletagmanager.com
           https://www.google-analytics.com https://static.cloudflareinsights.com
(brak dyrektywy frame-src → dziedziczy default-src 'self')
```

Brak `https://challenges.cloudflare.com` w `script-src` i brak `frame-src` oznacza,
że przeglądarka zablokowała zarówno `turnstile/v0/api.js`, jak i ramkę widgetu.
Przeglądarka egzekwuje część wspólną polityki z `<meta>` i z nagłówka `_headers` —
nagłówek miał już wtedy `challenges.cloudflare.com` (dodane w `600c0dc`), ale węższa
polityka z `<meta>` i tak wygrywała.

Efekt: widget się nie renderuje → ukryte pole `cf-turnstile-response` nie powstaje →
bramka z 07.06 nadal przerywa każdą wysyłkę. Formularz na stronie głównej pozostał
martwy.

Ten sam commit-brat `5c0a50e` dodał Turnstile do krótkiego formularza, co uśmierciło
również jego — to jest awaria już opisana w `CLAUDE.md` jako „martwy od 15.06.2026 do
09.09.2026”. Obie awarie mają wspólną przyczynę: widget Turnstile zablokowany przez
CSP na `index.html`.

### Dlaczego `formularz.html` przetrwał, a strona główna nie

`formularz.html` nie ma polityki w `<meta>` (`grep -c "Content-Security-Policy"
formularz.html` → 0). Obowiązuje ją wyłącznie nagłówek z `_headers`, do którego
`challenges.cloudflare.com` trafił 07.06 o 16:54 w commicie `600c0dc` — 40 minut po
wprowadzeniu bramki. Ta ścieżka najprawdopodobniej działała dalej i to ona
odpowiada za ostatnią konwersję z 09.06. Ruch z reklam idzie jednak głównie na
`index.html`, gdzie ścieżka była zerwana.

### Kiedy CSP zostało naprawione

```
340381e | 2026-08-24 14:05:53 +0000 | Naprawa blokad CSP formularza i martwych zasobów
```

Ujednolicił `<meta>` z `_headers`; `challenges.cloudflare.com` jest od tego momentu
w `script-src`, `frame-src` i `connect-src` w obu miejscach. Od 24.08 widget na
`index.html` powinien się renderować.

### Czego NIE da się ustalić z kodu

Zero konwersji między 24.08 (naprawa CSP) a 09.09 nie ma wytłumaczenia w repozytorium.
Nie zakładam przyczyny. Możliwości do sprawdzenia poza kodem:

- niski wolumen — pełny wniosek to 6-krokowy kreator z pytaniami medycznymi;
  16 dni przy ówczesnym ruchu może nie wystarczyć na jedną wysyłkę,
- krótki formularz — czyli ta ścieżka, którą realnie wybiera ruch z reklam — był
  martwy aż do dzisiejszego commita `22ba46c` i **nadal nie ma żadnego śledzenia**,
- stan samego celu konwersji po stronie Google Ads (długa nieaktywność) — to jest
  do zweryfikowania w panelu, nie w repo.

Do potwierdzenia w panelu Google Ads: czy w oknie 24.08–09.09 były w ogóle odsłony
`/thankyou.html` w GA4. Jeśli były, a konwersji nie ma, problem leży po stronie
konfiguracji celu, nie kodu.

### Ryzyko wtórne (niepotwierdzone, do weryfikacji w przeglądarce)

Token Turnstile wygasa po ok. 5 minutach. Widget renderuje się przy załadowaniu
strony, a użytkownik przechodzi potem 6 kroków z pytaniami medycznymi. Jeżeli
przekroczy 5 minut, token zostanie wyczyszczony i bramka z `style.js` odrzuci
wysyłkę tym samym komunikatem. W kodzie nie ma `data-expired-callback` ani obsługi
odświeżenia tokenu (`grep` po `data-expired` / `refresh-expired` → 0 trafień).
Nie mam dowodu, że to występuje na produkcji — wymaga testu w przeglądarce.

---

## (b) Czy istnieje zdarzenie GA4 dla krótkiego formularza („Prośba o wycenę”)

**Nie. Nie istnieje. W repozytorium nie ma ani jednej linijki, która wysyłałaby
zdarzenie GA4 lub konwersję Google Ads przy wysyłce krótkiego formularza.**

Dowód — pełne wyszukanie wywołań zdarzeń w plikach źródłowych:

```
awaria.js:191      window.gtag('event', nazwa, { kod_bledu: ... })   ← telemetria błędów
cookie-consent.js:16  window.gtag = function () { window.dataLayer.push(arguments); }  ← definicja
thankyou.html:86   gtag('event', 'conversion', {send_to: 'AW-18020137303/...'})
```

To wszystko. Żadnego `gtag('event', 'generate_lead')`, żadnego `dataLayer.push`
z nazwą zdarzenia, żadnego zdarzenia typu `request_quote` / `wycena` / `lead`.

Ścieżka sukcesu krótkiego formularza (`app.js`, `initQuickForm`) kończy się tak:

```js
if (res.ok && wynik.status === 'success') {
  form.classList.add('hidden');
  document.getElementById('quick-success').classList.remove('hidden');   // „Dziękujemy! Oddzwonimy wkrótce.”
}
```

Brak przekierowania, brak `gtag`, brak `dataLayer`. Cel „Prośba o wycenę”
(REQUEST_QUOTE, import z GA4) nie ma źródła zdarzenia i nie mógł zarejestrować
konwersji w żadnym momencie historii — niezależnie od awarii formularza.

### Dodatkowo: GA4 nie widzi strony konwersji

- `G-MGB0RBTCC9` (GA4) jest skonfigurowany **wyłącznie w `index.html`**.
- `formularz.html` ma tylko `gtag('config', 'AW-18020137303')` — bez GA4.
- `thankyou.html` ma tylko `AW-18020137303` — **bez GA4**.
- Podstrony zawodów mają tylko `AW-18020137303`.

Nawet gdyby zdarzenie GA4 istniało, odsłona `/thankyou.html` nie trafia do GA4,
bo na tej stronie nie ma property GA4.

### Niespójność ID GA4

`cookie-consent.js:6` deklaruje `const GA4_ID = 'G-D9XHPWP5DE'` — inny identyfikator
niż `G-MGB0RBTCC9` w `index.html`. Dodatkowo `loadGA4()` zaczyna się od:

```js
if (document.querySelector('script[src*="googletagmanager"]')) return;
```

a `index.html` ma skrypt googletagmanager już w `<head>`, więc `loadGA4()` zawsze
wychodzi natychmiast. `cookie-consent.js` jest w praktyce martwym kodem w części
dotyczącej ładowania GA4. To nie jest przyczyna awarii konwersji, ale jest to
niespójność do uporządkowania.

---

## (3) Consent Mode / baner cookies — wykluczone jako przyczyna

Wyszukanie w całym repozytorium:

```
grep -rn "gtag('consent'\|ad_storage\|analytics_storage" --include=*.js --include=*.html --include=*.py .
→ 0 trafień
```

**Google Consent Mode nie jest w ogóle zaimplementowany.** Nie ma `gtag('consent',
'default', ...)` ani `gtag('consent', 'update', ...)`, nie ma `ad_storage` ani
`analytics_storage`. Baner z `cookie-consent.js` nie steruje tagiem Google Ads
w żaden sposób — tag `AW-18020137303` jest wpisany na stałe w `<head>` każdej strony
i odpala się bezwarunkowo, niezależnie od decyzji użytkownika w banerze.

Logika banera nie zmieniała się w czerwcu — `cookie-consent.js` ostatnio dotknięty
w `abf3d4e` z 2026-05-14, czyli przed pierwszymi zarejestrowanymi konwersjami.

Wniosek: **Consent Mode nie jest przyczyną spadku konwersji.** Brak Consent Mode
jest natomiast osobnym problemem zgodności (RODO oraz wymóg Google dla EOG) i temat
wraca w propozycji poprawki jako pozycja niskiego priorytetu, do decyzji biznesowej.

---

## (4) Czy tagi odpalają się w momencie realnego sukcesu

| Formularz | Moment sukcesu | Co się wykonuje | Ocena |
|---|---|---|---|
| Pełny wniosek (`insurance-form`, `style.js`) | `mainRes.status === 'success'` po odpowiedzi z `form-submit` | `window.location.href = '/thankyou.html'` → event konwersji przy odsłonie | Poprawnie. Tag jest po stronie serwerowej odpowiedzi, nie przy kliknięciu |
| Krótki kontakt (`quick-form`, `app.js`) | `res.ok && wynik.status === 'success'` | pokazanie `#quick-success` | Brak jakiegokolwiek tagu |

Sprawdzone jawnie: **tag nie odpala się w złym miejscu.** Nie ma go ani na
`submit`, ani w gałęzi błędu, ani w `finally`. Ścieżki błędu krótkiego formularza
(`SZYBKI_KONTAKT_ODPOWIEDZ`, `SZYBKI_KONTAKT_SIEC`) oraz wniosku
(`WNIOSEK_ODRZUCONY`, `WNIOSEK_SIEC`) prowadzą wyłącznie do modala awarii. Nie ma
ryzyka fałszywych konwersji. Problem jest odwrotny: brakuje wywołania tam, gdzie
powinno być.

---

## (c) Propozycja poprawki — DO AKCEPTACJI, jeszcze nie wdrożona

### P1. Zdarzenie konwersji dla krótkiego formularza

Najważniejsza zmiana. Krótki formularz to główna ścieżka konwersji z reklam i nie ma
żadnego śledzenia.

W `app.js`, w gałęzi sukcesu `initQuickForm` — dokładnie tam, gdzie pokazujemy
„Dziękujemy! Oddzwonimy wkrótce.”, i nigdzie indziej:

```js
if (res.ok && wynik.status === 'success') {
  form.classList.add('hidden');
  document.getElementById('quick-success').classList.remove('hidden');

  // Google Ads — konwersja
  if (typeof gtag === 'function') {
    gtag('event', 'conversion', { send_to: 'AW-18020137303/<ETYKIETA_SZYBKI_KONTAKT>' });
    // GA4 — źródło importu dla celu „Prośba o wycenę”
    gtag('event', 'generate_lead', { form_type: 'szybki_kontakt', value: 0, currency: 'PLN' });
  }
}
```

**Potrzebuję od Ciebie dwóch decyzji:**

1. Czy krótki kontakt ma raportować się na **ten sam** cel („Przesłanie formularza
   kontaktowego”, etykieta `_uZeCOTG_KwcENfy1ZBD`), czy na **osobny** cel? Zalecam
   osobny — inaczej nie odróżnisz w raportach leada telefonicznego od pełnego
   wniosku z wywiadem medycznym, a mają zupełnie inną wartość. Osobny cel wymaga
   wygenerowania nowej etykiety w panelu Google Ads.
2. Jaką nazwę zdarzenia GA4 oczekuje cel „Prośba o wycenę”? Cel jest już
   skonfigurowany w GA4 jako zdarzenie niestandardowe — nazwa w kodzie musi się
   z nim zgadzać co do znaku. Jeśli nie ma preferencji, proponuję standardowe
   `generate_lead`, ale wtedy trzeba przepiąć cel w GA4 na tę nazwę.

### P2. GA4 na stronach konwersji

`thankyou.html` i `formularz.html` mają tylko tag Google Ads, bez GA4. Dopisać
`gtag('config', 'G-MGB0RBTCC9')` do bloku gtag na obu stronach, żeby GA4 w ogóle
widziało domknięcie ścieżki. Bez tego cele importowane z GA4 nie mają szans zadziałać
dla pełnego wniosku.

### P3. Zabezpieczenie przed powtórką awarii z 07.06

Bramka Turnstile w `style.js` cicho przerywa wysyłkę, gdy widgetu nie ma na stronie.
To właśnie zamieniło literówkę konfiguracyjną w trzymiesięczny brak leadów.
Proponuję rozróżnić dwa przypadki:

- widget jest na stronie, ale użytkownik go nie rozwiązał → obecny komunikat,
- widgetu **nie ma w DOM w ogóle** (`form.querySelector('.cf-turnstile') === null`)
  → to awaria konfiguracji, nie użytkownika: zgłosić przez `Awaria.pokaz()`
  z własnym kodem, np. `TURNSTILE_BRAK_WIDGETU`. Wtedy taki błąd trafia do tabeli
  `ud_errors` i widać go od razu, zamiast czekać trzy miesiące na raport z Google Ads.

### P4. Obsługa wygaśnięcia tokenu w kreatorze (do weryfikacji w przeglądarce)

Jeśli test potwierdzi ryzyko z sekcji „Ryzyko wtórne”: dodać do widgetu we wniosku
`data-expired-callback` odświeżający token, albo renderować widget dopiero przy
wejściu na ostatni krok kreatora (`updateWizardUI` już wie, kiedy to następuje).

### P5. Consent Mode (niski priorytet, decyzja biznesowa)

Strona zbiera dane medyczne i deklaruje w banerze, że analityka rusza dopiero po
zgodzie — a tag Google Ads odpala się bezwarunkowo. To rozjazd między deklaracją
a implementacją. Wdrożenie Consent Mode v2 uporządkuje to, ale **zmieni wolumen
raportowanych konwersji** (część użytkowników odrzuci zgodę), więc nie proponuję
tego robić w jednej paczce z naprawą śledzenia. Najpierw przywrócić pomiar, potem
osobno zdecydować o zgodach.

### Kolejność wdrożenia

1. P1 — po Twojej decyzji o etykiecie i nazwie zdarzenia. Odblokowuje oba martwe cele.
2. P2 — bez zależności, można od razu.
3. P3 — bez zależności, chroni przed powtórką.
4. P4 — dopiero po teście w przeglądarce potwierdzającym problem.
5. P5 — osobno, jako decyzja biznesowa.

---

## Załącznik: oś czasu z commitów

| Data | Commit | Zdarzenie | Wpływ na konwersje |
|---|---|---|---|
| 2026-05-15 | `bc92717` | Global tag AW na wszystkich stronach | start pomiaru |
| 2026-05-16 | `e90790d` | Redirect na `/thankyou.html` po wysłaniu | konwersje działają |
| 24, 26, 30.05 | — | konwersje zarejestrowane | OK |
| 2026-06-07 16:13 | `67f66ee` | Bramka Turnstile w `style.js`, widget tylko w `formularz.html` | **strona główna zerwana** |
| 2026-06-07 16:54 | `600c0dc` | `challenges.cloudflare.com` do CSP w `_headers` | `formularz.html` odblokowany |
| 2026-06-09 | — | ostatnia konwersja | prawdopodobnie z `formularz.html` |
| 2026-06-15 09:52 | `5c0a50e` | Turnstile w krótkim formularzu (`index.html`) | krótki formularz zerwany |
| 2026-06-15 10:01 | `3cf32e8` | Turnstile we wniosku na `index.html` | nadal blokowany przez CSP w `<meta>` |
| 2026-08-24 | `340381e` | Ujednolicenie CSP `<meta>` z `_headers` | widget odblokowany |
| 2026-09-09 | `22ba46c` | Krótki kontakt przez Edge Function | wysyłka naprawiona, śledzenia nadal brak |
