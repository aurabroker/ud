-- Dane testowe tablicy leadów: 4 agentów, 8 klientów z ofertami, 4 szkice.
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

insert into public.ud_offers (user_id, client_id, status, created_at, sent_at, viewed_at, decided_at, archived_at) values
 (null,                                           'c0000000-0000-0000-0000-000000000002', 'sent',     now() - interval '12 days', now() - interval '12 days', null, null, null),
 (null,                                           'c0000000-0000-0000-0000-000000000003', 'bought',   now() - interval '20 days', now() - interval '20 days', now() - interval '19 days', now() - interval '18 days', now() - interval '1 day'),
 ('a0000000-0000-0000-0000-0000000000a3',         'c0000000-0000-0000-0000-000000000004', 'chosen',   now() - interval '9 days',  now() - interval '9 days',  now() - interval '8 days',  now() - interval '7 days', null),
 (null,                                           'c0000000-0000-0000-0000-000000000005', 'sent',     now() - interval '15 days', now() - interval '15 days', null, null, now() - interval '2 days'),
 (null,                                           'c0000000-0000-0000-0000-000000000006', 'rejected', now() - interval '14 days', now() - interval '14 days', null, now() - interval '13 days', null),
 (null,                                           'c0000000-0000-0000-0000-000000000008', 'draft',    now() - interval '3 days',  null, null, null, null);

insert into public.ud_wnioski_szkice (id, created_at, updated_at, ostatni_krok, imie, email, phone,
                                      zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
 ('50000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '1 day', 'kontakt', 'Szymon Szkic', 'szymon@x.pl', '600 700 800', true, 'v1', 'treść', now() - interval '1 day');
insert into public.ud_wnioski_szkice (id, ostatni_krok) values
 ('50000000-0000-0000-0000-000000000002', 'dane');                                    -- bez zgody
insert into public.ud_wnioski_szkice (id, ostatni_krok, ukonczony_at, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
 ('50000000-0000-0000-0000-000000000003', 'zgody', now(), true, 'v1', 'treść', now());   -- ukończony bez klienta
insert into public.ud_wnioski_szkice (id, ostatni_krok, zgoda_kontakt, zgoda_wycofana_at) values
 ('50000000-0000-0000-0000-000000000004', 'zakres', false, now());                       -- zgoda wycofana

