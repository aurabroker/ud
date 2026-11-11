-- Kliknięcia w linki wychodzące portalu — na razie jeden: /kup-online,
-- przekierowanie na stronę sprzedaży Leadenhall z naszym kodem pośrednika
-- (decyzja właściciela z 11.11.2026). Zapisuje funkcja Pages
-- `apps/portal/functions/kup-online/[[reszta]].js` kluczem serwisowym.
--
-- Bez danych osobowych: czas, cel i miejsce, z którego ktoś kliknął
-- (`?z=kalkulator` → 'kalkulator'). Bez IP, bez User-Agenta, bez ciasteczek —
-- dlatego licznik nie potrzebuje zgody i liczy wszystkich, nie tylko tych,
-- którzy zgodzili się na analitykę. Roboty, podglądy linków i prefetch
-- funkcja odsiewa sama i do tabeli nie wpisuje.
--
-- Ograniczenia CHECK powtarzają reguły funkcji: gdyby ktoś je kiedyś
-- poluzował w kodzie, do tabeli i tak nie wejdzie dowolny tekst z adresu.
--
-- Ile wejść tygodniowo, z którego miejsca:
--   select date_trunc('week', czas at time zone 'Europe/Warsaw')::date as tydzien,
--          zrodlo, count(*)
--   from public.ud_klikniecia where cel = 'leadenhall'
--   group by 1, 2 order by 1 desc, 3 desc;

create table if not exists public.ud_klikniecia (
  id     bigint generated always as identity primary key,
  czas   timestamptz not null default now(),
  cel    text not null check (cel in ('leadenhall')),
  zrodlo text not null check (zrodlo ~ '^[a-z0-9-]{1,32}$')
);

create index if not exists ud_klikniecia_cel_czas on public.ud_klikniecia (cel, czas desc);

alter table public.ud_klikniecia enable row level security;
revoke all on public.ud_klikniecia from public, anon, authenticated;
grant all on public.ud_klikniecia to service_role;
revoke all on sequence public.ud_klikniecia_id_seq from public, anon, authenticated;
grant usage on sequence public.ud_klikniecia_id_seq to service_role;
