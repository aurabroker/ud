-- Kosz ofert na 30 dni — decyzja właściciela z 13.10.2026, po przypadkowym
-- usunięciu oferty UD/2026/CE/00034 (przycisk „Usuń ofertę" kasował ją na
-- stałe: wiersz, warianty, pliki PDF, PIN-y, pytania klienta i historię
-- wysyłek; odtwarzanie szło z maila w Resend i PDF-ów z Dysku).
--
-- Jak to działa:
--   * „Usuń" w panelu woła ud_oferta_do_kosza(): w ud_offers_kosz zostaje
--     KOMPLETNA kopia oferty i wszystkiego, co od niej zależy (JSON wierszy),
--     a sama oferta jest usuwana jak dotąd (FK ON DELETE CASCADE). Dzięki temu
--     żadne miejsce czytające ud_offers — lista, strona klienta pod linkiem,
--     tablica leadów, statystyki, przypomnienia SMS — nie musi wiedzieć
--     o koszu: oferty w koszu po prostu nie ma. Klient traci dostęp od razu.
--   * Pliki PDF w kubełku ud-offers ZOSTAJĄ (nikt ich nie widzi — adresy
--     podpisuje panel tylko dla istniejących ofert).
--   * ud_oferta_z_kosza() wstawia ofertę z powrotem z TYM SAMYM id
--     i share_token — link z maila do klienta znowu działa.
--   * Po 30 dniach panel (cron co godzinę, /api/cron/kosz-ofert) usuwa pliki
--     z kubełka i wpis z kosza. To jest usunięcie danych osobowych na dobre —
--     dlatego cron, nie „kiedyś".
--   * Wpis po terminie NIE da się przywrócić i znika z listy. Inaczej
--     przywrócenie mogłoby się wcisnąć między usunięcie plików a usunięcie
--     wpisu i oddać ofertę z martwymi odnośnikami do PDF-ów. Czyszczenie
--     dodatkowo „zajmuje" wpis (czyszczenie_od, FOR UPDATE SKIP LOCKED), więc
--     przywrócenie trwające akurat na granicy 30 dni nie zostanie rozjechane.
--
-- Kto usuwa: właściciel oferty i administrator (jak RLS na ud_offers; panel
-- woła kluczem serwisowym, więc reguła musi siedzieć tutaj). Kto widzi wpis
-- i przywraca: ci sami oraz osoba, która ofertę usunęła. Konto nieaktywne —
-- nic.
--
-- Uwaga przy zmianach schematu: przywrócenie wstawia wiersze przez
-- jsonb_populate_record(set), więc kolumna NOT NULL dodana do tabel ofert
-- PO usunięciu oferty dostanie NULL i przywrócenie się nie uda. Dodając
-- taką kolumnę, uzupełnij ją w snapshotach w ud_offers_kosz.

create table if not exists public.ud_offers_kosz (
  id              uuid primary key default gen_random_uuid(),
  offer_id        uuid not null unique,
  offer_number    text,
  client_name     text,
  wlasciciel_id   uuid,
  usunieto_at     timestamptz not null default now(),
  usunieto_przez  uuid,
  oferta          jsonb not null,
  dokumenty       jsonb not null default '[]'::jsonb,
  pliki           jsonb not null default '[]'::jsonb,
  piny            jsonb not null default '[]'::jsonb,
  pytania         jsonb not null default '[]'::jsonb,
  wysylki         jsonb not null default '[]'::jsonb,
  leady           jsonb not null default '[]'::jsonb,
  pliki_storage   text[] not null default '{}',
  czyszczenie_od  timestamptz
);

comment on table public.ud_offers_kosz is
  'Usunięte oferty na 30 dni: pełna kopia wierszy (ud_oferta_do_kosza / ud_oferta_z_kosza). Czyści cron panelu.';

create index if not exists ud_offers_kosz_usunieto_idx on public.ud_offers_kosz (usunieto_at);

-- Tylko service_role (panel kluczem serwisowym). RLS bez polityk.
alter table public.ud_offers_kosz enable row level security;
revoke all on public.ud_offers_kosz from public, anon, authenticated;
grant all on public.ud_offers_kosz to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Przeniesienie do kosza

