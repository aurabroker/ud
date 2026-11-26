-- Testy SQL statystyk według źródła leada: public.ud_leady_statystyki_zrodla
-- (migracja 20261120110000_statystyki_zrodla.sql). Uruchamia je
-- apps/panel/scripts/test-leady-sql.mjs po leady.sql, na tym samym klastrze.
--
-- Całość w jednej transakcji wycofywanej na końcu: czyścimy tabele leadów
-- i kartotekę, wstawiamy własne dane z policzonymi na papierze liczbami,
-- a po testach baza wraca do stanu po leady.sql (testy współbieżności
-- w runnerze jadą dalej na nim).
--
-- Funkcja oddaje SUROWE grupy (platne, utm_source, utm_medium, link_agenta,
-- ma_zrodlo, kampania) — rodzaj „Google Ads / Link agenta / Inne / Brak danych"
-- liczy apps/panel/src/lib/zrodlo.js i tam jest testowany.

begin;

truncate public.ud_leady_widok_uzytkownika, public.ud_leady_notatki, public.ud_leady_historia, public.ud_leady_pliki,
         public.ud_leady, public.ud_offers, public.ud_clients cascade;

update public.ud_user_profiles
   set role = case when id = tt.id_adm() then 'admin' else 'user' end,
       active = (id <> tt.id_ines()),
       prowizja_procent = case when id = tt.id_adm() then 20 when id = tt.id_ula() then 15 end
 where id in (tt.id_adm(), tt.id_ula(), tt.id_olek(), tt.id_ines());

-- Klient z leadem. Sprzedaż: etap „Wygrany", data sprzedaży, składka, opcjonalnie
-- stawka zapisana przy sprzedaży i sprzedawca inny niż opiekun.
create function pg_temp.k(p_nr int, p_nazwa text, p_source text, p_utworzono timestamptz, p_form jsonb, p_kod text,
                          p_opiekun uuid, p_sprzedano timestamptz default null, p_skladka numeric default null,
                          p_stawka numeric default null, p_sprzedawca uuid default null, p_lead boolean default true,
                          p_etap_od timestamptz default null, p_wygrany boolean default null)
returns void language plpgsql as $$
declare
  v_klient uuid := ('c1000000-0000-0000-0000-' || lpad(p_nr::text, 12, '0'))::uuid;
begin
  insert into public.ud_clients (id, created_at, full_name, source, form_data, affiliate_code_used)
  values (v_klient, p_utworzono, p_nazwa, p_source, p_form, p_kod);
  if p_lead then
    insert into public.ud_leady (pipeline_id, etap_id, klient_id, opiekun_id, etap_od,
                                 skladka_roczna, sprzedano_at, prowizja_procent, sprzedawca_id)
    values (tt.pipeline(), tt.etap(case when p_sprzedano is not null or p_wygrany then 'wygrany' else 'nowy' end), v_klient, p_opiekun,
            coalesce(p_etap_od, p_sprzedano, p_utworzono), p_skladka, p_sprzedano, p_stawka, p_sprzedawca);
  end if;
end $$;

-- Grupa o dokładnie tych kluczach (null = brak wartości) albo null.
create function pg_temp.g(w jsonb, p boolean, s text, m text, l boolean, z boolean, kamp text) returns jsonb language sql as $$
  select x from jsonb_array_elements(w -> 'grupy') x
   where (x ->> 'platne')::boolean = p and x ->> 'utm_source' is not distinct from s and x ->> 'utm_medium' is not distinct from m
     and (x ->> 'link_agenta')::boolean = l and (x ->> 'ma_zrodlo')::boolean = z and x ->> 'kampania' is not distinct from kamp $$;
-- Miary grupy jako „wnioski/sprzedaże/składki/prowizja/bez stawki" (bez zer po przecinku).
create function pg_temp.m(x jsonb) returns text language sql as $$
  select format('%s/%s/%s/%s/%s', x ->> 'wnioski', x ->> 'sprzedaze', trim_scale((x ->> 'skladka_roczna_suma')::numeric),
                trim_scale((x ->> 'prowizja_suma')::numeric), x ->> 'bez_stawki') $$;
