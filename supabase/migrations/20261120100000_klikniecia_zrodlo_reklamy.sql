-- Kliknięcia /kup-online: czy wejście przyszło z reklamy (20.11.2026).
--
-- Klient z kampanii Google Ads może kupić online u Leadenhall i nie złożyć
-- wniosku — wtedy nie ma go ani w `ud_clients`, ani w konwersjach Ads, a licznik
-- kliknięć mówił tylko „z którego miejsca na stronie". Portal niesie teraz
-- parametry kampanii w adresie między podstronami (apps/portal/public/zrodlo.js
-- dokleja je też do odnośnika /kup-online), a funkcja Pages
-- `apps/portal/functions/kup-online/[[reszta]].js` zapisuje z nich trzy rzeczy:
--
--   platne          — wejście z reklamy według reguły „Google Ads" z panelu
--                     (apps/panel/src/lib/zrodlo.js): w adresie był poprawny
--                     gclid, gbraid, wbraid albo gad_source, ALBO utm_source
--                     ads/google przy utm_medium cpc/internet/paid. NULL =
--                     kliknięcie sprzed pomiaru (patrz niżej),
--   utm_campaign    — nazwa kampanii (tylko poprawna, inaczej NULL),
--   gad_campaignid  — identyfikator kampanii Google (j.w.).
--
-- `platne` BEZ wartości domyślnej i z NULL-em. Kliknięcia sprzed tej zmiany
-- nikt nie sprawdzał pod kątem reklamy (stary portal nie niósł parametrów do
-- /kup-online), więc dostają NULL, nie false — false wyglądałoby w panelu
-- jak „z reklamy: 0", czyli „reklama nic nie dała", a tego nie wiemy. Nowa
-- funkcja zawsze wpisuje true albo false; NULL zostaje też wierszom, które
-- funkcja zapisała samym celem i źródłem, bo baza nie znała jeszcze kolumn.
-- Widok liczy obie rzeczy: `z_reklamy` (true) i `zmierzonych` (nie NULL).
--
-- Identyfikatora kliknięcia (gclid / gbraid / wbraid) NIE zapisujemy: licznik
-- nie zna zgody na cookies marketingowe, a bez niej klient odmówił pomiaru
-- skuteczności reklam. Dalej bez IP, User-Agenta i ciasteczek — licznik nie
-- potrzebuje zgody i liczy wszystkich.
--
-- CHECK-i powtarzają reguły funkcji (i packages/wniosek/src/zrodlo.js, skąd
-- pochodzą): gdyby ktoś je poluzował w kodzie, do tabeli i tak nie wejdzie
-- dowolny tekst z adresu. Zgodność pilnuje apps/portal/test/zrodlo.spec.js,
-- który czyta ten plik jako tekst.
--
-- Do panelu (Niedokończone → „Kup online u Leadenhall — kliknięcia") widok
-- tygodniowy dostaje na KOŃCU kolumny `z_reklamy` i `zmierzonych` (create or
-- replace view pozwala dopisać kolumny tylko na końcu), a
-- `ud_klikniecia_tabela` — piątą i szóstą kolumnę wyniku. Zmiana kolumn wyniku
-- funkcji wymaga DROP + CREATE; zwijanie miejsc bez zmian (jak
-- w 20261111130946_klikniecia_tabela.sql). Panel sprzed tej zmiany czyta
-- z wyniku cztery kolumny i dalszych nie zauważy.
--
-- KOLEJNOŚĆ WDROŻENIA: ta migracja PRZED pushem portalu (push wdraża portal
-- od razu). Nowa funkcja Pages wstawia kolumny `platne` (zawsze),
-- `utm_campaign` i `gad_campaignid`; baza bez nich odpowiada 400 PGRST204.
-- Funkcja to przeżyje — ponawia wtedy zapis samym celem i źródłem, więc
-- licznik liczy dalej — ale wejścia z reklamy z tego okresu przepadają
-- (NULL = sprzed pomiaru). Stara funkcja po migracji też działa: wstawia
-- tylko `cel` i `zrodlo`, `platne` zostaje NULL.
--
-- Ile wejść tygodniowo przyszło z reklamy i z której kampanii:
--   select date_trunc('week', czas at time zone 'Europe/Warsaw')::date as tydzien,
--          coalesce(utm_campaign, gad_campaignid, '—') as kampania,
--          count(*) filter (where platne) as z_reklamy,
--          count(platne) as zmierzonych,
--          count(*) as wszystkich
--     from public.ud_klikniecia where cel = 'leadenhall'
--    group by 1, 2 order by 1 desc, 3 desc;

alter table public.ud_klikniecia
  add column if not exists platne boolean,
  add column if not exists utm_campaign text,
  add column if not exists gad_campaignid text;

-- utm_campaign: 1–100 znaków, bez odstępów na brzegach, bez znaków sterujących
-- (U+0001–U+001F i U+007F; U+0000 w text i tak nie istnieje). Ten sam zakres
-- co /[\u0000-\u001F\u007F]/ w JS — nie [[:cntrl:]], które zależnie od
-- lokalizacji łapie też C1 (U+0080–U+009F), przepuszczane przez funkcję.
alter table public.ud_klikniecia drop constraint if exists ud_klikniecia_utm_campaign_ksztalt;
alter table public.ud_klikniecia add constraint ud_klikniecia_utm_campaign_ksztalt check (
  utm_campaign is null or (
    char_length(utm_campaign) between 1 and 100
    and utm_campaign = btrim(utm_campaign)
    and utm_campaign !~ '[\x01-\x1f\x7f]'
  )
);

-- gad_campaignid: znaki base64url, 1–32 (Google wpisuje tam cyfry).
alter table public.ud_klikniecia drop constraint if exists ud_klikniecia_gad_campaignid_ksztalt;
alter table public.ud_klikniecia add constraint ud_klikniecia_gad_campaignid_ksztalt check (
  gad_campaignid is null or gad_campaignid ~ '^[A-Za-z0-9_-]{1,32}$'
);

-- Widok tygodniowy: nowe kolumny na końcu. security_invoker zostaje — widok
-- czyta z uprawnieniami wywołującego, więc RLS tabeli działa dalej.
-- `zmierzonych` < `klikniec` = w tygodniu są kliknięcia sprzed pomiaru.
create or replace view public.ud_klikniecia_tydzien
with (security_invoker = true) as
select date_trunc('week', czas at time zone 'Europe/Warsaw')::date as tydzien,
       cel,
       zrodlo,
       count(*)::int as klikniec,
       (count(*) filter (where platne))::int as z_reklamy,
       count(platne)::int as zmierzonych
  from public.ud_klikniecia
 group by 1, 2, 3;

revoke all on public.ud_klikniecia_tydzien from public, anon, authenticated;
grant select on public.ud_klikniecia_tydzien to service_role;

-- Tabela do panelu z liczbą kliknięć z reklamy. Zwijanie jak dotąd: najwyżej
-- tygodnie × (p_miejsc + 1) wierszy, reszta miejsc pod '__pozostale';
-- `z_reklamy` i `zmierzonych` sumują się razem z kliknięciami.
drop function if exists public.ud_klikniecia_tabela(date, int);
create function public.ud_klikniecia_tabela(p_od date, p_miejsc int default 6)
returns table (tydzien date, zrodlo text, klikniec int, miejsc_wszystkich int, z_reklamy int, zmierzonych int)
language sql
stable
security invoker
set search_path = ''
as $$
  with okno as (
    select k.tydzien, k.zrodlo, k.klikniec, k.z_reklamy, k.zmierzonych
      from public.ud_klikniecia_tydzien k
     where k.cel = 'leadenhall' and k.tydzien >= p_od
  ), ranking as (
    select o.zrodlo,
           row_number() over (order by sum(o.klikniec) desc, o.zrodlo collate "C") as nr,
           count(*) over () as wszystkich
      from okno o
     group by o.zrodlo
  )
  select o.tydzien,
         case when r.nr > p_miejsc then '__pozostale' else o.zrodlo end,
         sum(o.klikniec)::int,
         max(r.wszystkich)::int,
         sum(o.z_reklamy)::int,
         sum(o.zmierzonych)::int
    from okno o
    join ranking r on r.zrodlo = o.zrodlo
   group by 1, 2
$$;

revoke all on function public.ud_klikniecia_tabela(date, int) from public, anon, authenticated;
grant execute on function public.ud_klikniecia_tabela(date, int) to service_role;
