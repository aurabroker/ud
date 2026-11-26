-- Kalibracja stawek kalkulatora (ud-kalibrator) — decyzje właściciela
-- z 14.10.2026. Specyfikacja: metoda „osoby-v1".
--
-- Co tu jest:
--   * ud_kalibracja_ustawienia — jeden wiersz: tryb pracy kalibratora
--     (wylaczony / na_sucho / propozycja), gałąź produkcyjna portalu, adres,
--     na który idą maile, i opcjonalna dolna granica danych (dane_od —
--     właściciel ustawia ją przy zmianie taryfy ubezpieczyciela).
--   * ud_kalibracja_przebiegi — dziennik przebiegów funkcji brzegowej
--     `kalibrator` (wynik, wyliczone liczby, numer PR). Bez danych osobowych.
--   * ud_kalibracja_stawek() — liczy stawki z ofert. Tylko odczyt (STABLE,
--     SECURITY INVOKER): woła ją funkcja brzegowa kluczem serwisowym.
--   * ud_kalibracja_uruchom() + pg_cron `kalibracja-stawek` (pn–pt 05:40 UTC)
--     — woła funkcję brzegową z tokenem z Vaulta (wzorzec edge_cron_token).
--     Zadanie powstaje WYŁĄCZONE; włącza je człowiek:
--       select cron.alter_job((select jobid from cron.job
--         where jobname = 'kalibracja-stawek'), active := true);
--
-- Metoda (dlaczego tak, a nie średnia ze wszystkich wariantów):
--   * Do bazy wchodzi tylko wariant porównywalny z kalkulatorem: Leadenhall,
--     oferta wysłana (status ≠ draft, sent_at), samo świadczenie miesięczne
--     (bez trwałej niezdolności i bez śmierci), raty miesięczne (12), okres
--     wyczekiwania do 21 dni, bez klauzuli HIV/WZW (niesie ją osobny mnożnik
--     1,07 w symulacja.ts) i bez płatnych dodatków — wolno tylko LW144
--     (ograniczenie chorób zwyrodnieniowych), który ceny nie podnosi.
--   * Okno: 365 dni wstecz po sent_at, z 48 h karencji (oferta wysłana przed
--     chwilą bywa jeszcze poprawiana i wysyłana drugi raz). Archiwalne oferty
--     się liczą — archiwum to porządek na liście, nie unieważnienie oferty.
--   * Składka BRUTTO (premium_total: to, co płaci klient, z opłatą
--     dystrybucyjną) — kalkulator pokazuje kwotę do zapłaty. NIGDY
--     ud_skladka_netto: tamta służy prowizji, nie cenie dla klienta.
--   * Jedna osoba = jedna obserwacja. Osoba to skrót PESEL-u (dwie kartoteki
--     z jednym PESEL-em to jedna osoba), a bez niego klient albo oferta.
--     Skrót nigdy nie opuszcza funkcji. Stawka osoby = mediana jej wariantów
--     24-miesięcznych z NAJNOWSZEJ oferty — kto dostał trzy warianty
--     świadczenia, nie waży trzy razy więcej niż ten, kto dostał jeden.
--   * dol / gora = najtańsza i najdroższa osoba (zaokrąglone W GÓRĘ do 0,01
--     punktu procentowego — zaniżona cena to najgorszy kierunek błędu),
--     srodek = mediana osób w górę do 0,1 p.p.
--   * Mnożnik okresu tylko z par w JEDNEJ ofercie (to samo świadczenie,
--     wyczekiwanie, dodatki i baza OWU, inny okres wypłaty) i tylko przy
--     ≥ 3 osobach o zgodnych ilorazach (rozrzut ≤ 1,05). Bez ekstrapolacji:
--     48 i 60 nie powstaną, dopóki nie ma par.
--   * Poniżej 8 osób — za_malo_osob, bez stawek. Jakakolwiek anomalia
--     w danych (rata × 12 ≠ składka, „do zapłaty" ≠ składka, stawka poza
--     1–5%) — status anomalie, bez stawek: nic nie jest pomijane po cichu.
--
-- Funkcje bez UPDATE/DELETE — MCP przyjmie migrację bez potwierdzeń.

-- ─────────────────────────────────────────────────────────────────────────────
-- Ustawienia (jeden wiersz)

create table if not exists public.ud_kalibracja_ustawienia (
  id           boolean primary key default true check (id),
  tryb         text not null default 'na_sucho'
                 check (tryb in ('wylaczony', 'na_sucho', 'propozycja')),
  galaz        text not null default 'claude/portal-rebuild-seo-llm-yz2x4t',
  odbiorca     text not null default 'biuro@utratadochodu.com',
  dane_od      date,
  zmieniono_at timestamptz not null default now()
);

