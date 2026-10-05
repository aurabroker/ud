-- Tablica leadów (Kanban), część 6: wykaz polis.
-- Decyzja właściciela z 05.10.2026: „musimy mieć jeszcze wykaz polis, z datami,
-- składkami miesięcznymi".
--
--   * Sprzedaż (lead w „Wygrany") dostaje trzy pola polisy: numer, początek
--     i koniec ochrony. Wpisuje je agent w oknie „Dane sprzedaży" albo
--     „Dodaj polisę" — z pliku ich nie zgadujemy: czytnik PDF zna układ oferty,
--     nie polisy, a zła data końca ochrony to przegapione wznowienie.
--   * ud_leady_polisy — wykaz dla strony /panel/polisy. Kto co widzi: jak
--     w statystykach (administrator wszystkich, agent swoje sprzedaże —
--     sprzedawca, a bez niego opiekun). Składka miesięczna zapisana albo 1/12
--     rocznej (z flagą), prowizja jak w statystykach.
--
-- Stosuje się ją w Supabase SQL Editor (cały plik naraz — jedna transakcja),
-- bo MCP wstrzymuje funkcje z UPDATE do potwierdzenia, które nie dociera.
-- Kolejność: baza, potem panel v.0.62. Stary panel działa z nią dalej
-- (pól polisy po prostu nie wysyła).

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Pola polisy

alter table public.ud_leady
  add column if not exists polisa_numer text check (char_length(polisa_numer) between 1 and 60),
  add column if not exists ochrona_od   date,
  add column if not exists ochrona_do   date;
alter table public.ud_leady drop constraint if exists lead_ochrona_kolejnosc;
alter table public.ud_leady add constraint lead_ochrona_kolejnosc
  check (ochrona_od is null or ochrona_do is null or ochrona_do >= ochrona_od);

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
  l.sprzedano_at,
  -- Nowe (część 6):
  l.polisa_numer,
  l.ochrona_od,
  l.ochrona_do
from public.ud_leady l
left join public.ud_clients c         on c.id = l.klient_id
left join public.ud_wnioski_szkice s  on s.id = l.szkic_id
left join public.ud_user_profiles p   on p.id = l.opiekun_id
where l.zarchiwizowano_at is null
  and l.klient_id is not null;

revoke all on public.ud_leady_baza from public, anon, authenticated;
grant select on public.ud_leady_baza to service_role;

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
    'sprzedaz',      case when b.skladka_roczna is null and b.sprzedaz_wariant_id is null
                               and b.polisa_numer is null and b.ochrona_od is null then null
                          else jsonb_build_object(
                                 'wariant_id',           b.sprzedaz_wariant_id,
                                 'skladka_roczna',       b.skladka_roczna,
                                 'skladka_mies',         b.skladka_mies,
                                 'swiadczenie_okresowa', b.swiadczenie_okresowa,
                                 'swiadczenie_trwala',   b.swiadczenie_trwala,
                                 'swiadczenie_zgon',     b.swiadczenie_zgon,
                                 'polisa_numer',         b.polisa_numer,
                                 'ochrona_od',           b.ochrona_od,
                                 'ochrona_do',           b.ochrona_do) end
  )
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Zapis: pola polisy w danych sprzedaży (wejście do „Wygrany", poprawka,
--    „Dodaj polisę"); wyjście z „Wygrany" zeruje je razem z kwotami.

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
  v_nr       text;
  v_od       date;
  v_do       date;
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
        v_nr   := nullif(btrim(v_sp->>'polisa_numer'), '');
        v_od   := nullif(btrim(v_sp->>'ochrona_od'), '')::date;
        v_do   := nullif(btrim(v_sp->>'ochrona_do'), '')::date;
      end if;
      if coalesce(v_wariant::text, v_rok::text, v_mies::text, v_okr::text, v_trw::text, v_zgon::text, v_nr, v_od::text, v_do::text) is not null then
        v_sp_norm := jsonb_build_object(
          'wariant_id', v_wariant, 'skladka_roczna', v_rok, 'skladka_mies', v_mies,
          'swiadczenie_okresowa', v_okr, 'swiadczenie_trwala', v_trw, 'swiadczenie_zgon', v_zgon,
          'polisa_numer', v_nr, 'ochrona_od', v_od, 'ochrona_do', v_do);
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
  -- Pola polisy (część 6): numer do 60 znaków, daty w rozsądnym zakresie,
  -- koniec ochrony nie przed początkiem.
  if v_nr is not null and char_length(v_nr) > 60 then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('polisa_numer'),
      'komunikat', 'Numer polisy jest za długi (max 60 znaków).');
  end if;
  if v_od not between date '2000-01-01' and date '2100-12-31' or v_do not between date '2000-01-01' and date '2100-12-31' then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('ochrona_od', 'ochrona_do'),
      'komunikat', 'Sprawdź daty ochrony.');
  end if;
  if v_do < v_od then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('ochrona_do'),
      'komunikat', 'Koniec ochrony nie może być przed jej początkiem.');
  end if;
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
                                    'wariant_id', l.sprzedaz_wariant_id,
                                    'polisa_numer', l.polisa_numer, 'ochrona_od', l.ochrona_od, 'ochrona_do', l.ochrona_do);
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
           polisa_numer         = case when v_cel.rodzaj = 'wygrany' then v_nr end,
           ochrona_od           = case when v_cel.rodzaj = 'wygrany' then v_od end,
           ochrona_do           = case when v_cel.rodzaj = 'wygrany' then v_do end,
           sprzedawca_id        = case when v_cel.rodzaj = 'wygrany' then coalesce(l.opiekun_id, p_user) end,
           prowizja_procent     = case when v_cel.rodzaj = 'wygrany'
                                       then public.ud_stawka_prowizji(coalesce(l.opiekun_id, p_user)) end,
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
       and v_zgon is not distinct from l.swiadczenie_zgon and v_nr is not distinct from l.polisa_numer
       and v_od is not distinct from l.ochrona_od and v_do is not distinct from l.ochrona_do then
      return jsonb_build_object('status', 'bez_zmiany', 'lead', public.ud_lead_karta(p_lead));
    end if;
    v_poprz := case when l.skladka_roczna is null then null
                    else jsonb_build_object('skladka_roczna', l.skladka_roczna, 'skladka_mies', l.skladka_mies,
                                            'wariant_id', l.sprzedaz_wariant_id,
                                            'polisa_numer', l.polisa_numer, 'ochrona_od', l.ochrona_od,
                                            'ochrona_do', l.ochrona_do) end;
    update public.ud_leady
       set sprzedaz_wariant_id  = v_wariant,
           skladka_roczna       = v_rok,
           skladka_mies         = v_mies,
           swiadczenie_okresowa = v_okr,
           swiadczenie_trwala   = v_trw,
           swiadczenie_zgon     = v_zgon,
           polisa_numer         = v_nr,
           ochrona_od           = v_od,
           ochrona_do           = v_do,
           sprzedawca_id        = coalesce(l.sprzedawca_id, l.opiekun_id, p_user),
           prowizja_procent     = coalesce(l.prowizja_procent,
                                           public.ud_stawka_prowizji(coalesce(l.sprzedawca_id, l.opiekun_id, p_user))),
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

