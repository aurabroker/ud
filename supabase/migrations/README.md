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

Dlaczego tak: MCP Supabase (`apply_migration` i `execute_sql`) wstrzymuje do
ręcznego potwierdzenia każde `DROP` i każdą funkcję, która w treści robi
`UPDATE`/`DELETE` na tabeli w `public` (na tabeli tymczasowej ta sama treść
przechodzi). Potwierdzenie nie dociera do właściciela, a zapytanie przepada
po 60 s bez śladu w bazie — sprawdzone sondami 01.10.2026. Nie obchodź tego
dynamicznym SQL-em: to jest bramka na zgodę człowieka, nie usterka do
wyminięcia. Migracja z takimi funkcjami idzie przez SQL Editor.

Testy na jednorazowym Postgresie wczytują obie części po kolei:
`pnpm test:leady-sql` w `apps/panel` (stub środowiska w `supabase/tests/`).
