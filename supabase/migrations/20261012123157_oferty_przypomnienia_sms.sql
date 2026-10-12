-- Przypomnienie SMS o ofercie bez odpowiedzi — decyzja właściciela z 12.10.2026:
-- „ludzie, co dostali ofertę i cisza — musimy się przypomnieć".
--
-- Podział pracy:
--   * baza WYBIERA kandydatów (ud_oferty_do_przypomnienia) — reguła w jednym
--     miejscu, do odczytu także „na sucho", bez wysyłania czegokolwiek,
--   * panel WYSYŁA (SMSAPI ma token tylko w panelu) i „zajmuje" ofertę warunkowym
--     UPDATE-em, żeby dwa wywołania nie wysłały dwóch SMS-ów,
--   * pg_cron co godzinę woła panel przez ud_oferty_przypomnienia() — token
--     z Vaulta dokłada funkcja SQL, nie treść zadania (wzorzec z
--     20260924191031_edge_cron_token.sql).
--
-- Jeden SMS na WERSJĘ oferty: nowa wysyłka (wersja 2) to nowa oferta, o której
-- klient może zapomnieć tak samo; ta sama wersja — nigdy drugi raz.

alter table public.ud_offers
  add column if not exists przypomnienie_wersja integer,
  add column if not exists przypomnienie_sms_at timestamptz;

comment on column public.ud_offers.przypomnienie_wersja is
  'Wersja oferty, o której wysłano przypomnienie SMS (ud_oferty_do_przypomnienia). Null — jeszcze żadnej.';
comment on column public.ud_offers.przypomnienie_sms_at is
  'Kiedy panel zajął ofertę do przypomnienia SMS.';

-- Kandydaci do przypomnienia. Tylko odczyt — nic nie zmienia, więc można to
-- wołać „na sucho", żeby zobaczyć, kto dostałby SMS.
--
-- Oferta jest „cicha", gdy:
--   * poszła do klienta (sent albo viewed — obejrzenie bez decyzji też jest ciszą),
--   * od wysyłki minęło co najmniej p_po_dniach dni, ale nie więcej niż
--     p_najwyzej_dni (po miesiącu SMS „wysłaliśmy ofertę" jest dziwny),
--   * klient nie wybrał wariantu, nie zadał pytania po tej wysyłce,
--   * oferta nie jest w archiwum, a jego lead nie jest zamknięty (Wygrany /
--     Przegrany — agent już wie, jak się skończyło),
--   * to najnowsza wysłana oferta tego klienta (o starszej nie przypominamy),
--   * o tej wersji jeszcze nie przypominaliśmy.
create or replace function public.ud_oferty_do_przypomnienia(
  p_po_dniach integer default 3,
  p_najwyzej_dni integer default 30
)
returns table (
  offer_id uuid,
  wersja integer,
  telefon_oferty text,
  telefon_klienta text,
  sent_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, coalesce(o.wersja, 1), nullif(trim(o.client_phone), ''), nullif(trim(c.phone), ''), o.sent_at
  from public.ud_offers o
  left join public.ud_clients c on c.id = o.client_id
  where o.status in ('sent', 'viewed')
    and o.archived_at is null
    and o.sent_at is not null
    and o.sent_at <= now() - make_interval(days => p_po_dniach)
    and o.sent_at >  now() - make_interval(days => p_najwyzej_dni)
    and o.client_choice is null
    and o.decided_at is null
    and coalesce(o.przypomnienie_wersja, 0) < coalesce(o.wersja, 1)
    and not exists (
      select 1 from public.ud_offer_questions q
      where q.offer_id = o.id and q.asked_at >= o.sent_at
    )
    and not exists (
      select 1 from public.ud_offers n
      where o.client_id is not null and n.client_id = o.client_id
        and n.id <> o.id and n.sent_at > o.sent_at
    )
    and not exists (
      select 1 from public.ud_leady l
      join public.ud_leady_etap e on e.id = l.etap_id
      where o.client_id is not null and l.klient_id = o.client_id
        and e.rodzaj in ('wygrany', 'przegrany')
    )
  order by o.sent_at;
$$;

revoke all on function public.ud_oferty_do_przypomnienia(integer, integer) from public, anon, authenticated;
grant execute on function public.ud_oferty_do_przypomnienia(integer, integer) to service_role;

-- Wywołanie panelu z pg_cron. Godziny wysyłki (dni robocze, 9–18 czasu
-- polskiego) pilnuje panel — tu byłyby w UTC i rozjeżdżałyby się przy zmianie
-- czasu.
create or replace function public.ud_oferty_przypomnienia()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://app.utratadochodu.pl/api/cron/przypomnienia-ofert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets
                       where name = 'edge_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$;

revoke all on function public.ud_oferty_przypomnienia() from public, anon, authenticated;

-- Zadanie powstaje WYŁĄCZONE. Włączenie to decyzja właściciela po obejrzeniu
-- listy kandydatów (select * from public.ud_oferty_do_przypomnienia();):
--   select cron.alter_job((select jobid from cron.job
--     where jobname = 'oferty-przypomnienia-sms'), active := true);
do $$
declare
  v_id bigint;
begin
  select jobid into v_id from cron.job where jobname = 'oferty-przypomnienia-sms';
  if v_id is null then
    v_id := cron.schedule('oferty-przypomnienia-sms', '25 * * * *',
                          'select public.ud_oferty_przypomnienia()');
    perform cron.alter_job(v_id, active := false);
  end if;
end $$;
