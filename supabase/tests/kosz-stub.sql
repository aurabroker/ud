-- Atrapa dla testów kosza ofert (apps/panel/scripts/test-kosz-sql.mjs).
-- Ładowana po stub.sql, migracjach leadów i przypomnienia-stub.sql: dokłada
-- kolumny oferty, których kosz musi przenieść (link, kod, numer), oraz pliki
-- i PIN-y — z kluczami obcymi jak na produkcji (sprawdzone 13.10.2026).

alter table public.ud_offers
  add column if not exists share_token  text,
  add column if not exists access_code  text,
  add column if not exists offer_number text,
  add column if not exists client_email text,
  add column if not exists client_name  text,
  add column if not exists source       text not null default 'calculator',
  add column if not exists broker_message text,
  add column if not exists additional_terms text,
  add column if not exists updated_at   timestamptz default now(),
  add column if not exists data         jsonb not null default '{}'::jsonb;

create table if not exists public.ud_offer_files (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references public.ud_offers(id) on delete cascade,
  document_id    uuid references public.ud_offer_documents(id) on delete cascade,
  file_type      text not null,
  file_name      text,
  storage_bucket text not null default 'ud-offers',
  storage_path   text not null,
  insurer_type   text,
  size_bytes     bigint,
  created_at     timestamptz not null default now()
);

create table if not exists public.ud_offer_pins (
  id           uuid primary key default gen_random_uuid(),
  offer_id     uuid not null references public.ud_offers(id) on delete cascade,
  pin_hash     text not null,
  attempts     integer not null default 0,
  max_attempts integer not null default 3,
  expires_at   timestamptz not null,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);
