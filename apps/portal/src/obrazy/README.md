# Zdjęcia portalu

Nazwa pliku to slug adresu, który ma go pokazać. Rozszerzenie nie ma znaczenia —
`jpg`, `jpeg`, `png` i `webp` działają tak samo, bo zestaw powstaje w różnych
narzędziach. Do przeglądarki i tak leci WebP.

| Gdzie | Nazwa | Widać na |
|---|---|---|
| `kategorie/` | slug kategorii, np. `budownictwo.jpg` | `/zawody/<slug>/`, kafelki na stronie głównej, oraz `/<zawód>/` gdy zawód nie ma własnego |
| `zawody/` | slug zawodu, np. `chirurg.jpg` | `/<slug>/` |
| `hero.jpg` (tu, obok tego pliku) | — | pas na stronie głównej |

Pliki idą do `src/`, **nigdy do `public/`**. Tylko `src/` przechodzi przez
optymalizację; z `public/` plik leci do przeglądarki taki, jaki jest, a jedno
zdjęcie z Artlista waży kilka megabajtów.

Ten sam slug w dwóch formatach naraz to błąd — `obrazy.ts` wybrałby jeden po
kolejności rozszerzeń, więc nie dałoby się przewidzieć który. Test to wyłapuje.

Katalog zawodów można uzupełniać po jednym pliku: zawód bez własnego zdjęcia
bierze zdjęcie swojej kategorii, więc nie ma etapu, w którym część podstron
stoi pusta.

## Kadr

Nagłówek leży **na zdjęciu**, nie pod nim. Kadruj z zapasem nad i pod
bohaterem, a lewą tercję zostaw spokojną — tam stoi tekst. Proporcje 21:9,
2K wystarczy.

Reszta — kontrasty zasłony, czego nie ruszać bez przeliczenia — w `CLAUDE.md`,
sekcja „Zdjęcia — nazwa pliku to slug adresu, który ma je pokazać".
