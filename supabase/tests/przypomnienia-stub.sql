-- Atrapa dla testów przypomnień SMS o ofercie (apps/panel/scripts/test-przypomnienia-sql.mjs).
-- Dokłada do stub.sql to, czego ud_oferty_do_przypomnienia potrzebuje,
-- a czego tablica leadów nie używa: wersję i telefon oferty, pytania klienta
-- i dziennik wysyłek. Kolumny jak na produkcji (sprawdzone 12.10.2026).

alter table public.ud_offers
  add column if not exists wersja integer not null default 1,
  add column if not exists client_phone text;

create table if not exists public.ud_offer_questions (
  id        uuid primary key default gen_random_uuid(),
  offer_id  uuid not null references public.ud_offers(id) on delete cascade,
  asked_at  timestamptz not null default now()
);

create table if not exists public.ud_send_log (
  id          uuid primary key default gen_random_uuid(),
  offer_id    uuid references public.ud_offers(id) on delete cascade,
  user_id     uuid,
  channel     text not null,
  recipient   text,
  status      text not null,
  provider_id text,
  error       text,
  created_at  timestamptz not null default now(),
  wersja      integer
);

-- Supabase nadaje anon i authenticated EXECUTE na każdą nową funkcję w public
-- (domyślne uprawnienia). Bez tego test uprawnień nie złapałby migracji, która
-- odbiera EXECUTE tylko PUBLIC-owi, a zapomina o tych dwóch rolach.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
