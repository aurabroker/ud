-- Tablica leadów (Kanban), część 3: zmiany po pierwszym dniu pracy na tablicy.
-- Decyzje właściciela z 02.10.2026:
--
--   * „Nowy" i „Kontakt" to jeden etap. Leady z Kontaktu przechodzą do Nowego,
--     a etap Kontakt jest WYŁĄCZANY, nie usuwany — historia wskazuje na niego
--     i ma dalej mówić, skąd lead przyszedł.
--   * Porzucone wnioski (szkice) nie są leadami. Zostają na liście
--     „Niedokończone" w panelu; z tablicy znikają, a wyzwalacz na szkicach,
--     który pilnował ich leadów, nie jest już potrzebny. Dzięki temu tablica
--     nie ma ŻADNEGO wyzwalacza — ani na ud_clients, ani na ud_wnioski_szkice.
--   * Wejście do „Wygrany" wymaga danych sprzedaży: składki rocznej (reszta
--     opcjonalna). Kwoty przychodzą z wybranego wariantu oferty albo są
--     wpisywane ręcznie — żadna oferta nie ma zapisanego wyboru klienta, więc
--     „który wariant sprzedano" wie tylko agent.
--   * Statystyki sprzedaży: administrator widzi wszystkich, agent swoje.
--   * Karta mówi, czy opiekun jest administratorem — panel wtedy go nie pokazuje.
--
-- Stosuje się ją w Supabase SQL Editor (cały plik naraz — jedna transakcja),
-- bo MCP wstrzymuje funkcje z UPDATE/DELETE do potwierdzenia, które nie dociera
-- (patrz supabase/migrations/README.md). lock_timeout: przeniesienie leadów
-- i zdjęcie wyzwalacza z ud_wnioski_szkice bierze krótkie blokady; lepiej, żeby
-- migracja odpadła po 5 s, niż żeby kreator wniosku czekał za nią.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Porzucone wnioski poza tablicą

drop trigger if exists ud_leady_szkic_zmiana on public.ud_wnioski_szkice;
drop function if exists public.ud_leady_szkic_zmiana();
drop function if exists public.ud_leady_przepnij_szkic(uuid, uuid);

delete from public.ud_leady where szkic_id is not null;

-- Kolumna szkic_id zostaje (widok i stare wpisy historii jej nie potrzebują,
-- ale usunięcie jej wymagałoby przebudowy widoku i wszystkich funkcji naraz).
-- To ograniczenie pilnuje, żeby żaden kod nie dołożył leada ze szkicu.
alter table public.ud_leady drop constraint if exists lead_tylko_klient;
alter table public.ud_leady add constraint lead_tylko_klient check (szkic_id is null);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Nowy i Kontakt to jeden etap

with przeniesione as (
  update public.ud_leady l
     set etap_id = n.id, wersja = l.wersja + 1, updated_at = now()
    from public.ud_leady_etap k
    join public.ud_leady_etap n on n.pipeline_id = k.pipeline_id and n.klucz = 'nowy'
   where k.klucz = 'kontakt' and l.etap_id = k.id
  returning l.id, k.id as z_id, n.id as do_id
)
insert into public.ud_leady_historia (lead_id, typ, z_etapu_id, do_etapu_id, wykonawca_nazwa, dane)
select id, 'etap', z_id, do_id, 'System — scalenie etapów Nowy i Kontakt', '{}'::jsonb
  from przeniesione;

update public.ud_leady_etap set aktywny = false where klucz = 'kontakt';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Dane sprzedaży

alter table public.ud_leady
  add column if not exists sprzedaz_wariant_id  uuid references public.ud_offer_documents(id) on delete set null,
  add column if not exists skladka_roczna       numeric(12,2) check (skladka_roczna > 0),
  add column if not exists skladka_mies         numeric(12,2) check (skladka_mies > 0),
  -- Świadczenia sprzedanego wariantu: okresowa niezdolność w zł MIESIĘCZNIE,
  -- trwała niezdolność i śmierć jako sumy ubezpieczenia.
  add column if not exists swiadczenie_okresowa numeric(12,2) check (swiadczenie_okresowa > 0),
  add column if not exists swiadczenie_trwala   numeric(14,2) check (swiadczenie_trwala > 0),
  add column if not exists swiadczenie_zgon     numeric(14,2) check (swiadczenie_zgon > 0),
  -- Czyja to sprzedaż w statystykach. Ustalana przy wejściu do „Wygrany"
  -- (opiekun, a gdy go nie ma — ten, kto przeniósł) i nie zmienia się razem
  -- z opiekunem: statystyka ma pamiętać, kto sprzedał.
  add column if not exists sprzedawca_id        uuid references public.ud_user_profiles(id) on delete set null,
  add column if not exists sprzedano_at         timestamptz;

