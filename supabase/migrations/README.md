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