comment on table public.ud_kalibracja_ustawienia is
  'Kalibrator stawek: tryb (wylaczony/na_sucho/propozycja), gałąź portalu, odbiorca maili, dolna granica danych (dane_od). Jeden wiersz.';
comment on column public.ud_kalibracja_ustawienia.dane_od is
  'Najwcześniejsza data wysłania oferty (czas warszawski) brana do kalibracji; null = tylko okno 365 dni. Ustawić przy zmianie taryfy.';

insert into public.ud_kalibracja_ustawienia (id) values (true) on conflict do nothing;

alter table public.ud_kalibracja_ustawienia enable row level security;
revoke all on public.ud_kalibracja_ustawienia from public, anon, authenticated;
grant all on public.ud_kalibracja_ustawienia to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Dziennik przebiegów

create table if not exists public.ud_kalibracja_przebiegi (
  id               uuid primary key default gen_random_uuid(),
  uruchomiono      timestamptz not null default now(),
  tryb             text not null,
  wynik            text not null
                     check (wynik in ('na_sucho', 'bez_zmian', 'propozycja', 'odmowa', 'wylaczony', 'blad')),
  wyliczone        jsonb,
  powod            text,
  pr_numer         integer,
  propozycja_hash  text,
  mail_wyslany     boolean not null default false,
  na_stronie       boolean
);

comment on table public.ud_kalibracja_przebiegi is
  'Dziennik funkcji brzegowej kalibrator: wynik przebiegu, wyliczone stawki, PR. Bez danych osobowych.';

create index if not exists ud_kalibracja_przebiegi_uruchomiono_idx
  on public.ud_kalibracja_przebiegi (uruchomiono);

alter table public.ud_kalibracja_przebiegi enable row level security;
revoke all on public.ud_kalibracja_przebiegi from public, anon, authenticated;
grant all on public.ud_kalibracja_przebiegi to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Wyliczenie stawek
--
-- Kontrakt wyniku (funkcja brzegowa i testy na nim polegają):
--   status    'ok' | 'za_malo_osob' | 'anomalie'
--   metoda    'osoby-v1'
--   na_dzien  chwila przebiegu (UTC, ISO 8601)
--   stawka    {dol, srodek, gora} — tylko przy 'ok', inaczej null
--   okresy    {"24": 1, "36": …} — tylko przy 'ok', inaczej null
--   zrodlo    metryczka do kalibracja.json: okno, osob, ofert, wariantow, par
--   raport    surowe (stawki osób przed zaokrągleniem), okresy_kandydaci,
--             pominiete (ile wariantów odpadło i dlaczego), anomalie
--             (numer oferty BEZ ostatniego członu z nazwiskiem + powód)
-- Żadnych uuid, PESEL-i ani skrótów — wynik idzie do maila i do repozytorium.
--
-- Liczby na numeric (percentile_cont jest float8 — mediana liczona tu
-- samodzielnie), zaokrąglenia w SQL: 0,0202 zostaje 0,0202, a nie 0,0203
-- przez błąd zmiennoprzecinkowy.

