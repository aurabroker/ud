-- Szkice niedokończonych wniosków: lejek bez danych osobowych + kontakt tylko za zgodą.
--
-- Plan: PLAN-NIEDOKONCZONE-WNIOSKI.md. Wiersz powstaje po zaliczeniu pierwszego
-- kroku kreatora (`kontakt`) i rośnie o krok po każdym kolejnym. Dane kontaktowe
-- zapisujemy WYŁĄCZNIE przy zaznaczonej zgodzie — pilnuje tego ograniczenie
-- w bazie, nie tylko kod funkcji brzegowej.
--
-- CZEGO TU NIGDY NIE MA: PESEL-u ani odpowiedzi z ankiety medycznej (med_*,
-- hs_*, hsd_*). Dane o zdrowiu z wniosku, którego ktoś nie wysłał, nie mają
-- podstawy prawnej — zgoda z art. 9 RODO pada dopiero w ostatnim kroku.
-- Dlatego tabela nie ma na nie kolumn i nie ma na nie miejsca w `form_data`.
--
-- Znaczenie `ostatni_krok`: OSTATNI ZALICZONY krok. `kontakt` tuż po utworzeniu,
-- `dane` po przejściu danych podstawowych, … `zgody` wyłącznie po udanej wysyłce
-- wniosku (wtedy też `ukonczony_at`). Odpadnięcie „na kroku dane" to więc szkic
-- z ostatni_krok = 'kontakt'.
--
-- Dostęp: RLS włączone i BEZ polityk. Zapis i odczyt wyłącznie kluczem
-- serwisowym (funkcje brzegowe, panel przez createAdminClient). Anon i
-- authenticated nie mają tu nic — także na widoku lejka.

create table if not exists public.ud_wnioski_szkice (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  -- Ostatnia aktywność. Ustawiana jawnie przez funkcję brzegową (bez wyzwalacza:
  -- dobowe czyszczenie ip_hash nie może przedłużać życia wiersza).
  updated_at               timestamptz not null default now(),
  ostatni_krok             text not null default 'kontakt'
                           check (ostatni_krok in ('kontakt', 'dane', 'zakres', 'zdrowie', 'zgody')),
  ukonczony_at             timestamptz,
  client_id                uuid references public.ud_clients(id) on delete set null,

  zgoda_kontakt            boolean not null default false,
  -- Wersję zgody wysyła przeglądarka, TREŚĆ dopisuje funkcja brzegowa z własnej
  -- mapy wersja → tekst. Rozliczalność (art. 7 ust. 1 RODO) opiera się więc na
  -- tym, co zna serwer, a nie na tekście, który ktoś mógł podstawić w żądaniu.
  zgoda_wersja             text,
  zgoda_tresc              text,
  zgoda_at                 timestamptz,
  zgoda_wycofana_at        timestamptz,

  imie                     text check (char_length(imie) <= 100),
  email                    text check (char_length(email) <= 150),
  phone                    text check (char_length(phone) <= 30),

  przypomnienie_wyslane_at timestamptz,
  obsluzony_at             timestamptz,

  -- Skrót adresu IP — wyłącznie do limitu „N szkiców na godzinę". Zerowany po
  -- dobie przez ud_wnioski_szkice_retencja(). Nie jest kluczem ani wskaźnikiem
  -- do niczego innego.
  ip_hash                  text,

  -- Bez zgody wiersz służy tylko lejkowi: żadnego imienia, e-maila, telefonu.
  constraint szkic_kontakt_tylko_za_zgoda
    check (zgoda_kontakt or (imie is null and email is null and phone is null)),
  constraint szkic_zgoda_udokumentowana
    check (not zgoda_kontakt or (zgoda_wersja is not null and zgoda_tresc is not null and zgoda_at is not null)),
  -- Ukończony wniosek to ostatni krok `zgody`; odwrotność jest niepotrzebna.
  constraint szkic_ukonczony_to_ostatni_krok
    check (ukonczony_at is null or ostatni_krok = 'zgody')
);

comment on table public.ud_wnioski_szkice is
  'Szkice wniosków z kreatora: lejek + kontakt za zgodą. Nigdy PESEL ani ankieta medyczna.';

create index if not exists ud_wnioski_szkice_ip_idx
  on public.ud_wnioski_szkice (ip_hash, created_at) where ip_hash is not null;
create index if not exists ud_wnioski_szkice_przypomnienie_idx
  on public.ud_wnioski_szkice (updated_at)
  where zgoda_kontakt and ukonczony_at is null and przypomnienie_wyslane_at is null;
