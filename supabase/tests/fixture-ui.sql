-- Dane do testów przeglądarkowych tablicy leadów (apps/panel/test/leady).
-- Ładowane na świeży klaster (po stub.sql, migracjach i pomocnicze.sql) oraz przy
-- KAŻDYM resecie między testami (serwer.mjs czyści tabele i wykonuje to od nowa).
--
-- Układ po synchronizacji i poprawkach na końcu pliku (Kontakt scalony z Nowym,
-- porzucone wnioski nie są leadami — Szymon Szkic jest szkicem ze zgodą, ale nie kartą):
--   Nowy        Anna Kowalska (2 dni), Bartek Nowak (20), Celina Zielińska (1), Dariusz Wójcik (2), Ewa Mazur (1),
--               Filip Lis (3), Grażyna Pawlak (4) — ci dwaj byli w Kontakcie
--   Oferta      Henryk Sikora (6), Irena Kubiak (8)
--   Decyzja     — (pusta kolumna: K04)
--   Wygrany     Jerzy Duda (bez danych sprzedaży; w ofercie jeden wariant)
--   Przegrany   Karolina Mróz
-- Agenci: Ada (admin), Ula, Olek (user), Ines (nieaktywna).

insert into public.ud_user_profiles (id, full_name, role, active) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Ada Admin',       'admin', true),
  ('a0000000-0000-0000-0000-0000000000a2', 'Ula Agent',       'user',  true),
  ('a0000000-0000-0000-0000-0000000000a3', 'Olek Agent',      'user',  true),
  ('a0000000-0000-0000-0000-0000000000a4', 'Ines Nieaktywna', 'user',  false);

insert into public.ud_clients (id, created_at, full_name, email, phone, pesel, profession, employment_type, source,
                               risk_temp_incapacity, risk_perm_incapacity, risk_death_invalidity,
                               temp_incapacity_sum, perm_incapacity_sum) values
 ('c0000000-0000-0000-0000-000000000001', now() - interval '40 days', 'Anna Kowalska',   'anna@x.pl',     '500100200', '80010112345', 'Księgowa',   'B2B',       'form',   true, null, null, '8000',  null),
 ('c0000000-0000-0000-0000-000000000002', now() - interval '30 days', 'Bartek Nowak',    'bartek@x.pl',   '600200300', '81010112345', 'Kierowca',   'umowa',     'direct', true, true, null, '9000',  '1000000'),
 ('c0000000-0000-0000-0000-000000000003', now() - interval '25 days', 'Celina Zielińska','celina@x.pl',   '700300400', null,          'Lekarka',    'B2B',       'form',   true, null, null, '15000', null),
 ('c0000000-0000-0000-0000-000000000004', now() - interval '22 days', 'Dariusz Wójcik',  'darek@x.pl',    '800400500', null,          'Architekt',  'B2B',       'form',   true, null, true, '12000', null),
 ('c0000000-0000-0000-0000-000000000005', now() - interval '20 days', 'Ewa Mazur',       'ewa@x.pl',      '900500600', null,          'Prawniczka', 'B2B',       'direct', null, null, null, null,    null),
 ('c0000000-0000-0000-0000-000000000006', now() - interval '18 days', 'Filip Lis',       'filip@x.pl',    '510600700', null,          'Programista','B2B',       'form',   true, null, null, '20000', null),
 ('c0000000-0000-0000-0000-000000000007', now() - interval '16 days', 'Grażyna Pawlak',  'grazyna@x.pl',  '520700800', null,          'Dentystka',  'B2B',       'form',   true, true, null, '10000', '500000'),
 ('c0000000-0000-0000-0000-000000000008', now() - interval '14 days', 'Henryk Sikora',   'henryk@x.pl',   '530800900', null,          'Elektryk',   'B2B',       'form',   true, null, null, '7000',  null),
 ('c0000000-0000-0000-0000-000000000009', now() - interval '12 days', 'Irena Kubiak',    'irena@x.pl',    '540900100', null,          'Fryzjerka',  'B2B',       'direct', true, null, null, '6000',  null),
 ('c0000000-0000-0000-0000-00000000000a', now() - interval '10 days', 'Jerzy Duda',      'jerzy@x.pl',    '551000200', null,          'Stolarz',    'B2B',       'form',   true, null, null, '8000',  null),
 ('c0000000-0000-0000-0000-00000000000b', now() - interval '9 days',  'Karolina Mróz',   'karolina@x.pl', '561100300', null,          'Fotograf',   'B2B',       'form',   true, null, null, '5000',  null);

