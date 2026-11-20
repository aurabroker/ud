-- Statystyki według źródła leada (panel v.0.80, Statystyki → „Według źródła").
--
-- Pytanie właściciela: czy reklama się zwraca — ile wniosków, ile sprzedanych
-- polis i ile składek oraz prowizji przyszło z Google Ads, z linków agentów
-- i z innych źródeł w wybranym okresie.
--
-- Źródło żyje w ud_clients.form_data.zrodlo (zapisuje je kreator wniosku,
-- form-submit kopiuje ciało żądania do form_data bez zmian) — NIE w kolumnie
-- i bez wyzwalacza na ud_clients (ABSOLUTE_RULE: wniosek to jedyna ścieżka,
-- którą wpływają pieniądze). Kod agenta: ud_clients.affiliate_code_used.
--
-- FUNKCJA ODDAJE SUROWE GRUPY, NIE RODZAJ ŹRÓDŁA. Reguła „Google Ads / Link
-- agenta / Inne / Brak danych" stoi w jednym miejscu, apps/panel/src/lib/zrodlo.js
-- (ta sama dla listy klientów, karty i statystyk). Gdyby SQL liczył ją drugi
-- raz, pierwsza poprawka reguły rozjechałaby statystyki z listą klientów.
-- Klucz grupy:
--   platne       form_data.zrodlo.platne = JSON true (napis "true" się nie liczy —
--                tak samo jak `platne === true` w zrodlo.js)
--   utm_source   małymi literami, przycięty; tylko gdy jest napisem
--   utm_medium   j.w.
--   link_agenta  niepusty affiliate_code_used
--   ma_zrodlo    form_data.zrodlo jest obiektem (stare wnioski: false)
--   kampania     utm_campaign, a bez niego gad_campaignid (przycięte)
-- utm_source, utm_medium i kampania najwyżej 100 znaków (left). Portal nie
-- przepuszcza dłuższych, ale form-submit kopiuje ciało żądania do form_data
-- bez limitu — jeden spreparowany wniosek z 2 MB w utm_campaign szedłby
-- inaczej w danych strony do każdego, kto otworzy Statystyki.
-- Identyfikatorów kliknięcia (gclid, gbraid, wbraid) funkcja nie czyta wcale.
--
-- Miary w grupie:
--   wnioski             klienci z wniosku (source inne niż 'manual' i 'polisa' —
--                       klient dodany w panelu albo przez „Dodaj polisę" nie
--                       składał wniosku), z datą utworzenia w okresie [p_od, p_do).
--                       Agent widzi wnioski klientów, których lead prowadzi.
--   sprzedaze, z_danymi, skladka_roczna_suma, prowizja_suma, bez_stawki
--                       DOKŁADNIE jak w ud_leady_statystyki (część 5): lead
--                       w etapie „Wygrany" (także zarchiwizowany), okres po dacie
--                       sprzedaży, sprzedawca = coalesce(sprzedawca, opiekun),
--                       prowizja = składka roczna × stawka z chwili sprzedaży
--                       (bez niej — aktualna stawka sprzedawcy). Sprzedaż klienta
--                       z 'manual'/'polisa' liczy się (w grupie bez źródła).
--   Suma sprzedaży, składek i prowizji po wszystkich grupach = podsumowanie
--   ud_leady_statystyki dla tych samych parametrów (test SQL to porównuje).
--
-- Widoczność jak w ud_leady_statystyki: nieaktywne konto i obcy uuid → null;
-- administrator — wszyscy albo wybrany agent; agent — wyłącznie swoje, choćby
-- podał cudzego agenta.
--
-- Wynik: { rola, agent, grupy: [...] (najwyżej 500, najwięcej wniosków +
-- sprzedaży pierwsze), grup_wszystkich }. Limit chroni przed zalewem różnych
-- utm_source/utm_campaign z cudzych linków; panel mówi, gdy coś ucięto.

create or replace function public.ud_leady_statystyki_zrodla(
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

  with k as (
    -- form_data bywa czymkolwiek (stare wiersze, ręczne wstawki) — tylko obiekt.
    select c.id, c.created_at, coalesce(c.source, '') as source, c.affiliate_code_used,
           case when jsonb_typeof(c.form_data) = 'object' and jsonb_typeof(c.form_data -> 'zrodlo') = 'object'
                then c.form_data -> 'zrodlo' end as z
      from public.ud_clients c
  ), g as (
    select k.id, k.created_at, k.source,
           k.z is not null                                              as ma_zrodlo,
           coalesce(k.z -> 'platne' = 'true'::jsonb, false)             as platne,
           case when jsonb_typeof(k.z -> 'utm_source') = 'string'
                then left(nullif(lower(btrim(k.z ->> 'utm_source')), ''), 100) end as utm_source,
           case when jsonb_typeof(k.z -> 'utm_medium') = 'string'
                then left(nullif(lower(btrim(k.z ->> 'utm_medium')), ''), 100) end as utm_medium,
           left(coalesce(
             case when jsonb_typeof(k.z -> 'utm_campaign') = 'string' then nullif(btrim(k.z ->> 'utm_campaign'), '') end,
             case when jsonb_typeof(k.z -> 'gad_campaignid') = 'string' then nullif(btrim(k.z ->> 'gad_campaignid'), '') end
           ), 100)                                                      as kampania,
           nullif(btrim(k.affiliate_code_used), '') is not null         as link_agenta
      from k
  ), wnioski as (
    select g.platne, g.utm_source, g.utm_medium, g.link_agenta, g.ma_zrodlo, g.kampania
      from g
     where g.source not in ('manual', 'polisa')
       and (p_od is null or g.created_at >= p_od)
       and (p_do is null or g.created_at < p_do)
       and (v_agent is null
            or exists (select 1 from public.ud_leady l where l.klient_id = g.id and l.opiekun_id = v_agent))
  ), sprzedaze as (
    -- Ten sam zbiór i ta sama prowizja co w ud_leady_statystyki.
    select l.klient_id,
           l.skladka_roczna as rok,
           round(l.skladka_roczna * coalesce(l.prowizja_procent, ps.prowizja_procent) / 100, 2) as prow
      from public.ud_leady l
      join public.ud_leady_etap e on e.id = l.etap_id and e.rodzaj = 'wygrany'
      left join public.ud_user_profiles ps on ps.id = coalesce(l.sprzedawca_id, l.opiekun_id)
     where l.klient_id is not null
       and (v_agent is null or coalesce(l.sprzedawca_id, l.opiekun_id) = v_agent)
       and (p_od is null or coalesce(l.sprzedano_at, l.etap_od) >= p_od)
       and (p_do is null or coalesce(l.sprzedano_at, l.etap_od) < p_do)
  ), r as (
    select w.platne, w.utm_source, w.utm_medium, w.link_agenta, w.ma_zrodlo, w.kampania,
           1 as wniosek, 0 as sprzedaz, null::numeric as rok, null::numeric as prow
      from wnioski w
    union all
    select coalesce(g.platne, false), g.utm_source, g.utm_medium, coalesce(g.link_agenta, false),
           coalesce(g.ma_zrodlo, false), g.kampania,
           0, 1, s.rok, s.prow
      from sprzedaze s
      left join g on g.id = s.klient_id
  ), grupy as (
    select r.platne, r.utm_source, r.utm_medium, r.link_agenta, r.ma_zrodlo, r.kampania,
           sum(r.wniosek)::int                                                    as wnioski,
           sum(r.sprzedaz)::int                                                   as sprzedaze,
           count(r.rok)::int                                                      as z_danymi,
           coalesce(sum(r.rok), 0)                                                as skladka_roczna_suma,
           coalesce(sum(r.prow), 0)                                               as prowizja_suma,
           -- Sprzedaż z kwotami, ale bez stawki sprzedawcy: prowizji nie da się policzyć.
           count(*) filter (where r.sprzedaz = 1 and r.rok is not null and r.prow is null)::int as bez_stawki
      from r
     group by r.platne, r.utm_source, r.utm_medium, r.link_agenta, r.ma_zrodlo, r.kampania
  ), pierwsze as (
    select g2.*
      from grupy g2
     order by g2.wnioski + g2.sprzedaze desc, g2.platne desc, g2.link_agenta desc, g2.ma_zrodlo desc,
              g2.utm_source collate "C" nulls last, g2.utm_medium collate "C" nulls last, g2.kampania collate "C" nulls last
     limit 500
  )
  select jsonb_build_object(
    'rola',  v_rola,
    'agent', v_agent,
    'grupy', coalesce((
      select jsonb_agg(jsonb_build_object(
               'platne', p.platne, 'utm_source', p.utm_source, 'utm_medium', p.utm_medium,
               'link_agenta', p.link_agenta, 'ma_zrodlo', p.ma_zrodlo, 'kampania', p.kampania,
               'wnioski', p.wnioski, 'sprzedaze', p.sprzedaze, 'z_danymi', p.z_danymi,
               'skladka_roczna_suma', p.skladka_roczna_suma, 'prowizja_suma', p.prowizja_suma,
               'bez_stawki', p.bez_stawki)
             order by p.wnioski + p.sprzedaze desc, p.platne desc, p.link_agenta desc, p.ma_zrodlo desc,
                      p.utm_source collate "C" nulls last, p.utm_medium collate "C" nulls last, p.kampania collate "C" nulls last)
        from pierwsze p), '[]'::jsonb),
    'grup_wszystkich', (select count(*) from grupy)
  ) into v_wynik;

  return v_wynik;
end
$fn$;

-- Tylko klucz serwisowy (panel przez createAdminClient), jak reszta funkcji tablicy.
revoke all on function public.ud_leady_statystyki_zrodla(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.ud_leady_statystyki_zrodla(uuid, timestamptz, timestamptz, uuid) to service_role;

notify pgrst, 'reload schema';