create or replace function public.ud_lead_polisa_reczna(p_user uuid, p_klucz text, p_dane jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_dane     jsonb := coalesce(p_dane, '{}'::jsonb);
  v_rola     text;
  v_wyk      text;
  v_nazwa    text;
  v_email    text;
  v_tel      text;
  v_pesel    text;
  v_agent    uuid;
  v_data     date;
  v_dzis     date := (now() at time zone 'Europe/Warsaw')::date;
  v_kiedy    timestamptz;
  v_sp       jsonb;
  v_rok      numeric;
  v_mies     numeric;
  v_okr      numeric;
  v_trw      numeric;
  v_zgon     numeric;
  v_nr       text;
  v_od       date;
  v_do       date;
  v_sp_norm  jsonb;
  v_zadanie  jsonb;
  v_stary    public.ud_leady_historia%rowtype;
  v_pipeline uuid;
  v_etap     uuid;
  v_istn     public.ud_leady%rowtype;
  v_klient   uuid;
  v_lead     uuid;
begin
  v_rola := public.ud_leady_rola(p_user);
  if v_rola is null then
    return jsonb_build_object('status', 'brak_uprawnien', 'komunikat', 'Brak dostępu do tablicy leadów.');
  end if;
  if p_klucz is null or char_length(p_klucz) not between 8 and 80 then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Brak klucza idempotencji.');
  end if;

  begin
    v_nazwa := left(regexp_replace(btrim(coalesce(v_dane->>'imie_nazwisko', '')), '\s+', ' ', 'g'), 200);
    v_email := lower(nullif(btrim(v_dane->>'email'), ''));
    v_tel   := nullif(regexp_replace(btrim(coalesce(v_dane->>'telefon', '')), '\s+', ' ', 'g'), '');
    v_pesel := nullif(regexp_replace(coalesce(v_dane->>'pesel', ''), '\s', '', 'g'), '');
    v_agent := coalesce(nullif(btrim(v_dane->>'agent_id'), '')::uuid, p_user);
    v_data  := coalesce(nullif(btrim(v_dane->>'data_sprzedazy'), '')::date, v_dzis);
    v_sp    := v_dane->'sprzedaz';
    if v_sp is not null and jsonb_typeof(v_sp) = 'object' then
      v_rok  := public.ud_leady_liczba(v_sp->'skladka_roczna');
      v_mies := public.ud_leady_liczba(v_sp->'skladka_mies');
      v_okr  := public.ud_leady_liczba(v_sp->'swiadczenie_okresowa');
      v_trw  := public.ud_leady_liczba(v_sp->'swiadczenie_trwala');
      v_zgon := public.ud_leady_liczba(v_sp->'swiadczenie_zgon');
      v_nr   := nullif(btrim(v_sp->>'polisa_numer'), '');
      v_od   := nullif(btrim(v_sp->>'ochrona_od'), '')::date;
      v_do   := nullif(btrim(v_sp->>'ochrona_do'), '')::date;
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format
            or invalid_parameter_value or numeric_value_out_of_range then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Niepoprawne dane żądania (sprawdź kwoty i datę).');
  end;

  if char_length(v_nazwa) < 3 then
    return jsonb_build_object('status', 'brak_danych', 'pola', jsonb_build_array('imie_nazwisko'),
      'komunikat', 'Podaj imię i nazwisko klienta.');
  end if;
  if v_email is not null and (char_length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('email'),
      'komunikat', 'Niepoprawny adres e-mail.');
  end if;
  if v_tel is not null and v_tel !~ '^\+?[0-9 ()-]{6,40}$' then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('telefon'),
      'komunikat', 'Niepoprawny numer telefonu.');
  end if;
  if v_pesel is not null and v_pesel !~ '^[0-9]{11}$' then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('pesel'),
      'komunikat', 'PESEL ma 11 cyfr.');
  end if;
  if v_data > v_dzis or v_data < date '2020-01-01' then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('data_sprzedazy'),
      'komunikat', 'Data sprzedaży nie może być z przyszłości.');
  end if;
  if v_rok is null then
    return jsonb_build_object('status', 'brak_danych', 'pola', jsonb_build_array('skladka_roczna'),
      'komunikat', 'Podaj składkę roczną sprzedanego wariantu.');
  end if;
  -- Pola polisy (część 6): numer do 60 znaków, daty w rozsądnym zakresie,
  -- koniec ochrony nie przed początkiem.
  if v_nr is not null and char_length(v_nr) > 60 then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('polisa_numer'),
      'komunikat', 'Numer polisy jest za długi (max 60 znaków).');
  end if;
  if v_od not between date '2000-01-01' and date '2100-12-31' or v_do not between date '2000-01-01' and date '2100-12-31' then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('ochrona_od', 'ochrona_do'),
      'komunikat', 'Sprawdź daty ochrony.');
  end if;
  if v_do < v_od then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('ochrona_do'),
      'komunikat', 'Koniec ochrony nie może być przed jej początkiem.');
  end if;
  if v_agent <> p_user and v_rola <> 'admin' then
    return jsonb_build_object('status', 'brak_uprawnien', 'komunikat', 'Sprzedaż innego agenta dodaje administrator.');
  end if;
  if public.ud_leady_rola(v_agent) is null then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('agent_id'),
      'komunikat', 'Nieznany albo nieaktywny agent.');
  end if;

  v_sp_norm := jsonb_build_object(
    'wariant_id', null, 'skladka_roczna', v_rok, 'skladka_mies', v_mies,
    'swiadczenie_okresowa', v_okr, 'swiadczenie_trwala', v_trw, 'swiadczenie_zgon', v_zgon,
    'polisa_numer', v_nr, 'ochrona_od', v_od, 'ochrona_do', v_do);
  v_zadanie := jsonb_build_object(
    'op', 'polisa',
    'odcisk', md5(concat_ws('|', v_nazwa, coalesce(v_email, ''), coalesce(v_tel, ''), coalesce(v_pesel, ''),
                            v_agent::text, v_data::text, v_sp_norm::text)));

  perform pg_advisory_xact_lock(hashtext('ud_lead_polisa_reczna'), hashtext(p_klucz));
  select * into v_stary from public.ud_leady_historia h where h.klucz = p_klucz order by h.id limit 1;
  if found then
    if v_stary.dane->'zadanie' is distinct from v_zadanie then
      return jsonb_build_object('status', 'klucz_uzyty', 'komunikat', 'Ten klucz posłużył do innej operacji.');
    end if;
    return jsonb_build_object('status', 'ok', 'powtorzone', true, 'lead_id', v_stary.lead_id,
      'lead', public.ud_lead_karta(v_stary.lead_id));
  end if;

  -- Ten sam człowiek drugi raz w kartotece rozjechałby statystykę i tablicę.
  if v_pesel is not null then
    select l.* into v_istn
      from public.ud_clients c
      left join public.ud_leady l on l.klient_id = c.id
     where regexp_replace(coalesce(c.pesel, ''), '\s', '', 'g') = v_pesel
     order by l.zarchiwizowano_at nulls first, c.created_at
     limit 1;
    if found then
      return jsonb_build_object('status', 'klient_istnieje', 'pola', jsonb_build_array('pesel'),
        'lead_id', case when v_istn.id is not null and v_istn.zarchiwizowano_at is null
                         and public.ud_leady_widzi(p_user, v_istn.opiekun_id) then v_istn.id end,
        'komunikat', case when v_istn.id is not null and v_istn.zarchiwizowano_at is null
                               and public.ud_leady_widzi(p_user, v_istn.opiekun_id)
                          then 'Klient z tym PESEL-em jest już w kartotece. Przenieś jego lead do „Wygrany" na tablicy.'
                          else 'Klient z tym PESEL-em jest już w kartotece. Jeśli nie widzisz go na tablicy, poproś administratora o przydział leada.' end);
    end if;
  end if;

  select id into v_pipeline from public.ud_leady_pipeline where aktywny order by created_at, id limit 1;
  select e.id into v_etap
    from public.ud_leady_etap e
   where e.pipeline_id = v_pipeline and e.aktywny and e.rodzaj = 'wygrany'
   order by (e.klucz = 'wygrany') desc, e.pozycja, e.id
   limit 1;
  if v_etap is null then
    return jsonb_build_object('status', 'niedozwolony', 'komunikat', 'Na tablicy nie ma etapu „Wygrany".');
  end if;

  -- Sprzedaż z dzisiaj — teraz; z innego dnia — w południe tego dnia (czas
  -- polski), żeby granice okresów w statystykach nie przesuwały jej o dzień.
  v_kiedy := case when v_data = v_dzis then now()
                  else (v_data::text || ' 12:00 Europe/Warsaw')::timestamptz end;
  select coalesce(nullif(btrim(full_name), ''), 'Agent') into v_wyk from public.ud_user_profiles where id = p_user;

  insert into public.ud_clients (full_name, source, referred_by, form_data)
  values (v_nazwa, 'polisa', v_agent, jsonb_build_object('dodano_z', 'polisa', 'dodal_id', p_user))
  returning id into v_klient;
  -- Osobno — patrz nagłówek sekcji (wyzwalacz potwierdzenia wniosku).
  if coalesce(v_email, v_tel, v_pesel) is not null then
    update public.ud_clients set email = v_email, phone = v_tel, pesel = v_pesel where id = v_klient;
  end if;

  insert into public.ud_leady (pipeline_id, etap_id, klient_id, opiekun_id, etap_od,
                               skladka_roczna, skladka_mies, swiadczenie_okresowa, swiadczenie_trwala,
                               swiadczenie_zgon, sprzedawca_id, sprzedano_at, prowizja_procent,
                               polisa_numer, ochrona_od, ochrona_do)
  values (v_pipeline, v_etap, v_klient, v_agent, v_kiedy,
          v_rok, v_mies, v_okr, v_trw, v_zgon, v_agent, v_kiedy, public.ud_stawka_prowizji(v_agent),
          v_nr, v_od, v_do)
  returning id into v_lead;
  insert into public.ud_leady_historia (lead_id, typ, do_etapu_id, wykonawca_id, wykonawca_nazwa, dane, klucz)
  values (v_lead, 'etap', v_etap, p_user, v_wyk,
          jsonb_build_object('zadanie', v_zadanie, 'zrodlo', 'polisa', 'sprzedaz', v_sp_norm), p_klucz);

  return jsonb_build_object('status', 'ok', 'lead_id', v_lead, 'lead', public.ud_lead_karta(v_lead));
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Wykaz polis

