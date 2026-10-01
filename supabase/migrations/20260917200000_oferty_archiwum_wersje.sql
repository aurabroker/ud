-- Panel ofert: sprzedana polisa, archiwum i wersjonowanie wysyłek.
--
-- Trzy braki, które zgłosił klient:
--   1. nie dało się odnotować, że klient kupił polisę — status kończył się
--      na „chosen" (klient wskazał wariant w portalu), co jest czym innym
--      niż podpisana umowa;
--   2. nie było archiwum, więc lista rosła bez końca i sprawy zamknięte
--      mieszały się z bieżącymi;
--   3. gdy klient prosił o kolejne warianty, agent dokładał je do tej samej
--      oferty i wysyłał ponownie — obie wysyłki wyglądały tak samo i nie było
--      wiadomo, którą wersję klient ma przed sobą.
--
-- Daty wysyłek już były: ud_send_log.created_at zapisuje każdą próbę, także
-- nieudaną. Brakowało tylko powiązania wysyłki z numerem wersji.

alter table public.ud_offers
  add column if not exists archived_at timestamptz,
  add column if not exists wersja integer not null default 1;

alter table public.ud_send_log
  add column if not exists wersja integer;

comment on column public.ud_offers.archived_at is
  'Zarchiwizowana, gdy nie NULL. Nie kasujemy ofert i nie zmieniamy statusu — '
  'oferta kupiona zostaje kupiona, tylko znika z listy bieżącej.';

comment on column public.ud_offers.wersja is
  'Numer wersji oferty. Rośnie przy każdej kolejnej wysyłce do klienta, nie '
  'przy dokładaniu dokumentów — liczy się to, co klient faktycznie zobaczył.';

comment on column public.ud_send_log.wersja is
  'Wersja oferty w chwili tej wysyłki. Bez tego nie da się odtworzyć, którą '
  'wersję klient dostał którego dnia.';

-- Lista bieżących ofert to zapytanie „archived_at is null" — indeks częściowy
-- obsługuje dokładnie ten przypadek i nie rośnie razem z archiwum.
create index if not exists ud_offers_biezace_idx
  on public.ud_offers (created_at desc)
  where archived_at is null;

-- Wysyłki sprzed tej migracji to wersja 1: w tamtym czasie kolejna wysyłka
-- nadpisywała poprzednią i innej wersji nie było.
update public.ud_send_log set wersja = 1 where wersja is null;
