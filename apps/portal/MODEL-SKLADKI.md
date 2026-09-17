# Model szacowania składki — kalibracja na ofertach z bazy

Stan na 2026-09-17. Źródło: `ud_offer_documents` w projekcie Supabase
`kukvgsjrmrqtzhkszzum` — 48 wariantów z 15 ofert, jeden ubezpieczyciel
(Leadenhall), produkty LW044 i LW047/MEDICARE.

Dokument opisuje, skąd biorą się liczby w `src/lib/symulacja.ts`. Bez niego
każda z nich jest umowna, a to jest dokładnie ten zarzut, który postawił klient
stawce 1,5%.

## Co w danych jest, a czego nie ma

| Parametr | Pokrycie | Nadaje się do modelu |
|---|---|---|
| składka roczna i miesięczna | 48 / 48 | tak |
| miesięczne świadczenie | 48 / 48 | tak |
| okres wypłaty | 48 / 48 — ale **tylko 24 i 36 miesięcy** | tak, dla tych dwóch |
| karencja (NW / choroba) | 48 / 48 | tak |
| trwała niezdolność, śmierć | 48 / 48 | tak, jako filtr |
| zawód | 48 / 48 — 14 różnych | nie, zbyt rzadkie |
| klasa ryzyka | 16 / 48 — tylko LW044 | **nie** (patrz niżej) |
| wiek (z PESEL-u klienta) | 48 / 48, zakres 26–43 lat | **nie** (patrz niżej) |
| forma zatrudnienia | 48 / 48 — wszyscy B2B | nie, zero zmienności |
| dochód, data urodzenia w dokumencie | 0 / 48 | nie |

## Co dane potwierdzają

### 1. Składka jest wprost proporcjonalna do świadczenia

Dwa zawody wystąpiły z dwiema sumami przy identycznej reszcie parametrów:

| Zawód | 1. suma | 2. suma | stawka 1. | stawka 2. |
|---|---|---|---|---|
| Elektryk | 10 000 zł | 12 000 zł | 2,120% | 2,117% |
| Kierowca | 6 000 zł | 8 000 zł | 2,333% | 2,338% |

Różnica poniżej pół procenta. Kształt wzoru `składka = świadczenie × stawka`
jest więc poprawny — zmiany wymaga sama stawka.

### 2. Stawka za samą niezdolność okresową to około 2,2%, nie 1,5%

Dziesięć wariantów bez trwałej niezdolności i bez śmierci, płatnych w 12 ratach
(stawka = składka roczna / (świadczenie × 12)):

| Zawód | Świadczenie | Karencja | Składka mies. | Stawka |
|---|---|---|---|---|
| Kosmetolog | 5 000 | 14/21 | 101 zł | 2,020% |
| Kosmetyczka | 5 000 | 14/21 | 102 zł | 2,040% |
| Ratownik medyczny | 12 000 | 14/21 | 253 zł | 2,108% |
| Elektryk | 12 000 | 21/21 | 254 zł | 2,117% |
| Elektryk | 10 000 | 21/21 | 212 zł | 2,120% |
| Kosmetolog | 15 000 | 14/21 | 326 zł | 2,173% |
| Kierowca | 6 000 | 14/21 | 140 zł | 2,333% |
| Kierowca | 8 000 | 14/21 | 187 zł | 2,338% |
| Pielęgniarka | 15 000 | 14/21 | 356 zł | 2,373% |
| Pielęgniarka | 15 000 | 14/21 | 366 zł | 2,440% |

Mediana 2,147%, średnia 2,206%, rozrzut 2,02–2,44%.

**Stawka 1,5% z `symulacja.ts` leży poniżej najniższej zaobserwowanej oferty.**
Przy świadczeniu 14 400 zł serwis pokazuje 216 zł; najtańsza obserwacja daje
291 zł, najdroższa 351 zł.

### 3. Wydłużenie wypłaty z 24 do 36 miesięcy to około +25%

Sześć par z tej samej oferty, identycznych we wszystkim poza okresem wypłaty
(bez trwałej niezdolności, bez śmierci, 12 rat):

| Zawód | Świadczenie | 24 mies. | 36 mies. | Mnożnik |
|---|---|---|---|---|
| Kosmetolog | 5 000 | 1 212 zł | 1 500 zł | 1,2376 |
| Pielęgniarka | 15 000 | 4 392 zł | 5 460 zł | 1,2432 |
| Elektryk | 10 000 | 2 544 zł | 3 168 zł | 1,2453 |
| Ratownik medyczny | 12 000 | 3 036 zł | 3 792 zł | 1,2490 |
| Kosmetyczka | 5 000 | 1 224 zł | 1 536 zł | 1,2549 |
| Pielęgniarka | 15 000 | 4 272 zł | 5 460 zł | 1,2781 |

Mediana 1,2471, rozrzut 1,2376–1,2781. **Mnożnik 1,25.**

Warianty z dorzuconą trwałą niezdolnością dają mnożnik niższy (1,13–1,21),
bo część składki za trwałą niezdolność nie zależy od okresu wypłaty. To
potwierdza mechanizm, a przy okazji tłumaczy, czemu mnożnik liczymy wyłącznie
na wariantach bez dodatków.

