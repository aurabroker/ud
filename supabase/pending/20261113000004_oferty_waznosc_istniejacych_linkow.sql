-- ============================================================
-- Data ważności dla linków do ofert utworzonych przed 13.11.2026.
-- STATUS: SZABLON — CZEKA NA DECYZJĘ WŁAŚCICIELA. Wszystkie polecenia są
-- zakomentowane; uruchomienie pliku w tej postaci niczego nie zmienia.
--
-- Stan po migracji 20261113000003_oferty_wygasanie_linku: nowe oferty mają
-- share_expires_at = utworzenie + 60 dni, a 52 starsze linki mają NULL. Panel
-- traktuje NULL jak „bez terminu”, więc do decyzji wszystkie stare linki działają.
--
-- Najpierw podgląd skutków (same liczby, bez danych klientów):
--   select count(*) filter (where created_at + interval '60 days' <= now()) as wygasna_od_razu_60d,
--          count(*) filter (where created_at + interval '60 days' >  now()) as zostana_60d,
--          count(*) filter (where status in ('sent', 'viewed'))            as czekaja_na_decyzje_klienta
--   from public.ud_offers where share_token is not null and share_expires_at is null;
--
-- Wybierz JEDEN wariant, odkomentuj go i uruchom razem z częścią „NOT NULL”.
-- ============================================================

-- set local lock_timeout = '5s';

-- Wariant A: 60 dni od utworzenia, ale nie krócej niż 14 dni od dziś
-- (oferty, które klient właśnie ogląda, nie gasną z dnia na dzień).
-- update public.ud_offers
--    set share_expires_at = greatest(created_at + interval '60 days', now() + interval '14 days')
--  where share_expires_at is null;

-- Wariant B: jeden termin dla wszystkich starych linków.
-- update public.ud_offers
--    set share_expires_at = timestamptz '2026-12-31 23:59:59+01'
--  where share_expires_at is null;

-- Wariant C: oferty zamknięte (kupione, odrzucone, w archiwum) od razu nieważne,
-- pozostałe jak w wariancie A.
-- update public.ud_offers
--    set share_expires_at = case
--          when status in ('bought', 'rejected') or archived_at is not null then now()
--          else greatest(created_at + interval '60 days', now() + interval '14 days')
--        end
--  where share_expires_at is null;

-- Część „NOT NULL” — po każdym wariancie. Od tej chwili panel też egzekwuje datę
-- dla wszystkich linków (gałąź „NULL = bez terminu” w linkOferty.js można usunąć).
-- alter table public.ud_offers alter column share_expires_at set not null;

-- ROLLBACK:
--   alter table public.ud_offers alter column share_expires_at drop not null;
--   (daty ustawione wariantem nie mają kopii — przed uruchomieniem zapisz
--    select id, share_expires_at from public.ud_offers where share_expires_at is null;)
