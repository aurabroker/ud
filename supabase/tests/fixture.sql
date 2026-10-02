-- Dane testowe tablicy leadów: 4 agentów, 8 klientów z ofertami i wariantami, 4 szkice
-- (szkice od części 3 nie są leadami — są tu po to, żeby to sprawdzić).
-- Rozkład etapów po synchronizacji i oczekiwania — patrz leady.sql, sekcja 1.

-- ─── Fixture ────────────────────────────────────────────────────────────────
insert into public.ud_user_profiles (id, full_name, role, active) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Ada Admin',        'admin', true),
  ('a0000000-0000-0000-0000-0000000000a2', 'Ula Agent',        'user',  true),
  ('a0000000-0000-0000-0000-0000000000a3', 'Olek Agent',       'user',  true),
  ('a0000000-0000-0000-0000-0000000000a4', 'Ines Nieaktywna',  'user',  false);

insert into public.ud_clients (id, created_at, full_name, email, phone, pesel, profession, source, referred_by,
                               risk_temp_incapacity, risk_perm_incapacity, risk_death_invalidity,
                               temp_incapacity_sum, perm_incapacity_sum) values
 ('c0000000-0000-0000-0000-000000000001', now() - interval '40 days', 'Anna Kowalska',      'anna@x.pl',  '500100200', '80010112345', 'Księgowa', 'form',   null, true,  null,  null,  '8000',        null),
 ('c0000000-0000-0000-0000-000000000002', now() - interval '30 days', 'Bartek Nowak',      'bartek@x.pl','600200300', '81010112345', 'Kierowca', 'direct', 'a0000000-0000-0000-0000-0000000000a2', true, true, null, '8 000,50 zł', '1000000'),
 ('c0000000-0000-0000-0000-000000000003', now() - interval '25 days', 'Celina Wygrana',     'celina@x.pl','700300400', null,          null,       'form',   null, null,  null,  null,  null,          null),
 ('c0000000-0000-0000-0000-000000000004', now() - interval '22 days', 'Darek Decyzja',      'darek@x.pl', '800400500', null,          null,       'form',   null, true,  null,  true,  '20000',       null),
 ('c0000000-0000-0000-0000-000000000005', now() - interval '20 days', 'Ewa Archiwalna',     'ewa@x.pl',   '900500600', null,          null,       'direct', null, null,  null,  null,  '5000',        null),
 ('c0000000-0000-0000-0000-000000000006', now() - interval '18 days', 'Filip Odrzucony',    'filip@x.pl', '510600700', null,          null,       'form',   null, null,  null,  null,  null,          null),
 ('c0000000-0000-0000-0000-000000000007', now() - interval '10 days', 'Gabriel Podkreślnik','a_b@x.pl',  '520700800', null,          null,       'form',   null, true,  null,  null,  '12000',       null),
 ('c0000000-0000-0000-0000-000000000008', now() - interval '5 days',  'Hanna Szkicowa',     'hanna@x.pl', '530800900', null,          null,       'form',   'a0000000-0000-0000-0000-0000000000a4', null, null, null, null, null);

insert into public.ud_offers (id, user_id, client_id, status, created_at, sent_at, viewed_at, decided_at, archived_at, client_choice) values
 ('0f000000-0000-0000-0000-000000000002', null,                                   'c0000000-0000-0000-0000-000000000002', 'sent',     now() - interval '12 days', now() - interval '12 days', null, null, null, null),
 ('0f000000-0000-0000-0000-000000000003', null,                                   'c0000000-0000-0000-0000-000000000003', 'bought',   now() - interval '20 days', now() - interval '20 days', now() - interval '19 days', now() - interval '18 days', now() - interval '1 day',
  '{"document_id": "0d000000-0000-0000-0000-000000000003"}'),
 ('0f000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-000000000004', 'chosen',   now() - interval '9 days',  now() - interval '9 days',  now() - interval '8 days',  now() - interval '7 days', null, null),
 ('0f000000-0000-0000-0000-000000000005', null,                                   'c0000000-0000-0000-0000-000000000005', 'sent',     now() - interval '15 days', now() - interval '15 days', null, null, now() - interval '2 days', null),
 ('0f000000-0000-0000-0000-000000000006', null,                                   'c0000000-0000-0000-0000-000000000006', 'rejected', now() - interval '14 days', now() - interval '14 days', null, now() - interval '13 days', null, null),
 ('0f000000-0000-0000-0000-000000000008', null,                                   'c0000000-0000-0000-0000-000000000008', 'draft',    now() - interval '3 days',  null, null, null, null, null);

-- Warianty: dwa w ofercie Bartka (bez wyboru), jeden kupiony przez Celinę.
insert into public.ud_offer_documents (id, offer_id, insurer_type, offer_number, death_covered, temp_incapacity_covered,
                                       temp_monthly_benefit, perm_incapacity_covered, perm_sum_insured,
                                       premium_total, premium_monthly, parsed_raw) values
 ('0d000000-0000-0000-0000-00000000002a', '0f000000-0000-0000-0000-000000000002', 'leadenhall', 'LHQ1/1', false, true, 10000, false, null,   3036, 253,  '{}'),
 ('0d000000-0000-0000-0000-00000000002b', '0f000000-0000-0000-0000-000000000002', 'ceu',        'LOIP/2', true,  true, 12000, true,  240000, 4200, null, '{"death_sum_insured": "100000"}'),
 ('0d000000-0000-0000-0000-000000000003', '0f000000-0000-0000-0000-000000000003', 'leadenhall', 'LHQ3/1', true,  true, 8000,  false, null,   6000, 500,  '{"death_sum_insured": "50 000"}');

insert into public.ud_wnioski_szkice (id, created_at, updated_at, ostatni_krok, imie, email, phone,
                                      zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
 ('50000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '1 day', 'kontakt', 'Szymon Szkic', 'szymon@x.pl', '600 700 800', true, 'v1', 'treść', now() - interval '1 day');
insert into public.ud_wnioski_szkice (id, ostatni_krok) values
 ('50000000-0000-0000-0000-000000000002', 'dane');                                    -- bez zgody
insert into public.ud_wnioski_szkice (id, ostatni_krok, ukonczony_at, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
 ('50000000-0000-0000-0000-000000000003', 'zgody', now(), true, 'v1', 'treść', now());   -- ukończony bez klienta
insert into public.ud_wnioski_szkice (id, ostatni_krok, zgoda_kontakt, zgoda_wycofana_at) values
 ('50000000-0000-0000-0000-000000000004', 'zakres', false, now());                       -- zgoda wycofana

