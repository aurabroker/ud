-- Tablica leadów (Kanban), część 4: kto widzi który lead, polisy, kwota zero.
-- Decyzje właściciela z 02.10.2026 (po pierwszym nowym agencie):
--
--   * Agent widzi i obsługuje WYŁĄCZNIE leady, których jest opiekunem.
--     Starych ani nieprzypisanych nie widzi — dopiero przypisanie przez
--     administratora pozwala mu pracować z leadem. Administrator widzi wszystko.
--     Ta sama reguła obejmuje zakładkę „Klienci" (ud_klienci_widoczni): bez
--     niej nowy agent zobaczyłby tam wszystkich klientów z pełnymi danymi.
--   * Opiekuna przydziela tylko administrator (agent nie przejmuje ani nie
--     zwalnia leadów).
--   * Przy wygranej można wgrać polisę (PDF) — plik leży w prywatnym kubełku
--     ud-polisy, wiersz w ud_leady_pliki, wpis w historii.
--   * Kwota 0 w danych sprzedaży znaczy „tego ryzyka nie ma", a nie „błąd".
--   * Link agenta do wniosku (/wniosek/?agent=<kod>): lead z takiego wniosku
--     dostaje tego agenta jako opiekuna (sekcja 7).
--
-- Stosuje się ją w Supabase SQL Editor (cały plik naraz — jedna transakcja),
-- bo MCP wstrzymuje DROP i funkcje z UPDATE/DELETE do potwierdzenia, które nie
-- dociera (supabase/migrations/README.md). Panel v.0.60 woła nowe sygnatury —
-- kolejność: baza, potem panel. Między jednym a drugim (kilka minut) stary
-- panel nie otworzy szczegółów leada; tablica działa.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Kto widzi lead: administrator — każdy; agent — tylko swój; konto
--    nieaktywne albo nieznane — żaden. Jedno miejsce, z którego korzystają
--    filtr tablicy, liczniki, szczegóły, zmiany, notatki i pliki.