create or replace function public.ud_oferta_do_kosza(p_offer uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  o public.ud_offers%rowtype;
  v_kosz uuid;
  v_stare text[];
begin
  if not exists (select 1 from public.ud_user_profiles p
                  where p.id = p_user and coalesce(p.active, true)) then
    return jsonb_build_object('status', 'brak_uprawnien');
  end if;

  select * into o from public.ud_offers where id = p_offer for update;
  -- Cudza oferta „nie istnieje" — agent usuwa tylko swoje (administrator
  -- wszystkie), jak w RLS na ud_offers.
  if not found or not public.ud_leady_widzi(p_user, o.user_id) then
    return jsonb_build_object('status', 'brak_oferty');
  end if;

  -- Wpis z poprzedniego usunięcia tej samej oferty (wstawionej potem ręcznie
  -- z tym samym id): nowa kopia go zastępuje, a jego pliki zostają na liście
  -- do czyszczenia. Bez tego unique(offer_id) blokowałby usunięcie na zawsze,
  -- a stary wpis z danymi klienta nigdy by nie zniknął (czyszczenie pomija
  -- wpisy, których oferta istnieje).
  delete from public.ud_offers_kosz where offer_id = o.id
    returning pliki_storage into v_stare;

  insert into public.ud_offers_kosz (
    offer_id, offer_number, client_name, wlasciciel_id, usunieto_przez,
    oferta, dokumenty, pliki, piny, pytania, wysylki, leady, pliki_storage
  )
  select
    o.id, o.offer_number, o.client_name, o.user_id, p_user,
    to_jsonb(o),
    coalesce((select jsonb_agg(to_jsonb(d) order by d.sort_order, d.created_at)
                from public.ud_offer_documents d where d.offer_id = o.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at)
                from public.ud_offer_files f where f.offer_id = o.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(pn) order by pn.created_at)
                from public.ud_offer_pins pn where pn.offer_id = o.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(q) order by q.asked_at)
                from public.ud_offer_questions q where q.offer_id = o.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at)
                from public.ud_send_log s where s.offer_id = o.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('lead_id', l.id, 'sprzedaz_wariant_id', l.sprzedaz_wariant_id))
                from public.ud_leady l
               where l.sprzedaz_wariant_id in (select d.id from public.ud_offer_documents d
                                                where d.offer_id = o.id)), '[]'::jsonb),
    coalesce((select array_agg(distinct p order by p)
                from unnest(coalesce(v_stare, '{}'::text[])
                            || array(select f.storage_path from public.ud_offer_files f
                                      where f.offer_id = o.id and f.storage_bucket = 'ud-offers')) p), '{}')
  returning id into v_kosz;

  -- Reszta jak przy dawnym usuwaniu: FK ON DELETE CASCADE / SET NULL.
  delete from public.ud_offers where id = o.id;

  return jsonb_build_object('status', 'ok', 'kosz_id', v_kosz, 'offer_id', o.id);
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Przywrócenie z kosza

