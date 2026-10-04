-- Atrapa środowiska Supabase dla testów SQL na zwykłym Postgresie 16.
--
-- NIE jest to schemat produkcji. To minimum potrzebne migracjom z tego
-- repozytorium: role, schematy rozszerzeń (cron, vault, net) i cztery tabele, na
-- których opiera się tablica leadów — z kolumnami i ograniczeniami zgodnymi
-- z produkcją tam, gdzie testy na nich polegają (NOT NULL na full_name, status
-- oferty, `role`/`active` profilu).
-- Uruchamia to apps/panel/scripts/test-leady-sql.mjs na jednorazowym klastrze.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema extensions;
create schema vault;
create schema cron;
create schema net;

create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job(jobname, schedule, command) values (n, s, c) returning jobid $$;
create function cron.alter_job(job_id bigint, active boolean default null) returns void language sql as
  $$ update cron.job set active = coalesce(alter_job.active, cron.job.active) where jobid = job_id $$;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('edge_cron_token', 'x');
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int)
  returns bigint language sql as $$ select 1::bigint $$;

create table public.ud_user_profiles (
  id           uuid primary key,
  full_name    text,
  role         text,
  active       boolean default true,
  created_at   timestamptz default now(),
  affiliate_code text unique,
  leader_id    uuid
);

create table public.ud_clients (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz default now(),
  full_name              text not null,
  email                  text,
  phone                  text,
  pesel                  text,
  employment_type        text,
  profession             text,
  source                 text,
  referred_by            uuid,
  affiliate_code_used    text,
  risk_death_invalidity  boolean,
  risk_temp_incapacity   boolean,
  risk_perm_incapacity   boolean,
  nw_death_sum           text,
  temp_incapacity_sum    text,
  perm_incapacity_sum    text
);

create table public.ud_offers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  name         text not null default 'oferta',
  offer_number text,
  client_id    uuid references public.ud_clients(id) on delete set null,
  status       text not null,
  created_at   timestamptz default now(),
  sent_at      timestamptz,
  viewed_at    timestamptz,
  decided_at   timestamptz,
  archived_at  timestamptz,
  client_choice jsonb
);

-- Warianty oferty (pliki PDF ubezpieczyciela po parsowaniu) — kolumny, z których
-- tablica leadów bierze kwoty sprzedaży.
create table public.ud_offer_documents (
  id                      uuid primary key default gen_random_uuid(),
  offer_id                uuid not null references public.ud_offers(id) on delete cascade,
  insurer_type            text,
  offer_number            text,
  product_name            text,
  death_covered           boolean,
  temp_incapacity_covered boolean,
  temp_monthly_benefit    numeric,
  perm_incapacity_covered boolean,
  perm_sum_insured        numeric,
  premium_total           numeric,
  premium_monthly         numeric,
  installments            integer,
  parsed_raw              jsonb,
  sort_order              integer default 0,
  created_at              timestamptz default now()
);

-- Storage Supabase: tylko tabela kubełków (część 4 zakłada w niej ud-polisy).
create schema if not exists storage;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
