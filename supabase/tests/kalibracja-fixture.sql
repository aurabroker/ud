-- Zamrożony zestaw z produkcji do testów kalibracji stawek
-- (supabase/tests/kalibracja.sql, apps/panel/scripts/test-kalibracja-sql.mjs).
--
-- 127 wariantów z 35 ofert — wszystkie z ud_offer_documents na 14.10.2026
-- (ok. 12:40 UTC). Wyciągnięte jednym SELECT-em, BEZ danych osobowych:
--   * oferta, klient i osoba to numery porządkowe (dense_rank), nie id —
--     osoba to ranga skrótu PESEL-u, więc „dwa client_id, jeden PESEL"
--     zostaje odwzorowane (klienci 32 i 25 → osoba 10), a PESEL nie wychodzi;
--   * PESEL-e i numery ofert poniżej są zmyślone, imion nie ma;
--   * z wariantu tylko liczby i flagi, których używa ud_kalibracja_stawek();
--     z extras — wyłącznie objęte pozycje (klucz, symbol).
-- Wierność wyciągu sprawdzona 19 sumami kontrolnymi policzonymi osobno
-- w bazie i z tego pliku (liczba, sumy kwot, rat, okresów wyczekiwania,
-- epoch wysłania, pozycji extras, flag, numerów porządkowych) — zgodne co do grosza.
--
-- Kolumny w wierszu: nr oferty, status, sent_at (UTC), archiwalna, nr klienta,
-- nr osoby, insurer_type, temp_monthly_benefit, premium_total, premium_monthly,
-- installments, wait_accident, wait_illness, perm_incapacity_covered,
-- perm_sum_insured, death_covered, indemnity_period, covers_hiv_wzw,
-- hiv_owu_symbol, owu_base, total_to_pay, objęte extras [[klucz, symbol]].
--
-- NIE dopisuj tu nowych ofert z bazy bez ponownego policzenia oczekiwanych
-- wartości w kalibracja.sql: ten plik jest punktem odniesienia — przy tych
-- samych danych funkcja musi dać te same liczby, inaczej zmieniła się metoda.

