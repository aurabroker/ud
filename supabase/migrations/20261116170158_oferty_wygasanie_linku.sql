-- ============================================================
-- Link do oferty (/offer/<share_token>): data ważności i utwardzenie
-- ud_offer_by_token (przegląd bezpieczeństwa z 12.11.2026).
--
-- 1) ud_offers.share_expires_at — koniec ważności linku.
--    * NOWE oferty: domyślnie 60 dni od utworzenia (wysyłka przedłuża, patrz
--      apps/panel/src/lib/server/linkOferty.js).
--    * ISTNIEJĄCE oferty (53 wiersze, 52 z linkiem, stan 13.11.2026) zostają z NULL:
--      datę dostaną po decyzji właściciela — dostały 19.11.2026 w
--      supabase/migrations/20261119204221_oferty_waznosc_starych_linkow.sql.
--      Kolumnę dodajemy BEZ wartości domyślnej i dopiero potem ją ustawiamy: przy
--      ADD COLUMN … DEFAULT now() + … Postgres wpisałby tę datę także starym wierszom.
--    * Panel (service_role) do czasu tej decyzji traktuje NULL jak „bez terminu”.
--
-- 2) ud_offer_by_token — dotąd zwracała CAŁY wiersz (e-mail, telefon, kod dostępu,
--    dane oferty) każdemu z tokenem, przez publiczne API, z pominięciem PIN-u.
--    Nic jej nie wywołuje (panel czyta ud_offers kluczem service_role; brak w kodzie
--    ud/udapp, w logach API z 7 dni i w pg_stat_statements od 07.03.2026). Teraz:
--    * zwraca tylko to, co strona oferty pokazuje przed podaniem hasła, bez danych
--      klienta: nazwę, numer, status i datę ważności,
--    * wyłącznie dla ważnego linku: share_expires_at NOT NULL i w przyszłości, oferta
--      nie w archiwum,
--    * EXECUTE tylko service_role (anon/authenticated odebrane).
--    Licznik/limit otwarć: rozważony i pominięty — funkcji nic nie wywołuje, a stronę
--    oferty chroni hasło z limitem prób (ud_offer_pins.max_attempts).
--
-- Idempotentna. Testy: apps/panel/scripts/test-link-oferty-sql.mjs (lokalnie)
-- i supabase/tests/link-oferty.sql (ten sam plik na produkcji — wszystko wycofuje).
-- ============================================================

set local lock_timeout = '5s';

alter table public.ud_offers add column if not exists share_expires_at timestamptz;
alter table public.ud_offers alter column share_expires_at set default (now() + interval '60 days');

comment on column public.ud_offers.share_expires_at is
  'Koniec ważności linku /offer/<share_token>. Nowe oferty: 60 dni od utworzenia, wysyłka przedłuża. '
  'NULL = link sprzed 13.11.2026, data po decyzji właściciela (panel: bez terminu; ud_offer_by_token: nieważny).';

drop function if exists public.ud_offer_by_token(text);
create function public.ud_offer_by_token(p_token text)
returns table (
  name             text,
  offer_number     text,
  status           text,
  share_expires_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select o.name, o.offer_number, o.status, o.share_expires_at
  from public.ud_offers o
  where p_token is not null
    and o.share_token = p_token
    and o.share_expires_at is not null
    and o.share_expires_at > now()
    and o.archived_at is null
$$;

comment on function public.ud_offer_by_token(text) is
  'Stan linku do oferty bez danych klienta; tylko ważny link (share_expires_at w przyszłości, poza archiwum). Tylko service_role.';

revoke all on function public.ud_offer_by_token(text) from public, anon, authenticated;
grant execute on function public.ud_offer_by_token(text) to service_role;