create index if not exists ud_wnioski_szkice_email_idx
  on public.ud_wnioski_szkice (lower(email)) where email is not null;
create index if not exists ud_wnioski_szkice_retencja_idx
  on public.ud_wnioski_szkice (updated_at);

alter table public.ud_wnioski_szkice enable row level security;
-- Celowo ZERO polityk. Klucz serwisowy omija RLS, reszta nie ma dostępu.
revoke all on table public.ud_wnioski_szkice from public, anon, authenticated;
grant all on table public.ud_wnioski_szkice to service_role;

-- Dzienne sumy ze szkiców usuniętych po 30 dniach. Bez danych osobowych —
-- sam tydzień, krok i liczba — żeby lejek nie urywał się po miesiącu.
create table if not exists public.ud_lejek_wniosku_archiwum (
  tydzien       date not null,
  ostatni_krok  text not null,
  szkicow       integer not null,
  primary key (tydzien, ostatni_krok)
);
alter table public.ud_lejek_wniosku_archiwum enable row level security;
revoke all on table public.ud_lejek_wniosku_archiwum from public, anon, authenticated;
grant all on table public.ud_lejek_wniosku_archiwum to service_role;

-- Lejek: tydzień × ostatni zaliczony krok → liczba szkiców, bez danych osobowych.
-- `doszlo_co_najmniej` to liczba szkiców, które zaliczyły ten krok albo dalszy —
-- różnica między sąsiednimi krokami pokazuje, gdzie ludzie odpadają.
-- security_invoker: widok czyta z uprawnieniami wywołującego, więc RLS tabel
-- bazowych nadal działa (domyślnie widok omija RLS jako jego właściciel).
create or replace view public.ud_lejek_wniosku
with (security_invoker = true) as
with wszystkie as (
  select date_trunc('week', created_at at time zone 'Europe/Warsaw')::date as tydzien,
         ostatni_krok,
         count(*)::int as szkicow
    from public.ud_wnioski_szkice
   group by 1, 2
  union all
  select tydzien, ostatni_krok, szkicow from public.ud_lejek_wniosku_archiwum
), zbiorczo as (
  select tydzien, ostatni_krok, sum(szkicow)::int as szkicow
    from wszystkie group by 1, 2
)
select tydzien,
       ostatni_krok,
       array_position(array['kontakt', 'dane', 'zakres', 'zdrowie', 'zgody'], ostatni_krok) as krok_nr,
       szkicow,
       (sum(szkicow) over (
          partition by tydzien
          order by array_position(array['kontakt', 'dane', 'zakres', 'zdrowie', 'zgody'], ostatni_krok) desc
        ))::int as doszlo_co_najmniej
  from zbiorczo;

revoke all on public.ud_lejek_wniosku from public, anon, authenticated;
grant select on public.ud_lejek_wniosku to service_role;

-- Oznaczenie szkicu jako ukończonego, wołane przez funkcję brzegową po udanej
-- wysyłce wniosku. Wiersz zostaje do lejka (ostatni_krok = 'zgody'), ale dane
-- kontaktowe znikają od razu — po powiązaniu z ud_clients nie ma już po co ich
-- trzymać. Powiązanie robi SQL, a nie filtr PostgREST: `ilike` traktuje `_`
-- i `%` jako wzorce, a `_` jest poprawnym znakiem w adresie e-mail.
create or replace function public.ud_wnioski_szkic_ukoncz(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ud_wnioski_szkice s
     set ukonczony_at = now(),
         ostatni_krok = 'zgody',
         updated_at   = now(),
         client_id    = (select c.id from public.ud_clients c
                          where s.email is not null
                            and lower(c.email) = lower(s.email)
                            and c.created_at >= s.created_at
                          order by c.created_at limit 1),
         imie = null, email = null, phone = null
   where s.id = p_id
     and s.ukonczony_at is null;
$$;

revoke all on function public.ud_wnioski_szkic_ukoncz(uuid) from public, anon, authenticated;
grant execute on function public.ud_wnioski_szkic_ukoncz(uuid) to service_role;

-- Retencja: szkice nieaktywne od 30 dni znikają, ale najpierw zostawiają sumę
-- w archiwum lejka. Ip_hash jest zbędny po dobie (limit liczymy w oknie godziny).
create or replace function public.ud_wnioski_szkice_retencja()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ud_wnioski_szkice
     set ip_hash = null
   where ip_hash is not null
     and created_at < now() - interval '1 day';

  with stare as (
    delete from public.ud_wnioski_szkice
     where updated_at < now() - interval '30 days'
    returning created_at, ostatni_krok
  )
  insert into public.ud_lejek_wniosku_archiwum as a (tydzien, ostatni_krok, szkicow)
  select date_trunc('week', created_at at time zone 'Europe/Warsaw')::date, ostatni_krok, count(*)
    from stare
   group by 1, 2
  on conflict (tydzien, ostatni_krok)
  do update set szkicow = a.szkicow + excluded.szkicow;
end;
$$;

revoke all on function public.ud_wnioski_szkice_retencja() from public, anon, authenticated;
grant execute on function public.ud_wnioski_szkice_retencja() to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'wnioski-szkice-retencja') then
    perform cron.schedule(
      'wnioski-szkice-retencja',
      '20 2 * * *',
      'select public.ud_wnioski_szkice_retencja()'
    );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Przypomnienie e-mailem (etap 5). Zadanie jest zakładane WYŁĄCZONE.
