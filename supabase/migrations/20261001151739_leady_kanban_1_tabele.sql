-- Tablica leadów (Kanban) w panelu.
--
-- Lead to człowiek, który ZŁOŻYŁ wniosek (ud_clients) albo go PORZUCIŁ i zostawił
-- kontakt za zgodą (ud_wnioski_szkice, zgoda_kontakt = true). Szkic bez zgody nie
-- ma imienia, e-maila ani telefonu — nie ma więc kogo wyświetlić i nie jest leadem.
--
-- CZEGO TU NIE MA I NIE BĘDZIE:
--   * wyzwalacza na ud_clients. Wniosek to jedyna ścieżka, którą wpływają pieniądze;
--     leady są tworzone przez ud_leady_synchronizuj() wołaną przy otwarciu tablicy,
--     a nie w transakcji, w której klient zapisuje wniosek.
--   * kopii danych kontaktowych. ud_leady trzyma wyłącznie stan procesu (etap,
--     opiekun, następne działanie); imię, e-mail i telefon czytamy z ud_clients
--     albo ze szkicu w chwili wyświetlenia. Wycofanie zgody albo retencja szkicu
--     nie zostawia więc nigdzie kopii.
--   * PESEL-u i ankiety medycznej — ani w widoku, ani w funkcjach.
--
-- Retencja: lead porzuconego wniosku jest powiązany ze szkicem kluczem obcym
-- `on delete cascade`, więc znika razem z nim po 30 dniach nieaktywności
-- (ud_wnioski_szkice_retencja) — razem z notatkami i historią. Wycofanie zgody
-- albo ukończenie wniosku bez dopasowanego klienta usuwa go od razu. Ukończony
-- wniosek z dopasowanym klientem jest PRZEPINANY na klienta (notatki zostają).
--
-- Dostęp: RLS włączone i BEZ polityk; czyta i zapisuje wyłącznie klucz serwisowy
-- (panel przez createAdminClient). Tożsamość wykonawcy (p_user) ustala panel
-- z sesji — funkcje ufają jej tylko dlatego, że wołać je może wyłącznie
-- service_role, i same sprawdzają, że to aktywny agent.
--
-- Migracja w czterech częściach (MCP Supabase nie przyjmował jednego pliku 50 KB).
-- Każda kończy się tym samym blokiem uprawnień, żeby żadna funkcja nie była
-- choć przez chwilę wykonywalna dla anon/authenticated między częściami.

-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline i etapy

