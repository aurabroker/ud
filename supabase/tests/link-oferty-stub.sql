-- Atrapa dla testów ważności linku do oferty (apps/panel/scripts/test-link-oferty-sql.mjs).
-- Dokłada do stub.sql kolumny ud_offers, których tablica leadów nie używa, a link
-- do oferty tak, RLS z politykami jak w produkcji (tylko authenticated) i uprawnienia
-- tabel dla ról API, jakie Supabase nadaje domyślnie. Funkcja ud_offer_by_token jest
-- w wersji SPRZED migracji 20261113…_oferty_wygasanie_linku (kopia z produkcji),
-- więc te same testy puszczone bez migracji pokazują błędy.
-- Kolumny jak na produkcji (sprawdzone 13.11.2026).

alter table public.ud_offers
  add column if not exists client_name      text,
  add column if not exists data             jsonb not null default '{}'::jsonb,
  add column if not exists broker_message   text,
  add column if not exists version          text default 'v1.0',
  add column if not exists share_token      text unique,
  add column if not exists updated_at       timestamptz default now(),
  add column if not exists client_email     text,
  add column if not exists client_phone     text,
  add column if not exists access_code      text,
  add column if not exists additional_terms text,
  add column if not exists source           text not null default 'calculator';

alter table public.ud_offers alter column status set default 'draft';

grant usage on schema public to anon, authenticated, service_role;
grant all on public.ud_offers to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create or replace function public.is_ud_admin() returns boolean language sql stable as $$ select false $$;

alter table public.ud_offers enable row level security;
create policy ud_offers_select on public.ud_offers for select to authenticated
  using (user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid or is_ud_admin());
create policy ud_offers_insert on public.ud_offers for insert to authenticated
  with check (user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid);
create policy ud_offers_update on public.ud_offers for update to authenticated
  using (user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid or is_ud_admin());
create policy ud_offers_delete on public.ud_offers for delete to authenticated
  using (user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid or is_ud_admin());

-- Wersja sprzed utwardzenia (kopia z produkcji): cały wiersz po samym tokenie, dla anon.
create function public.ud_offer_by_token(p_token text) returns setof public.ud_offers
  language sql stable security definer set search_path = public as $$
  select o.*
  from public.ud_offers o
  where o.share_token is not null
    and o.share_token = p_token;
$$;
