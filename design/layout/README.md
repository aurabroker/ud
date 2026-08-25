# Layout — pliki źródłowe kanwy projektowej

Artboardy w formacie Design Components (`.dc.html`) + manifest `canvas.json`.
Z nich składana jest kanwa projektowa; edycja = zmiana tych plików i ponowne złożenie.

| Plik | Co przedstawia |
|---|---|
| `Main.dc.html` | Strona główna, 1440 px |
| `Wniosek.dc.html` | Wniosek ubezpieczeniowy, cztery kroki, 1440 px |
| `Zawod.dc.html` | Strona zawodowa (lekarz), 1440 px |
| `Mobile.dc.html` | Widok mobilny, 390 px |
| `System.dc.html` | System wizualny: paleta, znak, ikony, typografia, przyciski, fotografia |
| `canvas.json` | Rozmieszczenie artboardów i notatki |

## Wniosek — kolejność kroków

W oryginale ankieta medyczna była przed wyborem sum. To błąd: ankietę
rozszerzoną wyzwala **suma trwałej niezdolności powyżej 1 000 000 zł**
(`HEALTH_SURVEY_THRESHOLD` w `healthSurvey.js`), więc wyzwalacz przychodził
po ankiecie. W nowym układzie:

1. Dane podstawowe — dane osobowe, PESEL, forma zatrudnienia, zawód, parametry, szczegóły działalności
2. **Zakres ochrony** — ryzyka, sumy, klauzule NW, styl życia
3. **Stan zdrowia** — 7 pytań podstawowych, a powyżej progu dodatkowo ankieta rozszerzona (20 pytań w 3 grupach)
4. Zgody i kontakt — klauzula informacyjna, zgody, e-mail, telefon

Na kanwie wszystkie kroki są rozwinięte jeden pod drugim, żeby dało się je
przejrzeć naraz. W aplikacji widoczny jest tylko jeden.

## Reguły biznesowe sterujące interfejsem

**Limit świadczenia zależy od formy zatrudnienia:**

| Forma | Limit | Przykład dla 18 000 zł |
|---|---|---|
| B2B / JDG | 80% dochodu | 14 400 zł |
| Umowa o pracę | 65% dochodu | 11 700 zł |

Wybór w kroku 1 wniosku ustawia górny zakres suwaka kwoty miesięcznej w kroku 2
oraz wynik kalkulatora na stronie głównej i mobile. **Żaden tekst na stronie
nie może mówić „do 80%" bez zastrzeżenia.**

**Próg ankiety rozszerzonej:** suma trwałej niezdolności powyżej
`1 000 000 zł` (`HEALTH_SURVEY_THRESHOLD` w `healthSurvey.js`) dokłada
w kroku 3 ankietę rozszerzoną — 20 pytań w trzech grupach.

## Kolorystyka

Jasny cyjan wzięty z zestawu ikon Klienta (2026-08-25). Zasada nadrzędna:
**ciemny zostaje wyłącznie tekst** — żadnych czarnych sekcji.

| Token | Hex | Zastosowanie |
|---|---|---|
| Cyjan marki | `#1BAEE5` | znak, pasek zaufania, akcenty |
| Cyjan głębszy | `#0E96D0` | przyciski, linki, etykiety |
| Błękit jasny | `#A6DFF7` | fasety ikon, podkreślenia |
| Biel z cyjanem | `#F4FBFE` | tło co drugiej sekcji, stopka |
| Granat tekstu | `#0F2E40` | wyłącznie pismo |
| Linia | `#D3E9F4` | ramki, separatory |

## Znak i ikony

Fasetowana litera U oraz pięć ikon (dokument z %, teczka, ludzie, rozeta,
koło zębate) narysowane jako wielokąty SVG w kilku odcieniach cyjanu.

**To odrysy z podglądów rastrowych przysłanych przez Klienta.**
Oryginalne pliki SVG wgrać do `design/brand/` i podmienić odrysy —
wtedy znak będzie zgodny co do współrzędnej.

## Style kit w Artlist

Nazwa: **UtrataDochodu.pl** · `4d4ba388-e7f8-4409-8487-ea36b34d5099`

Zawiera paletę marki i trzy wytyczne tekstowe: temat i kadr, światło i kolor,
czego unikać. Wszystkie generacje zdjęć mają przechodzić przez ten kit —
bez niego kadry rozjeżdżają się stylistycznie.

Kierunek zdjęć: **wysoki klucz**. Dużo dziennego światła, jasne wnętrza,
otwarte cienie, chłodna tonacja w stronę błękitu. Najciemniejszy ton w kadrze
to miękka szarość, nigdy czerń.

Zatwierdzona próbka (2026-08-25, Seedream 5.0 Pro, 16:9): lekarz z tabletem
w jasnym gabinecie, okno po lewej, cała lewa połowa kadru wolna pod nagłówek.

Wcześniejsza, ciemna wersja kierunku została odrzucona przez Klienta.

## Wartości w nawiasach kwadratowych

`[STAWKA]`, `[KWOTA ZUS]`, `[OPINIA KLIENTA]` czekają na dane od Aury Expert —
stawki z tabel ubezpieczycieli, kwota zasiłku przy minimalnej podstawie ZUS
i realne opinie klientów. Nie są wymyślone celowo.
