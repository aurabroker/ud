-- Tabela kliknięć /kup-online do panelu, już zwinięta: tydzień × miejsce,
-- tylko `p_miejsc` miejsc z największą liczbą kliknięć w oknie, reszta
-- zsumowana pod '__pozostale' (podkreślnika nie przepuszcza biała lista
-- źródeł, więc nie zderzy się z prawdziwym miejscem). Wynik ma najwyżej
-- tygodnie × (p_miejsc + 1) wierszy, niezależnie od tego, ile różnych `?z=`
-- ktoś nawpisuje — zwijanie w przeglądarce działało dopiero PO limicie
-- 1000 wierszy PostgREST, więc zalew `?z=` wypychał prawdziwe tygodnie
-- (przegląd z 11.11.2026). Kolejność przy remisie: nazwa w porządku bajtów
-- (collate "C"), jak w panelu.
create or replace function public.ud_klikniecia_tabela(p_od date, p_miejsc int default 6)
returns table (tydzien date, zrodlo text, klikniec int, miejsc_wszystkich int)
language sql
stable
security invoker
set search_path = ''
as $$
  with okno as (
    select k.tydzien, k.zrodlo, k.klikniec
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
         max(r.wszystkich)::int
    from okno o
    join ranking r on r.zrodlo = o.zrodlo
   group by 1, 2
$$;

revoke all on function public.ud_klikniecia_tabela(date, int) from public, anon, authenticated;
grant execute on function public.ud_klikniecia_tabela(date, int) to service_role;
