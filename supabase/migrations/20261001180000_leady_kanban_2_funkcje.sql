-- Tablica leadów (Kanban), część 2: funkcje zapisu i odczytu, wyzwalacz na szkicach.
-- Opis całości i zasady — w nagłówku części 1 (20261001151739_leady_kanban_1_tabele.sql).
--
-- Dlaczego dwie części: MCP Supabase (apply_migration i execute_sql) wstrzymuje do
-- ręcznego potwierdzenia każde polecenie tworzące funkcję, która zmienia dane w
-- tabeli public (UPDATE/DELETE w treści), a potwierdzenie nie dociera do
-- właściciela — zapytanie przepada po 60 s. Część 1 przeszła przez MCP; tę
-- stosuje się w Supabase SQL Editor (cały plik naraz — jedna transakcja).
--
-- lock_timeout: wyzwalacz na ud_wnioski_szkice bierze krótką blokadę tabeli,
-- którą pisze kreator wniosku. Lepiej, żeby migracja odpadła po 5 s, niż żeby
-- wnioski stały w kolejce za nią.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Przepięcie leada ze szkicu na klienta (wniosek został ukończony)

create or replace function public.ud_leady_przepnij_szkic(p_szkic uuid, p_klient uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_lead   uuid;
  v_cel    uuid;
begin
  select id into v_lead from public.ud_leady where szkic_id = p_szkic for update;
  if v_lead is null then
    return;
  end if;

  select id into v_cel from public.ud_leady where klient_id = p_klient for update;
  if v_cel is not null then
    -- Lead klienta już istnieje (synchronizacja zdążyła przed ukończeniem
    -- szkicu): notatki i historię przenosimy do niego, lead szkicu znika.
    update public.ud_leady_notatki set lead_id = v_cel where lead_id = v_lead;
    update public.ud_leady_historia set lead_id = v_cel, klucz = null where lead_id = v_lead;
    delete from public.ud_leady where id = v_lead;
    insert into public.ud_leady_historia (lead_id, typ, dane)
    values (v_cel, 'przepieto', jsonb_build_object('ze', 'szkic', 'scalono', true));
  else
    update public.ud_leady
       set klient_id = p_klient, szkic_id = null,
           wersja = wersja + 1, updated_at = now()
     where id = v_lead;
    insert into public.ud_leady_historia (lead_id, typ, dane)
    values (v_lead, 'przepieto', jsonb_build_object('ze', 'szkic', 'scalono', false));
  end if;
end
$fn$;

-- Wyzwalacz na SZKICACH (nie na ud_clients). Szkic zmienia się w „wystrzel i
-- zapomnij" po wysłaniu wniosku, więc wyzwalacz nie może zawieść: każdy błąd
-- jest połykany, a synchronizacja i widok (filtr zgody) naprawią resztę.
create or replace function public.ud_leady_szkic_zmiana()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  begin
    if new.client_id is not null and new.client_id is distinct from old.client_id then
      perform public.ud_leady_przepnij_szkic(new.id, new.client_id);
    elsif new.client_id is null
          and not (new.zgoda_kontakt and new.zgoda_wycofana_at is null and new.ukonczony_at is null) then
      -- Zgoda wycofana albo cofnięta, wniosek ukończony bez dopasowanego klienta:
      -- nie ma już tożsamości, którą ten lead mógłby przedstawiać.
      delete from public.ud_leady where szkic_id = new.id;
    end if;
  exception when others then
    null;
  end;
  return new;
end
$fn$;

-- `create or replace`: ponowne uruchomienie jest bezpieczne bez usuwania wyzwalacza,
-- a MCP Supabase wstrzymuje polecenia usuwające obiekty do ręcznego potwierdzenia.
create or replace trigger ud_leady_szkic_zmiana
  after update of client_id, zgoda_kontakt, zgoda_wycofana_at, ukonczony_at
  on public.ud_wnioski_szkice
  for each row execute function public.ud_leady_szkic_zmiana();

-- ─────────────────────────────────────────────────────────────────────────────
-- Synchronizacja: dokłada leady, sprząta po szkicach. Idempotentna; wołana przy
-- każdym otwarciu tablicy. Dzięki niej nic nie wisi na ścieżce zapisu wniosku.
--
-- Etap startowy klienta wynika z jego ofert (najdalszy status wśród ofert
-- nieoarchiwizowanych; zarchiwizowana liczy się tylko jako kupiona):
--   bought → Wygrany, chosen → Decyzja klienta, sent/viewed → Oferta,
--   draft → Kontakt, rejected → Przegrany, brak → Nowy.
-- To tylko punkt wyjścia. Później etap zmienia człowiek na tablicy.

create or replace function public.ud_leady_synchronizuj()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_pipeline  uuid;
  v_start     uuid;
  r           record;
  n_przepiete int := 0;
  n_usuniete  int := 0;
  n_klienci   int := 0;
  n_szkice    int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ud_leady_synchronizuj'));

  select id into v_pipeline
    from public.ud_leady_pipeline where aktywny order by created_at, id limit 1;
  if v_pipeline is null then
    return jsonb_build_object('klienci', 0, 'szkice', 0, 'przepiete', 0, 'usuniete', 0);
  end if;

  select e.id into v_start
    from public.ud_leady_etap e
   where e.pipeline_id = v_pipeline and e.aktywny and e.rodzaj = 'otwarty'
   order by (e.klucz = 'nowy') desc, e.pozycja, e.id
   limit 1;
  if v_start is null then
    return jsonb_build_object('klienci', 0, 'szkice', 0, 'przepiete', 0, 'usuniete', 0);
  end if;

  -- 1. Szkice ukończone z dopasowanym klientem → lead przechodzi na klienta.
  for r in
    select l.szkic_id, s.client_id
      from public.ud_leady l
      join public.ud_wnioski_szkice s on s.id = l.szkic_id
     where s.client_id is not null
  loop
    perform public.ud_leady_przepnij_szkic(r.szkic_id, r.client_id);
    n_przepiete := n_przepiete + 1;
  end loop;

  -- 2. Szkice, które przestały być leadem (zgoda cofnięta/wycofana, wniosek
  --    ukończony bez klienta).
  with usuniete as (
    delete from public.ud_leady l
     using public.ud_wnioski_szkice s
     where l.szkic_id = s.id
       and s.client_id is null
       and not (s.zgoda_kontakt and s.zgoda_wycofana_at is null and s.ukonczony_at is null)
    returning l.id
  )
  select count(*) into n_usuniete from usuniete;

  -- 3. Klienci bez leada.
  with nowi as (
    insert into public.ud_leady (pipeline_id, etap_id, klient_id, opiekun_id, etap_od, powod_utraty)
    select v_pipeline,
           coalesce(e.id, v_start),
           c.id,
           (select pr.id from public.ud_user_profiles pr
             where pr.id = coalesce(c.referred_by, o.user_id) and coalesce(pr.active, true)),
           coalesce(o.zdarzenie, c.created_at, now()),
           case when e.rodzaj = 'przegrany' then 'Klient odrzucił ofertę (stan przeniesiony z ofert)' end
      from public.ud_clients c
      left join lateral (
        select x.status, x.user_id,
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
      left join public.ud_leady_etap e
        on e.pipeline_id = v_pipeline and e.aktywny
       and e.klucz = case o.status
                       when 'bought' then 'wygrany' when 'chosen' then 'decyzja'
                       when 'viewed' then 'oferta'  when 'sent' then 'oferta'
                       when 'draft' then 'kontakt'  when 'rejected' then 'przegrany' end
     where not exists (select 1 from public.ud_leady x where x.klient_id = c.id)
    on conflict (klient_id) do nothing
    returning id
  )
  select count(*) into n_klienci from nowi;

  -- 4. Szkice ze zgodą, jeszcze bez leada.
  with nowe as (
    insert into public.ud_leady (pipeline_id, etap_id, szkic_id, etap_od)
    select v_pipeline, v_start, s.id, s.updated_at
      from public.ud_wnioski_szkice s
     where s.zgoda_kontakt
       and s.zgoda_wycofana_at is null
       and s.ukonczony_at is null
       and s.client_id is null
       and not exists (select 1 from public.ud_leady x where x.szkic_id = s.id)
    on conflict (szkic_id) do nothing
    returning id
  )
  select count(*) into n_szkice from nowe;

  return jsonb_build_object('klienci', n_klienci, 'szkice', n_szkice,
                            'przepiete', n_przepiete, 'usuniete', n_usuniete);
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Zmiana stanu leada — JEDNA ścieżka dla przeciągania, menu i szczegółów.
--
-- Zwraca jsonb { status, ... }:
--   ok              wykonano (powtorzone = true, gdy to ponowienie tego samego klucza)
--   bez_zmiany      stan już taki jak żądany
--   konflikt        ktoś zmienił lead — wersja inna niż oczekiwana (lead = stan bieżący)
--   brak_leada      nie ma takiego leada albo zniknął z widoku (archiwum, cofnięta zgoda)
--   brak_uprawnien  wykonawca nie jest aktywnym agentem albo nie może tej zmiany
--   niedozwolony    etap spoza pipeline'u / nieaktywny
--   brak_danych     etap wymaga pól, których nie podano (pola = [...])
--   bledne_dane     niepoprawne żądanie
--   klucz_uzyty     ten sam klucz idempotencji użyty do innej operacji

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
begin
  if p_op is null or p_op not in ('przenies', 'dzialanie', 'opiekun', 'archiwizuj') then
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

  -- Parsowanie żądania przed blokadą: zły uuid / data to błąd klienta, nie wyjątek.
  begin
    if p_op = 'przenies' then
      v_cel_id := (v_dane->>'etap_id')::uuid;
      v_powod  := nullif(btrim(v_dane->>'powod_utraty'), '');
      v_zadanie := jsonb_build_object('etap_id', v_cel_id, 'powod_utraty', v_powod);
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
    else
      v_zadanie := '{}'::jsonb;
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format
            or invalid_parameter_value then
    return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Niepoprawne dane żądania.');
  end;
  v_zadanie := jsonb_build_object('op', p_op) || v_zadanie;

  -- Od tej chwili wiersz jest zablokowany: równoległe żądania na tym samym
  -- leadzie ustawiają się w kolejce, więc nie ma okna na podwójny zapis.
  select * into l from public.ud_leady where id = p_lead for update;
  if not found then
    return jsonb_build_object('status', 'brak_leada', 'komunikat', 'Lead nie istnieje albo został zarchiwizowany.');
  end if;

  -- Ponowienie: ten sam klucz + ta sama treść = ten sam wynik, bez drugiego skutku.
  -- Sprawdzane PRZED widocznością: ponowiona archiwizacja nie ma zgłosić „brak leada".
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
    if char_length(coalesce(v_powod, '')) > 300 then
      return jsonb_build_object('status', 'bledne_dane', 'komunikat', 'Powód utraty jest za długi (max 300 znaków).');
    end if;

    -- Wejście do etapu zamykającego (Wygrany / Przegrany) kończy proces, więc
    -- zaplanowane działanie znika: przeterminowane „zadzwoń" przy zamkniętej
    -- sprawie krzyczałoby w nieskończoność. Poprzednie zostaje w historii.
    update public.ud_leady
       set etap_id = v_cel.id,
           etap_od = now(),
           powod_utraty = case when v_cel.rodzaj = 'przegrany' then v_powod end,
           nastepne_dzialanie_typ   = case when v_cel.rodzaj = 'otwarty' then nastepne_dzialanie_typ end,
           nastepne_dzialanie_at    = case when v_cel.rodzaj = 'otwarty' then nastepne_dzialanie_at end,
           nastepne_dzialanie_opis  = case when v_cel.rodzaj = 'otwarty' then nastepne_dzialanie_opis end,
           wersja = wersja + 1,
           updated_at = now()
     where id = p_lead;
    insert into public.ud_leady_historia (lead_id, typ, z_etapu_id, do_etapu_id, wykonawca_id, wykonawca_nazwa, dane, klucz)
    values (p_lead, 'etap', l.etap_id, v_cel.id, p_user, v_wyk,
            jsonb_build_object('zadanie', v_zadanie, 'powod_utraty', v_powod,
                               'zamkniete_dzialanie',
                               case when v_cel.rodzaj <> 'otwarty' and l.nastepne_dzialanie_typ is not null
                                    then jsonb_build_object('typ', l.nastepne_dzialanie_typ,
                                                            'termin', l.nastepne_dzialanie_at) end),
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

-- Notatka nie zmienia wersji (dopisanie notatki nie ma kolidować z przeniesieniem),
-- ale też jest idempotentna.
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

  perform 1 from public.ud_leady where id = p_lead for update;
  if not found then
    return jsonb_build_object('status', 'brak_leada', 'komunikat', 'Lead nie istnieje albo został zarchiwizowany.');
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
-- Odczyt: filtr, kolumny, liczniki, szczegóły

-- Zbiór leadów spełniających filtr — jedyne miejsce, w którym filtr jest
-- zdefiniowany, więc liczniki, sumy i karty nie mogą się rozjechać.
-- Klucze filtra: q, opiekun (uuid | 'brak' | 'ja'), zrodlo, produkt
-- (okresowa | trwala | zgon | nieznany), termin (przeterminowane | dzisiaj |
-- tydzien | brak). Wyszukiwanie przez strpos, nie ilike: `_` i `%` są
-- poprawnymi znakami w adresie e-mail i nie mogą działać jak wzorce.
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

-- Liczniki i sumy dla CAŁEGO zbioru (nie dla załadowanych kart). `ile` i `suma`
-- — po filtrze; `ile_wszystkich` i `suma_wszystkich` — bez filtra, do „8 z 24".
create or replace function public.ud_leady_liczniki(p_pipeline uuid, p_filtr jsonb, p_user uuid)
returns table (etap_id uuid, ile integer, ile_wszystkich integer, suma numeric, suma_wszystkich numeric)
language sql
stable
security definer
set search_path = ''
as $fn$
  with d as (
    select x.etap_id, count(*)::int as n, coalesce(sum(x.wartosc), 0) as s
      from public.ud_leady_dopasowane(p_pipeline, p_filtr, p_user) x
     group by x.etap_id
  ), w as (
    select y.etap_id, count(*)::int as n, coalesce(sum(y.wartosc), 0) as s
      from public.ud_leady_baza y
     where y.pipeline_id = p_pipeline
     group by y.etap_id
  )
  select e.id, coalesce(d.n, 0), coalesce(w.n, 0), coalesce(d.s, 0), coalesce(w.s, 0)
    from public.ud_leady_etap e
    left join d on d.etap_id = e.id
    left join w on w.etap_id = e.id
   where e.pipeline_id = p_pipeline and e.aktywny
   order by e.pozycja, e.id
$fn$;

-- Jedna strona kart jednego etapu. Sortowanie: dzialanie (najbliższy termin,
-- bez terminu na końcu) | data (najnowsze zgłoszenia) | wartosc (największe).
-- Remis rozstrzyga id, żeby kolejność była stabilna między stronami.
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

-- Szczegóły jednego leada. null, gdy leada nie ma w widoku.
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
-- Osobisty stan zwinięcia etapów (per użytkownik i pipeline)

-- p_etap null i p_zwin = false → rozwiń wszystkie. Atomowe (jedno upsert), więc
-- dwa szybkie kliknięcia nie nadpiszą się nawzajem. Zwraca aktualny zbiór.
create or replace function public.ud_leady_zwin(p_user uuid, p_pipeline uuid, p_etap uuid, p_zwin boolean)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_wynik uuid[];
begin
  if public.ud_leady_rola(p_user) is null then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  if p_etap is not null and not exists (
       select 1 from public.ud_leady_etap where id = p_etap and pipeline_id = p_pipeline and aktywny) then
    raise exception 'nieznany etap' using errcode = '22023';
  end if;

  insert into public.ud_leady_widok_uzytkownika as w (user_id, pipeline_id, zwiniete)
  values (p_user, p_pipeline, case when p_zwin and p_etap is not null then array[p_etap] else '{}'::uuid[] end)
  on conflict (user_id, pipeline_id) do update
     set zwiniete = case
           when p_etap is null then '{}'::uuid[]
           when p_zwin then (select coalesce(array_agg(distinct z), '{}') from unnest(w.zwiniete || p_etap) z)
           else array_remove(w.zwiniete, p_etap) end,
         updated_at = now()
  returning w.zwiniete into v_wynik;
  return v_wynik;
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Plan tablicy dla jednego agenta: pipeline, etapy, jego zwinięte etapy, lista
-- agentów do filtra i przypisywania. null, gdy to nie jest aktywny agent.
-- p_pipeline spoza listy → pipeline domyślny (pierwszy aktywny).

create or replace function public.ud_leady_plan(p_user uuid, p_pipeline uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_rola      text := public.ud_leady_rola(p_user);
  v_pipeline  public.ud_leady_pipeline%rowtype;
begin
  if v_rola is null then
    return null;
  end if;

  select * into v_pipeline from public.ud_leady_pipeline
   where aktywny and (p_pipeline is null or id = p_pipeline)
   order by created_at, id limit 1;
  if not found then
    select * into v_pipeline from public.ud_leady_pipeline where aktywny order by created_at, id limit 1;
  end if;
  if v_pipeline.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'rola', v_rola,
    'uzytkownik', (select jsonb_build_object('id', p.id, 'nazwa', coalesce(nullif(btrim(p.full_name), ''), 'Agent'))
                     from public.ud_user_profiles p where p.id = p_user),
    'pipeline', jsonb_build_object('id', v_pipeline.id, 'klucz', v_pipeline.klucz, 'nazwa', v_pipeline.nazwa),
    'pipelines', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nazwa', x.nazwa) order by x.created_at, x.id), '[]'::jsonb)
                    from public.ud_leady_pipeline x where x.aktywny),
    'etapy', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', e.id, 'klucz', e.klucz, 'nazwa', e.nazwa, 'pozycja', e.pozycja,
                        'rodzaj', e.rodzaj, 'wymagane_pola', to_jsonb(e.wymagane_pola)) order by e.pozycja, e.id), '[]'::jsonb)
                from public.ud_leady_etap e where e.pipeline_id = v_pipeline.id and e.aktywny),
    -- Tylko etapy, które nadal istnieją i są aktywne: nieaktualne identyfikatory
    -- zostają w bazie, ale nigdy nie trafiają do przeglądarki.
    'zwiniete', coalesce((select jsonb_agg(z) from public.ud_leady_widok_uzytkownika w
                           cross join lateral unnest(w.zwiniete) z
                           join public.ud_leady_etap e on e.id = z and e.pipeline_id = v_pipeline.id and e.aktywny
                          where w.user_id = p_user and w.pipeline_id = v_pipeline.id), '[]'::jsonb),
    'agenci', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', a.id, 'nazwa', coalesce(nullif(btrim(a.full_name), ''), 'Agent')) order by a.full_name, a.id), '[]'::jsonb)
                 from public.ud_user_profiles a where coalesce(a.active, true))
  );
end
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

notify pgrst, 'reload schema';
