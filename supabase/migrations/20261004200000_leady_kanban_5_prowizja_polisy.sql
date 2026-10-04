-- Tablica leadów (Kanban), część 5: prowizja, składka bez opłaty
-- dystrybucyjnej, polisa spoza formularza. Decyzje właściciela z 04.10.2026:
--
--   * „prowizja Centrali to 20%, agent widzi w statystykach swoją prowizję,
--     przy dodawaniu agentów będziemy to definiować" — stawka jest cechą
--     AGENTA (ud_user_profiles.prowizja_procent, % składki rocznej), ustawia
--     ją administrator w Panelu Admina. Prowizja ze sprzedaży = składka roczna
--     × stawka sprzedawcy. Stawka zapisuje się przy sprzedaży
--     (ud_leady.prowizja_procent), żeby późniejsza zmiana stawki agenta nie
--     przepisywała jego historii; sprzedaż sprzed ustawienia stawki liczy się
--     stawką aktualną.
--   * „opłaty dystrybucyjnej nie doliczaj do składki" — składka w danych
--     sprzedaży jest bez opłaty (Leadenhall: 2 760, nie 3 036). Opłata nie jest
--     prowizją agenta i nigdzie się nie liczy.
--   * „dodaj opcję dodawania polisy, nawet jeśli klient nie zgłosił się przez
--     formularz" — ud_lead_polisa_reczna: klient trafia do kartoteki i od razu
--     do „Wygrany" z danymi sprzedaży. Plik polisy dokłada potem panel tą samą
--     drogą co przy leadzie (ud_lead_plik_dodaj).
--
-- Stosuje się ją w Supabase SQL Editor (cały plik naraz — jedna transakcja),
-- bo MCP wstrzymuje funkcje z UPDATE do potwierdzenia, które nie dociera
-- (supabase/migrations/README.md). Kolejność: baza, potem panel v.0.61.
-- Stary panel działa z nią dalej (nie zna tylko nowych pól).

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Stawka prowizji agenta i jej migawka przy sprzedaży

alter table public.ud_user_profiles
  add column if not exists prowizja_procent numeric(5,2)
  check (prowizja_procent >= 0 and prowizja_procent <= 100);

-- Centrala (konto administratora agencji): 20%.
update public.ud_user_profiles set prowizja_procent = 20
 where full_name = 'Centrala' and role = 'admin' and prowizja_procent is null;

alter table public.ud_leady
  add column if not exists prowizja_procent numeric(5,2)
  check (prowizja_procent >= 0 and prowizja_procent <= 100);

create or replace function public.ud_stawka_prowizji(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $fn$
  select prowizja_procent from public.ud_user_profiles where id = p_user
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Składka bez opłaty dystrybucyjnej
--
-- Leadenhall podaje w ofercie „Składka 2 760 zł, Opłata dystrybucyjna 276 zł,
-- razem 3 036 zł płatne w 12 ratach". Czytnik PDF zapisuje w premium_total
-- i premium_monthly kwotę DO ZAPŁATY (z opłatą) — tak ma zostać, bo tyle płaci
-- klient i to pokazuje oferta. W danych sprzedaży składka jest bez opłaty.
-- Rata bez opłaty: rata × netto / razem (3 036 / 253 → 2 760 / 230). Oferta
-- bez opłaty (CEU) — kwoty bez zmian.

create or replace function public.ud_skladka_netto(p_razem numeric, p_oplata numeric)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select case when p_razem > 0 and p_razem < 1e10
              then round(p_razem - case when p_oplata > 0 and p_oplata < p_razem then p_oplata else 0 end, 2) end
$fn$;

create or replace function public.ud_skladka_mies_netto(p_mies numeric, p_razem numeric, p_oplata numeric)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select case when p_mies > 0 and p_mies < 1e10 and p_razem > 0 and p_razem < 1e10
              then round(p_mies * public.ud_skladka_netto(p_razem, p_oplata) / p_razem, 2) end
$fn$;

-- Sprzedaże już zapisane z wariantu oferty, z kwotą skopiowaną z oferty
-- (składka = premium_total): składka bez opłaty. Kwot wpisanych ręcznie albo
-- odczytanych z polisy nie ruszamy — z bazy nie widać, czy zawierają opłatę;
-- te poprawia się w oknie „Dane sprzedaży" („Odczytaj kwoty z polisy").
-- Każda korekta zostawia wpis w historii leada z poprzednimi kwotami. Drugie
-- uruchomienie niczego nie zmienia (składka przestaje być równa premium_total).
with korekta as (
  select l.id, l.skladka_roczna as rok_przed, l.skladka_mies as mies_przed,
         public.ud_skladka_netto(d.premium_total, d.distribution_fee) as rok,
         case when l.skladka_mies is not distinct from d.premium_monthly
              then public.ud_skladka_mies_netto(d.premium_monthly, d.premium_total, d.distribution_fee)
              else l.skladka_mies end as mies
    from public.ud_leady l
    join public.ud_offer_documents d on d.id = l.sprzedaz_wariant_id
   where l.skladka_roczna = d.premium_total
     and d.distribution_fee > 0 and d.distribution_fee < d.premium_total
), zmiana as (
  update public.ud_leady l
     set skladka_roczna = k.rok, skladka_mies = k.mies, wersja = l.wersja + 1, updated_at = now()
    from korekta k
   where l.id = k.id
  returning l.id, k.rok_przed, k.mies_przed, k.rok, k.mies
)
insert into public.ud_leady_historia (lead_id, typ, wykonawca_nazwa, dane)
select z.id, 'sprzedaz', 'Korekta: składka bez opłaty dystrybucyjnej',
       jsonb_build_object('sprzedaz', jsonb_build_object('skladka_roczna', z.rok, 'skladka_mies', z.mies),
                          'poprzednia_sprzedaz', jsonb_build_object('skladka_roczna', z.rok_przed, 'skladka_mies', z.mies_przed))
  from zmiana z;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Zmiana stanu: przy wejściu do „Wygrany" zapisuje się stawka sprzedawcy;