create function pg_temp.suma(w jsonb, pole text) returns numeric language sql as $$
  select coalesce(sum((x ->> pole)::numeric), 0) from jsonb_array_elements(w -> 'grupy') x $$;
-- Sprzedaże, składki i prowizja po wszystkich grupach = podsumowanie ud_leady_statystyki.
create function pg_temp.zgodne(p_user uuid, p_od timestamptz, p_do timestamptz, p_agent uuid) returns boolean language sql as $$
  select pg_temp.suma(z, 'sprzedaze') = (s -> 'podsumowanie' ->> 'sprzedaze')::numeric
     and pg_temp.suma(z, 'z_danymi') = (s -> 'podsumowanie' ->> 'z_danymi')::numeric
     and pg_temp.suma(z, 'skladka_roczna_suma') = (s -> 'podsumowanie' ->> 'skladka_roczna_suma')::numeric
     and pg_temp.suma(z, 'prowizja_suma') = (s -> 'podsumowanie' ->> 'prowizja_suma')::numeric
     and pg_temp.suma(z, 'bez_stawki') = (s -> 'podsumowanie' ->> 'bez_stawki')::numeric
     and (s -> 'podsumowanie' ->> 'sprzedaze')::int > 0
    from (select public.ud_leady_statystyki_zrodla(p_user, p_od, p_do, p_agent) z,
                 public.ud_leady_statystyki(p_user, p_od, p_do, p_agent) s) q $$;

-- ─── Dane (stawki: Ada 20%, Ula 15%, Olek bez stawki) ──────────────────────
select pg_temp.k(1, 'Ads Jeden', 'form', '2026-03-10 12:00+01',
  '{"zrodlo": {"utm_source": "ads", "utm_medium": "internet", "utm_campaign": "jesien26", "utm_term": "utrata",
               "platne": true, "zgoda_marketing": true, "gclid": "GCLID-SEKRET-123"}}', null,
  tt.id_ula(), '2026-03-20 12:00+01', 3000);                                         -- 15% → 450
select pg_temp.k(2, 'Ads Dwa', 'form', '2026-03-12 12:00+01',
  '{"zrodlo": {"utm_source": "  Google ", "utm_medium": "CPC", "utm_campaign": "jesien26", "platne": false, "zgoda_marketing": false}}',
  null, tt.id_olek());
select pg_temp.k(3, 'Ads Trzy', 'form', '2026-04-02 12:00+02',
  '{"zrodlo": {"gad_source": "1", "gad_campaignid": "998877", "platne": true, "zgoda_marketing": false}}', null,
  tt.id_ula(), '2026-04-05 12:00+02', 1200, 10);                                     -- stawka z chwili sprzedaży 10% → 120
select pg_temp.k(4, 'Agent Link', 'form', '2026-03-11 12:00+01', '{}', ' AG7 ',
  tt.id_ula(), '2026-03-25 12:00+01', 2000);                                         -- 300
select pg_temp.k(5, 'Agent z FB', 'form', '2026-03-13 12:00+01',
  '{"zrodlo": {"utm_source": "facebook", "platne": false, "zgoda_marketing": false}}', 'AG7', tt.id_olek());
select pg_temp.k(6, 'Inne FB', 'form', '2026-03-14 12:00+01',
  '{"zrodlo": {"utm_source": "FaceBook", "utm_medium": "social", "platne": false, "zgoda_marketing": true}}', null,
  tt.id_olek(), '2026-03-28 12:00+01', 1000);                                        -- Olek bez stawki → bez_stawki
select pg_temp.k(7, 'Inne fb małe', 'form', '2026-03-15 12:00+01',
  '{"zrodlo": {"utm_source": "facebook ", "utm_medium": "Social", "platne": false, "zgoda_marketing": false}}', null, tt.id_olek());
select pg_temp.k(8, 'Inne bez source', 'form', '2026-03-16 12:00+01',
  '{"zrodlo": {"utm_campaign": "x", "platne": false, "zgoda_marketing": false}}', null, null);
select pg_temp.k(9, 'Stary', 'direct', '2026-03-01 10:00+01', '{}', null,
  tt.id_ula(), '2026-03-05 12:00+01', 500);                                          -- 75