insert into public.ud_wnioski_szkice (id, created_at, updated_at, ostatni_krok, imie, email, phone,
                                      zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
 ('50000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '1 day', 'dane', 'Szymon Szkic', 'szymon@x.pl', '600 700 800', true, 'v1-2026-10', 'treść zgody', now() - interval '1 day');

-- Oferta Jerzego z jednym wariantem: do wyboru w oknie danych sprzedaży.
insert into public.ud_offers (id, user_id, client_id, status, offer_number, created_at, sent_at, viewed_at) values
 ('0f000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-00000000000a', 'viewed', 'UD/2026/10', now() - interval '8 days', now() - interval '8 days', now() - interval '7 days');
insert into public.ud_offer_documents (id, offer_id, insurer_type, product_name, offer_number, death_covered, temp_incapacity_covered,
                                       temp_monthly_benefit, perm_incapacity_covered, perm_sum_insured, premium_total, premium_monthly, parsed_raw) values
 ('0d000000-0000-0000-0000-00000000000a', '0f000000-0000-0000-0000-00000000000a', 'leadenhall', 'Leadenhall Utrata Dochodu', 'LHQ7/1',
  true, true, 8000, false, null, 3600, 300, '{"death_sum_insured": "50 000"}');

select public.ud_leady_synchronizuj();

-- Etapy, opiekunowie i działania — bezpośrednio, żeby fixture nie zależał od funkcji, którą testują testy.
create temp table _ust (nazwa text, etap text, opiekun uuid, dzialanie text, termin interval, opis text, w_etapie interval, powod text);
insert into _ust values
 ('Anna Kowalska',    'nowy',      'a0000000-0000-0000-0000-0000000000a2', 'telefon',   interval '-1 day',  'Oddzwonić w sprawie oferty', interval '2 days', null),
 ('Bartek Nowak',     'nowy',      null,                                   null,        null,               null,                         interval '20 days', null),
 ('Celina Zielińska', 'nowy',      'a0000000-0000-0000-0000-0000000000a3', 'email',     interval '1 day',   null,                         interval '1 day', null),
 ('Dariusz Wójcik',   'nowy',      'a0000000-0000-0000-0000-0000000000a2', 'spotkanie', interval '3 days',  null,                         interval '2 days', null),
 ('Ewa Mazur',        'nowy',      null,                                   null,        null,               null,                         interval '1 day', null),
 ('Filip Lis',        'nowy',      'a0000000-0000-0000-0000-0000000000a2', 'telefon',   interval '2 hours', null,                         interval '3 days', null),
 ('Grażyna Pawlak',   'nowy',      'a0000000-0000-0000-0000-0000000000a3', 'telefon',   interval '5 days',  null,                         interval '4 days', null),
 ('Henryk Sikora',    'oferta',    'a0000000-0000-0000-0000-0000000000a2', 'email',     interval '2 days',  null,                         interval '6 days', null),
 ('Irena Kubiak',     'oferta',    null,                                   null,        null,               null,                         interval '8 days', null),
 ('Jerzy Duda',       'wygrany',   'a0000000-0000-0000-0000-0000000000a2', null,        null,               null,                         interval '5 days', null),
 ('Karolina Mróz',    'przegrany', 'a0000000-0000-0000-0000-0000000000a3', null,        null,               null,                         interval '6 days', 'Wybrała konkurencję');

update public.ud_leady l
   set etap_id = (select e.id from public.ud_leady_etap e where e.klucz = u.etap and e.pipeline_id = l.pipeline_id),
       opiekun_id = u.opiekun,
       nastepne_dzialanie_typ = u.dzialanie,
       nastepne_dzialanie_at = case when u.dzialanie is not null then now() + u.termin end,
       nastepne_dzialanie_opis = case when u.dzialanie is not null then u.opis end,
       etap_od = now() - u.w_etapie,
       powod_utraty = u.powod
  from _ust u
  join public.ud_clients c on c.full_name = u.nazwa
 where l.klient_id = c.id;
