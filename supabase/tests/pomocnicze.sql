-- Funkcje pomocnicze testów tablicy leadów (schemat tt). Ładowane po stub.sql
-- i migracjach, przed fixture.sql. Każda asercja to tt.t('nazwa', warunek) →
-- linia PASS/FAIL; runner liczy je i wywala się przy FAIL albo błędzie SQL.

create schema tt;
create table tt.wyniki (nazwa text, ok boolean);
create function tt.t(p_nazwa text, p_ok boolean) returns void language plpgsql as $$
begin
  insert into tt.wyniki values (p_nazwa, coalesce(p_ok, false));
  if coalesce(p_ok, false) then raise notice 'PASS %', p_nazwa; else raise notice 'FAIL %', p_nazwa; end if;
end $$;

create function tt.etap(k text) returns uuid language sql as $$
  select e.id from public.ud_leady_etap e join public.ud_leady_pipeline p on p.id = e.pipeline_id
   where p.klucz = 'sprzedaz' and e.klucz = k $$;
create function tt.pipeline() returns uuid language sql as $$
  select id from public.ud_leady_pipeline where klucz = 'sprzedaz' $$;
-- Lead po nazwie z widoku (nazwy w fixture są unikalne).
create function tt.lead(p_nazwa text) returns uuid language sql as $$
  select id from public.ud_leady_baza where nazwa = p_nazwa $$;
create function tt.wersja(p_lead uuid) returns int language sql as $$
  select wersja from public.ud_leady where id = p_lead $$;
create function tt.etap_leada(p_lead uuid) returns text language sql as $$
  select e.klucz from public.ud_leady l join public.ud_leady_etap e on e.id = l.etap_id where l.id = p_lead $$;
create function tt.hist(p_lead uuid) returns int language sql as $$
  select count(*)::int from public.ud_leady_historia where lead_id = p_lead $$;
create function tt.ruch(p_op text, p_lead uuid, p_wersja int, p_klucz text, p_user uuid, p_dane jsonb default '{}')
  returns jsonb language sql as $$ select public.ud_lead_zmien(p_op, p_lead, p_wersja, p_klucz, p_user, p_dane) $$;
create function tt.przenies(p_lead uuid, p_cel text, p_klucz text, p_user uuid default 'a0000000-0000-0000-0000-0000000000a2')
  returns jsonb language sql as $$
  select public.ud_lead_zmien('przenies', p_lead, tt.wersja(p_lead), p_klucz, p_user,
                              jsonb_build_object('etap_id', tt.etap(p_cel))) $$;
-- Identyfikatory agentów: a1 admin, a2 Ula (user), a3 Olek (user), a4 Ines (nieaktywna).
create function tt.id_ula() returns uuid language sql as $$ select 'a0000000-0000-0000-0000-0000000000a2'::uuid $$;
create function tt.id_adm() returns uuid language sql as $$ select 'a0000000-0000-0000-0000-0000000000a1'::uuid $$;
create function tt.id_olek() returns uuid language sql as $$ select 'a0000000-0000-0000-0000-0000000000a3'::uuid $$;
create function tt.id_ines() returns uuid language sql as $$ select 'a0000000-0000-0000-0000-0000000000a4'::uuid $$;