select pg_temp.k(10, 'Ręczny', 'manual', '2026-03-02 12:00+01', '{}', null,
  tt.id_ula(), '2026-03-06 12:00+01', 800);                                          -- 120, nie wniosek
select pg_temp.k(11, 'Polisa', 'polisa', '2026-03-03 12:00+01', '{"dodano_z": "polisa"}', null,
  tt.id_olek(), '2026-03-07 12:00+01', 900, 20, tt.id_olek(),
  p_etap_od => '2026-04-10 12:00+02');            -- 180, nie wniosek; do „Wygrany” weszła w kwietniu
select pg_temp.k(12, 'Zły form_data', 'form', '2026-03-17 12:00+01', '"tekst"', null, tt.id_ula());
select pg_temp.k(13, 'Tablica', 'form', '2026-03-18 12:00+01', '[1, 2]', null, tt.id_ula());
select pg_temp.k(14, 'Napis zamiast źródła', 'form', '2026-03-19 12:00+01', '{"zrodlo": "ads"}', null, tt.id_ula());
select pg_temp.k(15, 'Płatne napisem', 'form', '2026-03-20 12:00+01',
  '{"zrodlo": {"platne": "true", "utm_source": "mail"}}', null, tt.id_ula());
select pg_temp.k(16, 'Luty', 'form', '2026-02-20 12:00+01',
  '{"zrodlo": {"utm_campaign": "zima", "platne": true, "zgoda_marketing": true, "gclid": "GCLID-SEKRET-456"}}', null,
  tt.id_olek(), '2026-03-18 12:00+01', 600, null, tt.id_ula(),
  p_etap_od => '2026-02-25 12:00+01');            -- opiekun Olek, sprzedała Ula: 90; do „Wygrany” weszła w lutym
select pg_temp.k(17, 'Bez source', null, '2026-03-21 12:00+01', null, null, null);
select pg_temp.k(18, 'Bez leada', 'form', '2026-03-22 12:00+01',
  '{"zrodlo": {"utm_campaign": "jesien26", "platne": true, "zgoda_marketing": false}}', null, null, p_lead => false);
-- Sprzedaż bez zapisanej daty sprzedaży: okres po dacie wejścia do „Wygrany” (jak w ud_leady_statystyki).
select pg_temp.k(19, 'Bez daty sprzedaży', 'form', '2026-01-15 12:00+01',
  '{"zrodlo": {"utm_source": "partner", "platne": false, "zgoda_marketing": false}}', null,
  tt.id_ula(), null, 400, p_wygrany => true, p_etap_od => '2026-03-26 12:00+01');    -- 60

-- ─── Testy ──────────────────────────────────────────────────────────────────
do $$
declare
  w jsonb; s jsonb; marzec_od timestamptz := '2026-03-01 00:00 Europe/Warsaw'; marzec_do timestamptz := '2026-04-01 00:00 Europe/Warsaw';
  wyjatek boolean;
