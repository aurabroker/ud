-- Przypomnienie SMS o ofercie — poprawki po przeglądzie (12.10.2026).
-- Pierwsza wersja: 20261012123157_oferty_przypomnienia_sms.sql (zadanie crona
-- nadal WYŁĄCZONE — ta migracja go nie rusza).
--
-- Zmienia wyłącznie ud_oferty_do_przypomnienia (tylko odczyt):
--
--  1. Oferta bez klienta (client_id is null) nie jest kandydatem. Warunek
--     „najnowsza oferta klienta" i „lead niezamknięty" niczego by wtedy nie
--     sprawdzały, a numer przy takiej ofercie może być czyjkolwiek.
--  2. Klient, który kupił albo wybrał wariant w INNEJ ofercie, nie dostaje
--     przypomnienia o tej. Wcześniej sprawdzana była tylko sama oferta.
--  3. Zarchiwizowany lead to sprawa zamknięta przez agenta — tak samo jak
--     Wygrany / Przegrany.
--  4. Osierocone zajęcie: panel zajmuje ofertę (przypomnienie_wersja =
--     wersja) PRZED zapisem w ud_send_log. Gdy wywołanie padnie między jednym
--     a drugim (limit workera, zerwane połączenie), oferta zostałaby zajęta bez
--     żadnego SMS-a na zawsze. Zajęcie starsze niż godzina, przy którym
--     dziennik nie ma ŻADNEGO wpisu o tej wersji, wraca do puli. Wpis
--     w dzienniku — także „pending" — blokuje ponowienie: wtedy nie wiadomo,
--     czy SMS wyszedł, a dwa SMS-y są gorsze niż żaden.
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
  join public.ud_clients c on c.id = o.client_id
  where o.status in ('sent', 'viewed')
    and o.archived_at is null
    and o.sent_at is not null
    and o.sent_at <= now() - make_interval(days => p_po_dniach)
    and o.sent_at >  now() - make_interval(days => p_najwyzej_dni)
    and o.client_choice is null
    and o.decided_at is null
    and (
      coalesce(o.przypomnienie_wersja, 0) < coalesce(o.wersja, 1)
      or (
        o.przypomnienie_wersja = coalesce(o.wersja, 1)
        and o.przypomnienie_sms_at < now() - interval '1 hour'
        and not exists (
          select 1 from public.ud_send_log s
          where s.offer_id = o.id
            and s.channel = 'sms_przypomnienie'
            and s.wersja = o.przypomnienie_wersja
        )
      )
    )
    and not exists (
      select 1 from public.ud_offer_questions q
      where q.offer_id = o.id and q.asked_at >= o.sent_at
    )
    and not exists (
      select 1 from public.ud_offers n
      where n.client_id = o.client_id and n.id <> o.id and n.sent_at > o.sent_at
    )
    and not exists (
      select 1 from public.ud_offers b
      where b.client_id = o.client_id and b.id <> o.id
        and b.status in ('bought', 'chosen')
    )
    and not exists (
      select 1 from public.ud_leady l
      left join public.ud_leady_etap e on e.id = l.etap_id
      where l.klient_id = o.client_id
        and (e.rodzaj in ('wygrany', 'przegrany') or l.zarchiwizowano_at is not null)
    )
  order by o.sent_at;
$$;

revoke all on function public.ud_oferty_do_przypomnienia(integer, integer) from public, anon, authenticated;
grant execute on function public.ud_oferty_do_przypomnienia(integer, integer) to service_role;
