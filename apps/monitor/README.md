# Monitor UtrataDochodu.pl

Worker Cloudflare z cronem co pięć minut, własną bazą D1 i stroną statusu.

## Po co, skoro są gotowe usługi uptime

Zwykły uptime monitor odpowiada na pytanie „czy strona się otwiera”.
W tym projekcie najdroższa awaria wyglądała inaczej: formularz szybkiego
kontaktu był martwy od 15.06.2026, bo funkcja brzegowa wysyłała do PostgREST
kolumnę, której nie ma w tabeli. Wszystkie usługi odpowiadały poprawnie,
strona się otwierała, przycisk się klikał — a leady znikały przez kilka
tygodni, zanim ktokolwiek zauważył.

Dlatego oprócz sond dostępności są tu dwie rzeczy, których gotowe usługi
nie robią:

**Sondy kontraktowe.** Wysyłają do funkcji brzegowej celowo błędne dane
i sprawdzają, czy odpowiedź ma umówiony kształt — status i treść komunikatu.
Funkcja niewdrożona, źle przekierowana albo wywalająca się na starcie nie
odpowie „400 i taki komunikat”. Sonda nie tworzy przy tym żadnego zgłoszenia
w bazie.

**Sonda ciszy.** Zlicza zgłoszenia z ostatnich godzin. Zero zgłoszeń
w godzinach pracy przy działającej stronie to dokładnie ten sygnał, który
tamtym razem nie zapalił się nikomu. Poza godzinami pracy i w weekendy sonda
milczy, bo cisza w niedzielę o trzeciej w nocy nic nie znaczy.

## Dlaczego D1, a nie Supabase

Monitor sprawdza między innymi Supabase. Trzymanie w nim własnego stanu
oznaczałoby, że przy awarii bazy monitor traci zdolność zapisania, że baza
padła. To samo dotyczy hostingu: worker jest osobny od projektu Pages portalu,
więc nieudany deploy portalu nie zabiera ze sobą narzędzia, którym mielibyśmy
to zauważyć.

## Alerty

Wiadomość idzie **przy zmianie stanu**, nie przy każdym nieudanym pomiarze.
Monitor, który pisze co pięć minut przez godzinę awarii, zostaje wyciszony
po tygodniu i przestaje istnieć.

- Awaria zgłaszana po `PROG_AWARII` nieudanych pomiarach z rzędu (domyślnie 2,
  czyli po około 10 minutach). Pojedyncze mrugnięcie sieci nikogo nie budzi.
- Powrót zgłaszany tylko wtedy, gdy zgłoszono awarię — nikt nie dostaje
  „znowu działa” o czymś, o czym nie słyszał.
- Format webhooka pasuje do Slacka (`text`) i Discorda (`content`);
  własny odbiorca dostaje komplet w polu `zdarzenie`.

## Uruchomienie

```bash
# 1. Baza
npx wrangler d1 create ud-monitor          # id wklej do wrangler.toml
pnpm --filter @ud/monitor baza             # schemat na zdalnej bazie

# 2. Sekrety
npx wrangler secret put KLUCZ_ANON               # klucz anon Supabase
npx wrangler secret put KLUCZ_SERWISOWY          # service_role — tylko do zliczania
npx wrangler secret put ALERT_WEBHOOK            # Slack / Discord / własny
npx wrangler secret put TOKEN_STATUSU            # dostęp do strony statusu
npx wrangler secret put URL_STATUSU              # adres wstawiany w treść alertu
npx wrangler secret put ID_DOKUMENTU_TESTOWEGO   # id aktywnego OWU

# 3. Wdrożenie
pnpm --filter @ud/monitor deploy
```

Po wdrożeniu można nie czekać na crona:

```bash
curl -X POST "https://ud-monitor.<konto>.workers.dev/uruchom?token=<TOKEN_STATUSU>"
```

## Adresy

| Adres | Do czego |
|---|---|
| `/` | Strona statusu (HTML), za tokenem |
| `/json` | Ten sam obraz maszynowo |
| `/uruchom` | `POST` — przebieg na żądanie |
| `/zdrowie` | Bez tokenu — czy sam monitor żyje |

Strona statusu jest za tokenem, bo wymienia wewnętrzne adresy i nazwy funkcji.
`/zdrowie` jest otwarte, żeby dało się monitorować monitor z zewnątrz.

## Testy

```bash
pnpm --filter @ud/monitor test
```

32 testy na atrapie D1 i podmienionym `fetch`. Sprawdzają przede wszystkim
logikę alertowania — to ona decyduje, czy monitor będzie używany, czy
wyciszony po tygodniu.

## Wydzielenie do osobnego repozytorium

Monitor jest samodzielny: nie importuje niczego z reszty monorepo.
Gdyby miał zamieszkać osobno:

```bash
git subtree split --prefix=apps/monitor -b monitor
```