--
-- E-mail zachęcający do dokończenia wniosku to marketing bezpośredni (art. 398
-- Prawa komunikacji elektronicznej) i wymaga uprzedniej zgody, której treść
-- czeka na akceptację prawnika. Włączenie po jej uzyskaniu:
--
--   select cron.alter_job(
--     (select jobid from cron.job where jobname = 'wnioski-przypomnienia'),
--     active := true);
--
-- Wzorzec jak w 20260924191031_edge_cron_token.sql: token w Vaulcie, funkcja
-- SQL-owa dokłada nagłówek, funkcja brzegowa sprawdza go przed pierwszym
-- odczytem. Tokenu nie ma w treści zadania.

-- Wybiera szkice do przypomnienia. Zanim je zwróci, zamyka te, w których klient
-- jednak złożył wniosek (ten sam e-mail w ud_clients po dacie szkicu) —
-- bezpiecznik na wypadek, gdyby oznaczenie z kreatora nie doszło.
-- Jeden e-mail na adres na 30 dni, niezależnie od liczby szkiców.
create or replace function public.ud_wnioski_do_przypomnienia(
  opoznienie interval default interval '3 hours',
  maks       integer  default 50
)
returns table (szkic_id uuid, adres text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ud_wnioski_szkice s
     set ukonczony_at = now(),
         ostatni_krok = 'zgody',
         updated_at   = now(),
         client_id    = (select c.id from public.ud_clients c
                          where lower(c.email) = lower(s.email) and c.created_at >= s.created_at
                          order by c.created_at limit 1),
         imie = null, email = null, phone = null
   where s.ukonczony_at is null
     and s.email is not null
     and exists (select 1 from public.ud_clients c
                  where lower(c.email) = lower(s.email) and c.created_at >= s.created_at);

  return query
  select distinct on (lower(s.email)) s.id, s.email
    from public.ud_wnioski_szkice s
   where s.zgoda_kontakt
     and s.ukonczony_at is null
     and s.obsluzony_at is null
     and s.przypomnienie_wyslane_at is null
     and s.email is not null
     and s.updated_at < now() - opoznienie
     and s.created_at > now() - interval '7 days'
     and not exists (select 1 from public.ud_wnioski_szkice p
                      where lower(p.email) = lower(s.email)
                        and p.przypomnienie_wyslane_at > now() - interval '30 days')
   order by lower(s.email), s.updated_at desc
   limit maks;
end;
$$;

create or replace function public.ud_wnioski_przypomnienia()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/wniosek-przypomnienie',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets
                       where name = 'edge_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$;

revoke all on function public.ud_wnioski_do_przypomnienia(interval, integer) from public, anon, authenticated;
revoke all on function public.ud_wnioski_przypomnienia() from public, anon, authenticated;
grant execute on function public.ud_wnioski_do_przypomnienia(interval, integer) to service_role;
grant execute on function public.ud_wnioski_przypomnienia() to service_role;

do $$
declare
  nr bigint;
begin
  if not exists (select 1 from cron.job where jobname = 'wnioski-przypomnienia') then
    nr := cron.schedule(
      'wnioski-przypomnienia',
      '10 * * * *',
      'select public.ud_wnioski_przypomnienia()'
    );
    perform cron.alter_job(nr, active := false);
  end if;
end $$;

notify pgrst, 'reload schema';