create index if not exists ud_leady_sprzedaz_idx on public.ud_leady (sprzedano_at) where skladka_roczna is not null;

alter table public.ud_leady_etap drop constraint if exists ud_leady_etap_wymagane_pola_check;
alter table public.ud_leady_etap add constraint ud_leady_etap_wymagane_pola_check
  check (wymagane_pola <@ array['powod_utraty', 'skladka_roczna']);
update public.ud_leady_etap set wymagane_pola = array['skladka_roczna'] where klucz = 'wygrany' and rodzaj = 'wygrany';

alter table public.ud_leady_historia drop constraint if exists ud_leady_historia_typ_check;
alter table public.ud_leady_historia add constraint ud_leady_historia_typ_check
  check (typ in ('etap', 'dzialanie', 'opiekun', 'archiwum', 'notatka', 'przepieto', 'sprzedaz'));

-- Kwota z JSON-a: liczba albo tekst („1 500,50 zł"). Pusto → null; śmieci,
-- zero, wartości ujemne i astronomiczne → wyjątek, który ud_lead_zmien zamienia
-- na „błędne dane" (nie na „brak danych": agent coś wpisał, tylko źle).
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
  if n <= 0 or n >= 1e10 then
    raise exception 'kwota poza zakresem' using errcode = '22003';
  end if;
  return round(n, 2);
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Widok: tylko klienci, opiekun-administrator, dane sprzedaży
--
-- Pierwsze kolumny bez zmian (create or replace view pozwala tylko dokładać
-- na końcu); kolumny szkicu zostają i są puste.

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
  -- (zł / mies.) z wniosku. Nie jest składką ani przychodem.
  case when l.klient_id is not null then public.ud_kwota(c.temp_incapacity_sum) end as wartosc,
  array_position(array['kontakt', 'dane', 'zakres', 'zdrowie', 'zgody'], s.ostatni_krok) as krok_nr,
  case when l.szkic_id is not null then s.updated_at + interval '30 days' end as dane_do,
  -- Nowe (część 3):
  coalesce(p.role = 'admin', false)                     as opiekun_admin,
  l.skladka_roczna,
  l.skladka_mies,
  l.swiadczenie_okresowa,
  l.swiadczenie_trwala,
  l.swiadczenie_zgon,
  l.sprzedaz_wariant_id,
  coalesce(l.sprzedawca_id, l.opiekun_id)               as sprzedawca_id,
  l.sprzedano_at
from public.ud_leady l
left join public.ud_clients c         on c.id = l.klient_id
left join public.ud_wnioski_szkice s  on s.id = l.szkic_id
left join public.ud_user_profiles p   on p.id = l.opiekun_id
where l.zarchiwizowano_at is null
  and l.klient_id is not null;

revoke all on public.ud_leady_baza from public, anon, authenticated;
grant select on public.ud_leady_baza to service_role;