begin
  -- Administrator, cały czas.
  w := public.ud_leady_statystyki_zrodla(tt.id_adm());
  perform tt.t('źródła admin: rola i agent', w ->> 'rola' = 'admin' and w -> 'agent' = 'null'::jsonb);
  perform tt.t('źródła admin: wnioski = klienci z wniosku (bez manual i polisa) = 17',
    pg_temp.suma(w, 'wnioski') = 17);
  perform tt.t('źródła admin: sprzedaże 9, składki 10400, prowizja 1395, 1 bez stawki',
    pg_temp.suma(w, 'sprzedaze') = 9 and pg_temp.suma(w, 'skladka_roczna_suma') = 10400
    and pg_temp.suma(w, 'prowizja_suma') = 1395 and pg_temp.suma(w, 'bez_stawki') = 1);
  perform tt.t('źródła admin: 12 grup, grup_wszystkich = długość listy',
    jsonb_array_length(w -> 'grupy') = 12 and (w ->> 'grup_wszystkich')::int = 12);
  perform tt.t('grupa: sprzedaż bez daty sprzedaży', pg_temp.m(pg_temp.g(w, false, 'partner', null, false, true, null)) = '1/1/400/60/0');

  perform tt.t('grupa: platne + ads/internet + kampania jesien26 (z gclid w danych)',
    pg_temp.m(pg_temp.g(w, true, 'ads', 'internet', false, true, 'jesien26')) = '1/1/3000/450/0');
  perform tt.t('grupa: utm_source i utm_medium małymi literami i przycięte („  Google " / „CPC")',
    pg_temp.m(pg_temp.g(w, false, 'google', 'cpc', false, true, 'jesien26')) = '1/0/0/0/0');
  perform tt.t('grupa: kampania z gad_campaignid, gdy brak utm_campaign; stawka z chwili sprzedaży (10%)',
    pg_temp.m(pg_temp.g(w, true, null, null, false, true, '998877')) = '1/1/1200/120/0');
  perform tt.t('grupa: link agenta (kod z odstępami) bez źródła',
    pg_temp.m(pg_temp.g(w, false, null, null, true, false, null)) = '1/1/2000/300/0');
  perform tt.t('grupa: link agenta i utm_source osobno od samego utm_source (rodzaj rozstrzyga zrodlo.js)',
    pg_temp.m(pg_temp.g(w, false, 'facebook', null, true, true, null)) = '1/0/0/0/0');
  perform tt.t('grupa: „FaceBook" i „facebook " to jedna grupa (wielkość liter, odstępy); sprzedaż bez stawki',
    pg_temp.m(pg_temp.g(w, false, 'facebook', 'social', false, true, null)) = '2/1/1000/0/1');
  perform tt.t('grupa: zrodlo bez utm_source — ma_zrodlo, kampania x',
    pg_temp.m(pg_temp.g(w, false, null, null, false, true, 'x')) = '1/0/0/0/0');
  perform tt.t('grupa: platne jako napis "true" NIE jest płatne (jak platne === true w zrodlo.js)',
    pg_temp.m(pg_temp.g(w, false, 'mail', null, false, true, null)) = '1/0/0/0/0'
    and pg_temp.g(w, true, 'mail', null, false, true, null) is null);
  perform tt.t('grupa bez źródła: stare wnioski, form_data napis/tablica, zrodlo napis, source null — ma_zrodlo false',
    pg_temp.m(pg_temp.g(w, false, null, null, false, false, null)) = '5/3/2200/375/0');
  perform tt.t('manual i polisa: nie są wnioskami, ich sprzedaże się liczą (w grupie bez źródła)',
    (pg_temp.g(w, false, null, null, false, false, null) ->> 'sprzedaze')::int = 3
    and (pg_temp.g(w, false, null, null, false, false, null) ->> 'wnioski')::int = 5);
  perform tt.t('klient bez leada: administrator liczy jego wniosek',
    pg_temp.m(pg_temp.g(w, true, null, null, false, true, 'jesien26')) = '1/0/0/0/0');
  perform tt.t('kolejność: najwięcej wniosków + sprzedaży pierwsze (grupa bez źródła: 5 + 3)',
    (w -> 'grupy' -> 0 ->> 'wnioski')::int = 5 and (w -> 'grupy' -> 0 ->> 'ma_zrodlo')::boolean = false);
  perform tt.t('identyfikatorów kliknięcia w wyniku nie ma (ani wartości, ani nazwy pola)',
    w::text not like '%SEKRET%' and w::text not like '%gclid%' and w::text not like '%gbraid%' and w::text not like '%wbraid%');
  perform tt.t('źródła = ud_leady_statystyki: admin, cały czas', pg_temp.zgodne(tt.id_adm(), null, null, null));

  -- Okres: wnioski po dacie utworzenia klienta, sprzedaże po dacie sprzedaży.
  w := public.ud_leady_statystyki_zrodla(tt.id_adm(), marzec_od, marzec_do);
  perform tt.t('okres marzec: 14 wniosków (bez kwietniowego, lutowego i styczniowego), 8 sprzedaży, 9200 zł, prowizja 1275',
    pg_temp.suma(w, 'wnioski') = 14 and pg_temp.suma(w, 'sprzedaze') = 8
    and pg_temp.suma(w, 'skladka_roczna_suma') = 9200 and pg_temp.suma(w, 'prowizja_suma') = 1275);
  perform tt.t('okres marzec: klient z lutego sprzedany w marcu (do „Wygrany” w lutym) — tylko sprzedaż, po dacie sprzedaży',
    pg_temp.m(pg_temp.g(w, true, null, null, false, true, 'zima')) = '0/1/600/90/0');
  perform tt.t('okres marzec: sprzedaż bez daty sprzedaży liczy się po wejściu do „Wygrany”',
    pg_temp.m(pg_temp.g(w, false, 'partner', null, false, true, null)) = '0/1/400/60/0');
  perform tt.t('okres marzec: wniosek i sprzedaż z kwietnia poza okresem (grupy nie ma)',
    pg_temp.g(w, true, null, null, false, true, '998877') is null);
  perform tt.t('okres: granica p_do wyłączna, p_od włączna',
    pg_temp.suma(public.ud_leady_statystyki_zrodla(tt.id_adm(), '2026-03-10 12:00+01', '2026-03-11 12:00+01'), 'wnioski') = 1);
  perform tt.t('źródła = ud_leady_statystyki: admin, marzec', pg_temp.zgodne(tt.id_adm(), marzec_od, marzec_do, null));
  perform tt.t('okres w przyszłości: pusto',
    public.ud_leady_statystyki_zrodla(tt.id_adm(), now() + interval '1 day', null) -> 'grupy' = '[]'::jsonb);

  -- Widoczność.
  w := public.ud_leady_statystyki_zrodla(tt.id_ula(), null, null, tt.id_olek());
  perform tt.t('agent (Ula) z cudzym agentem w parametrze: wyłącznie swoje',
    w ->> 'rola' = 'user' and w ->> 'agent' = tt.id_ula()::text);
  perform tt.t('agent: wnioski klientów, których lead prowadzi (9), sprzedaże, w których jest sprzedawcą (7)',
    pg_temp.suma(w, 'wnioski') = 9 and pg_temp.suma(w, 'sprzedaze') = 7
    and pg_temp.suma(w, 'skladka_roczna_suma') = 8500 and pg_temp.suma(w, 'prowizja_suma') = 1215);
  perform tt.t('agent: sprzedaż klienta Olka, którą zamknęła Ula — u Uli jako sprzedaż, bez wniosku',
    pg_temp.m(pg_temp.g(w, true, null, null, false, true, 'zima')) = '0/1/600/90/0');
  perform tt.t('agent: nic z leadów Olka ani wolnych',
    pg_temp.g(w, false, 'facebook', 'social', false, true, null) is null
    and pg_temp.g(w, false, null, null, false, true, 'x') is null
    and pg_temp.g(w, true, null, null, false, true, 'jesien26') is null);
  perform tt.t('źródła = ud_leady_statystyki: agent z cudzym parametrem', pg_temp.zgodne(tt.id_ula(), null, null, tt.id_olek()));

  w := public.ud_leady_statystyki_zrodla(tt.id_adm(), null, null, tt.id_olek());
  perform tt.t('administrator dla wybranego agenta (Olek): 5 wniosków, 2 sprzedaże, 1900 zł, prowizja 180',
    w ->> 'agent' = tt.id_olek()::text and pg_temp.suma(w, 'wnioski') = 5 and pg_temp.suma(w, 'sprzedaze') = 2
    and pg_temp.suma(w, 'skladka_roczna_suma') = 1900 and pg_temp.suma(w, 'prowizja_suma') = 180
    and pg_temp.suma(w, 'bez_stawki') = 1);
  perform tt.t('agent Olek sam = administrator dla Olka',
    (public.ud_leady_statystyki_zrodla(tt.id_olek()) - 'rola') = (w - 'rola'));
  perform tt.t('źródła = ud_leady_statystyki: administrator dla Olka', pg_temp.zgodne(tt.id_adm(), null, null, tt.id_olek()));
  perform tt.t('źródła = ud_leady_statystyki: Olek sam', pg_temp.zgodne(tt.id_olek(), null, null, null));
  perform tt.t('nieaktywne konto i obcy uuid → null (jak ud_leady_statystyki)',
    public.ud_leady_statystyki_zrodla(tt.id_ines()) is null and public.ud_leady_statystyki_zrodla(gen_random_uuid()) is null
    and public.ud_leady_statystyki_zrodla(null) is null);

  -- Uprawnienia.
  perform tt.t('uprawnienia: ud_leady_statystyki_zrodla tylko dla service_role',
    (select not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
            and has_function_privilege('service_role', p.oid, 'execute')
       from pg_proc p where p.proname = 'ud_leady_statystyki_zrodla' and p.pronamespace = 'public'::regnamespace));
  perform tt.t('funkcja: security definer, pusty search_path',
    (select p.prosecdef and p.proconfig = array['search_path=""']
       from pg_proc p where p.proname = 'ud_leady_statystyki_zrodla' and p.pronamespace = 'public'::regnamespace));
  wyjatek := false;
  begin
    execute 'set local role anon';
    perform public.ud_leady_statystyki_zrodla(tt.id_adm());
  exception when insufficient_privilege then wyjatek := true;
  end;
  execute 'reset role';
  perform tt.t('uprawnienia: anon dostaje odmowę przy wywołaniu', wyjatek);