create or replace function public.ud_oferta_z_kosza(p_kosz uuid, p_user uuid, p_dni integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  k public.ud_offers_kosz%rowtype;
begin
  if not exists (select 1 from public.ud_user_profiles p
                  where p.id = p_user and coalesce(p.active, true)) then
    return jsonb_build_object('status', 'brak_uprawnien');
  end if;

  select * into k from public.ud_offers_kosz where id = p_kosz for update;
  -- Cudzy wpis „nie istnieje" — jak cudzy lead na tablicy.
  if not found or not (public.ud_leady_widzi(p_user, k.wlasciciel_id)
                       or k.usunieto_przez = p_user) then
    return jsonb_build_object('status', 'brak_wpisu');
  end if;

  -- Po terminie albo w trakcie czyszczenia pliki mogą już nie istnieć.
  if k.czyszczenie_od is not null or k.usunieto_at < now() - make_interval(days => p_dni) then
    return jsonb_build_object('status', 'po_terminie');
  end if;

  if exists (select 1 from public.ud_offers where id = k.offer_id) then
    return jsonb_build_object('status', 'oferta_istnieje', 'offer_id', k.offer_id);
  end if;
  if k.oferta->>'share_token' is not null
     and exists (select 1 from public.ud_offers where share_token = k.oferta->>'share_token') then
    return jsonb_build_object('status', 'konflikt_linku');
  end if;

  -- Konto właściciela usunięte w Supabase, gdy oferta leżała w koszu: żywej
  -- ofercie klucz ud_offers_user_id_fkey (ON DELETE SET NULL) wyzerowałby
  -- user_id — przywrócenie robi to samo, zamiast padać na kluczu obcym.
  if k.oferta->>'user_id' is not null
     and not exists (select 1 from auth.users u where u.id = (k.oferta->>'user_id')::uuid) then
    k.oferta := jsonb_set(k.oferta, '{user_id}', 'null'::jsonb);
  end if;

  insert into public.ud_offers
    select * from jsonb_populate_record(null::public.ud_offers, k.oferta);
  -- Kolejność: dokumenty przed plikami (FK document_id).
  insert into public.ud_offer_documents
    select * from jsonb_populate_recordset(null::public.ud_offer_documents, k.dokumenty);
  insert into public.ud_offer_files
    select * from jsonb_populate_recordset(null::public.ud_offer_files, k.pliki);
  insert into public.ud_offer_pins
    select * from jsonb_populate_recordset(null::public.ud_offer_pins, k.piny);
  insert into public.ud_offer_questions
    select * from jsonb_populate_recordset(null::public.ud_offer_questions, k.pytania);
  insert into public.ud_send_log
    select * from jsonb_populate_recordset(null::public.ud_send_log, k.wysylki);

  -- Sprzedany wariant przy leadzie: usunięcie oferty wyzerowało go (SET NULL).
  -- Wraca tylko tam, gdzie nikt w międzyczasie nie wpisał innego, a lead dalej
  -- jest w „Wygrany". Wersja leada rośnie — otwarta tablica dostanie konflikt
  -- zamiast nadpisać stan, którego nie widziała.
  update public.ud_leady l
     set sprzedaz_wariant_id = (x->>'sprzedaz_wariant_id')::uuid,
         wersja = l.wersja + 1,
         updated_at = now()
    from jsonb_array_elements(k.leady) x
   where l.id = (x->>'lead_id')::uuid
     and l.sprzedaz_wariant_id is null
     and exists (select 1 from public.ud_leady_etap e
                  where e.id = l.etap_id and e.rodzaj = 'wygrany');

  delete from public.ud_offers_kosz where id = k.id;

  return jsonb_build_object('status', 'ok', 'offer_id', k.offer_id);
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Lista kosza dla użytkownika (te same reguły widoczności co przywracanie)

create or replace function public.ud_kosz_ofert_lista(p_user uuid, p_dni integer default 30)
returns table (
  id uuid,
  offer_id uuid,
  offer_number text,
  client_name text,
  nazwa text,
  status text,
  wlasciciel text,
  usunieto_at timestamptz,
  usunieto_przez text,
  wariantow integer,
  usuniecie_na_dobre timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select k.id, k.offer_id, k.offer_number, k.client_name,
         k.oferta->>'name', k.oferta->>'status',
         w.full_name, k.usunieto_at, u.full_name,
         jsonb_array_length(k.dokumenty),
         k.usunieto_at + make_interval(days => p_dni)
    from public.ud_offers_kosz k
    left join public.ud_user_profiles w on w.id = k.wlasciciel_id
    left join public.ud_user_profiles u on u.id = k.usunieto_przez
   where exists (select 1 from public.ud_user_profiles p
                  where p.id = p_user and coalesce(p.active, true))
     and (public.ud_leady_widzi(p_user, k.wlasciciel_id) or k.usunieto_przez = p_user)
     and k.czyszczenie_od is null
     and k.usunieto_at >= now() - make_interval(days => p_dni)
   order by k.usunieto_at desc;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Do wyczyszczenia po p_dni dniach. ZAJMUJE wpisy (czyszczenie_od) pod blokadą
-- z SKIP LOCKED: wpis, który ktoś właśnie przywraca, zostaje na następną
-- godzinę, a wpisu zajętego przez czyszczenie nie da się już przywrócić.
-- Pliki z kubełka usuwa panel (API Storage), potem kasuje wpis; nieudane
-- usunięcie zostawia wpis zajęty i po terminie — następne wywołanie go ponowi.
-- Wpis, którego oferta jakimś cudem istnieje (przywrócona inną drogą), nie
-- jest zwracany: jej pliki są w użyciu.

create or replace function public.ud_kosz_ofert_do_wyczyszczenia(p_dni integer default 30, p_limit integer default 20)
returns table (id uuid, offer_id uuid, pliki_storage text[])
language sql
volatile
security definer
set search_path = ''
as $fn$
  with kandydaci as (
    select k.id
      from public.ud_offers_kosz k
     where k.usunieto_at < now() - make_interval(days => p_dni)
       and not exists (select 1 from public.ud_offers o where o.id = k.offer_id)
     order by k.usunieto_at
     limit p_limit
       for update of k skip locked
  )
  update public.ud_offers_kosz k
     set czyszczenie_od = coalesce(k.czyszczenie_od, now())
    from kandydaci c
   where k.id = c.id
  returning k.id, k.offer_id, k.pliki_storage;
$fn$;

revoke all on function public.ud_oferta_do_kosza(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ud_oferta_z_kosza(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.ud_kosz_ofert_lista(uuid, integer) from public, anon, authenticated;
revoke all on function public.ud_kosz_ofert_do_wyczyszczenia(integer, integer) from public, anon, authenticated;
grant execute on function public.ud_oferta_do_kosza(uuid, uuid) to service_role;
grant execute on function public.ud_oferta_z_kosza(uuid, uuid, integer) to service_role;
grant execute on function public.ud_kosz_ofert_lista(uuid, integer) to service_role;
grant execute on function public.ud_kosz_ofert_do_wyczyszczenia(integer, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cron: co godzinę (o :17) panel czyści wpisy starsze niż 30 dni (pliki +
-- wpis), najwyżej 20 naraz. Co godzinę, nie raz na dobę: po usunięciu
-- kilkudziesięciu ofert jednego dnia zaległość schodzi w godziny, a nie dni —
-- dane osobowe nie mogą leżeć dłużej, niż obiecuje strona kosza. Bez
-- kandydatów wywołanie kończy się na jednym zapytaniu.
-- Token z Vaulta dokłada funkcja SQL (wzorzec edge_cron_token).

create or replace function public.ud_kosz_ofert_czyszczenie()
returns bigint
language sql
security definer
set search_path = ''
as $fn$
  select net.http_post(
    url := 'https://app.utratadochodu.pl/api/cron/kosz-ofert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets
                       where name = 'edge_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$fn$;

revoke all on function public.ud_kosz_ofert_czyszczenie() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'kosz-ofert-czyszczenie') then
    perform cron.schedule('kosz-ofert-czyszczenie', '17 * * * *',
                          'select public.ud_kosz_ofert_czyszczenie()');
  end if;
end $$;
