-- Postanowienia dodatkowe oferty (warunki/zastrzeżenia agenta).
-- Pole niezależne od broker_message („Wiadomość dla klienta") — trafia
-- osobną sekcją na PDF rekomendacji, nie do treści wiadomości.
alter table public.ud_offers
  add column if not exists additional_terms text;

comment on column public.ud_offers.additional_terms is
  'Postanowienia dodatkowe (warunki, zastrzeżenia) drukowane w PDF rekomendacji.';
