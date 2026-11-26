-- ============================================================
-- Link do oferty: termin ważności dla linków sprzed 13.11.2026 i NOT NULL.
-- STATUS: ZASTOSOWANA na produkcji 19.11.2026 o 20:42 UTC przez MCP (wersja = nazwa
-- pliku), przed panelem v.0.78. Liczby z chwili zastosowania: supabase/migrations/README.md.
--
-- Decyzja właściciela z 19.11.2026: „60 dni od ostatniej wysyłki + C”:
--   * oferta ZAMKNIĘTA (kupiona, odrzucona albo w archiwum) — link nieważny od razu
--     (wariant C szablonu supabase/pending/20261113000004_…, który ten plik zastępuje),
--   * pozostałe — 60 dni od OSTATNIEJ wysyłki (ud_offers.sent_at — sendOfferToClient
--     nadpisuje je przy każdej udanej wysyłce), a oferta nigdy niewysłana — 60 dni od
--     utworzenia (tak samo liczy domyślna wartość kolumny dla nowych ofert).
-- Bez dolnej granicy „nie krócej niż N dni od dziś” — właściciel jej nie chciał.
--
-- Skutek zależy od dnia zastosowania (reguła liczy od dat wysyłki) — liczby z chwili
-- zastosowania stoją w supabase/migrations/README.md. Agent przywraca link przyciskiem
-- „Odnów link” na stronie oferty albo ponowną wysyłką (obie drogi: co najmniej 60 dni
-- od teraz).
--
-- Kosz ofert (ud_offers_kosz): ud_oferta_z_kosza() wstawia ofertę z kopii JSON przez
-- jsonb_populate_record, więc kopia zrobiona przed tą migracją (bez klucza albo z null)
-- wróciłaby z NULL i przywrócenie padłoby na NOT NULL. Kopie dostają termin tą samą
-- regułą.
--
-- Po tej migracji panel nie ma już gałęzi „NULL = bez terminu” (v.0.78): brak daty
-- = link nieważny. Kolejność: najpierw ta migracja, potem panel — odwrotnie 53 stare
-- linki byłyby przez chwilę nieważne.
--
-- Idempotentna (drugie uruchomienie nie ma czego zmienić). Testy:
-- apps/panel/scripts/test-link-oferty-sql.mjs i supabase/tests/link-oferty.sql.
-- ============================================================

set local lock_timeout = '5s';
-- Najsilniejsza blokada od razu: bez niej UPDATE (blokady wierszy), a potem ALTER
-- (ACCESS EXCLUSIVE) mógłby się zakleszczyć z równoległym zapisem panelu do tego
-- samego wiersza. Tabela ma kilkadziesiąt wierszy — blokada trwa milisekundy.
lock table public.ud_offers in access exclusive mode;

update public.ud_offers
   set share_expires_at = case
         when status in ('bought', 'rejected') or archived_at is not null then now()
         else coalesce(sent_at, created_at, now()) + interval '60 days'
       end
 where share_expires_at is null;

do $kosz$
begin
  if to_regclass('public.ud_offers_kosz') is not null then
    update public.ud_offers_kosz
       set oferta = jsonb_set(oferta, '{share_expires_at}', to_jsonb(
             case
               when oferta->>'status' in ('bought', 'rejected')
                    or coalesce(oferta->>'archived_at', '') <> '' then now()
               else coalesce((oferta->>'sent_at')::timestamptz,
                             (oferta->>'created_at')::timestamptz,
                             now()) + interval '60 days'
             end))
     where coalesce(oferta->>'share_expires_at', '') = '';
  end if;
end
$kosz$;

alter table public.ud_offers alter column share_expires_at set not null;

comment on column public.ud_offers.share_expires_at is
  'Koniec ważności linku /offer/<share_token>. NOT NULL od 19.11.2026; nowe oferty: '
  'utworzenie + 60 dni, wysyłka i „Odnów link” w panelu: co najmniej 60 dni od teraz. '
  'Brak daty albo data w przeszłości = link nieważny (panel 410, ud_offer_by_token pusto).';

-- ROLLBACK (przywraca „bez terminu” — tylko na wyraźne słowo właściciela, razem
-- z panelem v.0.77, który NULL obsługuje). Wszystkie oferty sprzed dodania kolumny
-- (migracja 20261116170158) miały NULL, więc granicą jest data utworzenia; cofa to
-- także późniejsze odnowienia i wysyłki tych ofert:
--   alter table public.ud_offers alter column share_expires_at drop not null;
--   update public.ud_offers set share_expires_at = null
--    where created_at < timestamptz '2026-11-16 17:01:58+00';