create or replace function public.ud_leady_widzi(p_user uuid, p_opiekun uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((
    select p.role = 'admin' or p.id = p_opiekun
      from public.ud_user_profiles p
     where p.id = p_user and coalesce(p.active, true)), false)
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Kwota zero = brak kwoty

create or replace function public.ud_leady_liczba(j jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  t text;
  n numeric;
begin
  if j is null or jsonb_typeof(j) = 'null' then
    return null;
  end if;
  if jsonb_typeof(j) = 'number' then
    n := (j #>> '{}')::numeric;
  elsif jsonb_typeof(j) = 'string' then
    t := btrim(j #>> '{}');
    if t = '' then
      return null;
    end if;
    n := public.ud_kwota(t);
    if n is null then
      raise exception 'niepoprawna kwota' using errcode = '22P02';
    end if;
  else
    raise exception 'niepoprawna kwota' using errcode = '22P02';
  end if;
  -- Zero to „tego ryzyka nie ma" (np. sprzedana sama okresowa niezdolność),
  -- a nie błąd: pole bez kwoty. Składkę roczną > 0 wymusza osobno ud_lead_zmien.
  if n = 0 then
    return null;
  end if;
  if n < 0 or n >= 1e10 then
    raise exception 'kwota poza zakresem' using errcode = '22003';
  end if;
  return round(n, 2);
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Pliki leadów (polisy)

create table if not exists public.ud_leady_pliki (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.ud_leady(id) on delete cascade,
  rodzaj       text not null default 'polisa' check (rodzaj in ('polisa')),
  bucket       text not null check (bucket = 'ud-polisy'),
  -- <lead_id>/<uuid>.pdf — ścieżkę wymyśla serwer, nigdy przeglądarka.
  sciezka      text not null unique check (sciezka ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  nazwa        text not null check (char_length(nazwa) between 1 and 200),
  rozmiar      integer check (rozmiar >= 0),
  dodal_id     uuid references public.ud_user_profiles(id) on delete set null,
  dodal_nazwa  text,
  created_at   timestamptz not null default now()
);
create index if not exists ud_leady_pliki_lead_idx on public.ud_leady_pliki (lead_id, created_at desc);
alter table public.ud_leady_pliki enable row level security;
revoke all on table public.ud_leady_pliki from public, anon, authenticated;
grant all on table public.ud_leady_pliki to service_role;

alter table public.ud_leady_historia drop constraint if exists ud_leady_historia_typ_check;
alter table public.ud_leady_historia add constraint ud_leady_historia_typ_check
  check (typ in ('etap', 'dzialanie', 'opiekun', 'archiwum', 'notatka', 'przepieto', 'sprzedaz', 'plik'));

-- Prywatny kubełek: tylko PDF, do 10 MB. Pliki wychodzą wyłącznie przez panel
-- (adres podpisany na minutę, po sprawdzeniu, że użytkownik widzi lead).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ud-polisy', 'ud-polisy', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Zapis pliku już wgranego do kubełka. Serwer wgrywa obiekt PRZED tym
-- wywołaniem; gdy funkcja odmówi, serwer usuwa obiekt.
create or replace function public.ud_lead_plik_dodaj(
  p_lead    uuid,
  p_user    uuid,
  p_sciezka text,
  p_nazwa   text,
  p_rozmiar integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_wyk    text;
  v_nazwa  text := left(btrim(coalesce(p_nazwa, '')), 200);
  v_opiek  uuid;
  f        public.ud_leady_pliki%rowtype;
begin
  if public.ud_leady_rola(p_user) is null then
    return jsonb_build_object('status', 'brak_uprawnien', 'komunikat', 'Brak dostępu do tablicy leadów.');
  end if;
  if p_lead is null or p_sciezka is null or split_part(p_sciezka, '/', 1) <> p_lead::text
     or p_sciezka !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$' then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Niepoprawna ścieżka pliku.');
  end if;
  if v_nazwa = '' then
    v_nazwa := 'polisa.pdf';
  end if;

  select opiekun_id into v_opiek from public.ud_leady where id = p_lead for update;
  if not found or not exists (select 1 from public.ud_leady_baza b where b.id = p_lead) then
    return jsonb_build_object('status', 'brak_leada', 'komunikat', 'Lead nie istnieje albo został zarchiwizowany.');
  end if;
  if not public.ud_leady_widzi(p_user, v_opiek) then
    return jsonb_build_object('status', 'brak_leada',
      'komunikat', 'Ten lead nie jest przypisany do Ciebie. Leady przydziela administrator.');
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Agent') into v_wyk from public.ud_user_profiles where id = p_user;
  insert into public.ud_leady_pliki (lead_id, rodzaj, bucket, sciezka, nazwa, rozmiar, dodal_id, dodal_nazwa)
  values (p_lead, 'polisa', 'ud-polisy', p_sciezka, v_nazwa, greatest(coalesce(p_rozmiar, 0), 0), p_user, v_wyk)
  returning * into f;
  insert into public.ud_leady_historia (lead_id, typ, wykonawca_id, wykonawca_nazwa, dane)
  values (p_lead, 'plik', p_user, v_wyk, jsonb_build_object('plik_id', f.id, 'rodzaj', f.rodzaj, 'nazwa', f.nazwa));
  update public.ud_leady set updated_at = now() where id = p_lead;

  return jsonb_build_object('status', 'ok', 'plik', jsonb_build_object(
    'id', f.id, 'rodzaj', f.rodzaj, 'nazwa', f.nazwa, 'rozmiar', f.rozmiar,
    'dodal_nazwa', f.dodal_nazwa, 'created_at', f.created_at));
end
$fn$;

-- Gdzie leży plik — tylko dla kogoś, kto widzi jego lead. Null = brak dostępu.
create or replace function public.ud_lead_plik(p_plik uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object('bucket', f.bucket, 'sciezka', f.sciezka, 'nazwa', f.nazwa)
    from public.ud_leady_pliki f
    join public.ud_leady l on l.id = f.lead_id
   where f.id = p_plik
     and public.ud_leady_widzi(p_user, l.opiekun_id)
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Odczyt tablicy: filtr i liczniki tylko z widocznych leadów

create or replace function public.ud_leady_dopasowane(p_pipeline uuid, p_filtr jsonb, p_user uuid)
returns setof public.ud_leady_baza
language sql
stable
security definer
set search_path = ''
as $fn$
  select b.*
    from public.ud_leady_baza b
   where b.pipeline_id = p_pipeline
     and public.ud_leady_widzi(p_user, b.opiekun_id)
     and (nullif(btrim(coalesce(p_filtr->>'q', '')), '') is null
          or strpos(lower(coalesce(b.nazwa, '') || ' ' || coalesce(b.email, '') || ' ' || coalesce(b.telefon, '')),
                    lower(btrim(p_filtr->>'q'))) > 0
          or (char_length(regexp_replace(p_filtr->>'q', '\D', '', 'g')) >= 3
              and strpos(regexp_replace(coalesce(b.telefon, ''), '\D', '', 'g'),
                         regexp_replace(p_filtr->>'q', '\D', '', 'g')) > 0))
     and (coalesce(p_filtr->>'opiekun', '') = ''
          or case p_filtr->>'opiekun'
               when 'brak' then b.opiekun_id is null
               when 'ja'   then b.opiekun_id = p_user
               else b.opiekun_id::text = p_filtr->>'opiekun' end)
     and (coalesce(p_filtr->>'zrodlo', '') = '' or b.zrodlo = p_filtr->>'zrodlo')
     and (coalesce(p_filtr->>'produkt', '') = ''
          or (p_filtr->>'produkt' = 'nieznany' and cardinality(b.produkty) = 0)
          or p_filtr->>'produkt' = any (b.produkty))
     and (coalesce(p_filtr->>'termin', '') = ''
          or case p_filtr->>'termin'
               when 'przeterminowane' then b.nastepne_dzialanie_at < now()
               when 'dzisiaj' then (b.nastepne_dzialanie_at at time zone 'Europe/Warsaw')::date
                                   = (now() at time zone 'Europe/Warsaw')::date
               when 'tydzien' then b.nastepne_dzialanie_at >= now()
                                   and b.nastepne_dzialanie_at < now() + interval '7 days'
               when 'brak' then b.nastepne_dzialanie_at is null
               else true end)
$fn$;

create or replace function public.ud_leady_liczniki(p_pipeline uuid, p_filtr jsonb, p_user uuid)
returns table (etap_id uuid, ile integer, ile_wszystkich integer, suma numeric, suma_wszystkich numeric,
               skladki numeric, skladki_wszystkich numeric)
language sql
stable
security definer
set search_path = ''
as $fn$
  with d as (
    select x.etap_id, count(*)::int as n, coalesce(sum(x.wartosc), 0) as s, coalesce(sum(x.skladka_roczna), 0) as sk
      from public.ud_leady_dopasowane(p_pipeline, p_filtr, p_user) x
     group by x.etap_id
  ), w as (
    select y.etap_id, count(*)::int as n, coalesce(sum(y.wartosc), 0) as s, coalesce(sum(y.skladka_roczna), 0) as sk
      from public.ud_leady_baza y
     where y.pipeline_id = p_pipeline
       and public.ud_leady_widzi(p_user, y.opiekun_id)
     group by y.etap_id
  )
  select e.id, coalesce(d.n, 0), coalesce(w.n, 0), coalesce(d.s, 0), coalesce(w.s, 0),
         coalesce(d.sk, 0), coalesce(w.sk, 0)
    from public.ud_leady_etap e
    left join d on d.etap_id = e.id
    left join w on w.etap_id = e.id
   where e.pipeline_id = p_pipeline and e.aktywny
   order by e.pozycja, e.id
$fn$;

-- Szczegóły dostają użytkownika (zmiana sygnatury — stara znika) i listę plików.
drop function if exists public.ud_lead_szczegoly(uuid);
create function public.ud_lead_szczegoly(p_lead uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  b public.ud_leady_baza%rowtype;
  c public.ud_clients%rowtype;
  v_kontakt jsonb;
begin
  select * into b from public.ud_leady_baza where id = p_lead;
  if not found then
    return null;
  end if;
  -- Cudzy albo nieprzypisany lead jest dla agenta niewidoczny — jak na tablicy.
  if not public.ud_leady_widzi(p_user, b.opiekun_id) then
    return null;
  end if;

  if b.klient_id is not null then
    select * into c from public.ud_clients where id = b.klient_id;
    v_kontakt := jsonb_build_object(
      'zawod', c.profession,
      'forma_zatrudnienia', c.employment_type,
      'kwoty', jsonb_build_object(
        'okresowa', c.temp_incapacity_sum,
        'trwala',   c.perm_incapacity_sum,
        'zgon',     c.nw_death_sum));
  else
    v_kontakt := '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'lead', public.ud_lead_karta(b),
    'email', b.email,
    'telefon', b.telefon,
    'klient_id', b.klient_id,
    'kontakt', v_kontakt,
    'pliki', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'rodzaj', f.rodzaj, 'nazwa', f.nazwa, 'rozmiar', f.rozmiar,
                                          'dodal_nazwa', f.dodal_nazwa, 'created_at', f.created_at)
                       order by f.created_at desc)
        from public.ud_leady_pliki f where f.lead_id = p_lead), '[]'::jsonb),
    'notatki', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'tresc', n.tresc,
                                          'autor_nazwa', n.autor_nazwa, 'created_at', n.created_at)
                       order by n.created_at desc)
        from (select * from public.ud_leady_notatki
               where lead_id = p_lead order by created_at desc limit 50) n), '[]'::jsonb),
    'historia', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'typ', h.typ, 'created_at', h.created_at,
               'wykonawca_nazwa', h.wykonawca_nazwa,
               'z_etap', ez.nazwa, 'do_etap', ed.nazwa,
               'dane', h.dane - 'zadanie') order by h.id desc)
        from (select * from public.ud_leady_historia
               where lead_id = p_lead order by id desc limit 50) h
        left join public.ud_leady_etap ez on ez.id = h.z_etapu_id
        left join public.ud_leady_etap ed on ed.id = h.do_etapu_id), '[]'::jsonb));
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Zapis: tylko na widocznych leadach; opiekuna zmienia administrator