--    poprawka danych sprzedaży jej nie zmienia (pierwsza zapisana zostaje);
--    wyjście z „Wygrany" ją zeruje razem z resztą danych sprzedaży.

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Synchronizacja: kupiona oferta z wyborem wariantu wnosi składkę bez
--    opłaty i stawkę sprzedawcy

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
                                 swiadczenie_trwala, swiadczenie_zgon, sprzedawca_id, sprzedano_at, prowizja_procent)
    select v_pipeline,
           coalesce(e.id, v_start),
           c.id,
           op.id,
           coalesce(o.zdarzenie, c.created_at, now()),
           case when e.rodzaj = 'przegrany' then 'Klient odrzucił ofertę (stan przeniesiony z ofert)' end,
           w.id,
           -- Składka BEZ opłaty dystrybucyjnej (decyzja z 04.10.2026).
           public.ud_skladka_netto(w.premium_total, w.distribution_fee),
           public.ud_skladka_mies_netto(w.premium_monthly, w.premium_total, w.distribution_fee),
           case when w.temp_incapacity_covered is not false and w.temp_monthly_benefit > 0
                 and w.temp_monthly_benefit < 1e10 then round(w.temp_monthly_benefit, 2) end,
           case when w.perm_incapacity_covered and w.perm_sum_insured > 0
                 and w.perm_sum_insured < 1e12 then round(w.perm_sum_insured, 2) end,
           case when w.death_covered then public.ud_kwota(w.parsed_raw->>'death_sum_insured') end,
           case when w.id is not null then op.id end,
           case when w.id is not null then o.zdarzenie end,
           case when w.id is not null then public.ud_stawka_prowizji(op.id) end
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Statystyki z prowizją

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
           l.swiadczenie_zgon                                      as zgon,
           round(l.skladka_roczna * coalesce(l.prowizja_procent, ps.prowizja_procent) / 100, 2) as prow
      from public.ud_leady l
      join public.ud_leady_etap e on e.id = l.etap_id and e.rodzaj = 'wygrany'
      left join public.ud_clients c on c.id = l.klient_id
      left join public.ud_user_profiles ps on ps.id = coalesce(l.sprzedawca_id, l.opiekun_id)
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
           round(avg(s.mies), 2)            as skladka_mies_srednia,
           coalesce(sum(s.prow), 0)         as prowizja_suma,
           count(*) filter (where s.rok is not null and s.prow is null)::int as bez_stawki,
           max(p.prowizja_procent)          as stawka
      from s left join public.ud_user_profiles p on p.id = s.agent_id
     group by s.agent_id, p.full_name, p.prowizja_procent
  )
  select jsonb_build_object(
    'rola',  v_rola,
    'agent', v_agent,
    -- Aktualna stawka wybranego agenta (agent: własna). Sprzedaże liczą się
    -- stawką z chwili sprzedaży, gdy ją zapisano.
    'stawka', (select prowizja_procent from public.ud_user_profiles where id = v_agent),
    'podsumowanie', (
      select jsonb_build_object(
        'sprzedaze',                 count(*),
        'z_danymi',                  count(s.rok),
        'skladka_roczna_suma',       coalesce(sum(s.rok), 0),
        'skladka_roczna_srednia',    round(avg(s.rok), 2),
        'skladka_mies_suma',         coalesce(sum(s.mies), 0),
        'skladka_mies_srednia',      round(avg(s.mies), 2),
        'skladka_mies_wyliczonych',  count(*) filter (where s.mies_wyliczona),
        'prowizja_suma',             coalesce(sum(s.prow), 0),
        'prowizja_srednia',          round(avg(s.prow), 2),
        'z_prowizja',                count(s.prow),
        -- Sprzedaż z kwotami, ale bez stawki sprzedawcy: prowizji nie da się policzyć.
        'bez_stawki',                count(*) filter (where s.rok is not null and s.prow is null),
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
               'skladka_mies_srednia', a.skladka_mies_srednia,
               'prowizja_suma', a.prowizja_suma, 'bez_stawki', a.bez_stawki, 'stawka', a.stawka)
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
-- 6. Polisa spoza formularza: nowy klient od razu w „Wygrany"
--
-- Agent dodaje polisę dla siebie; administrator — dla siebie albo dla
-- wskazanego agenta (ten zostaje opiekunem i sprzedawcą). Klient z tym samym
-- PESEL-em, który już jest w kartotece, nie jest zakładany drugi raz — jego
-- lead przenosi się do „Wygrany" na tablicy.
--
-- E-MAIL, TELEFON I PESEL IDĄ OSOBNYM UPDATE-EM, NIE W INSERT-CIE. Na
-- ud_clients stoi stary wyzwalacz send-confirmation-email-full (tylko INSERT):
-- wysyła klientowi „Twój kompletny wniosek ubezpieczeniowy dotarł… przekazaliśmy
-- go do weryfikacji" i SMS do doradcy „nowy wniosek". Klientowi, który ma już
-- polisę i żadnego wniosku nie składał, ten list mówiłby nieprawdę. Wiersz bez
-- e-maila funkcja brzegowa odrzuca („No email") i nic nie wysyła; UPDATE jej
-- nie wywołuje. Wyzwalacza nie ruszamy — to ścieżka wniosku (ABSOLUTE_RULE).
--
-- Idempotencja: klucz z panelu w ud_leady_historia (przy pierwszym wpisie
-- nowego leada). Ponowienie tym samym kluczem i tą samą treścią zwraca ten sam
-- lead; równoległe żądania z jednym kluczem ustawia w kolejce blokada doradcza.
-- W historii nie ma danych osobowych — tylko odcisk (md5) treści żądania.

create index if not exists ud_leady_historia_tylko_klucz_idx
  on public.ud_leady_historia (klucz) where klucz is not null;

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
  if v_agent <> p_user and v_rola <> 'admin' then
    return jsonb_build_object('status', 'brak_uprawnien', 'komunikat', 'Sprzedaż innego agenta dodaje administrator.');
  end if;
  if public.ud_leady_rola(v_agent) is null then
    return jsonb_build_object('status', 'bledne_dane', 'pola', jsonb_build_array('agent_id'),
      'komunikat', 'Nieznany albo nieaktywny agent.');
  end if;

  v_sp_norm := jsonb_build_object(
    'wariant_id', null, 'skladka_roczna', v_rok, 'skladka_mies', v_mies,
    'swiadczenie_okresowa', v_okr, 'swiadczenie_trwala', v_trw, 'swiadczenie_zgon', v_zgon);
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
                               swiadczenie_zgon, sprzedawca_id, sprzedano_at, prowizja_procent)
  values (v_pipeline, v_etap, v_klient, v_agent, v_kiedy,
          v_rok, v_mies, v_okr, v_trw, v_zgon, v_agent, v_kiedy, public.ud_stawka_prowizji(v_agent))
  returning id into v_lead;
  insert into public.ud_leady_historia (lead_id, typ, do_etapu_id, wykonawca_id, wykonawca_nazwa, dane, klucz)
  values (v_lead, 'etap', v_etap, p_user, v_wyk,
          jsonb_build_object('zadanie', v_zadanie, 'zrodlo', 'polisa', 'sprzedaz', v_sp_norm), p_klucz);

  return jsonb_build_object('status', 'ok', 'lead_id', v_lead, 'lead', public.ud_lead_karta(v_lead));
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Uprawnienia: wszystko tylko dla klucza serwisowego.

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('ud_stawka_prowizji', 'ud_skladka_netto', 'ud_skladka_mies_netto', 'ud_lead_zmien',
                         'ud_leady_synchronizuj', 'ud_leady_statystyki', 'ud_lead_polisa_reczna')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