do $$
declare
  w jsonb;
  dane jsonb := $dane$[
[1,"draft",null,false,18,4,"leadenhall",12000,3132,261,12,14,21,null,288000,null,"24 miesiące",null,null,null,3132,null],
[1,"draft",null,false,18,4,"leadenhall",12000,3912,326,12,14,21,null,432000,null,"36 miesięcy",null,null,null,3912,null],
[2,"viewed","2026-08-16T21:19:47Z",false,29,20,"leadenhall",5000,2145,null,null,14,21,true,300000,false,"24 miesiące",false,null,"LW047",2145,null],
[2,"viewed","2026-08-16T21:19:47Z",false,29,20,"leadenhall",5000,2340,195,12,14,21,true,300000,false,"24 miesiące",false,null,"LW047",2340,null],
[2,"viewed","2026-08-16T21:19:47Z",false,29,20,"leadenhall",5000,2820,235,12,14,21,true,300000,false,"36 miesięcy",false,null,"LW047",2820,null],
[2,"viewed","2026-08-16T21:19:47Z",false,29,20,"leadenhall",5000,2868,239,12,14,21,true,300000,true,"24 miesiące",false,null,"LW047",2868,null],
[2,"viewed","2026-08-16T21:19:47Z",false,29,20,"leadenhall",5000,3336,278,12,14,21,true,300000,true,"36 miesięcy",false,null,"LW047",3336,null],
[3,"sent","2026-08-23T20:46:26Z",true,11,32,"leadenhall",5000,1100,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW047",1100,null],
[3,"sent","2026-08-23T20:46:26Z",true,11,32,"leadenhall",5000,1212,101,12,14,21,false,null,false,"24 miesiące",false,null,"LW047",1212,null],
[3,"sent","2026-08-23T20:46:26Z",true,11,32,"leadenhall",5000,1500,125,12,14,21,false,null,false,"36 miesięcy",false,null,"LW047",1500,null],
[4,"viewed","2026-08-28T10:52:55Z",false,32,10,"leadenhall",5000,1536,128,12,14,21,false,null,false,"36 miesięcy",false,null,"LW047",1536,null],
[4,"viewed","2026-08-28T10:52:55Z",false,32,10,"leadenhall",5000,1224,102,12,14,21,false,null,false,"24 miesiące",false,null,"LW047",1224,null],
[4,"viewed","2026-08-28T10:52:55Z",false,32,10,"leadenhall",5000,1644,137,12,14,21,false,null,false,"36 miesięcy",true,"LW049",null,1644,null],
[5,"sent","2026-09-06T17:00:23Z",false,17,13,"leadenhall",8000,4224,352,12,21,21,false,null,true,"24 miesiące",false,null,"LW044",4224,null],
[5,"sent","2026-09-06T17:00:23Z",false,17,13,"leadenhall",8000,4788,399,12,21,21,false,null,true,"36 miesięcy",false,null,"LW044",4788,null],
[5,"sent","2026-09-06T17:00:23Z",false,17,13,"leadenhall",8000,6084,507,12,21,21,true,500000,true,"24 miesiące",false,null,"LW044",6084,null],
[6,"viewed","2026-09-06T18:17:17Z",false,19,6,"leadenhall",15000,6523,null,null,14,21,true,500000,true,"24 miesiące",false,null,"LW047",6523,[["hospital_daily","LW140"],["disability_adaptation","LW141"],["medical_costs","LW126"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"]]],
[6,"viewed","2026-09-06T18:17:17Z",false,19,6,"leadenhall",15000,7176,598,12,14,21,true,500000,true,"24 miesiące",false,null,"LW047",7176,[["hospital_daily","LW140"],["disability_adaptation","LW141"],["medical_costs","LW126"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"]]],
[6,"viewed","2026-09-06T18:17:17Z",false,19,6,"leadenhall",15000,6144,512,12,14,21,true,500000,false,"24 miesiące",false,null,"LW047",6144,null],
[6,"viewed","2026-09-06T18:17:17Z",false,19,6,"leadenhall",15000,6576,548,12,30,30,true,500000,true,"24 miesiące",false,null,"LW047",6576,[["hospital_daily","LW140"],["disability_adaptation","LW141"],["medical_costs","LW126"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"]]],
[7,"sent","2026-09-08T11:21:17Z",false,19,6,"leadenhall",15000,3912,326,12,14,21,false,null,false,"24 miesiące",false,null,"LW047",3912,null],
[7,"sent","2026-09-08T11:21:17Z",false,19,6,"leadenhall",15000,2497,null,null,60,60,false,null,false,"24 miesiące",false,null,"LW047",2497,null],
[7,"sent","2026-09-08T11:21:17Z",false,19,6,"leadenhall",15000,3564,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW047",3564,null],
[7,"sent","2026-09-08T11:21:17Z",false,19,6,"leadenhall",15000,4521,null,null,60,60,true,500000,false,"24 miesiące",false,null,"LW047",4521,null],
[8,"viewed","2026-09-09T09:17:21Z",false,10,19,"leadenhall",4000,3108,259,12,14,21,true,720000,false,"24 miesiące",false,null,"LW047",3108,null],
[8,"viewed","2026-09-09T09:17:21Z",false,10,19,"leadenhall",5000,3408,284,12,14,21,true,720000,false,"24 miesiące",false,null,"LW047",3408,null],
[8,"viewed","2026-09-09T09:17:21Z",false,10,19,"leadenhall",5000,3228,269,12,30,30,true,720000,false,"24 miesiące",false,null,"LW047",3228,null],
[8,"viewed","2026-09-09T09:17:21Z",false,10,19,"leadenhall",4000,3108,259,12,14,21,true,720000,false,"24 miesiące",false,null,"LW047",3108,null],
[9,"viewed","2026-09-09T09:30:37Z",false,16,2,"leadenhall",10000,2544,212,12,21,21,false,null,false,"24 miesiące",false,null,"LW044",2544,null],
[9,"viewed","2026-09-09T09:30:37Z",false,16,2,"leadenhall",10000,3168,264,12,21,21,false,null,false,"36 miesięcy",false,null,"LW044",3168,null],
[9,"viewed","2026-09-09T09:30:37Z",false,16,2,"leadenhall",12000,3048,254,12,21,21,false,null,false,"24 miesiące",false,null,"LW044",3048,null],
[10,"viewed","2026-09-18T11:13:58Z",false,7,8,"leadenhall",8000,7141,null,null,30,30,true,1000000,true,"24 miesiące",false,null,"LW044",7141,null],
[10,"viewed","2026-09-18T11:13:58Z",false,7,8,"leadenhall",6000,5100,425,12,30,30,true,1000000,false,"24 miesiące",false,null,"LW044",5100,null],
[10,"viewed","2026-09-18T11:13:58Z",false,7,8,"leadenhall",8000,7848,654,12,30,30,true,1000000,true,"24 miesiące",false,null,"LW044",7848,[["degenerative_limit","LW144"]]],
[10,"viewed","2026-09-18T11:13:58Z",false,7,8,"leadenhall",6000,7176,598,12,30,30,true,1000000,true,"24 miesiące",false,null,"LW044",7176,[["degenerative_limit","LW144"]]],
[11,"viewed","2026-09-10T09:23:10Z",false,23,11,"leadenhall",6000,1680,140,12,14,21,false,null,false,"24 miesiące",false,null,"LW044",1680,null],
[11,"viewed","2026-09-10T09:23:10Z",false,23,11,"leadenhall",8000,2244,187,12,14,21,false,null,false,"24 miesiące",false,null,"LW044",2244,null],
[12,"viewed","2026-09-17T10:22:19Z",false,13,23,"leadenhall",15000,7476,623,12,30,30,true,150000,true,"36 miesięcy",false,null,"LW044",7476,[["hospital_daily","LW140"],["medical_costs","LW126"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"]]],
[12,"viewed","2026-09-17T10:22:19Z",false,13,23,"leadenhall",15000,6744,562,12,14,21,true,150000,true,"24 miesiące",false,null,"LW044",6744,[["hospital_daily","LW140"],["medical_costs","LW126"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"]]],
[12,"viewed","2026-09-17T10:22:19Z",false,13,23,"leadenhall",10000,3468,289,12,14,21,true,120000,false,"24 miesiące",false,null,"LW044",3468,[["degenerative_limit","LW144"]]],
[13,"viewed","2026-10-05T11:55:16Z",false,4,30,"leadenhall",20000,7887,null,null,14,21,true,990000,false,"24 miesiące",false,null,"LW044",7887,[["lw_lw144","LW144"]]],
[13,"viewed","2026-10-05T11:55:16Z",false,4,30,"leadenhall",20000,8664,722,12,14,21,true,990000,false,"24 miesiące",false,null,"LW044",8664,[["lw_lw144","LW144"]]],
[13,"viewed","2026-10-05T11:55:16Z",false,4,30,"leadenhall",20000,9163,null,null,14,21,true,1000000,true,"24 miesiące",false,null,"LW044",9163,[["degenerative_limit","LW144"]]],
[13,"viewed","2026-10-05T11:55:16Z",false,4,30,"leadenhall",20000,10080,840,12,14,21,true,1000000,true,"24 miesiące",false,null,"LW044",10080,[["degenerative_limit","LW144"]]],
[13,"viewed","2026-10-05T11:55:16Z",false,4,30,"leadenhall",20000,4950,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW044",4950,[["degenerative_limit","LW144"]]],
[14,"sent","2026-09-16T17:03:18Z",false,12,1,"leadenhall",12000,2761,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW047",2761,[["lw_lw144","LW144"]]],
[14,"sent","2026-09-16T17:03:18Z",false,12,1,"leadenhall",12000,3792,316,12,14,21,false,null,false,"36 miesięcy",false,null,"LW047",3792,[["lw_lw144","LW144"]]],
[14,"sent","2026-09-16T17:03:18Z",false,12,1,"leadenhall",12000,3036,253,12,14,21,false,null,false,"24 miesiące",false,null,"LW047",3036,[["lw_lw144","LW144"]]],
[15,"viewed","2026-09-16T17:22:43Z",false,6,29,"leadenhall",15000,4272,356,12,14,21,false,null,false,"24 miesiące",false,null,"LW047",4272,[["degenerative_limit","LW144"]]],
[15,"viewed","2026-09-16T17:22:43Z",false,6,29,"leadenhall",15000,3894,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW047",3894,[["degenerative_limit","LW144"]]],
[15,"viewed","2026-09-16T17:22:43Z",false,6,29,"leadenhall",15000,4392,366,12,14,21,false,null,false,"24 miesiące",true,"LW049",null,4392,[["hiv_wzw",null],["degenerative_limit","LW144"]]],
[15,"viewed","2026-09-16T17:22:43Z",false,6,29,"leadenhall",15000,5460,455,12,14,21,false,null,false,"36 miesięcy",true,"LW049",null,5460,[["hiv_wzw",null],["degenerative_limit","LW144"]]],
[16,"viewed","2026-09-17T10:54:14Z",true,15,24,"leadenhall",8000,8356,696.33,12,21,21,true,300000,true,"24 miesiące",false,null,"LW044",8356,[["hospital_daily","LW140"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"]]],
[16,"viewed","2026-09-17T10:54:14Z",true,15,24,"leadenhall",8000,4584,382,12,14,21,true,300000,true,"24 miesiące",false,null,"LW044",4584,[["hospital_daily","LW140"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"],["degenerative_limit","LW144"]]],
[16,"viewed","2026-09-17T10:54:14Z",true,15,24,"leadenhall",8000,5388,449,12,14,21,true,300000,true,"36 miesięcy",false,null,"LW044",5388,[["hospital_daily","LW140"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"],["degenerative_limit","LW144"]]],
[16,"viewed","2026-09-17T10:54:14Z",true,15,24,"leadenhall",8000,5100,425,12,14,21,true,500000,true,"24 miesiące",false,null,"LW044",5100,[["hospital_daily","LW140"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"],["degenerative_limit","LW144"]]],
[16,"viewed","2026-09-17T10:54:14Z",true,15,24,"leadenhall",8000,5904,492,12,14,21,true,500000,true,"36 miesięcy",false,null,"LW044",5904,[["hospital_daily","LW140"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"],["degenerative_limit","LW144"]]],
[17,"viewed","2026-09-18T05:21:54Z",false,5,33,"leadenhall",20000,7092,591,12,30,30,true,500000,false,"24 miesiące",false,null,"LW044",7092,[["degenerative_limit","LW144"]]],
[17,"viewed","2026-09-18T05:21:54Z",false,5,33,"leadenhall",20000,7884,657,12,14,21,true,500000,false,"24 miesiące",false,null,"LW044",7884,[["degenerative_limit","LW144"]]],
[17,"viewed","2026-09-18T05:21:54Z",false,5,33,"leadenhall",20000,9372,781,12,14,21,true,500000,true,"24 miesiące",false,null,"LW044",9372,[["hospital_daily","LW140"],["disability_adaptation","LW141"],["medical_costs","LW126"],["unconsciousness_weekly","LW121"],["permanent_impairment","LW143"],["funeral","LW142"],["degenerative_limit","LW144"]]],
[18,"viewed","2026-09-20T17:16:14Z",false,34,25,"leadenhall",8500,5580,465,12,21,21,true,800000,false,"24 miesiące",false,null,"LW044",5580,[["degenerative_limit","LW144"]]],
[18,"viewed","2026-09-20T17:16:14Z",false,34,25,"leadenhall",8500,5346,null,null,21,21,true,900000,false,"24 miesiące",false,null,"LW044",5346,[["degenerative_limit","LW144"]]],
[18,"viewed","2026-09-20T17:16:14Z",false,34,25,"leadenhall",8500,5868,489,12,21,21,true,900000,false,"24 miesiące",false,null,"LW044",5868,[["degenerative_limit","LW144"]]],
[18,"viewed","2026-09-20T17:16:14Z",false,34,25,"leadenhall",8500,5071,null,null,21,21,true,800000,false,"24 miesiące",false,null,"LW044",5071,[["degenerative_limit","LW144"]]],
[18,"viewed","2026-09-20T17:16:14Z",false,34,25,"leadenhall",8500,6204,517,12,30,30,true,800000,false,"36 miesięcy",false,null,"LW044",6204,[["degenerative_limit","LW144"]]],
[19,"viewed","2026-09-22T08:45:29Z",false,3,26,"leadenhall",6000,2112,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW047",2112,[["degenerative_limit","LW144"]]],
[19,"viewed","2026-09-22T08:45:29Z",false,3,26,"leadenhall",6000,2316,193,12,14,21,false,null,false,"24 miesiące",false,null,"LW047",2316,[["degenerative_limit","LW144"]]],
[19,"viewed","2026-09-22T08:45:29Z",false,3,26,"leadenhall",6000,2880,240,12,21,21,false,null,false,"36 miesięcy",false,null,"LW047",2880,[["degenerative_limit","LW144"]]],
[20,"viewed","2026-09-24T09:08:38Z",false,14,27,"leadenhall",10000,3672,306,12,14,21,true,100000,false,"24 miesiące",false,null,"LW047",3672,[["degenerative_limit","LW144"]]],
[20,"viewed","2026-09-24T09:08:38Z",false,14,27,"leadenhall",10000,4452,371,12,14,21,true,400000,false,"24 miesiące",false,null,"LW047",4452,[["degenerative_limit","LW144"]]],
[20,"viewed","2026-09-24T09:08:38Z",false,14,27,"leadenhall",10000,5160,430,12,14,21,true,400000,true,"24 miesiące",false,null,"LW047",5160,[["degenerative_limit","LW144"]]],
[21,"viewed","2026-10-02T10:26:55Z",false,1,28,"leadenhall",15000,5616,468,12,180,180,true,1000000,false,"24 miesiące",false,null,"LW044",5616,[["degenerative_limit","LW144"]]],
[21,"viewed","2026-10-02T10:26:55Z",false,1,28,"leadenhall",15000,5104,null,null,180,180,true,1000000,false,"24 miesiące",false,null,"LW044",5104,[["degenerative_limit","LW144"]]],
[21,"viewed","2026-10-02T10:26:55Z",false,1,28,"leadenhall",15000,7692,641,12,180,180,true,1000000,true,"24 miesiące",false,null,"LW044",7692,[["degenerative_limit","LW144"]]],
[21,"viewed","2026-10-02T10:26:55Z",false,1,28,"leadenhall",15000,6540,545,12,180,180,true,1000000,false,"36 miesięcy",false,null,"LW044",6540,[["degenerative_limit","LW144"]]],
[22,"viewed","2026-10-02T10:36:11Z",false,2,3,"leadenhall",8000,1903,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW044",1903,[["degenerative_limit","LW144"]]],
[22,"viewed","2026-10-02T10:36:11Z",false,2,3,"leadenhall",8000,2076,173,12,14,21,false,null,false,"24 miesiące",false,null,"LW044",2076,[["degenerative_limit","LW144"]]],
[22,"viewed","2026-10-02T10:36:11Z",false,2,3,"leadenhall",8000,2585,null,null,14,21,true,100000,false,"24 miesiące",false,null,"LW044",2585,[["degenerative_limit","LW144"]]],
[22,"viewed","2026-10-02T10:36:11Z",false,2,3,"leadenhall",10000,2604,217,12,14,21,false,null,false,"24 miesiące",false,null,"LW044",2604,[["degenerative_limit","LW144"]]],
[22,"viewed","2026-10-02T10:36:11Z",false,2,3,"leadenhall",12000,3132,261,12,14,21,false,null,false,"24 miesiące",false,null,"LW044",3132,[["degenerative_limit","LW144"]]],
[23,"viewed","2026-10-05T13:19:21Z",false,22,22,"leadenhall",7000,3058,null,null,21,21,true,200000,true,"24 miesiące",false,null,"LW044",3058,[["degenerative_limit","LW144"]]],
[23,"viewed","2026-10-05T13:19:21Z",false,22,22,"leadenhall",7000,3360,280,12,21,21,true,200000,true,"24 miesiące",false,null,"LW044",3360,[["degenerative_limit","LW144"]]],
[23,"viewed","2026-10-05T13:19:21Z",false,22,22,"leadenhall",7000,4068,339,12,21,21,true,200000,true,"36 miesięcy",false,null,"LW044",4068,[["degenerative_limit","LW144"]]],
[23,"viewed","2026-10-05T13:19:21Z",false,22,22,"leadenhall",7000,3180,265,12,30,30,true,200000,true,"24 miesiące",false,null,"LW044",3180,[["degenerative_limit","LW144"]]],
[24,"sent","2026-10-05T13:31:06Z",false,26,14,"leadenhall",4000,972,81,12,14,21,false,null,false,"24 miesiące",false,null,"LW044",972,[["degenerative_limit","LW144"]]],
[24,"sent","2026-10-05T13:31:06Z",false,26,14,"leadenhall",6000,1464,122,12,14,21,false,null,false,"24 miesiące",false,null,"LW044",1464,[["degenerative_limit","LW144"]]],
[24,"sent","2026-10-05T13:31:06Z",false,26,14,"leadenhall",6000,1812,151,12,14,21,false,null,false,"36 miesięcy",false,null,"LW044",1812,[["degenerative_limit","LW144"]]],
[24,"sent","2026-10-05T13:31:06Z",false,26,14,"leadenhall",6000,3168,264,12,14,21,true,300000,false,"36 miesięcy",false,null,"LW044",3168,[["degenerative_limit","LW144"]]],
[25,"viewed","2026-10-05T14:44:45Z",false,25,10,"leadenhall",12000,2684,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW047",2684,[["degenerative_limit","LW144"]]],
[25,"viewed","2026-10-05T14:44:45Z",false,25,10,"leadenhall",12000,2940,245,12,14,21,false,null,false,"24 miesiące",false,null,"LW047",2940,[["degenerative_limit","LW144"]]],
[25,"viewed","2026-10-05T14:44:45Z",false,25,10,"leadenhall",12000,4200,350,12,14,21,true,200000,false,"24 miesiące",false,null,"LW047",4200,[["degenerative_limit","LW144"]]],
[26,"viewed","2026-10-05T15:02:05Z",false,24,9,"leadenhall",10000,4917,null,null,21,21,true,500000,false,"24 miesiące",false,null,"LW044",4917,[["degenerative_limit","LW144"]]],
[26,"viewed","2026-10-05T15:02:05Z",false,24,9,"leadenhall",10000,5412,451,12,21,21,true,500000,false,"24 miesiące",false,null,"LW044",5412,[["degenerative_limit","LW144"]]],
[26,"viewed","2026-10-05T15:02:05Z",false,24,9,"leadenhall",10000,6108,509,12,21,21,true,700000,false,"24 miesiące",false,null,"LW044",6108,[["degenerative_limit","LW144"]]],
[26,"viewed","2026-10-05T15:02:05Z",false,24,9,"leadenhall",10000,4692,391,12,21,21,true,300000,false,"24 miesiące",false,null,"LW044",4692,[["degenerative_limit","LW144"]]],
[27,"viewed","2026-10-06T10:38:34Z",false,33,7,"leadenhall",17000,3685,null,null,30,30,false,null,false,"24 miesiące",false,null,"LW044",3685,[["degenerative_limit","LW144"]]],
[27,"viewed","2026-10-06T10:38:34Z",false,33,7,"leadenhall",17000,4044,337,12,30,30,false,null,false,"24 miesiące",false,null,"LW044",4044,[["degenerative_limit","LW144"]]],
[27,"viewed","2026-10-06T10:38:34Z",false,33,7,"leadenhall",17000,5064,422,12,30,30,false,null,false,"36 miesięcy",false,null,"LW044",5064,[["degenerative_limit","LW144"]]],
[27,"viewed","2026-10-06T10:38:34Z",false,33,7,"leadenhall",17000,6396,533,12,30,30,true,500000,false,"24 miesiące",false,null,"LW044",6396,[["degenerative_limit","LW144"]]],
[28,"viewed","2026-10-06T10:46:32Z",false,31,18,"leadenhall",6000,3652,null,null,14,21,true,1000000,false,"24 miesiące",false,null,"LW044",3652,[["degenerative_limit","LW144"]]],
[28,"viewed","2026-10-06T10:46:32Z",false,31,18,"leadenhall",6000,4008,334,12,14,21,true,1000000,false,"24 miesiące",false,null,"LW044",4008,[["degenerative_limit","LW144"]]],
[28,"viewed","2026-10-06T10:46:32Z",false,31,18,"leadenhall",8000,4632,386,12,14,21,true,1000000,false,"24 miesiące",false,null,"LW044",4632,[["degenerative_limit","LW144"]]],
[29,"viewed","2026-10-08T10:21:55Z",false,20,15,"leadenhall",20000,6116,null,null,14,21,true,100000,false,"24 miesiące",false,null,"LW044",6116,[["degenerative_limit","LW144"]]],
[29,"viewed","2026-10-08T10:21:55Z",false,20,15,"leadenhall",20000,4752,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW044",4752,[["degenerative_limit","LW144"]]],
[29,"viewed","2026-10-08T10:21:55Z",false,20,15,"leadenhall",20000,3685,null,null,45,45,false,null,false,"24 miesiące",false,null,"LW044",3685,[["degenerative_limit","LW144"]]],
[29,"viewed","2026-10-08T10:21:55Z",false,20,15,"leadenhall",20000,4598,null,null,45,45,false,null,false,"36 miesięcy",false,null,"LW044",4598,[["degenerative_limit","LW144"]]],
[30,"sent","2026-10-12T10:42:03Z",false,9,31,"leadenhall",10000,3520,null,null,14,21,true,300000,true,"24 miesiące",false,null,"LW044",3520,[["degenerative_limit","LW144"]]],
[30,"sent","2026-10-12T10:42:03Z",false,9,31,"leadenhall",10000,3864,322,12,14,21,true,300000,true,"24 miesiące",false,null,"LW044",3864,[["degenerative_limit","LW144"]]],
[30,"sent","2026-10-12T10:42:03Z",false,9,31,"leadenhall",12000,4428,369,12,14,21,true,300000,true,"24 miesiące",false,null,"LW044",4428,[["degenerative_limit","LW144"]]],
[30,"sent","2026-10-12T10:42:03Z",false,9,31,"leadenhall",12000,5436,453,12,14,21,true,300000,true,"36 miesięcy",false,null,"LW044",5436,[["degenerative_limit","LW144"]]],
[31,"viewed","2026-10-12T10:57:06Z",false,28,16,"leadenhall",5000,2046,null,null,14,21,true,200000,true,"24 miesiące",false,null,"LW047",2046,[["degenerative_limit","LW144"]]],
[31,"viewed","2026-10-12T10:57:06Z",false,28,16,"leadenhall",5000,2244,187,12,14,21,true,200000,true,"24 miesiące",false,null,"LW047",2244,[["degenerative_limit","LW144"]]],
[31,"viewed","2026-10-12T10:57:06Z",false,28,16,"leadenhall",10000,3792,316,12,14,21,true,200000,true,"24 miesiące",false,null,"LW047",3792,[["degenerative_limit","LW144"]]],
[32,"viewed","2026-10-12T11:34:44Z",false,21,5,"leadenhall",4000,1452,null,null,14,21,true,100000,false,"24 miesiące",false,null,"LW047",1452,[["degenerative_limit","LW144"]]],
[32,"viewed","2026-10-12T11:34:44Z",false,21,5,"leadenhall",4000,1596,133,12,14,21,true,100000,false,"24 miesiące",false,null,"LW047",1596,[["degenerative_limit","LW144"]]],
[32,"viewed","2026-10-12T11:34:44Z",false,21,5,"leadenhall",6000,2520,210,12,14,21,true,200000,false,"24 miesiące",false,null,"LW047",2520,[["degenerative_limit","LW144"]]],
[32,"viewed","2026-10-12T11:34:44Z",false,21,5,"leadenhall",8000,2928,244,12,14,21,true,100000,false,"24 miesiące",false,null,"LW047",2928,[["degenerative_limit","LW144"]]],
[33,"sent","2026-10-12T11:47:04Z",false,30,21,"leadenhall",6000,2112,null,null,14,21,true,100000,true,"24 miesiące",false,null,"LW047",2112,[["degenerative_limit","LW144"]]],
[33,"sent","2026-10-12T11:47:04Z",false,30,21,"leadenhall",6000,2316,193,12,14,21,true,100000,true,"24 miesiące",false,null,"LW047",2316,[["degenerative_limit","LW144"]]],
[33,"sent","2026-10-12T11:47:04Z",false,30,21,"leadenhall",9000,3264,272,12,14,21,true,100000,true,"24 miesiące",false,null,"LW047",3264,[["degenerative_limit","LW144"]]],
[33,"sent","2026-10-12T11:47:04Z",false,30,21,"leadenhall",9000,3708,309,12,14,21,true,200000,true,"24 miesiące",false,null,"LW047",3708,[["degenerative_limit","LW144"]]],
[34,"sent","2026-10-12T12:22:13Z",false,27,12,"leadenhall",9000,8074,null,null,21,21,true,500000,true,"24 miesiące",false,null,"LW044",8074,[["degenerative_limit","LW144"]]],
[34,"sent","2026-10-12T12:22:13Z",false,27,12,"leadenhall",9000,7860,655,12,21,21,true,300000,true,"24 miesiące",false,null,"LW044",7860,[["degenerative_limit","LW144"]]],
[35,"sent","2026-10-14T08:06:53Z",false,8,17,"leadenhall",10000,2288,null,null,14,21,false,null,false,"24 miesiące",false,null,"LW044",2288,[["degenerative_limit","LW144"]]],
[35,"sent","2026-10-14T08:06:53Z",false,8,17,"leadenhall",10000,2508,209,12,14,21,false,null,false,"24 miesiące",false,null,"LW044",2508,[["degenerative_limit","LW144"]]],
[35,"sent","2026-10-14T08:06:53Z",false,8,17,"leadenhall",15000,3756,313,12,14,21,false,null,false,"24 miesiące",false,null,"LW044",3756,[["degenerative_limit","LW144"]]],
[35,"sent","2026-10-14T08:06:53Z",false,8,17,"leadenhall",15000,4704,392,12,14,21,false,null,false,"36 miesięcy",false,null,"LW044",4704,[["degenerative_limit","LW144"]]]
]$dane$;
  v_klient uuid;
  v_oferta uuid;
  i int := 0;
begin
  for w in select value from jsonb_array_elements(dane)
  loop
    i := i + 1;
    v_klient := ('c0000000-0000-4000-8000-' || lpad((w->>4), 12, '0'))::uuid;
    insert into public.ud_clients (id, full_name, pesel)
    values (v_klient, 'Klient testowy ' || (w->>4),
            case when w->>5 is not null then '900101' || lpad(w->>5, 5, '0') end)
    on conflict (id) do nothing;

    v_oferta := ('a0000000-0000-4000-8000-' || lpad((w->>0), 12, '0'))::uuid;
    insert into public.ud_offers (id, name, status, sent_at, archived_at, client_id, offer_number)
    values (v_oferta, 'Oferta testowa ' || (w->>0), w->>1, (w->>2)::timestamptz,
            case when (w->>3)::boolean then (w->>2)::timestamptz + interval '1 day' end,
            v_klient, 'UD/2026/TT/' || lpad(w->>0, 5, '0') || '/Testowy')
    on conflict (id) do nothing;

    insert into public.ud_offer_documents (
      offer_id, insurer_type, temp_monthly_benefit, premium_total, premium_monthly, installments,
      wait_accident, wait_illness, perm_incapacity_covered, perm_sum_insured, death_covered,
      indemnity_period, parsed_raw, sort_order)
    values (
      v_oferta, w->>6, (w->>7)::numeric, (w->>8)::numeric, (w->>9)::numeric, (w->>10)::int,
      (w->>11)::int, (w->>12)::int, (w->>13)::boolean, (w->>14)::numeric, (w->>15)::boolean,
      w->>16,
      jsonb_build_object(
        'covers_hiv_wzw', w->17,
        'hiv_owu_symbol', w->>18,
        'owu_base',       w->>19,
        'total_to_pay',   w->20,
        'extras', coalesce((select jsonb_agg(jsonb_build_object('key', e->>0, 'symbol', e->>1, 'covered', true))
                              from jsonb_array_elements(case when jsonb_typeof(w->21) = 'array' then w->21 else '[]'::jsonb end) e),
                           '[]'::jsonb)),
      i);
  end loop;
end $$;