-- Karta: bez e-maila i PESEL-u. Dochodzi „opiekun_admin" (panel wtedy nie
-- pokazuje opiekuna) i „sprzedaz" (kwoty; tylko gdy są).
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
    'opiekun_admin', b.opiekun_admin,
    'dzialanie',     case when b.nastepne_dzialanie_typ is null then null
                          else jsonb_build_object('typ', b.nastepne_dzialanie_typ,
                                                  'termin', b.nastepne_dzialanie_at,
                                                  'opis', b.nastepne_dzialanie_opis) end,
    'etap_od',       b.etap_od,
    'zgloszono',     b.zgloszono,
    'krok_nr',       b.krok_nr,
    'dane_do',       b.dane_do,
    'powod_utraty',  b.powod_utraty,
    'sprzedaz',      case when b.skladka_roczna is null and b.sprzedaz_wariant_id is null then null
                          else jsonb_build_object(
                                 'wariant_id',           b.sprzedaz_wariant_id,
                                 'skladka_roczna',       b.skladka_roczna,
                                 'skladka_mies',         b.skladka_mies,
                                 'swiadczenie_okresowa', b.swiadczenie_okresowa,
                                 'swiadczenie_trwala',   b.swiadczenie_trwala,
                                 'swiadczenie_zgon',     b.swiadczenie_zgon) end
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
-- 5. Synchronizacja: tylko klienci
--
-- Etap startowy z ofert: bought → Wygrany, chosen → Decyzja klienta,
-- sent/viewed → Oferta, rejected → Przegrany, draft albo brak → Nowy.
-- Kupiona oferta z zapisanym wyborem wariantu wnosi dane sprzedaży od razu;
-- bez wyboru lead trafia do Wygrany „bez danych" i statystyki proszą o nie.

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
      left join lateral (
        select pr.id from public.ud_user_profiles pr
         where pr.id = coalesce(c.referred_by, o.user_id) and coalesce(pr.active, true)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Zmiana stanu leada — dochodzą dane sprzedaży i operacja „sprzedaz"
--
-- Statusy jak w części 2. Nowe przypadki:
--   brak_danych (pola = ["skladka_roczna"])  wejście do Wygrany bez składki rocznej
--   bledne_dane                              zła kwota albo wariant spoza ofert klienta
--   niedozwolony                             „sprzedaz" poza etapem Wygrany

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
    -- Administrator przypisuje komukolwiek. Zwykły agent może przejąć lead
    -- BEZ opiekuna na siebie albo zwolnić własny — cudzego nie przepisze.
    if v_rola <> 'admin' and not (
         (v_opiekun = p_user and l.opiekun_id is null)
         or (v_opiekun is null and l.opiekun_id = p_user)) then
      return jsonb_build_object('status', 'brak_uprawnien',
        'komunikat', 'Tylko administrator może zmienić opiekuna na inną osobę.');
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Odczyt: funkcje zależne od typu wiersza widoku — odtwarzane, bo widok
--    dostał nowe kolumny. Treść bez zmian poza licznikami (suma składek).

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

-- Zmiana typu wyniku (dochodzą składki) wymaga usunięcia funkcji.
drop function if exists public.ud_leady_liczniki(uuid, jsonb, uuid);
create function public.ud_leady_liczniki(p_pipeline uuid, p_filtr jsonb, p_user uuid)
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

create or replace function public.ud_leady_kolumna(
  p_pipeline uuid,
  p_etap     uuid,
  p_filtr    jsonb,
  p_sort     text,
  p_limit    integer,
  p_offset   integer,
  p_user     uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with o as (
    select b as lead,
           row_number() over (
             order by
               case when p_sort = 'wartosc' then b.wartosc end desc nulls last,
               case when p_sort = 'data' then b.zgloszono end desc,
               case when coalesce(p_sort, 'dzialanie') = 'dzialanie' then b.nastepne_dzialanie_at end asc nulls last,
               b.id
           ) as nr,
           count(*) over () as razem
      from public.ud_leady_dopasowane(p_pipeline, p_filtr, p_user) b
     where b.etap_id = p_etap
  )
  select jsonb_build_object(
           'karty', coalesce(jsonb_agg(public.ud_lead_karta(o.lead) order by o.nr)
                             filter (where o.nr > greatest(p_offset, 0)
                                       and o.nr <= greatest(p_offset, 0) + least(greatest(p_limit, 1), 100)),
                             '[]'::jsonb),
           'razem', coalesce(max(o.razem), 0))
    from o
$fn$;

create or replace function public.ud_lead_szczegoly(p_lead uuid)
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
-- 8. Statystyki sprzedaży
--
-- Sprzedaż = lead w etapie „Wygrany" (także zarchiwizowany — sprzedaż nie
-- przestaje nią być po sprzątnięciu tablicy). Agent widzi WYŁĄCZNIE swoje
-- (sprzedawca, a gdy go nie ma — opiekun); parametr p_agent bierze pod uwagę
-- tylko u administratora. Okres po dacie sprzedaży (albo wejścia do etapu).
--
-- Składka miesięczna: zapisana, a gdy jej nie ma — roczna / 12. Ile z nich
-- wyliczono, mówi „skladka_mies_wyliczonych" (strona to pokazuje): raty bywają
-- droższe niż 1/12 rocznej, więc wyliczona to przybliżenie, nie stawka.

create or replace function public.ud_leady_statystyki(
  p_user  uuid,
  p_od    timestamptz default null,
  p_do    timestamptz default null,
  p_agent uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_rola  text := public.ud_leady_rola(p_user);
  v_agent uuid;
  v_wynik jsonb;
begin
  if v_rola is null then
    return null;
  end if;
  v_agent := case when v_rola = 'admin' then p_agent else p_user end;

  with s as (
    select l.id,
           l.zarchiwizowano_at is not null                         as archiwum,
           coalesce(nullif(btrim(c.full_name), ''), c.email, 'Bez nazwy') as nazwa,
           coalesce(l.sprzedawca_id, l.opiekun_id)                 as agent_id,
           l.skladka_roczna                                        as rok,
           coalesce(l.skladka_mies, round(l.skladka_roczna / 12, 2)) as mies,
           (l.skladka_mies is null and l.skladka_roczna is not null) as mies_wyliczona,
           l.swiadczenie_okresowa                                  as okr,
           l.swiadczenie_trwala                                    as trw,
           l.swiadczenie_zgon                                      as zgon
      from public.ud_leady l
      join public.ud_leady_etap e on e.id = l.etap_id and e.rodzaj = 'wygrany'
      left join public.ud_clients c on c.id = l.klient_id
     where l.klient_id is not null
       and (v_agent is null or coalesce(l.sprzedawca_id, l.opiekun_id) = v_agent)
       and (p_od is null or coalesce(l.sprzedano_at, l.etap_od) >= p_od)
       and (p_do is null or coalesce(l.sprzedano_at, l.etap_od) < p_do)
  ), agenci as (
    select s.agent_id,
           coalesce(nullif(btrim(p.full_name), ''), case when s.agent_id is null then 'Bez opiekuna' else 'Agent' end) as nazwa,
           count(*)::int                    as sprzedaze,
           count(s.rok)::int                as z_danymi,
           coalesce(sum(s.rok), 0)          as skladka_roczna_suma,
           coalesce(sum(s.mies), 0)         as skladka_mies_suma,
           round(avg(s.mies), 2)            as skladka_mies_srednia
      from s left join public.ud_user_profiles p on p.id = s.agent_id
     group by s.agent_id, p.full_name
  )
  select jsonb_build_object(
    'rola',  v_rola,
    'agent', v_agent,
    'podsumowanie', (
      select jsonb_build_object(
        'sprzedaze',                 count(*),
        'z_danymi',                  count(s.rok),
        'skladka_roczna_suma',       coalesce(sum(s.rok), 0),
        'skladka_roczna_srednia',    round(avg(s.rok), 2),
        'skladka_mies_suma',         coalesce(sum(s.mies), 0),
        'skladka_mies_srednia',      round(avg(s.mies), 2),
        'skladka_mies_wyliczonych',  count(*) filter (where s.mies_wyliczona),
        'okresowa', jsonb_build_object('n', count(s.okr),  'suma', coalesce(sum(s.okr), 0),  'srednia', round(avg(s.okr), 2)),
        'trwala',   jsonb_build_object('n', count(s.trw),  'suma', coalesce(sum(s.trw), 0),  'srednia', round(avg(s.trw), 2)),
        'zgon',     jsonb_build_object('n', count(s.zgon), 'suma', coalesce(sum(s.zgon), 0), 'srednia', round(avg(s.zgon), 2)))
        from s),
    'bez_danych', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nazwa', s.nazwa, 'archiwum', s.archiwum) order by s.nazwa, s.id)
        from s where s.rok is null), '[]'::jsonb),
    'wg_agentow', case when v_rola = 'admin' and v_agent is null then coalesce((
      select jsonb_agg(jsonb_build_object(
               'agent_id', a.agent_id, 'nazwa', a.nazwa, 'sprzedaze', a.sprzedaze, 'z_danymi', a.z_danymi,
               'skladka_roczna_suma', a.skladka_roczna_suma, 'skladka_mies_suma', a.skladka_mies_suma,
               'skladka_mies_srednia', a.skladka_mies_srednia)
             order by a.skladka_roczna_suma desc, a.nazwa)
        from agenci a), '[]'::jsonb) end,
    'agenci', case when v_rola = 'admin' then (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nazwa', coalesce(nullif(btrim(p.full_name), ''), 'Agent'))
                                order by p.full_name, p.id), '[]'::jsonb)
        from public.ud_user_profiles p where coalesce(p.active, true)) end
  ) into v_wynik;

  return v_wynik;
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Uprawnienia: wszystko tylko dla klucza serwisowego.

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('ud_kwota', 'ud_leady_rola', 'ud_lead_karta', 'ud_leady_synchronizuj', 'ud_lead_zmien',
                         'ud_lead_notatka', 'ud_leady_dopasowane', 'ud_leady_liczniki', 'ud_leady_kolumna',
                         'ud_lead_szczegoly', 'ud_leady_zwin', 'ud_leady_plan', 'ud_leady_liczba', 'ud_leady_statystyki')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
