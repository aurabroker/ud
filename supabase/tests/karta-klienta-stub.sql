-- Atrapa dla testu przeglądarkowego karty klienta (apps/panel/test/leady,
-- /__test/ssr-klient). Ładowana po stub.sql, migracjach i pomocnicze.sql:
-- dokłada kolumny oferty i wariantu, które karta wymienia w zapytaniach,
-- a których tablica leadów nie używa. Typy jak w kosz-stub.sql
-- i kalibracja-stub.sql (produkcja, information_schema).
--
-- Potrzebne, bo atrapa transportu (test/leady/serwer.mjs) wykonuje listę
-- kolumn z .select() naprawdę — brakująca kolumna kończy się błędem, jak
-- w PostgREST.

alter table public.ud_offers
  add column if not exists source text not null default 'calculator';

alter table public.ud_offer_documents
  add column if not exists indemnity_period text,
  add column if not exists wait_accident    integer,
  add column if not exists wait_illness     integer;

-- Wersja oferty (zakładka „Klienci": „wysłana ponownie", panel v.0.80) —
-- typ jak w migracji 20260917200000_oferty_archiwum_wersje.sql i na produkcji.
alter table public.ud_offers
  add column if not exists wersja integer not null default 1;