### 4. Rozłożenie na raty kosztuje 10%

Dziewięć par „ta sama ochrona, raz jednorazowo, raz w 12 ratach": średnio
**1,1012**. Opłata dystrybucyjna (`distribution_fee`) to 8,6–9,1% składki
całkowitej, czyli jest już w `premium_total` — klient płaci tyle, ile stoi
w tej kolumnie.

### 5. Karencja zmienia składkę mocniej niż cokolwiek innego

Ten sam klient, to samo świadczenie 15 000 zł, 24 miesiące, bez dodatków:
karencja 14/21 dni → 3 564 zł rocznie, karencja 60/60 dni → 2 497 zł.
**Dłuższa karencja jest o 30% tańsza.** Kalkulator nie pyta o karencję i tego
nie zmieniamy — ale to znaczy, że jego wynik dotyczy wariantu najkrótszej
karencji, czyli najdroższego.

## Czego z tych danych policzyć się NIE da

### Klasy ryzyka

Klasa jest wypełniona w 16 wierszach na 48 (tylko LW044; MEDICARE jej nie ma).
Po odfiltrowaniu wariantów z trwałą niezdolnością zostają dwie klasy:

- klasa II (Kierowca): 2,333% i 2,338%, karencja 14/21
- klasa III (Elektryk): 2,117% i 2,120%, karencja **21/21**

Klasa III wychodzi tańsza od klasy II, co jest odwrotnie, niż powinno być —
bo różni je też karencja, a ta waży więcej niż klasa. Zostają dwie obserwacje
na klasę, każda od jednej osoby. **Współczynnika klasy z tego nie policzymy.**
Klasy I i IV występują wyłącznie w wariantach z trwałą niezdolnością albo
śmiercią, więc nie da się ich porównać z resztą.

### Wiek

Wiek daje się odtworzyć z PESEL-u klienta dla wszystkich 48 wierszy, ale:

- zakres to 26–43 lata, a serwis kieruje ofertę także do osób po pięćdziesiątce,
- **każdy wiek występuje z innym zawodem** — 14 osób, 14 zawodów. Wiek i zawód
  są w tych danych nierozróżnialne; to, co przypiszemy wiekowi, mogło być
  zawodem, i odwrotnie.

W realnym taryfikowaniu utraty dochodu wiek jest czynnikiem numer jeden.
Model, który go pomija, jest szacunkiem rzędu wielkości i niczym więcej — i tak
musi być opisany na stronie.

### Okresy 48 i 60 miesięcy

**Zero obserwacji.** W bazie są wyłącznie warianty 24- i 36-miesięczne.
Mnożnik dla 48 i 60 nie jest czymś, co można wyliczyć — trzeba go dostać
z tabeli ubezpieczyciela. Ekstrapolacja liniowa z jednego punktu (1,25 na 36)
dałaby 1,50 i 1,75, ale to byłoby zgadywanie udające rachunek.

## Model, który z tego wynika

```
świadczenie = dochód × limit                 (0,80 B2B, 0,65 etat)
składka     = świadczenie × stawka × mnożnik_okresu

stawka          = 0,022          ± 10% (rozrzut w danych: 0,0202–0,0244)
mnożnik_okresu  = 1,00  dla 24 miesięcy
                = 1,25  dla 36 miesięcy
                = brak danych dla 48 i 60
```

Zakres ważności: niezdolność okresowa bez trwałej niezdolności i bez śmierci,
B2B, wiek 26–43, karencja 14–21 dni, składka w 12 ratach, Leadenhall.

Sprawdzenie na wszystkich 16 czystych obserwacjach (10 × 24 mies., 6 × 36):
największy błąd **+10,0%**, najmniejszy **+0,4%**, wszystkie w przedziale
od −9,8% do +10,0%. Stąd `± 10%` przy stawce — to nie jest ostrożnościowy
margines dopisany na oko, tylko zmierzony rozrzut modelu.

### Klauzula HIV/WZW

W tych danych jej nie ma. Relacja 1,8% / 1,5% = **×1,2** pochodzi ze starego
`Calculator.js` i nie została niczym potwierdzona. Jeśli zostaje, to jako
mnożnik 1,2 nałożony na nową stawkę bazową — ale trzeba to zweryfikować
w tabeli, zanim ktoś się na tej liczbie oprze.

## Jak tę kalibrację powtórzyć

Zapytania, którymi policzone są tabele wyżej, są w historii sesji; każde
sprowadza się do tego samego filtru:

```sql
where coalesce(perm_incapacity_covered,false)=false
  and coalesce(perm_sum_insured,0)=0
  and coalesce(death_covered,false)=false
  and installments = 12
```

Mnożnik okresu liczy się na parach złączonych po `offer_id`, świadczeniu,
karencji, dodatkach i sposobie płatności — inaczej do porównania wchodzą
warianty różniące się czymś jeszcze i mnożnik rozjeżdża się do 1,13–1,40.

Kalibrację warto powtórzyć, gdy w `ud_offer_documents` przybędzie ofert —
w szczególności takich z okresem 48 lub 60 miesięcy, z drugim ubezpieczycielem
albo z klientem po pięćdziesiątce. Każde z tych trzech domyka jedną z dziur
opisanych wyżej.
