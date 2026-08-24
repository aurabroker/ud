# Monitor aplikacji UtrataDochodu

Monitoring na Cloudflare Workers. Sprawdza aplikacje co minutę, alarmuje
e-mailem i SMS-em, pokazuje status page z historią 24 godzin.

## Dlaczego nie zwykły pinger

Kiedy CSP blokował Turnstile, `utratadochodu.pl` przez cały czas zwracał
`200 OK` — formularza po prostu nie dało się wysłać. Każdy zwykły monitor
uptime świeciłby wtedy na zielono. Dlatego ten monitor sprawdza rzeczy,
które faktycznie decydują o tym, czy wpadają zgłoszenia:

| Sprawdzenie | Co wykrywa |
|---|---|
| `http` + szukanie tekstu w treści | strona wstała, ale wyrenderowała się bez formularza |
| `csp` | polityka przestała przepuszczać Turnstile / Supabase / Pixela — **nagłówek i `<meta>` osobno**, bo przeglądarka bierze ich część wspólną |
| `http-wiele` | plik JS zwraca HTML (czyli 404 z Cloudflare Pages) — formularz cicho umiera |
| `edge-function` | funkcja Supabase nie odpowiada albo sypie 5xx |
| `supabase-rest` | baza nie oddaje danych |

Sprawdzenie funkcji wysyła celowo niekompletne dane. Żywa funkcja odrzuci je
walidacją (4xx) i o to chodzi — **nic nie trafia do bazy**, nie zaśmiecamy
sobie zgłoszeń testami.

## Alerty

- awarię ogłaszamy dopiero po **dwóch porażkach z rzędu** — jednorazowe
  mrugnięcie sieci nie budzi nikogo,
- **e-mail** przy każdej awarii,
- **SMS tylko dla sprawdzeń oznaczonych `krytyczny: true`** — te budzą o każdej
  porze, bo od nich zależy lejek zgłoszeń. Blog czy opinie wysyłają sam e-mail,
- gdy awaria trwa, przypomnienie mailem co 30 minut,
- powrót do działania zgłaszany tym samym kanałem, którym poszła awaria.

## Wdrożenie

Wszystko poniżej robi się raz, w katalogu `monitoring/`.

```bash
npm install
npx wrangler login
```

**1. Baza D1**

```bash
npx wrangler d1 create ud-monitor
# skopiuj database_id z wyniku do wrangler.toml
npm run baza
```

**2. Sekrety**

```bash
npx wrangler secret put RESEND_API_KEY     # resend.com, darmowe 3000 maili/mies
npx wrangler secret put ALERT_EMAIL        # info@utratadochodu.pl
npx wrangler secret put SMSAPI_TOKEN       # smsapi.pl, token OAuth
npx wrangler secret put ALERT_SMS          # 48504400901
npx wrangler secret put STATUS_TOKEN       # długi losowy ciąg, chroni status page
npx wrangler secret put SUPABASE_ANON_KEY  # opcjonalne, do sprawdzeń REST
```

E-mail wymaga zweryfikowania domeny `utratadochodu.pl` w Resend (kilka
rekordów DNS — skoro domena jest na Cloudflare, to 5 minut roboty).
SMS-y kosztują ok. 10–15 gr za sztukę; przy poprawnie ustawionych progach
to kilka SMS-ów na miesiąc.

**3. Wdrożenie i sprawdzenie, że alerty naprawdę dochodzą**

```bash
npm test                    # 36 testów, bez sieci
npx wrangler deploy
curl "https://ud-monitor.<twoj-subdomain>.workers.dev/test-alert?token=STATUS_TOKEN"
```

`/test-alert` wysyła prawdziwy e-mail i SMS. **Zrób to zaraz po wdrożeniu** —
monitor, którego kanał alertowy jest zepsuty, jest gorszy niż żaden, bo daje
fałszywe poczucie bezpieczeństwa.

## Adresy

| Ścieżka | Do czego |
|---|---|
| `/?token=…` | status page |
| `/api/stan?token=…` | to samo w JSON |
| `/uruchom?token=…` | wymuszenie przebiegu teraz (`&id=ud-csp` dla jednego sprawdzenia) |
| `/test-alert?token=…` | test kanałów e-mail i SMS |
| `/zdrowie` | publiczne `200 ok` — pod to podepnij zewnętrzny monitor |
| `/zglos-blad` | `POST` z `awaria.js` — błędy prawdziwych użytkowników |

## Dodanie aplikacji do monitorowania

Jedna pozycja w `src/checks.js`, potem `npx wrangler deploy`. W pliku są już
przygotowane wpisy dla `app.utratadochodu.pl` i `auraexpert.pl` — mają
`wylaczone: true`, bo trzeba potwierdzić, że to właściwe adresy.

## Dwie rzeczy, o których trzeba pamiętać

**Monitor na Cloudflare nie zauważy awarii samego Cloudflare.** Dlatego
`/zdrowie` jest publiczne — podepnij pod nie darmowy UptimeRobot albo
Better Stack. Pięć minut konfiguracji i ktoś pilnuje pilnującego.

**Raportowanie błędów użytkowników wymaga jeszcze dwóch zmian** na stronie
(nie są zrobione): w `awaria.js` dopisać wysyłkę do `/zglos-blad`, a w CSP
w `_headers` i metatagach dodać adres Workera do `connect-src`. Wtedy
w zdarzeniach widać awarie zgłoszone przez prawdziwych użytkowników, a nie
tylko to, co wykryje sprawdzanie co minutę.

## Koszty

Darmowy plan Cloudflare wystarcza: 1440 uruchomień cron dziennie przy limicie
100 000 żądań, ~8600 zapisów do D1 przy limicie 100 000. Płacicie tylko za
SMS-y.