create or replace function public.ud_lead_zmien(
  p_op     text,
  p_lead   uuid,
  p_wersja integer,
  p_klucz  text,
  p_user   uuid,
  p_dane   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_dane     jsonb := coalesce(p_dane, '{}'::jsonb);
  v_rola     text;
  v_wyk      text;
  l          public.ud_leady%rowtype;
  v_stary    public.ud_leady_historia%rowtype;
  v_zadanie  jsonb;
  v_cel      public.ud_leady_etap%rowtype;
  v_cel_id   uuid;
  v_powod    text;
  v_typ      text;
  v_termin   timestamptz;
  v_opis     text;
  v_opiekun  uuid;
  v_dzialanie_jest boolean;
  -- dane sprzedaży
  v_sp       jsonb;
  v_sp_norm  jsonb;
  v_wariant  uuid;
  v_rok      numeric;
  v_mies     numeric;
  v_okr      numeric;
  v_trw      numeric;
  v_zgon     numeric;
  v_poprz    jsonb;
begin
  if p_op is null or p_op not in ('przenies', 'dzialanie', 'opiekun', 'archiwizuj', 'sprzedaz') then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Nieznana operacja.');
  end if;
  if p_lead is null or p_wersja is null or p_wersja < 1 then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Brak leada albo wersji.');
  end if;
  if p_klucz is null or char_length(p_klucz) not between 8 and 80 then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Brak klucza idempotencji.');
  end if;

  v_rola := public.ud_leady_rola(p_user);
  if v_rola is null then
    return jsonb_build_object('status', 'brak_uprawnien', 'komunikat', 'Brak dostępu do tablicy leadów.');
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'Agent') into v_wyk
    from public.ud_user_profiles where id = p_user;

  -- Parsowanie żądania przed blokadą: zły uuid / data / kwota to błąd klienta, nie wyjątek.
  begin
    -- Dane sprzedaży: przy przeniesieniu (do Wygrany) i w operacji „sprzedaz".
    if p_op in ('przenies', 'sprzedaz') then
      v_sp := case when p_op = 'sprzedaz' then v_dane else v_dane->'sprzedaz' end;
      if v_sp is not null and jsonb_typeof(v_sp) = 'object' then
        v_wariant := nullif(btrim(v_sp->>'wariant_id'), '')::uuid;
        v_rok  := public.ud_leady_liczba(v_sp->'skladka_roczna');
        v_mies := public.ud_leady_liczba(v_sp->'skladka_mies');
        v_okr  := public.ud_leady_liczba(v_sp->'swiadczenie_okresowa');
        v_trw  := public.ud_leady_liczba(v_sp->'swiadczenie_trwala');
        v_zgon := public.ud_leady_liczba(v_sp->'swiadczenie_zgon');
      end if;
      if coalesce(v_wariant::text, v_rok::text, v_mies::text, v_okr::text, v_trw::text, v_zgon::text) is not null then
        v_sp_norm := jsonb_build_object(
          'wariant_id', v_wariant, 'skladka_roczna', v_rok, 'skladka_mies', v_mies,
          'swiadczenie_okresowa', v_okr, 'swiadczenie_trwala', v_trw, 'swiadczenie_zgon', v_zgon);
      end if;
    end if;

    if p_op = 'przenies' then
      v_cel_id := (v_dane->>'etap_id')::uuid;
      v_powod  := nullif(btrim(v_dane->>'powod_utraty'), '');
      v_zadanie := jsonb_build_object('etap_id', v_cel_id, 'powod_utraty', v_powod)
                   || case when v_sp_norm is not null then jsonb_build_object('sprzedaz', v_sp_norm) else '{}'::jsonb end;
    elsif p_op = 'dzialanie' then
      v_typ    := nullif(btrim(v_dane->>'typ'), '');
      v_termin := nullif(btrim(v_dane->>'termin'), '')::timestamptz;
      v_opis   := nullif(btrim(v_dane->>'opis'), '');
      if v_typ is null then
        v_termin := null; v_opis := null;
      elsif v_typ not in ('telefon', 'email', 'spotkanie', 'inne') or v_termin is null then
        return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Podaj rodzaj i termin działania.');
      elsif char_length(coalesce(v_opis, '')) > 200 then
        return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Opis działania jest za długi (max 200 znaków).');
      end if;
      v_zadanie := jsonb_build_object(
        'typ', v_typ, 'opis', v_opis,
        'termin', case when v_termin is null then null
                  else to_char(v_termin at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end);
    elsif p_op = 'opiekun' then
      v_opiekun := nullif(btrim(v_dane->>'opiekun_id'), '')::uuid;
      v_zadanie := jsonb_build_object('opiekun_id', v_opiekun);
    elsif p_op = 'sprzedaz' then
      v_zadanie := jsonb_build_object('sprzedaz', v_sp_norm);
    else
      v_zadanie := '{}'::jsonb;
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format
            or invalid_parameter_value or numeric_value_out_of_range then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Niepoprawne dane żądania (sprawdź kwoty i daty).');
  end;
  v_zadanie := jsonb_build_object('op', p_op) || v_zadanie;

  -- Od tej chwili wiersz jest zablokowany: równoległe żądania na tym samym
  -- leadzie ustawiają się w kolejce, więc nie ma okna na podwójny zapis.
  select * into l from public.ud_leady where id = p_lead for update;
  if not found then
    return jsonb_build_object('status', 'brak_leada', 'komunikat', 'Lead nie istnieje albo został zarchiwizowany.');
  end if;

  -- Agent pracuje wyłącznie na leadach, których jest opiekunem (02.10.2026).
  -- Dla niego cudzy albo nieprzypisany lead nie istnieje — tak jak w odczycie.
  if not public.ud_leady_widzi(p_user, l.opiekun_id) then
    return jsonb_build_object('status', 'brak_leada',
      'komunikat', 'Ten lead nie jest przypisany do Ciebie. Leady przydziela administrator.');
  end if;

  -- Ponowienie: ten sam klucz + ta sama treść = ten sam wynik, bez drugiego skutku.
  select * into v_stary from public.ud_leady_historia h where h.lead_id = p_lead and h.klucz = p_klucz;
  if found then
    if v_stary.dane->'zadanie' is distinct from v_zadanie then
      return jsonb_build_object('status', 'klucz_uzyty', 'komunikat', 'Ten klucz posłużył do innej operacji.');
    end if;
    return jsonb_build_object('status', 'ok', 'powtorzone', true,
      'zarchiwizowano', v_stary.typ = 'archiwum', 'lead', public.ud_lead_karta(p_lead));
  end if;

  if not exists (select 1 from public.ud_leady_baza b where b.id = p_lead) then
    return jsonb_build_object('status', 'brak_leada', 'komunikat', 'Lead nie istnieje albo został zarchiwizowany.');
  end if;

  if l.wersja <> p_wersja then
    return jsonb_build_object('status', 'konflikt',
      'komunikat', 'Ktoś zmienił ten lead przed Tobą.', 'lead', public.ud_lead_karta(p_lead));
  end if;

  -- Wariant musi pochodzić z ofert TEGO klienta — inaczej statystyka wzięłaby
  -- kwoty z cudzej oferty.
  if v_wariant is not null and not exists (
       select 1 from public.ud_offer_documents d join public.ud_offers o on o.id = d.offer_id
        where d.id = v_wariant and o.client_id = l.klient_id) then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Ten wariant nie należy do ofert tego klienta.');
  end if;

  -- ── przeniesienie ─────────────────────────────────────────────────────────
  if p_op = 'przenies' then
    select * into v_cel from public.ud_leady_etap
     where id = v_cel_id and pipeline_id = l.pipeline_id and aktywny;
    if not found then
      return jsonb_build_object('status', 'niedozwolony',
        'komunikat', 'Ten etap nie istnieje w tym pipeline''ie albo jest wyłączony.');
    end if;
    if v_cel.id = l.etap_id then
      return jsonb_build_object('status', 'bez_zmiany', 'lead', public.ud_lead_karta(p_lead));
    end if;
    if 'powod_utraty' = any (v_cel.wymagane_pola) and (v_powod is null or char_length(v_powod) < 3) then
      return jsonb_build_object('status', 'brak_danych', 'pola', jsonb_build_array('powod_utraty'),
        'komunikat', 'Podaj powód utraty (min. 3 znaki).');
    end if;
    if 'skladka_roczna' = any (v_cel.wymagane_pola) and v_rok is null then
      return jsonb_build_object('status', 'brak_danych', 'pola', jsonb_build_array('skladka_roczna'),
        'komunikat', 'Podaj składkę roczną sprzedanego wariantu.');
    end if;
    if char_length(coalesce(v_powod, '')) > 300 then
      return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Powód utraty jest za długi (max 300 znaków).');
    end if;

    if l.skladka_roczna is not null and v_cel.rodzaj <> 'wygrany' then
      v_poprz := jsonb_build_object('skladka_roczna', l.skladka_roczna, 'skladka_mies', l.skladka_mies,
                                    'wariant_id', l.sprzedaz_wariant_id);
    end if;

    -- Wejście do etapu zamykającego kończy proces, więc zaplanowane działanie
    -- znika (zostaje w historii). Dane sprzedaży żyją tylko w Wygrany: wyjście
    -- z niego je zeruje, a historia pamięta, co było.
    update public.ud_leady
       set etap_id = v_cel.id,
           etap_od = now(),
           powod_utraty = case when v_cel.rodzaj = 'przegrany' then v_powod end,
           nastepne_dzialanie_typ   = case when v_cel.rodzaj = 'otwarty' then nastepne_dzialanie_typ end,
           nastepne_dzialanie_at    = case when v_cel.rodzaj = 'otwarty' then nastepne_dzialanie_at end,
           nastepne_dzialanie_opis  = case when v_cel.rodzaj = 'otwarty' then nastepne_dzialanie_opis end,
           sprzedaz_wariant_id  = case when v_cel.rodzaj = 'wygrany' then v_wariant end,
           skladka_roczna       = case when v_cel.rodzaj = 'wygrany' then v_rok end,
           skladka_mies         = case when v_cel.rodzaj = 'wygrany' then v_mies end,
           swiadczenie_okresowa = case when v_cel.rodzaj = 'wygrany' then v_okr end,
           swiadczenie_trwala   = case when v_cel.rodzaj = 'wygrany' then v_trw end,
           swiadczenie_zgon     = case when v_cel.rodzaj = 'wygrany' then v_zgon end,
           sprzedawca_id        = case when v_cel.rodzaj = 'wygrany' then coalesce(l.opiekun_id, p_user) end,
           sprzedano_at         = case when v_cel.rodzaj = 'wygrany' then now() end,
           wersja = wersja + 1,
           updated_at = now()
     where id = p_lead;
    insert into public.ud_leady_historia (lead_id, typ, z_etapu_id, do_etapu_id, wykonawca_id, wykonawca_nazwa, dane, klucz)
    values (p_lead, 'etap', l.etap_id, v_cel.id, p_user, v_wyk,
            jsonb_build_object('zadanie', v_zadanie, 'powod_utraty', v_powod,
                               'sprzedaz', case when v_cel.rodzaj = 'wygrany' then v_sp_norm end,
                               'poprzednia_sprzedaz', v_poprz,
                               'zamkniete_dzialanie',
                               case when v_cel.rodzaj <> 'otwarty' and l.nastepne_dzialanie_typ is not null
                                    then jsonb_build_object('typ', l.nastepne_dzialanie_typ,
                                                            'termin', l.nastepne_dzialanie_at) end),
            p_klucz);

  -- ── dane sprzedaży (uzupełnienie albo poprawka w Wygrany) ─────────────────
  elsif p_op = 'sprzedaz' then
    select * into v_cel from public.ud_leady_etap where id = l.etap_id;
    if v_cel.rodzaj is distinct from 'wygrany' then
      return jsonb_build_object('status', 'niedozwolony',
        'komunikat', 'Dane sprzedaży wpisuje się w etapie „Wygrany".');
    end if;
    if v_rok is null then
      return jsonb_build_object('status', 'brak_danych', 'pola', jsonb_build_array('skladka_roczna'),
        'komunikat', 'Podaj składkę roczną sprzedanego wariantu.');
    end if;
    if v_wariant is not distinct from l.sprzedaz_wariant_id
       and v_rok is not distinct from l.skladka_roczna and v_mies is not distinct from l.skladka_mies
       and v_okr is not distinct from l.swiadczenie_okresowa and v_trw is not distinct from l.swiadczenie_trwala
       and v_zgon is not distinct from l.swiadczenie_zgon then
      return jsonb_build_object('status', 'bez_zmiany', 'lead', public.ud_lead_karta(p_lead));
    end if;
    v_poprz := case when l.skladka_roczna is null then null
                    else jsonb_build_object('skladka_roczna', l.skladka_roczna, 'skladka_mies', l.skladka_mies,
                                            'wariant_id', l.sprzedaz_wariant_id) end;
    update public.ud_leady
       set sprzedaz_wariant_id  = v_wariant,
           skladka_roczna       = v_rok,
           skladka_mies         = v_mies,
           swiadczenie_okresowa = v_okr,
           swiadczenie_trwala   = v_trw,
           swiadczenie_zgon     = v_zgon,
           sprzedawca_id        = coalesce(l.sprzedawca_id, l.opiekun_id, p_user),
           sprzedano_at         = coalesce(l.sprzedano_at, l.etap_od),
           wersja = wersja + 1,
           updated_at = now()
     where id = p_lead;
    insert into public.ud_leady_historia (lead_id, typ, wykonawca_id, wykonawca_nazwa, dane, klucz)
    values (p_lead, 'sprzedaz', p_user, v_wyk,
            jsonb_build_object('zadanie', v_zadanie, 'sprzedaz', v_sp_norm, 'poprzednia_sprzedaz', v_poprz),
            p_klucz);

  -- ── następne działanie ────────────────────────────────────────────────────
  elsif p_op = 'dzialanie' then
    v_dzialanie_jest := l.nastepne_dzialanie_typ is not null;
    if v_typ is not distinct from l.nastepne_dzialanie_typ
       and v_termin is not distinct from l.nastepne_dzialanie_at
       and v_opis is not distinct from l.nastepne_dzialanie_opis then
      return jsonb_build_object('status', 'bez_zmiany', 'lead', public.ud_lead_karta(p_lead));
    end if;
    update public.ud_leady
       set nastepne_dzialanie_typ = v_typ,
           nastepne_dzialanie_at = v_termin,
           nastepne_dzialanie_opis = v_opis,
           wersja = wersja + 1,
           updated_at = now()
     where id = p_lead;
    insert into public.ud_leady_historia (lead_id, typ, wykonawca_id, wykonawca_nazwa, dane, klucz)
    values (p_lead, 'dzialanie', p_user, v_wyk,
            jsonb_build_object('zadanie', v_zadanie,
                               'poprzednie', case when v_dzialanie_jest
                                  then jsonb_build_object('typ', l.nastepne_dzialanie_typ,
                                                          'termin', l.nastepne_dzialanie_at) end),
            p_klucz);

  -- ── opiekun ───────────────────────────────────────────────────────────────
  elsif p_op = 'opiekun' then
    if v_opiekun is not null and public.ud_leady_rola(v_opiekun) is null then
      return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Nieznany albo nieaktywny opiekun.');
    end if;
    if v_opiekun is not distinct from l.opiekun_id then
      return jsonb_build_object('status', 'bez_zmiany', 'lead', public.ud_lead_karta(p_lead));
    end if;
    -- Opiekuna przydziela wyłącznie administrator (02.10.2026). Agent nie widzi
    -- leadów bez opiekuna, więc nie ma czego przejmować, a zwolnienie własnego
    -- zabrałoby mu lead z tablicy bez wiedzy administratora.
    if v_rola <> 'admin' then
      return jsonb_build_object('status', 'brak_uprawnien', 'komunikat', 'Opiekuna przydziela administrator.');
    end if;
    update public.ud_leady
       set opiekun_id = v_opiekun, wersja = wersja + 1, updated_at = now()
     where id = p_lead;
    insert into public.ud_leady_historia (lead_id, typ, wykonawca_id, wykonawca_nazwa, dane, klucz)
    values (p_lead, 'opiekun', p_user, v_wyk,
            jsonb_build_object('zadanie', v_zadanie, 'poprzedni', l.opiekun_id), p_klucz);

  -- ── archiwizacja ──────────────────────────────────────────────────────────
  else
    update public.ud_leady
       set zarchiwizowano_at = now(), wersja = wersja + 1, updated_at = now()
     where id = p_lead;
    insert into public.ud_leady_historia (lead_id, typ, z_etapu_id, wykonawca_id, wykonawca_nazwa, dane, klucz)
    values (p_lead, 'archiwum', l.etap_id, p_user, v_wyk,
            jsonb_build_object('zadanie', v_zadanie), p_klucz);
    return jsonb_build_object('status', 'ok', 'zarchiwizowano', true, 'lead_id', p_lead);
  end if;

  return jsonb_build_object('status', 'ok', 'lead', public.ud_lead_karta(p_lead));
end
$fn$;

create or replace function public.ud_lead_notatka(
  p_lead   uuid,
  p_klucz  text,
  p_user   uuid,
  p_tresc  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tresc  text := btrim(coalesce(p_tresc, ''));
  v_wyk    text;
  v_stary  public.ud_leady_historia%rowtype;
  v_id     uuid;
  n        public.ud_leady_notatki%rowtype;
  v_opiekun uuid;
begin
  if p_lead is null or p_klucz is null or char_length(p_klucz) not between 8 and 80 then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Brak leada albo klucza idempotencji.');
  end if;
  if char_length(v_tresc) not between 1 and 2000 then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Notatka musi mieć od 1 do 2000 znaków.');
  end if;
  if public.ud_leady_rola(p_user) is null then
    return jsonb_build_object('status', 'brak_uprawnien', 'komunikat', 'Brak dostępu do tablicy leadów.');
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'Agent') into v_wyk
    from public.ud_user_profiles where id = p_user;

  select opiekun_id into v_opiekun from public.ud_leady where id = p_lead for update;
  if not found then
    return jsonb_build_object('status', 'brak_leada', 'komunikat', 'Lead nie istnieje albo został zarchiwizowany.');
  end if;
  if not public.ud_leady_widzi(p_user, v_opiekun) then
    return jsonb_build_object('status', 'brak_leada',
      'komunikat', 'Ten lead nie jest przypisany do Ciebie. Leady przydziela administrator.');
  end if;

  select * into v_stary from public.ud_leady_historia h where h.lead_id = p_lead and h.klucz = p_klucz;
  if found then
    if v_stary.typ = 'notatka' then
      select * into n from public.ud_leady_notatki where id = (v_stary.dane->>'notatka_id')::uuid;
    end if;
    if v_stary.typ <> 'notatka' or n.tresc is distinct from v_tresc then
      return jsonb_build_object('status', 'klucz_uzyty', 'komunikat', 'Ten klucz posłużył do innej operacji.');
    end if;
    return jsonb_build_object('status', 'ok', 'powtorzone', true,
      'notatka', jsonb_build_object('id', n.id, 'tresc', n.tresc, 'autor_nazwa', n.autor_nazwa, 'created_at', n.created_at));
  end if;

  if not exists (select 1 from public.ud_leady_baza b where b.id = p_lead) then
    return jsonb_build_object('status', 'brak_leada', 'komunikat', 'Lead nie istnieje albo został zarchiwizowany.');
  end if;

  insert into public.ud_leady_notatki (lead_id, tresc, autor_id, autor_nazwa)
  values (p_lead, v_tresc, p_user, v_wyk)
  returning * into n;
  insert into public.ud_leady_historia (lead_id, typ, wykonawca_id, wykonawca_nazwa, dane, klucz)
  values (p_lead, 'notatka', p_user, v_wyk, jsonb_build_object('notatka_id', n.id), p_klucz);
  update public.ud_leady set updated_at = now() where id = p_lead;

  return jsonb_build_object('status', 'ok',
    'notatka', jsonb_build_object('id', n.id, 'tresc', n.tresc, 'autor_nazwa', n.autor_nazwa, 'created_at', n.created_at));
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Klienci widoczni dla użytkownika (zakładka „Klienci", wybór klienta
--    w ofercie). Administrator: wszyscy. Agent: klienci jego leadów oraz ci,
--    którzy leada jeszcze nie mają, a są jego — dodani przez niego w panelu
--    albo z jego kodem z linku do wniosku (synchronizacja założy lead z nim
--    jako opiekunem przy najbliższym otwarciu tablicy).

create or replace function public.ud_klienci_widoczni(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  with r as (select public.ud_leady_rola(p_user) as rola,
                    (select nullif(btrim(affiliate_code), '') from public.ud_user_profiles where id = p_user) as kod)
  select c.id
    from public.ud_clients c, r
   where r.rola = 'admin'
      or (r.rola is not null and (
            exists (select 1 from public.ud_leady l where l.klient_id = c.id and l.opiekun_id = p_user)
         or ((c.referred_by = p_user or (c.referred_by is null and btrim(c.affiliate_code_used) = r.kod))
             and not exists (select 1 from public.ud_leady l where l.klient_id = c.id))))
$fn$;

create or replace function public.ud_klient_widoczny(p_user uuid, p_klient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  with r as (select public.ud_leady_rola(p_user) as rola,
                    (select nullif(btrim(affiliate_code), '') from public.ud_user_profiles where id = p_user) as kod)
  select coalesce((
    select r.rola = 'admin'
        or (r.rola is not null and (
              exists (select 1 from public.ud_leady l where l.klient_id = c.id and l.opiekun_id = p_user)
           or ((c.referred_by = p_user or (c.referred_by is null and btrim(c.affiliate_code_used) = r.kod))
               and not exists (select 1 from public.ud_leady l where l.klient_id = c.id))))
      from public.ud_clients c, r
     where c.id = p_klient), false)
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Link agenta do wniosku (decyzja właściciela z 02.10.2026): klient, który
--    wejdzie na /wniosek/?agent=<kod> i złoży wniosek, trafia na tablicę jako
--    lead tego agenta. form-submit już zapisuje kod (affiliateCode →
--    ud_clients.affiliate_code_used) — ścieżka wniosku się nie zmienia, kod
--    czyta dopiero synchronizacja tablicy.

create or replace function public.ud_leady_synchronizuj()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_pipeline  uuid;
  v_start     uuid;
  n_klienci   int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ud_leady_synchronizuj'));

  select id into v_pipeline
    from public.ud_leady_pipeline where aktywny order by created_at, id limit 1;
  if v_pipeline is null then
    return jsonb_build_object('klienci', 0);
  end if;

  select e.id into v_start
    from public.ud_leady_etap e
   where e.pipeline_id = v_pipeline and e.aktywny and e.rodzaj = 'otwarty'
   order by (e.klucz = 'nowy') desc, e.pozycja, e.id
   limit 1;
  if v_start is null then
    return jsonb_build_object('klienci', 0);
  end if;

  with nowi as (
    insert into public.ud_leady (pipeline_id, etap_id, klient_id, opiekun_id, etap_od, powod_utraty,
                                 sprzedaz_wariant_id, skladka_roczna, skladka_mies, swiadczenie_okresowa,
                                 swiadczenie_trwala, swiadczenie_zgon, sprzedawca_id, sprzedano_at)
    select v_pipeline,
           coalesce(e.id, v_start),
           c.id,
           op.id,
           coalesce(o.zdarzenie, c.created_at, now()),
           case when e.rodzaj = 'przegrany' then 'Klient odrzucił ofertę (stan przeniesiony z ofert)' end,
           w.id,
           case when w.premium_total > 0 and w.premium_total < 1e10 then round(w.premium_total, 2) end,
           case when w.premium_monthly > 0 and w.premium_monthly < 1e10 then round(w.premium_monthly, 2) end,
           case when w.temp_incapacity_covered is not false and w.temp_monthly_benefit > 0
                 and w.temp_monthly_benefit < 1e10 then round(w.temp_monthly_benefit, 2) end,
           case when w.perm_incapacity_covered and w.perm_sum_insured > 0
                 and w.perm_sum_insured < 1e12 then round(w.perm_sum_insured, 2) end,
           case when w.death_covered then public.ud_kwota(w.parsed_raw->>'death_sum_insured') end,
           case when w.id is not null then op.id end,
           case when w.id is not null then o.zdarzenie end
      from public.ud_clients c
      left join lateral (
        select x.status, x.user_id, x.client_choice,
               coalesce(x.decided_at, x.viewed_at, x.sent_at, x.created_at) as zdarzenie
          from public.ud_offers x
         where x.client_id = c.id
           and (x.archived_at is null or x.status = 'bought')
         order by case x.status
                    when 'bought' then 6 when 'chosen' then 5 when 'viewed' then 4
                    when 'sent' then 3 when 'draft' then 2 when 'rejected' then 1 else 0 end desc,
                  coalesce(x.decided_at, x.viewed_at, x.sent_at, x.created_at) desc
         limit 1
      ) o on true
      -- Opiekun: dodany przez agenta w panelu (referred_by), potem kod z jego
      -- linku do wniosku (affiliate_code_used — zapisuje go form-submit), potem
      -- autor oferty. Konto nieaktywne nie zostaje opiekunem: lead czeka na
      -- przydział administratora.
      left join lateral (
        select pr.id from public.ud_user_profiles pr
         where pr.id = coalesce(c.referred_by,
                                (select a.id from public.ud_user_profiles a
                                  where nullif(btrim(c.affiliate_code_used), '') is not null
                                    and a.affiliate_code = btrim(c.affiliate_code_used)),
                                o.user_id)
           and coalesce(pr.active, true)
      ) op on true
      left join public.ud_leady_etap e
        on e.pipeline_id = v_pipeline and e.aktywny
       and e.klucz = case o.status
                       when 'bought' then 'wygrany' when 'chosen' then 'decyzja'
                       when 'viewed' then 'oferta'  when 'sent' then 'oferta'
                       when 'rejected' then 'przegrany' end
      left join public.ud_offer_documents w
        on e.rodzaj = 'wygrany'
       and o.client_choice->>'document_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and w.id = (o.client_choice->>'document_id')::uuid
     where not exists (select 1 from public.ud_leady x where x.klient_id = c.id)
    on conflict (klient_id) do nothing
    returning id
  )
  select count(*) into n_klienci from nowi;

  return jsonb_build_object('klienci', n_klienci);
end
$fn$;

-- Kod agenta do linku: istniejący albo kolejny wolny (0004, 0005…). Konto
-- nieaktywne albo nieznane — null. Unikalność pilnuje indeks na affiliate_code;
-- przy wyścigu dwóch nowych agentów druga próba bierze następny numer.
create or replace function public.ud_agent_kod(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kod text;
  n     integer;
begin
  if public.ud_leady_rola(p_user) is null then
    return null;
  end if;
  select nullif(btrim(affiliate_code), '') into v_kod from public.ud_user_profiles where id = p_user;
  if v_kod is not null then
    return v_kod;
  end if;
  for proba in 1..5 loop
    select coalesce(max(affiliate_code::integer), 0) + 1 into n
      from public.ud_user_profiles where affiliate_code ~ '^[0-9]{1,9}$';
    begin
      update public.ud_user_profiles
         set affiliate_code = lpad(n::text, 4, '0')
       where id = p_user and nullif(btrim(affiliate_code), '') is null
      returning affiliate_code into v_kod;
      return coalesce(v_kod, (select affiliate_code from public.ud_user_profiles where id = p_user));
    exception when unique_violation then
      null;
    end;
  end loop;
  return null;
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Uprawnienia: wszystko tylko dla klucza serwisowego.

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('ud_leady_widzi', 'ud_leady_liczba', 'ud_lead_plik_dodaj', 'ud_lead_plik',
                         'ud_leady_dopasowane', 'ud_leady_liczniki', 'ud_lead_szczegoly', 'ud_lead_zmien',
                         'ud_lead_notatka', 'ud_klienci_widoczni', 'ud_klient_widoczny',
                         'ud_leady_synchronizuj', 'ud_agent_kod')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