create or replace function public.ud_kalibracja_stawek(
  p_na_dzien timestamptz default now(),
  p_dane_od  date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
with
par as (
  select coalesce(p_na_dzien, now()) as na_dzien, p_dane_od as dane_od
),
-- Wszystkie warianty ofert wysłanych. Szkice i oferty bez sent_at nie są
-- ofertami, które ktoś dostał — nie liczą się nawet jako pominięte.
w as (
  select
    d.id                                                   as dok_id,
    o.id                                                   as oferta_id,
    o.sent_at,
    array_to_string((string_to_array(coalesce(o.offer_number, '(bez numeru)'), '/'))[1:4], '/')
                                                           as oferta_nr,
    coalesce(
      case when regexp_replace(coalesce(c.pesel, ''), '\s', '', 'g') ~ '^\d{11}$'
           then 'p' || md5(regexp_replace(c.pesel, '\s', '', 'g')) end,
      'k' || o.client_id::text,
      'o' || o.id::text)                                   as osoba,
    d.insurer_type,
    d.temp_monthly_benefit                                 as sw,
    d.premium_total                                        as skl,
    d.premium_monthly                                      as rata,
    d.installments                                         as raty,
    d.wait_accident                                        as wa,
    d.wait_illness                                         as wi,
    d.perm_incapacity_covered                              as trwala,
    d.perm_sum_insured                                     as trwala_suma,
    d.death_covered                                        as smierc,
    (regexp_match(coalesce(d.indemnity_period, ''), '(\d+)'))[1]::numeric
                                                           as okres,
    d.parsed_raw->>'owu_base'                              as owu,
    case
      when jsonb_typeof(d.parsed_raw->'total_to_pay') = 'number'
        then (d.parsed_raw->>'total_to_pay')::numeric
      when d.parsed_raw->>'total_to_pay' ~ '^\s*-?\d+(\.\d+)?\s*$'
        then btrim(d.parsed_raw->>'total_to_pay')::numeric
    end                                                    as do_zaplaty,
    -- Klauzula HIV/WZW: wystarczy KTÓRYKOLWIEK z trzech sygnałów. Brak
    -- odpowiedzi parsera (null) też wyklucza — nie wiemy, że klauzuli nie ma.
    (lower(d.parsed_raw->>'covers_hiv_wzw') is distinct from 'false'
     or d.parsed_raw->>'hiv_owu_symbol' is not null
     or exists (select 1 from jsonb_array_elements(x.dodatki) e
                 where e->>'key' = 'hiv_wzw' and lower(e->>'covered') = 'true'))
                                                           as hiv,
    -- Objęte dodatki po SYMBOLU (LW144 bywa pod kluczem degenerative_limit
    -- i lw_lw144 — to ta sama pozycja). Pozycja bez symbolu też się liczy.
    coalesce((select array_agg(distinct e->>'symbol' order by e->>'symbol')
                from jsonb_array_elements(x.dodatki) e
               where lower(e->>'covered') = 'true'), '{}'::text[])
                                                           as dodatki,
    (o.sent_at <= par.na_dzien - interval '48 hours'
     and o.sent_at > par.na_dzien - interval '365 days'
     and (par.dane_od is null
          or (o.sent_at at time zone 'Europe/Warsaw')::date >= par.dane_od))
                                                           as w_oknie
  from public.ud_offer_documents d
  join public.ud_offers o on o.id = d.offer_id
  left join public.ud_clients c on c.id = o.client_id
  cross join par
  cross join lateral (
    select case when jsonb_typeof(d.parsed_raw->'extras') = 'array'
                then d.parsed_raw->'extras' else '[]'::jsonb end as dodatki
  ) x
  where o.status is distinct from 'draft'
    and o.sent_at is not null
),
-- Każdy wariant spoza bazy dostaje JEDEN powód (pierwszy pasujący).
k as (
  select w.*,
    case
      when not w.w_oknie                                         then 'poza_oknem'
      when w.insurer_type is distinct from 'leadenhall'          then 'inny_ubezpieczyciel'
      when w.trwala is not false or coalesce(w.trwala_suma, 0) <> 0
           or w.smierc is not false                              then 'trwala_lub_smierc'
      when w.raty is distinct from 12                            then 'jednorazowe'
      when w.hiv                                                 then 'hiv'
      when exists (select 1 from unnest(w.dodatki) as t(s)
                    where t.s is distinct from 'LW144')          then 'dodatki'
      when not coalesce(w.wa <= 21 and w.wi <= 21, false)        then 'wyczekiwanie'
      when not coalesce(w.sw > 0 and w.skl > 0, false)           then 'brak_kwot'
    end as pominiety
  from w
),
czyste as (
  select k.*, k.skl / (12 * k.sw) as stawka from k where k.pominiety is null
),
-- Kontrola danych na wariantach, które przeszły filtr — przed liczeniem.
anomalie as (
  select distinct a.oferta_nr, a.powod
  from (
    select c.oferta_nr, 'rata × 12 ≠ składka' as powod
      from czyste c where c.rata is not null and abs(c.rata * 12 - c.skl) > 1
    union all
    select c.oferta_nr, 'do zapłaty ≠ składka'
      from czyste c where c.do_zaplaty is not null and abs(c.do_zaplaty - c.skl) > 1
    union all
    select c.oferta_nr, 'stawka poza 1–5%'
      from czyste c where c.stawka < 0.01 or c.stawka > 0.05
  ) a
),
-- Ten sam wariant wczytany dwa razy do jednej oferty liczy się raz.
u as (
  select distinct on (c.oferta_id, c.sw, c.okres, c.wa, c.wi, c.skl, c.dodatki, c.owu) c.*
  from czyste c
  order by c.oferta_id, c.sw, c.okres, c.wa, c.wi, c.skl, c.dodatki, c.owu, c.dok_id
),
-- Najnowsza oferta osoby, w której jest choć jeden czysty wariant 24-mies.
najnowsza as (
  select distinct on (u.osoba) u.osoba, u.oferta_id
  from u
  where u.okres = 24
  order by u.osoba, u.sent_at desc, u.oferta_id
),
osoby_w as (
  select n.osoba, array_agg(u.stawka order by u.stawka) as r, count(*)::int as n
  from najnowsza n
  join u on u.oferta_id = n.oferta_id and u.okres = 24
  group by n.osoba
),
osoby as (
  select o.osoba, (o.r[(o.n + 1) / 2] + o.r[(o.n + 2) / 2]) / 2 as stawka, o.n
  from osoby_w o
),
agg as (
  select count(*)::int                           as osob,
         coalesce(sum(o.n), 0)::int               as wariantow,
         min(o.stawka)                            as mn,
         max(o.stawka)                            as mx,
         avg(o.stawka)                            as sr,
         array_agg(o.stawka order by o.stawka)    as s
  from osoby o
),
agg2 as (
  select a.*,
         (a.s[(a.osob + 1) / 2] + a.s[(a.osob + 2) / 2]) / 2 as mediana,
         1 + 0.1 * (a.osob - 1)                  as poz10,
         1 + 0.9 * (a.osob - 1)                  as poz90
  from agg a
),
agg3 as (
  select a.*,
         a.s[floor(a.poz10)::int] + (a.poz10 - floor(a.poz10)) * (a.s[ceil(a.poz10)::int] - a.s[floor(a.poz10)::int]) as p10,
         a.s[floor(a.poz90)::int] + (a.poz90 - floor(a.poz90)) * (a.s[ceil(a.poz90)::int] - a.s[floor(a.poz90)::int]) as p90
  from agg2 a
),
-- Pary okresów w jednej ofercie: to samo świadczenie, wyczekiwanie, dodatki
-- i baza OWU (gdy obie strony ją znają); raty i brak HIV gwarantuje filtr.
pary as (
  select a.osoba, b.okres, b.skl / a.skl as iloraz
  from u a
  join u b on b.oferta_id = a.oferta_id
          and b.sw = a.sw and b.wa = a.wa and b.wi = a.wi
          and b.dodatki = a.dodatki
          and (a.owu is null or b.owu is null or a.owu = b.owu)
  where a.okres = 24 and b.okres in (36, 48, 60)
),
pary_os as (
  select p.okres, p.osoba, array_agg(p.iloraz order by p.iloraz) as r, count(*)::int as n
  from pary p group by p.okres, p.osoba
),
pary_m as (
  select p.okres, p.osoba, (p.r[(p.n + 1) / 2] + p.r[(p.n + 2) / 2]) / 2 as m from pary_os p
),
okr as (
  select p.okres, count(*)::int as osob, array_agg(p.m order by p.m) as s,
         min(p.m) as mn, max(p.m) as mx
  from pary_m p group by p.okres
),
okr2 as (
  select o.*, (o.s[(o.osob + 1) / 2] + o.s[(o.osob + 2) / 2]) / 2 as mediana,
         (o.osob >= 3 and o.mx / o.mn <= 1.05) as przyjety
  from okr o
),
kandydaci as (
  select p.okres, o.osob, o.mediana, o.mn, o.mx, coalesce(o.przyjety, false) as przyjety
  from (values (36::numeric), (48), (60)) p(okres)
  left join okr2 o on o.okres = p.okres
),
pom as (
  select jsonb_build_object(
    'hiv',                 count(*) filter (where k.pominiety = 'hiv'),
    'dodatki',             count(*) filter (where k.pominiety = 'dodatki'),
    'wyczekiwanie',        count(*) filter (where k.pominiety = 'wyczekiwanie'),
    'jednorazowe',         count(*) filter (where k.pominiety = 'jednorazowe'),
    'trwala_lub_smierc',   count(*) filter (where k.pominiety = 'trwala_lub_smierc'),
    'inny_ubezpieczyciel', count(*) filter (where k.pominiety = 'inny_ubezpieczyciel'),
    'poza_oknem',          count(*) filter (where k.pominiety = 'poza_oknem'),
    'brak_kwot',           count(*) filter (where k.pominiety = 'brak_kwot')) as j
  from k
),
wynik as (
  select
    case
      when exists (select 1 from anomalie) then 'anomalie'
      when a.osob < 8                      then 'za_malo_osob'
      else 'ok'
    end as status,
    a.*
  from agg3 a
)
select jsonb_build_object(
  'status',   r.status,
  'metoda',   'osoby-v1',
  'na_dzien', to_char(par.na_dzien at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'stawka',   case when r.status = 'ok' then jsonb_build_object(
                'dol',    round(ceil(r.mn * 10000) / 10000, 4),
                -- Środek w górę do 0,1 p.p., ale nie ponad górę: przy medianie
                -- tuż pod maksimum (0,0321 / 0,0322) dałby 0,033 > góra.
                'srodek', least(round(ceil(r.mediana * 1000) / 1000, 3),
                                round(ceil(r.mx * 10000) / 10000, 4)),
                'gora',   round(ceil(r.mx * 10000) / 10000, 4)) end,
  'okresy',   case when r.status = 'ok' then
                jsonb_build_object('24', 1)
                || coalesce((select jsonb_object_agg(kd.okres::text, round(ceil(kd.mediana * 100) / 100, 2))
                               from kandydaci kd where kd.przyjety), '{}'::jsonb) end,
  'zrodlo',   jsonb_build_object(
                'metoda',         'osoby-v1',
                'ubezpieczyciel', 'Leadenhall',
                'okno', jsonb_build_object(
                  'od', to_char(greatest(((par.na_dzien - interval '365 days') at time zone 'Europe/Warsaw')::date,
                                         coalesce(par.dane_od, '-infinity'::date)), 'YYYY-MM-DD'),
                  'do', to_char(((par.na_dzien - interval '48 hours') at time zone 'Europe/Warsaw')::date, 'YYYY-MM-DD')),
                'osob',      r.osob,
                'ofert',     (select count(distinct u.oferta_id)::int from u),
                'wariantow', (select count(*)::int from u),
                'par', coalesce((select jsonb_object_agg(kd.okres::text, kd.osob)
                                   from kandydaci kd where kd.przyjety), '{}'::jsonb)),
  'raport',   jsonb_build_object(
                'surowe', jsonb_build_object(
                  'min',     round(r.mn, 6),
                  'mediana', round(r.mediana, 6),
                  'srednia', round(r.sr, 6),
                  'max',     round(r.mx, 6),
                  'p10',     round(r.p10, 6),
                  'p90',     round(r.p90, 6)),
                'okresy_kandydaci', (
                  select jsonb_object_agg(kd.okres::text,
                           case when kd.osob is null then jsonb_build_object('osob', 0)
                                else jsonb_build_object('osob', kd.osob,
                                                        'mediana', round(kd.mediana, 4),
                                                        'min', round(kd.mn, 4),
                                                        'max', round(kd.mx, 4)) end)
                    from kandydaci kd),
                'pominiete', (select pom.j from pom),
                'anomalie', coalesce((select jsonb_agg(jsonb_build_object('oferta', an.oferta_nr, 'powod', an.powod)
                                                       order by an.oferta_nr, an.powod)
                                        from anomalie an), '[]'::jsonb))
)
from wynik r cross join par;
$fn$;

comment on function public.ud_kalibracja_stawek(timestamptz, date) is
  'Kalibracja stawek kalkulatora (metoda osoby-v1): stawki dol/srodek/gora i mnożniki okresów z ofert Leadenhall. Tylko odczyt, bez danych osobowych w wyniku.';

revoke all on function public.ud_kalibracja_stawek(timestamptz, date) from public, anon, authenticated;
grant execute on function public.ud_kalibracja_stawek(timestamptz, date) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Wywołanie funkcji brzegowej z pg_cron. Token z Vaulta dokłada funkcja SQL
-- (wzorzec edge_cron_token) — nigdy nie stoi w treści zadania.

create or replace function public.ud_kalibracja_uruchom()
returns bigint
language sql
security definer
set search_path = ''
as $fn$
  select net.http_post(
    url := 'https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/kalibrator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets
                       where name = 'edge_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$fn$;

revoke all on function public.ud_kalibracja_uruchom() from public, anon, authenticated;

-- Zadanie powstaje WYŁĄCZONE (pn–pt 05:40 UTC). Ponowne uruchomienie migracji
-- nie zmienia stanu istniejącego zadania — ani go nie włącza, ani nie wyłącza.
do $$
declare
  v_id bigint;
begin
  select jobid into v_id from cron.job where jobname = 'kalibracja-stawek';
  if v_id is null then
    v_id := cron.schedule('kalibracja-stawek', '40 5 * * 1-5',
                          'select public.ud_kalibracja_uruchom();');
    perform cron.alter_job(v_id, active := false);
  end if;
end $$;