end $$;

-- Limit 500 grup: zalew różnych kampanii z cudzych linków nie rozdyma odpowiedzi.
insert into public.ud_clients (created_at, full_name, source, form_data)
select '2026-03-23 12:00+01', 'Zalew ' || n, 'form',
       jsonb_build_object('zrodlo', jsonb_build_object('platne', true, 'zgoda_marketing', false, 'utm_campaign', 'k' || lpad(n::text, 3, '0')))
  from generate_series(1, 510) n;
do $$
declare
  w jsonb := public.ud_leady_statystyki_zrodla(tt.id_adm());
begin
  perform tt.t('limit: 500 grup w odpowiedzi, grup_wszystkich = 522',
    jsonb_array_length(w -> 'grupy') = 500 and (w ->> 'grup_wszystkich')::int = 522);
  perform tt.t('limit: ucięte są najmniejsze grupy — największa (5 + 3) zostaje na początku',
    (w -> 'grupy' -> 0 ->> 'wnioski')::int = 5 and (w -> 'grupy' -> 0 ->> 'sprzedaze')::int = 3);
end $$;

-- Wartości ponad 100 znaków: portal ich nie przepuszcza, ale form-submit kopiuje
-- ciało żądania do form_data bez limitu. Spreparowany wniosek z 200 000 znaków
-- w utm_campaign / utm_source / utm_medium nie może jechać w całości w danych strony.
-- Bez zalewu z poprzedniego bloku: limit 500 grup uciąłby te, o które pytamy.
delete from public.ud_clients where full_name like 'Zalew %';
insert into public.ud_clients (created_at, full_name, source, form_data)
values ('2026-03-24 12:00+01', 'Długie kampania', 'form', jsonb_build_object('zrodlo', jsonb_build_object(
          'platne', true, 'utm_campaign', '  ' || repeat('K', 200000)))),
       ('2026-03-24 12:00+01', 'Długie źródło', 'form', jsonb_build_object('zrodlo', jsonb_build_object(
          'platne', false, 'utm_source', repeat('S', 200000), 'utm_medium', repeat('M', 200000)))),
       ('2026-03-24 12:00+01', 'Długie gad', 'form', jsonb_build_object('zrodlo', jsonb_build_object(
          'platne', true, 'gad_campaignid', repeat('9', 200000))));
do $$
declare
  w jsonb := public.ud_leady_statystyki_zrodla(tt.id_adm());
begin
  perform tt.t('długie wartości: kampania (utm_campaign po btrim) ucięta do 100 znaków',
    pg_temp.g(w, true, null, null, false, true, repeat('K', 100)) is not null);
  perform tt.t('długie wartości: utm_source i utm_medium małymi literami, ucięte do 100 znaków',
    pg_temp.g(w, false, repeat('s', 100), repeat('m', 100), false, true, null) is not null);
  perform tt.t('długie wartości: kampania z gad_campaignid też ucięta do 100',
    pg_temp.g(w, true, null, null, false, true, repeat('9', 100)) is not null);
  perform tt.t('długie wartości: żadne pole grupy nie ma więcej niż 100 znaków',
    not exists (select 1 from jsonb_array_elements(w -> 'grupy') x
                 where char_length(x ->> 'utm_source') > 100 or char_length(x ->> 'utm_medium') > 100
                    or char_length(x ->> 'kampania') > 100));
end $$;

rollback;