create or replace function public.ud_leady_polisy(
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
begin
  if v_rola is null then
    return null;
  end if;
  v_agent := case when v_rola = 'admin' then p_agent else p_user end;

  return jsonb_build_object(
    'rola',  v_rola,
    'agent', v_agent,
    -- „Dziś" w czasie polskim: od niego liczy się status (aktywna, wygasa…),
    -- więc nie bierzemy go z zegara przeglądarki.
    'dzis',  (now() at time zone 'Europe/Warsaw')::date,
    'agenci', case when v_rola = 'admin' then (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nazwa', coalesce(nullif(btrim(p.full_name), ''), 'Agent'))
                                order by p.full_name, p.id), '[]'::jsonb)
        from public.ud_user_profiles p where coalesce(p.active, true)) end,
    'polisy', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lead_id',        l.id,
               'archiwum',       l.zarchiwizowano_at is not null,
               'klient',         coalesce(nullif(btrim(c.full_name), ''), c.email, 'Bez nazwy'),
               'numer',          l.polisa_numer,
               'ochrona_od',     l.ochrona_od,
               'ochrona_do',     l.ochrona_do,
               'sprzedano',      coalesce(l.sprzedano_at, l.etap_od),
               'skladka_roczna', l.skladka_roczna,
               'skladka_mies',   coalesce(l.skladka_mies, round(l.skladka_roczna / 12, 2)),
               'mies_wyliczona', l.skladka_mies is null and l.skladka_roczna is not null,
               'stawka',         coalesce(l.prowizja_procent, ps.prowizja_procent),
               'prowizja',       round(l.skladka_roczna * coalesce(l.prowizja_procent, ps.prowizja_procent) / 100, 2),
               'agent_id',       coalesce(l.sprzedawca_id, l.opiekun_id),
               'agent',          nullif(btrim(ps.full_name), ''),
               'plik',           (select f.id from public.ud_leady_pliki f
                                   where f.lead_id = l.id order by f.created_at desc limit 1))
             order by coalesce(l.sprzedano_at, l.etap_od) desc, l.id)
        from public.ud_leady l
        join public.ud_leady_etap e on e.id = l.etap_id and e.rodzaj = 'wygrany'
        left join public.ud_clients c on c.id = l.klient_id
        left join public.ud_user_profiles ps on ps.id = coalesce(l.sprzedawca_id, l.opiekun_id)
       where l.klient_id is not null
         and (v_agent is null or coalesce(l.sprzedawca_id, l.opiekun_id) = v_agent)
         and (p_od is null or coalesce(l.sprzedano_at, l.etap_od) >= p_od)
         and (p_do is null or coalesce(l.sprzedano_at, l.etap_od) < p_do)), '[]'::jsonb)
  );
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Uprawnienia: wszystko tylko dla klucza serwisowego.

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('ud_lead_karta', 'ud_lead_zmien', 'ud_lead_polisa_reczna', 'ud_leady_polisy')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
