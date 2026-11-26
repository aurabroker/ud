-- Kliknięcia /kup-online zebrane po tygodniu i miejscu — do panelu
-- (Niedokończone → „Kup online u Leadenhall"). Bez danych osobowych:
-- tabela źródłowa ich nie ma. security_invoker: widok czyta z uprawnieniami
-- wywołującego, więc RLS tabeli działa dalej (bez tego widok czytałby jako
-- właściciel). Czyta tylko service_role, jak lejek wniosku.
create or replace view public.ud_klikniecia_tydzien
with (security_invoker = true) as
select date_trunc('week', czas at time zone 'Europe/Warsaw')::date as tydzien,
       cel,
       zrodlo,
       count(*)::int as klikniec
  from public.ud_klikniecia
 group by 1, 2, 3;

revoke all on public.ud_klikniecia_tydzien from public, anon, authenticated;
grant select on public.ud_klikniecia_tydzien to service_role;