create table if not exists public.ud_leady_pipeline (
  id          uuid primary key default gen_random_uuid(),
  klucz       text not null unique check (klucz ~ '^[a-z0-9_]{2,40}$'),
  nazwa       text not null check (char_length(nazwa) between 1 and 60),
  aktywny     boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.ud_leady_etap (
  id             uuid primary key default gen_random_uuid(),
  pipeline_id    uuid not null references public.ud_leady_pipeline(id) on delete restrict,
  klucz          text not null check (klucz ~ '^[a-z0-9_]{2,40}$'),
  nazwa          text not null check (char_length(nazwa) between 1 and 40),
  pozycja        integer not null,
  rodzaj         text not null default 'otwarty' check (rodzaj in ('otwarty', 'wygrany', 'przegrany')),
  -- Pola, które trzeba podać, żeby lead wszedł do tego etapu. Dziś jedno:
  -- powód utraty. „Wygrany" nie ma jeszcze danych zamknięcia — dopisze się je tu,
  -- gdy będzie wiadomo które (patrz CLAUDE.md, „Tablica leadów").
  wymagane_pola  text[] not null default '{}' check (wymagane_pola <@ array['powod_utraty']),
  aktywny        boolean not null default true,
  unique (pipeline_id, klucz),
  -- Cel dla złożonego klucza obcego w ud_leady: lead nie może wskazywać etapu
  -- z innego pipeline'u nawet przy bezpośrednim zapisie do bazy.
  unique (id, pipeline_id)
);

insert into public.ud_leady_pipeline (klucz, nazwa)
values ('sprzedaz', 'Sprzedaż')
on conflict (klucz) do nothing;

insert into public.ud_leady_etap (pipeline_id, klucz, nazwa, pozycja, rodzaj, wymagane_pola)
select p.id, v.klucz, v.nazwa, v.pozycja, v.rodzaj, v.wymagane
  from public.ud_leady_pipeline p,
       (values
         ('nowy',      'Nowy',            10, 'otwarty',   '{}'::text[]),
         ('kontakt',   'Kontakt',         20, 'otwarty',   '{}'::text[]),
         ('oferta',    'Oferta',          30, 'otwarty',   '{}'::text[]),
         ('decyzja',   'Decyzja klienta', 40, 'otwarty',   '{}'::text[]),
         ('wygrany',   'Wygrany',         50, 'wygrany',   '{}'::text[]),
         ('przegrany', 'Przegrany',       60, 'przegrany', array['powod_utraty'])
       ) as v(klucz, nazwa, pozycja, rodzaj, wymagane)
 where p.klucz = 'sprzedaz'
on conflict (pipeline_id, klucz) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Leady

create table if not exists public.ud_leady (
  id                       uuid primary key default gen_random_uuid(),
  pipeline_id              uuid not null,
  etap_id                  uuid not null,
  -- Dokładnie jedno z dwóch. Klient: kasowany razem z kartoteką. Szkic: razem ze
  -- szkicem (retencja 30 dni) — to jest obietnica z klauzuli informacyjnej.
  klient_id                uuid unique references public.ud_clients(id) on delete cascade,
  szkic_id                 uuid unique references public.ud_wnioski_szkice(id) on delete cascade,

  -- Wersja do kontroli równoległych zmian (expectedVersion). Rośnie przy każdej
  -- zmianie stanu procesu; notatka jej nie rusza.
  wersja                   integer not null default 1 check (wersja >= 1),
  opiekun_id               uuid references public.ud_user_profiles(id) on delete set null,
  nastepne_dzialanie_typ   text check (nastepne_dzialanie_typ in ('telefon', 'email', 'spotkanie', 'inne')),
  nastepne_dzialanie_at    timestamptz,
  nastepne_dzialanie_opis  text check (char_length(nastepne_dzialanie_opis) <= 200),
  powod_utraty             text check (char_length(powod_utraty) <= 300),
  etap_od                  timestamptz not null default now(),
  zarchiwizowano_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint lead_jedno_zrodlo
    check ((klient_id is not null)::int + (szkic_id is not null)::int = 1),
  constraint lead_dzialanie_komplet
    check ((nastepne_dzialanie_typ is null) = (nastepne_dzialanie_at is null)
           and (nastepne_dzialanie_typ is not null or nastepne_dzialanie_opis is null)),
  constraint lead_etap_w_pipeline
    foreign key (etap_id, pipeline_id) references public.ud_leady_etap (id, pipeline_id)
);

create index if not exists ud_leady_etap_idx
  on public.ud_leady (pipeline_id, etap_id) where zarchiwizowano_at is null;
create index if not exists ud_leady_opiekun_idx
  on public.ud_leady (opiekun_id) where zarchiwizowano_at is null;

comment on table public.ud_leady is
  'Lead = klient (ud_clients) albo szkic wniosku ze zgodą na kontakt. Tylko stan procesu — dane osobowe czytamy ze źródła.';

-- Historia zmian + dziennik idempotencji. Unikalność (lead_id, klucz) sprawia, że
-- ponowione żądanie z tym samym kluczem nie wykona się drugi raz.
create table if not exists public.ud_leady_historia (
  id               bigint generated always as identity primary key,
  lead_id          uuid not null references public.ud_leady(id) on delete cascade,
  typ              text not null check (typ in ('etap', 'dzialanie', 'opiekun', 'archiwum', 'notatka', 'przepieto')),
  z_etapu_id       uuid references public.ud_leady_etap(id) on delete set null,
  do_etapu_id      uuid references public.ud_leady_etap(id) on delete set null,
  wykonawca_id     uuid references public.ud_user_profiles(id) on delete set null,
  -- Migawka nazwy: po usunięciu konta historia nadal mówi, kto to zrobił.
  wykonawca_nazwa  text,
  -- `zadanie` to znormalizowana treść polecenia — po niej odróżniamy ponowienie
  -- od ponownego użycia klucza do innej operacji.
  dane             jsonb not null default '{}'::jsonb,
  klucz            text check (char_length(klucz) between 8 and 80),
  created_at       timestamptz not null default now()
);
create unique index if not exists ud_leady_historia_klucz_idx
  on public.ud_leady_historia (lead_id, klucz) where klucz is not null;
create index if not exists ud_leady_historia_lead_idx
  on public.ud_leady_historia (lead_id, id desc);

create table if not exists public.ud_leady_notatki (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.ud_leady(id) on delete cascade,
  tresc         text not null check (char_length(btrim(tresc)) between 1 and 2000),
  autor_id      uuid references public.ud_user_profiles(id) on delete set null,
  autor_nazwa   text,
  created_at    timestamptz not null default now()
);
create index if not exists ud_leady_notatki_lead_idx
  on public.ud_leady_notatki (lead_id, created_at desc);

-- Osobisty widok: które etapy ma zwinięte dany użytkownik w danym pipeline'ie.
-- Nie dotyka danych leadów ani kolejności etapów.
create table if not exists public.ud_leady_widok_uzytkownika (
  user_id      uuid not null references public.ud_user_profiles(id) on delete cascade,
  pipeline_id  uuid not null references public.ud_leady_pipeline(id) on delete cascade,
  zwiniete     uuid[] not null default '{}',
  updated_at   timestamptz not null default now(),
  primary key (user_id, pipeline_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['ud_leady_pipeline', 'ud_leady_etap', 'ud_leady', 'ud_leady_historia',
                           'ud_leady_notatki', 'ud_leady_widok_uzytkownika']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pomocnicze

-- Kwota z pola tekstowego („8000", „8 000", „8 000,50 zł"). Cokolwiek innego → null:
-- lepiej brak kwoty na karcie niż zgadnięta.
create or replace function public.ud_kwota(p text)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select case when t.n ~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then t.n::numeric end
    from (select replace(
                   regexp_replace(lower(coalesce(p, '')), '(\s|' || chr(160) || '|zł|pln)', '', 'g'),
                   ',', '.') as n) t
$fn$;

-- Rola aktywnego agenta panelu albo null. Wszystkie funkcje zapisujące zaczynają
-- od tego sprawdzenia, więc „dowolny uuid" nie wystarczy.
create or replace function public.ud_leady_rola(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(p.role, 'user')
    from public.ud_user_profiles p
   where p.id = p_user and coalesce(p.active, true)
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Widok leadów do wyświetlenia. Warunek na końcu jest ważny: szkic bez zgody,
-- z wycofaną zgodą albo ukończony NIE jest leadem — nawet zanim sprzątanie
-- (wyzwalacz, synchronizacja) usunie wiersz z ud_leady.

create or replace view public.ud_leady_baza
with (security_invoker = true) as
select
  l.id,
  l.pipeline_id,
  l.etap_id,
  l.wersja,
  l.opiekun_id,
  p.full_name                                           as opiekun_nazwa,
  l.nastepne_dzialanie_typ,
  l.nastepne_dzialanie_at,
  l.nastepne_dzialanie_opis,
  l.powod_utraty,
  l.etap_od,
  l.updated_at,
  l.klient_id,
  l.szkic_id,
  case when l.klient_id is not null then 'klient' else 'szkic' end as rodzaj,
  coalesce(c.created_at, s.created_at, l.created_at)    as zgloszono,
  case when l.klient_id is not null
       then coalesce(nullif(btrim(c.full_name), ''), c.email, 'Bez nazwy')
       else coalesce(nullif(btrim(s.imie), ''), s.email, 'Bez nazwy') end as nazwa,
  case when l.klient_id is not null then c.email else s.email end as email,
  case when l.klient_id is not null then c.phone else s.phone end as telefon,
  case when l.klient_id is not null then coalesce(nullif(btrim(c.source), ''), 'form') else 'szkic' end as zrodlo,
  case when l.klient_id is not null
       then array_remove(array[
              case when c.risk_temp_incapacity  then 'okresowa' end,
              case when c.risk_perm_incapacity  then 'trwala'   end,
              case when c.risk_death_invalidity then 'zgon'     end], null)
       else '{}'::text[] end                            as produkty,
  -- Wartość to MIESIĘCZNE świadczenie z ryzyka „okresowa niezdolność do pracy"
  -- (zł / mies.) — jedyna kwota, którą klient podaje na wniosku i która jest
  -- jednoznaczna. Nie jest składką ani przychodem; kolumna i podpisy w panelu
  -- mówią to wprost. Szkic nie ma kwot.
  case when l.klient_id is not null then public.ud_kwota(c.temp_incapacity_sum) end as wartosc,
  array_position(array['kontakt', 'dane', 'zakres', 'zdrowie', 'zgody'], s.ostatni_krok) as krok_nr,
  case when l.szkic_id is not null then s.updated_at + interval '30 days' end as dane_do
from public.ud_leady l
left join public.ud_clients c         on c.id = l.klient_id
left join public.ud_wnioski_szkice s  on s.id = l.szkic_id
left join public.ud_user_profiles p   on p.id = l.opiekun_id
where l.zarchiwizowano_at is null
  and (l.klient_id is not null
       or (s.id is not null
           and s.zgoda_kontakt
           and s.zgoda_wycofana_at is null
           and s.ukonczony_at is null));

revoke all on public.ud_leady_baza from public, anon, authenticated;
grant select on public.ud_leady_baza to service_role;

-- Karta: to, co wolno wysłać do przeglądarki jako element listy. Bez e-maila,
-- bez PESEL-u, bez zawodu — te są w szczegółach.
create or replace function public.ud_lead_karta(b public.ud_leady_baza)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'id',            b.id,
    'etap_id',       b.etap_id,
    'wersja',        b.wersja,
    'rodzaj',        b.rodzaj,
    'nazwa',         b.nazwa,
    'telefon',       b.telefon,
    'zrodlo',        b.zrodlo,
    'produkty',      to_jsonb(b.produkty),
    'wartosc',       b.wartosc,
    'opiekun_id',    b.opiekun_id,
    'opiekun_nazwa', b.opiekun_nazwa,
    'dzialanie',     case when b.nastepne_dzialanie_typ is null then null
                          else jsonb_build_object('typ', b.nastepne_dzialanie_typ,
                                                  'termin', b.nastepne_dzialanie_at,
                                                  'opis', b.nastepne_dzialanie_opis) end,
    'etap_od',       b.etap_od,
    'zgloszono',     b.zgloszono,
    'krok_nr',       b.krok_nr,
    'dane_do',       b.dane_do,
    'powod_utraty',  b.powod_utraty
  )
$fn$;

create or replace function public.ud_lead_karta(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.ud_lead_karta(b) from public.ud_leady_baza b where b.id = p_id
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia: wszystko tylko dla klucza serwisowego.

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('ud_kwota', 'ud_leady_rola', 'ud_lead_karta', 'ud_leady_przepnij_szkic',
                         'ud_leady_szkic_zmiana', 'ud_leady_synchronizuj', 'ud_lead_zmien',
                         'ud_lead_notatka', 'ud_leady_dopasowane', 'ud_leady_liczniki',
                         'ud_leady_kolumna', 'ud_lead_szczegoly', 'ud_leady_zwin', 'ud_leady_plan')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
