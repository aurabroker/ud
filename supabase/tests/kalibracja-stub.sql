-- Atrapa dla testów kalibracji stawek (apps/panel/scripts/test-kalibracja-sql.mjs).
-- Ładowana po stub.sql, migracjach leadów, przypomnienia-stub.sql
-- i kosz-stub.sql: dokłada kolumny wariantu oferty, z których liczy
-- ud_kalibracja_stawek, a których tablica leadów nie używa. Typy jak na
-- produkcji (information_schema, sprawdzone 14.10.2026).

alter table public.ud_offer_documents
  add column if not exists indemnity_period text,
  add column if not exists wait_accident    integer,
  add column if not exists wait_illness     integer;

-- Uprawnienia do tabel źródłowych jak na produkcji (has_table_privilege,
-- 14.10.2026): service_role, anon i authenticated mają SELECT; przed anon
-- i authenticated chroni RLS. Funkcja jest SECURITY INVOKER, więc bez tego
-- wywołanie jako service_role padłoby tutaj, a na produkcji nie.
grant all on public.ud_offer_documents, public.ud_offers, public.ud_clients
  to anon, authenticated, service_role;

-- Domyślne uprawnienia do NOWYCH tabel i funkcji w public jak na produkcji
-- (pg_default_acl, 14.10.2026): anon i authenticated dostają wszystko, także
-- EXECUTE. Bez tego asercje „anon/authenticated nie wykonają / nie czytają"
-- przechodzą także wtedy, gdy migracja zapomni o revoke.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
