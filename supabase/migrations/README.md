# Migracje Supabase

Do 2026-09-03 schemat zmieniał się przez panel Supabase i nic z tego nie
było w repozytorium — historia zmian istniała wyłącznie w tabeli
`supabase_migrations.schema_migrations` w produkcji. Ten katalog zaczyna
odwracać ten stan: leżą tu **kopie migracji już zastosowanych**, z nazwami
pliku odpowiadającymi wersjom zapisanym w bazie, żeby dało się je przeczytać
w diffie razem z kodem, który z nich korzysta.

Wszystkie są napisane tak, żeby dało się je puścić drugi raz bez szkody
(`if not exists`, `create or replace`), ale `supabase db push` i tak je
pominie — te wersje baza ma już odnotowane.

Starsze migracje (przed 2026-09-03) tu nie trafiły. Ich treść jest w panelu
Supabase; przenoszenie ich w całości to osobna robota.

Jeden wyjątek: `20260903091500_blog_images_bucket_limits.sql` zmienia wiersz
w `storage.buckets`, a nie schemat, i został puszczony zwykłym zapytaniem —
baza nie ma go odnotowanego jako migracji. Efekt w produkcji jest, ale
`supabase db push` puści go jeszcze raz. Jest idempotentny, więc nic z tego
nie wyniknie.

## Tablica leadów — migracja w dwóch częściach

- `20261001151739_leady_kanban_1_tabele.sql` — tabele, etapy, widok, karta.
  **Zastosowana** przez MCP 01.10.2026; nazwa pliku = wersja w bazie.
- `20261001180000_leady_kanban_2_funkcje.sql` — funkcje zapisu i odczytu,
  wyzwalacz na szkicach. **Zastosowana** w Supabase SQL Editor 01.10.2026
  (cały plik naraz), wersja dopisana ręcznie:
  `insert into supabase_migrations.schema_migrations (version, name) values ('20261001180000', 'leady_kanban_2_funkcje');`
  Editor zapisał funkcje z końcami linii CRLF — przy porównaniu `prosrc`
  z plikiem usuń `chr(13)`.

- `20261002120000_leady_kanban_3_sprzedaz.sql` — zmiany z 02.10.2026: Nowy
  i Kontakt w jednym etapie, porzucone wnioski poza tablicą (wyzwalacz na
  szkicach zdjęty), dane sprzedaży przy Wygrany, statystyki, opiekun-administrator
  na karcie. **Przez SQL Editor** (DROP i funkcje z UPDATE/DELETE), potem:
  `insert into supabase_migrations.schema_migrations (version, name) values ('20261002120000', 'leady_kanban_3_sprzedaz');`

- `20261002160000_leady_kanban_4_widocznosc.sql` — agent widzi i obsługuje
  tylko swoje leady (opiekuna przydziela administrator), klienci w panelu
  według tej samej reguły, polisy przy leadzie (tabela `ud_leady_pliki`,
  prywatny kubełek `ud-polisy`), kwota 0 = brak ryzyka, link agenta do
  wniosku (`ud_agent_kod`, opiekun z `affiliate_code_used`). Zmienia sygnaturę
  `ud_lead_szczegoly` — kolejność: baza, potem panel v.0.60. **Przez SQL
  Editor**, potem:
  `insert into supabase_migrations.schema_migrations (version, name) values ('20261002160000', 'leady_kanban_4_widocznosc');`
- `20261004200000_leady_kanban_5_prowizja_polisy.sql` — stawka prowizji agenta
  (`ud_user_profiles.prowizja_procent`, Centrala 20%) i jej migawka przy
  sprzedaży (`ud_leady.prowizja_procent`), składka w danych sprzedaży bez
  opłaty dystrybucyjnej (`ud_skladka_netto`; korekta sprzedaży skopiowanych
  z wariantu oferty), statystyki z prowizją, „Dodaj polisę" dla klienta spoza
  formularza (`ud_lead_polisa_reczna`). Kolejność: baza, potem panel v.0.61.
  **Przez SQL Editor**, potem:
  `insert into supabase_migrations.schema_migrations (version, name) values ('20261004200000', 'leady_kanban_5_prowizja_polisy');`
- `20261005090000_leady_kanban_6_wykaz_polis.sql` — wykaz polis: numer polisy
  i okres ochrony w danych sprzedaży (`ud_leady.polisa_numer`, `ochrona_od`,
  `ochrona_do`; widok, karta, `ud_lead_zmien`, `ud_lead_polisa_reczna`)
  i funkcja `ud_leady_polisy` dla strony `/panel/polisy`. Kolejność: baza,
  potem panel v.0.62. **Przez SQL Editor**, potem:
  `insert into supabase_migrations.schema_migrations (version, name) values ('20261005090000', 'leady_kanban_6_wykaz_polis');`

Dlaczego tak: MCP Supabase (`apply_migration` i `execute_sql`) wstrzymuje do
ręcznego potwierdzenia każde `DROP` i każdą funkcję, która w treści robi
`UPDATE`/`DELETE` na tabeli w `public` (na tabeli tymczasowej ta sama treść
przechodzi). Potwierdzenie nie dociera do właściciela, a zapytanie przepada
po 60 s bez śladu w bazie — sprawdzone sondami 01.10.2026. Nie obchodź tego
dynamicznym SQL-em: to jest bramka na zgodę człowieka, nie usterka do
wyminięcia. Migracja z takimi funkcjami idzie przez SQL Editor.

Testy na jednorazowym Postgresie wczytują wszystkie części po kolei:
`pnpm test:leady-sql` w `apps/panel` (stub środowiska w `supabase/tests/`).
