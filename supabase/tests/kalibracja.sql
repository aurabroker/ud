-- Kalibracja stawek (migracja …_kalibracja_stawek.sql): ud_kalibracja_stawek()
-- na zamrożonym zestawie z produkcji i na przypadkach brzegowych, tabele,
-- uprawnienia, zadanie crona. Uruchamia apps/panel/scripts/test-kalibracja-sql.mjs;
-- każda asercja to NOTICE PASS/FAIL.
--
-- Wartości oczekiwane dla zestawu z produkcji policzyła NIEZALEŻNA implementacja
-- metody (Python, poza repozytorium) — nie ta funkcja. Zgodność dwóch
-- implementacji na prawdziwych danych to cały sens tego pliku.
--
-- Przypadki brzegowe żyją w roku 2030: zestaw z produkcji (2026) leży wtedy
-- poza oknem 365 dni i nie miesza się z nimi. Każdy blok wstawia swoje oferty
-- i wycofuje je wyjątkiem ZZ001 (złapanym w tym samym bloku), więc bloki są
-- od siebie niezależne.

create schema if not exists tk;

create or replace function tk.sprawdz(nazwa text, warunek boolean) returns void language plpgsql as $$
begin
  if coalesce(warunek, false) then raise notice 'PASS %', nazwa;
  else raise notice 'FAIL %', nazwa;
  end if;
end $$;

-- Oferta wysłana w roku 2030 dla osoby o danym PESEL-u (nowy wiersz klienta
-- przy każdej ofercie — tak powstaje „dwa client_id, jeden PESEL").
create or replace function tk.oferta(p_nr text, p_pesel text, p_sent timestamptz,
                                     p_status text default 'sent', p_archiwalna boolean default false)
returns uuid language plpgsql as $$
declare v_klient uuid; v_oferta uuid;
begin
  insert into public.ud_clients (full_name, pesel) values ('Klient ' || p_nr, p_pesel) returning id into v_klient;
  insert into public.ud_offers (name, status, sent_at, archived_at, client_id, offer_number)
  values ('Oferta ' || p_nr, p_status, p_sent, case when p_archiwalna then p_sent + interval '1 day' end,
          v_klient, 'UD/2030/TT/' || p_nr || '/Nazwisko')
  returning id into v_oferta;
  return v_oferta;
end $$;

-- Wariant oferty: domyślnie czysty (Leadenhall, 24 mies., 14/21, raty, bez
-- trwałej i śmierci, bez HIV, z LW144 jak w danych produkcyjnych).
create or replace function tk.wariant(p_oferta uuid, p_sw numeric, p_skl numeric,
  p_okres int default 24, p_wa int default 14, p_wi int default 21, p_raty int default 12,
  p_trwala boolean default false, p_smierc boolean default false,
  p_hiv jsonb default 'false', p_hivsym text default null,
  p_extras jsonb default '[{"key":"degenerative_limit","symbol":"LW144","covered":true}]',
  p_owu text default 'LW044', p_rata numeric default null, p_ttp numeric default null,
  p_ubezpieczyciel text default 'leadenhall')
returns void language sql as $$
  insert into public.ud_offer_documents (
    offer_id, insurer_type, temp_monthly_benefit, premium_total, premium_monthly, installments,
    wait_accident, wait_illness, perm_incapacity_covered, perm_sum_insured, death_covered,
    indemnity_period, parsed_raw)
  values (p_oferta, p_ubezpieczyciel, p_sw, p_skl,
          coalesce(p_rata, case when p_raty = 12 then round(p_skl / 12, 2) end), p_raty,
          p_wa, p_wi, p_trwala, case when p_trwala then 100000 end, p_smierc,
          p_okres || case when p_okres = 24 then ' miesiące' else ' miesięcy' end,
          jsonb_build_object('covers_hiv_wzw', p_hiv, 'hiv_owu_symbol', p_hivsym, 'owu_base', p_owu,
                             'total_to_pay', coalesce(p_ttp, p_skl), 'extras', p_extras));
$$;

create or replace function tk.k(p_na timestamptz default '2030-06-01T05:40:00Z', p_od date default null)
returns jsonb language sql as $$ select public.ud_kalibracja_stawek(p_na, p_od) $$;

-- ═══ 1. Zestaw z produkcji (14.10.2026) ═════════════════════════════════════
do $$
declare r jsonb;
begin
  r := public.ud_kalibracja_stawek('2026-10-14T05:40:00Z');
  perform tk.sprawdz('produkcja 14.10: status ok, metoda osoby-v1',
    r->>'status' = 'ok' and r->>'metoda' = 'osoby-v1' and r->>'na_dzien' = '2026-10-14T05:40:00Z');
  perform tk.sprawdz('produkcja 14.10: dół 0,0202 / środek 0,022 / góra 0,0322',
    r->'stawka' = '{"dol": 0.0202, "srodek": 0.022, "gora": 0.0322}'::jsonb);
  perform tk.sprawdz('produkcja 14.10: okresy {24: 1, 36: 1,25} — bez 48 i 60',
    r->'okresy' = '{"24": 1, "36": 1.25}'::jsonb);
  perform tk.sprawdz('produkcja 14.10: 10 osób, 11 ofert, 22 warianty, 5 osób z parą 36',
    (r->'zrodlo'->>'osob')::int = 10 and (r->'zrodlo'->>'ofert')::int = 11
    and (r->'zrodlo'->>'wariantow')::int = 22 and r->'zrodlo'->'par' = '{"36": 5}'::jsonb);
  perform tk.sprawdz('produkcja 14.10: okno 2025-10-14 … 2026-10-12, Leadenhall',
    r->'zrodlo'->'okno' = '{"od": "2025-10-14", "do": "2026-10-12"}'::jsonb
    and r->'zrodlo'->>'ubezpieczyciel' = 'Leadenhall' and r->'zrodlo'->>'metoda' = 'osoby-v1');
  perform tk.sprawdz('produkcja 14.10: surowe min 0,0202 / mediana 0,021442 / max 0,032167',
    (r->'raport'->'surowe'->>'min')::numeric = 0.0202
    and (r->'raport'->'surowe'->>'mediana')::numeric = 0.021442
    and (r->'raport'->'surowe'->>'max')::numeric = 0.032167);
  perform tk.sprawdz('produkcja 14.10: pominięte — trwała/śmierć 64, jednorazowe 13, HIV 3, wyczekiwanie 2, poza oknem 21',
    r->'raport'->'pominiete' @> '{"trwala_lub_smierc": 64, "jednorazowe": 13, "hiv": 3, "wyczekiwanie": 2, "poza_oknem": 21, "dodatki": 0, "inny_ubezpieczyciel": 0, "brak_kwot": 0}'::jsonb);
  perform tk.sprawdz('produkcja 14.10: bez anomalii; kandydat 36 = 5 osób, mediana 1,2453',
    r->'raport'->'anomalie' = '[]'::jsonb
    and (r->'raport'->'okresy_kandydaci'->'36'->>'osob')::int = 5
    and (r->'raport'->'okresy_kandydaci'->'36'->>'mediana')::numeric = 1.2453
    and r->'raport'->'okresy_kandydaci'->'48' = '{"osob": 0}'::jsonb);
  -- Wrześniowa „góra" 2,44% to wariant z klauzulą HIV/WZW (oferta 15).
  perform tk.sprawdz('produkcja 14.10: wariant z HIV (2,44%) nie jest górą — góra to osoba 50+ (3,217%)',
    (r->'raport'->'surowe'->>'max')::numeric <> 0.0244);

  r := public.ud_kalibracja_stawek('2026-09-18T05:40:00Z');
  perform tk.sprawdz('produkcja 18.09: 5 osób — za_malo_osob, bez stawek i okresów',
    r->>'status' = 'za_malo_osob' and r->'stawka' = 'null'::jsonb and r->'okresy' = 'null'::jsonb
    and (r->'zrodlo'->>'osob')::int = 5);
end $$;

-- ═══ 2. Bazowa populacja 2030: 8 osób, stawki 2,00–2,40% ═════════════════════
do $$
declare
  stawki numeric[] := array[0.0200, 0.0205, 0.0210, 0.0215, 0.0220, 0.0225, 0.0230, 0.0240];
  o uuid;
begin
  for i in 1..8 loop
    o := tk.oferta('B' || i, '9505050000' || i, '2030-05-01T10:00:00Z');
    perform tk.wariant(o, 10000, stawki[i] * 12 * 10000);
  end loop;
end $$;

do $$
declare r jsonb;
begin
  r := tk.k();
  perform tk.sprawdz('baza 2030: 8 osób → ok, dół 0,02 / środek 0,022 / góra 0,024',
    r->>'status' = 'ok' and r->'stawka' = '{"dol": 0.0200, "srodek": 0.022, "gora": 0.0240}'::jsonb);
  perform tk.sprawdz('baza 2030: tylko okres 24 (brak par)', r->'okresy' = '{"24": 1}'::jsonb and r->'zrodlo'->'par' = '{}'::jsonb);
  perform tk.sprawdz('baza 2030: zestaw z produkcji jest poza oknem 365 dni',
    (r->'raport'->'pominiete'->>'poza_oknem')::int = 125 and (r->'zrodlo'->>'osob')::int = 8);
end $$;

-- ═══ 3. Klauzula HIV/WZW — każdy z trzech sygnałów wyklucza ══════════════════
do $$
declare r jsonb; o uuid;
begin
  begin
    o := tk.oferta('H1', '95050500011', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.045 * 12 * 10000, p_hiv := 'true');
    o := tk.oferta('H2', '95050500012', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.045 * 12 * 10000, p_hiv := 'null');
    o := tk.oferta('H3', '95050500013', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.045 * 12 * 10000, p_hivsym := 'LW049');
    o := tk.oferta('H4', '95050500014', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.045 * 12 * 10000,
      p_extras := '[{"key":"hiv_wzw","symbol":null,"covered":true},{"key":"degenerative_limit","symbol":"LW144","covered":true}]');
    r := tk.k();
    perform tk.sprawdz('HIV: covers=true, covers=null, symbol LW049, extras hiv_wzw objęte — żaden nie wchodzi',
      (r->'raport'->'pominiete'->>'hiv')::int = 4 and (r->'zrodlo'->>'osob')::int = 8
      and (r->'stawka'->>'gora')::numeric = 0.0240);
    -- Pozycja hiv_wzw NIEobjęta (covered=false) jest w każdym wariancie bez klauzuli.
    o := tk.oferta('H5', '95050500015', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0245 * 12 * 10000,
      p_extras := '[{"key":"hiv_wzw","symbol":null,"covered":false},{"key":"active_life","symbol":null,"covered":false},{"key":"degenerative_limit","symbol":"LW144","covered":true}]');
    r := tk.k();
    perform tk.sprawdz('HIV: pozycja hiv_wzw z covered=false nie wyklucza (osoba wchodzi, góra 0,0245)',
      (r->'zrodlo'->>'osob')::int = 9 and (r->'stawka'->>'gora')::numeric = 0.0245);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

-- ═══ 4. Wyczekiwanie, dodatki, raty, trwała/śmierć, ubezpieczyciel ══════════
do $$
declare r jsonb; o uuid;
begin
  begin
    o := tk.oferta('F1', '95050500021', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0150 * 12 * 10000, p_wa := 30, p_wi := 30);   -- tańsze, ale 30/30
    o := tk.oferta('F2', '95050500022', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0150 * 12 * 10000, p_wa := 14, p_wi := 22);   -- 22 dni choroby
    o := tk.oferta('F3', '95050500023', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0450 * 12 * 10000,
      p_extras := '[{"key":"hospital_daily","symbol":"LW140","covered":true}]');  -- płatny dodatek
    o := tk.oferta('F4', '95050500024', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0150 * 12 * 10000, p_raty := null);           -- jednorazowo
    o := tk.oferta('F5', '95050500025', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0450 * 12 * 10000, p_trwala := true);
    o := tk.oferta('F6', '95050500026', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0450 * 12 * 10000, p_smierc := true);
    o := tk.oferta('F7', '95050500027', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0150 * 12 * 10000, p_ubezpieczyciel := 'ceu');
    r := tk.k();
    perform tk.sprawdz('filtry: 30/30 i 22 dni → wyczekiwanie (2), stawka 1,5% NIE jest dołem',
      (r->'raport'->'pominiete'->>'wyczekiwanie')::int = 2 and (r->'stawka'->>'dol')::numeric = 0.0200);
    perform tk.sprawdz('filtry: płatny dodatek LW140 → dodatki (1), góra bez zmian',
      (r->'raport'->'pominiete'->>'dodatki')::int = 1 and (r->'stawka'->>'gora')::numeric = 0.0240);
    perform tk.sprawdz('filtry: jednorazowa płatność (1), trwała/śmierć (2), CEU (1) — wykluczone',
      (r->'raport'->'pominiete'->>'jednorazowe')::int = 1
      and (r->'raport'->'pominiete'->>'trwala_lub_smierc')::int = 2
      and (r->'raport'->'pominiete'->>'inny_ubezpieczyciel')::int = 1
      and (r->'zrodlo'->>'osob')::int = 8);
    -- Trwała niezdolność / śmierć z nieznaną flagą (null) też wyklucza.
    o := tk.oferta('F8', '95050500028', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0450 * 12 * 10000);
    update public.ud_offer_documents set perm_incapacity_covered = null where offer_id = o;
    o := tk.oferta('F9', '95050500029', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0450 * 12 * 10000);
    update public.ud_offer_documents set death_covered = null where offer_id = o;
    r := tk.k();
    perform tk.sprawdz('filtry: trwała/śmierć = null (nie wiemy) też wyklucza',
      (r->'raport'->'pominiete'->>'trwala_lub_smierc')::int = 4 and (r->'stawka'->>'gora')::numeric = 0.0240);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

-- ═══ 5. LW144 pod dwoma kluczami, brak extras ═══════════════════════════════
do $$
declare r jsonb; o uuid;
begin
  begin
    o := tk.oferta('L1', '95050500031', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0245 * 12 * 10000, p_extras := '[{"key":"lw_lw144","symbol":"LW144","covered":true}]');
    o := tk.oferta('L2', '95050500032', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0246 * 12 * 10000, p_extras := '[]');
    o := tk.oferta('L3', '95050500033', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0247 * 12 * 10000);
    update public.ud_offer_documents set parsed_raw = parsed_raw - 'extras' where offer_id = o;
    r := tk.k();
    perform tk.sprawdz('LW144 pod kluczem lw_lw144, pusta tablica i brak extras — wszystkie wchodzą (11 osób, góra 0,0247)',
      (r->'zrodlo'->>'osob')::int = 11 and (r->'stawka'->>'gora')::numeric = 0.0247);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

-- ═══ 6. Okno, karencja 48 h, szkic, brak sent_at, archiwum, dane_od ═════════
do $$
declare r jsonb; o uuid;
begin
  begin
    o := tk.oferta('W1', '95050500041', '2030-05-31T10:00:00Z');               -- 43 h przed przebiegiem
    perform tk.wariant(o, 10000, 0.0150 * 12 * 10000);
    o := tk.oferta('W2', '95050500042', '2029-05-31T10:00:00Z');               -- ponad 365 dni
    perform tk.wariant(o, 10000, 0.0150 * 12 * 10000);
    o := tk.oferta('W3', '95050500043', '2030-05-02T10:00:00Z', p_status := 'draft');
    perform tk.wariant(o, 10000, 0.0150 * 12 * 10000);
    o := tk.oferta('W4', '95050500044', null, p_status := 'sent');
    perform tk.wariant(o, 10000, 0.0150 * 12 * 10000);
    r := tk.k();
    perform tk.sprawdz('okno: < 48 h i > 365 dni → poza oknem; szkic i brak sent_at w ogóle się nie liczą',
      (r->'raport'->'pominiete'->>'poza_oknem')::int = 125 + 2 and (r->'zrodlo'->>'osob')::int = 8
      and (r->'stawka'->>'dol')::numeric = 0.0200);
    o := tk.oferta('W5', '95050500045', '2030-05-02T10:00:00Z', p_archiwalna := true);
    perform tk.wariant(o, 10000, 0.0195 * 12 * 10000);
    r := tk.k();
    perform tk.sprawdz('archiwalna oferta SIĘ liczy (dół 0,0195)',
      (r->'zrodlo'->>'osob')::int = 9 and (r->'stawka'->>'dol')::numeric = 0.0195);
    r := tk.k(p_od := '2030-05-02');
    perform tk.sprawdz('dane_od = 2030-05-02: zostaje tylko jedna osoba → za_malo_osob, okno od 2030-05-02',
      r->>'status' = 'za_malo_osob' and (r->'zrodlo'->>'osob')::int = 1
      and r->'zrodlo'->'okno'->>'od' = '2030-05-02');
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

-- ═══ 7. Osoba: PESEL ponad kartotekami, najnowsza oferta, mediana wariantów ═
do $$
declare r jsonb; o uuid;
begin
  begin
    -- Osoba B1 (PESEL 95050500001) dostaje nowszą ofertę — przez NOWĄ kartotekę.
    o := tk.oferta('P1', '95050500001', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0199 * 12 * 10000);
    r := tk.k();
    perform tk.sprawdz('dwa client_id z jednym PESEL-em = jedna osoba; liczy się najnowsza oferta (8 osób, dół 0,0199)',
      (r->'zrodlo'->>'osob')::int = 8 and (r->'stawka'->>'dol')::numeric = 0.0199);
    -- Trzy świadczenia jednej osoby w jednej ofercie = jedna obserwacja (mediana).
    o := tk.oferta('P2', '95050500051', '2030-05-03T10:00:00Z');
    perform tk.wariant(o, 5000, 0.0190 * 12 * 5000);
    perform tk.wariant(o, 8000, 0.0203 * 12 * 8000);
    perform tk.wariant(o, 12000, 0.0300 * 12 * 12000);
    r := tk.k();
    perform tk.sprawdz('trzy świadczenia jednej osoby → jedna obserwacja = mediana 0,0203 (ani 0,019, ani 0,03)',
      (r->'zrodlo'->>'osob')::int = 9 and (r->'stawka'->>'dol')::numeric = 0.0199
      and (r->'stawka'->>'gora')::numeric = 0.0240 and (r->'raport'->'surowe'->>'max')::numeric = 0.024);
    -- Ten sam wariant wczytany dwa razy liczy się raz.
    perform tk.wariant(o, 8000, 0.0203 * 12 * 8000);
    r := tk.k();
    perform tk.sprawdz('zdublowany wiersz w ofercie liczy się raz (warianty bez zmian)',
      (r->'zrodlo'->>'wariantow')::int = 8 + 1 + 3);
    -- Osoba bez PESEL-u: osobno po kartotece.
    o := tk.oferta('P3', null, '2030-05-03T10:00:00Z');
    perform tk.wariant(o, 10000, 0.0241 * 12 * 10000);
    r := tk.k();
    perform tk.sprawdz('klient bez PESEL-u liczy się jako osobna osoba', (r->'zrodlo'->>'osob')::int = 10
      and (r->'stawka'->>'gora')::numeric = 0.0241);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

-- ═══ 8. Zaokrąglenia na numeric, w górę ═════════════════════════════════════
do $$
declare r jsonb; o uuid;
begin
  begin
    -- Dokładnie 0,0202 nie może zostać 0,0203 przez błąd zmiennoprzecinkowy.
    o := tk.oferta('Z1', '95050500001', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 6000, 1454.40);                          -- 1454,40 / 72 000 = 0,0202 dokładnie
    o := tk.oferta('Z2', '95050500008', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 7000, 2026.71);                          -- 0,024127… → 0,0242
    r := tk.k();
    perform tk.sprawdz('zaokrąglenie: 0,0202 zostaje 0,0202; 0,024127 → 0,0242 (w górę)',
      (r->'stawka'->>'dol')::numeric = 0.0202 and (r->'stawka'->>'gora')::numeric = 0.0242);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

do $$
declare r jsonb; o uuid;
begin
  begin
    -- Dół 0,020113… → 0,0202. Zaokrąglenie „do najbliższej” dałoby 0,0201,
    -- czyli cenę poniżej najtańszej oferty — dokładnie ten kierunek błędu,
    -- którego kalkulator nie może popełnić.
    o := tk.oferta('Z3', '95050500001', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 6000, 1448.14);                          -- 1448,14 / 72 000 = 0,020113…
    r := tk.k();
    perform tk.sprawdz('zaokrąglenie: dół 0,020113 → 0,0202 (w górę, nie 0,0201)',
      (r->'raport'->'surowe'->>'min')::numeric = 0.020113 and (r->'stawka'->>'dol')::numeric = 0.0202);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

do $$
declare r jsonb;
begin
  -- Środek: mediana bazowej ósemki to 0,02175 → w górę do 0,1 p.p. = 0,022.
  r := tk.k();
  perform tk.sprawdz('środek: mediana 0,02175 → 0,022 (w górę do 0,1 p.p.)',
    (r->'raport'->'surowe'->>'mediana')::numeric = 0.02175 and (r->'stawka'->>'srodek')::numeric = 0.022);
end $$;

-- ═══ 9. Mnożniki okresów: ≥ 3 osoby, rozrzut ≤ 1,05, para w jednej ofercie ══
do $$
declare r jsonb; o uuid;
begin
  begin
    -- Trzy osoby z bazy dostają nowszą ofertę z parą 24/36; ilorazy 1,2401 / 1,2453 / 1,26.
    o := tk.oferta('M1', '95050500001', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2400); perform tk.wariant(o, 10000, 2976.24, p_okres := 36);
    o := tk.oferta('M2', '95050500002', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2460); perform tk.wariant(o, 10000, 3063.44, p_okres := 36);
    r := tk.k();
    perform tk.sprawdz('mnożnik 36: dwie osoby z parą — klucza NIE ma (kandydat z 2 osobami)',
      r->'okresy' = '{"24": 1}'::jsonb and (r->'raport'->'okresy_kandydaci'->'36'->>'osob')::int = 2);
    o := tk.oferta('M3', '95050500003', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2520); perform tk.wariant(o, 10000, 3175.20, p_okres := 36);
    r := tk.k();
    perform tk.sprawdz('mnożnik 36: trzy osoby, mediana 1,2453 → 1,25 (w górę), par 36 = 3',
      r->'okresy' = '{"24": 1, "36": 1.25}'::jsonb and r->'zrodlo'->'par' = '{"36": 3}'::jsonb
      and (r->'raport'->'okresy_kandydaci'->'36'->>'mediana')::numeric = 1.2453);
    -- Para w RÓŻNYCH ofertach tej samej osoby nie jest parą.
    o := tk.oferta('M4', '95050500004', '2030-05-09T10:00:00Z');
    perform tk.wariant(o, 10000, 2580);
    o := tk.oferta('M5', '95050500004', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 3300, p_okres := 36);
    -- Para z innym okresem wyczekiwania nie jest parą.
    o := tk.oferta('M6', '95050500005', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2640); perform tk.wariant(o, 10000, 3400, p_okres := 36, p_wa := 21);
    r := tk.k();
    perform tk.sprawdz('mnożnik 36: pary z dwóch ofert albo z innym wyczekiwaniem się nie liczą (dalej 3 osoby)',
      (r->'raport'->'okresy_kandydaci'->'36'->>'osob')::int = 3 and r->'okresy'->>'36' = '1.25');
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

do $$
declare r jsonb; o uuid;
begin
  begin
    -- Mediana ilorazów 1,2412 → 1,25. „Do najbliższej” dałoby 1,24.
    o := tk.oferta('N1', '95050500001', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2400); perform tk.wariant(o, 10000, 2976.24, p_okres := 36);
    o := tk.oferta('N2', '95050500002', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2460); perform tk.wariant(o, 10000, 3053.35, p_okres := 36);
    o := tk.oferta('N3', '95050500003', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2520); perform tk.wariant(o, 10000, 3175.20, p_okres := 36);
    r := tk.k();
    perform tk.sprawdz('mnożnik 36: mediana 1,2412 → 1,25 (w górę, nie 1,24)',
      (r->'raport'->'okresy_kandydaci'->'36'->>'mediana')::numeric = 1.2412
      and r->'okresy' = '{"24": 1, "36": 1.25}'::jsonb);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

do $$
declare r jsonb; o uuid;
begin
  begin
    -- Rozrzut ilorazów > 1,05 (1,20 … 1,30) — dane niespójne, klucza nie ma.
    o := tk.oferta('R1', '95050500001', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2400); perform tk.wariant(o, 10000, 2880, p_okres := 36);
    o := tk.oferta('R2', '95050500002', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2460); perform tk.wariant(o, 10000, 3075, p_okres := 36);
    o := tk.oferta('R3', '95050500003', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2520); perform tk.wariant(o, 10000, 3276, p_okres := 36);
    -- Para 24/48 u jednej osoby — za mało na klucz 48.
    o := tk.oferta('R4', '95050500004', '2030-05-10T10:00:00Z');
    perform tk.wariant(o, 10000, 2580); perform tk.wariant(o, 10000, 3870, p_okres := 48);
    r := tk.k();
    perform tk.sprawdz('mnożnik 36: rozrzut 1,30/1,20 > 1,05 → brak klucza; 48 z jedną osobą → brak klucza',
      r->'okresy' = '{"24": 1}'::jsonb
      and (r->'raport'->'okresy_kandydaci'->'36'->>'osob')::int = 3
      and (r->'raport'->'okresy_kandydaci'->'48'->>'osob')::int = 1
      and r->'raport'->'okresy_kandydaci'->'60' = '{"osob": 0}'::jsonb);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

-- ═══ 10. Za mało osób, anomalie ═════════════════════════════════════════════
do $$
declare r jsonb;
begin
  begin
    delete from public.ud_offer_documents d using public.ud_offers o
     where o.id = d.offer_id and o.offer_number like 'UD/2030/TT/B8/%';
    r := tk.k();
    perform tk.sprawdz('7 osób → za_malo_osob: stawka i okresy null, zrodlo jest',
      r->>'status' = 'za_malo_osob' and r->'stawka' = 'null'::jsonb and r->'okresy' = 'null'::jsonb
      and (r->'zrodlo'->>'osob')::int = 7 and r->'raport'->'surowe' is not null);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

do $$
declare r jsonb; o uuid;
begin
  begin
    o := tk.oferta('A1', '95050500061', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 2400, p_rata := 250);              -- 250 × 12 = 3000 ≠ 2400
    o := tk.oferta('A2', '95050500062', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 10000, 2400, p_ttp := 2700);              -- do zapłaty ≠ składka
    o := tk.oferta('A3', '95050500063', '2030-05-02T10:00:00Z');
    perform tk.wariant(o, 1000, 900);                               -- 7,5% — poza 1–5%
    r := tk.k();
    perform tk.sprawdz('anomalie → status anomalie, bez stawek',
      r->>'status' = 'anomalie' and r->'stawka' = 'null'::jsonb and r->'okresy' = 'null'::jsonb);
    perform tk.sprawdz('anomalie: trzy wpisy z numerem oferty BEZ nazwiska i powodem',
      r->'raport'->'anomalie' = '[{"oferta": "UD/2030/TT/A1", "powod": "rata × 12 ≠ składka"},
                                   {"oferta": "UD/2030/TT/A2", "powod": "do zapłaty ≠ składka"},
                                   {"oferta": "UD/2030/TT/A3", "powod": "stawka poza 1–5%"}]'::jsonb);
    perform tk.sprawdz('anomalie: nazwisko z numeru oferty nie wychodzi nigdzie w wyniku',
      strpos(r::text, 'Nazwisko') = 0);
    raise exception using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then null;
  end;
end $$;

-- ═══ 11. Kształt wyniku: tylko klucze z kontraktu, bez danych osobowych ═════
do $$
declare r jsonb; t text;
begin
  r := public.ud_kalibracja_stawek('2026-10-14T05:40:00Z');
  t := r::text;
  perform tk.sprawdz('wynik: klucze najwyższego poziomu = kontrakt',
    (select array_agg(k order by k) from jsonb_object_keys(r) k)
      = array['metoda', 'na_dzien', 'okresy', 'raport', 'status', 'stawka', 'zrodlo']);
  perform tk.sprawdz('wynik: zrodlo = metoda, ubezpieczyciel, okno, osob, ofert, wariantow, par',
    (select array_agg(k order by k) from jsonb_object_keys(r->'zrodlo') k)
      = array['metoda', 'ofert', 'okno', 'osob', 'par', 'ubezpieczyciel', 'wariantow']);
  perform tk.sprawdz('wynik: raport = surowe, okresy_kandydaci, pominiete, anomalie',
    (select array_agg(k order by k) from jsonb_object_keys(r->'raport') k)
      = array['anomalie', 'okresy_kandydaci', 'pominiete', 'surowe']);
  perform tk.sprawdz('wynik: żadnego ciągu 11 cyfr (PESEL), uuid ani skrótu md5',
    t !~ '\d{11}' and t !~ '[0-9a-f]{8}-[0-9a-f]{4}-' and t !~ '[0-9a-f]{32}');
end $$;

-- ═══ 12. Tabele, ustawienia, uprawnienia, wywołanie z crona ═════════════════
do $$
begin
  perform tk.sprawdz('ustawienia: jeden wiersz, domyślnie na_sucho, gałąź produkcyjna, biuro@',
    (select count(*) from public.ud_kalibracja_ustawienia) = 1
    and (select tryb = 'na_sucho' and galaz = 'claude/portal-rebuild-seo-llm-yz2x4t'
              and odbiorca = 'biuro@utratadochodu.com' and dane_od is null
           from public.ud_kalibracja_ustawienia));
  begin
    insert into public.ud_kalibracja_ustawienia (id) values (false);
    perform tk.sprawdz('ustawienia: id = false odrzucone (jeden wiersz)', false);
  exception when check_violation then
    perform tk.sprawdz('ustawienia: id = false odrzucone (jeden wiersz)', true);
  end;
  begin
    update public.ud_kalibracja_ustawienia set tryb = 'auto';
    perform tk.sprawdz('ustawienia: tryb spoza listy odrzucony', false);
  exception when check_violation then
    perform tk.sprawdz('ustawienia: tryb spoza listy odrzucony', true);
  end;
  begin
    insert into public.ud_kalibracja_przebiegi (tryb, wynik) values ('na_sucho', 'cokolwiek');
    perform tk.sprawdz('dziennik: wynik spoza listy odrzucony', false);
  exception when check_violation then
    perform tk.sprawdz('dziennik: wynik spoza listy odrzucony', true);
  end;

  perform tk.sprawdz('tabele: RLS włączone, bez polityk',
    (select bool_and(relrowsecurity) from pg_class
      where oid in ('public.ud_kalibracja_ustawienia'::regclass, 'public.ud_kalibracja_przebiegi'::regclass))
    and not exists (select 1 from pg_policies where tablename in ('ud_kalibracja_ustawienia', 'ud_kalibracja_przebiegi')));
  perform tk.sprawdz('tabele: anon/authenticated nie czytają ani nie piszą (atrapa ma domyślne uprawnienia jak produkcja)',
    not has_table_privilege('anon', 'public.ud_kalibracja_ustawienia', 'select, insert, update, delete, truncate')
    and not has_table_privilege('authenticated', 'public.ud_kalibracja_ustawienia', 'select, insert, update, delete, truncate')
    and not has_table_privilege('anon', 'public.ud_kalibracja_przebiegi', 'select, insert, update, delete, truncate')
    and not has_table_privilege('authenticated', 'public.ud_kalibracja_przebiegi', 'select, insert, update, delete, truncate'));
  perform tk.sprawdz('tabele: service_role czyta i pisze',
    has_table_privilege('service_role', 'public.ud_kalibracja_ustawienia', 'select, update')
    and has_table_privilege('service_role', 'public.ud_kalibracja_przebiegi', 'select, insert'));
  perform tk.sprawdz('funkcje: anon/authenticated nie wykonają ud_kalibracja_stawek ani ud_kalibracja_uruchom',
    not has_function_privilege('anon', 'public.ud_kalibracja_stawek(timestamptz, date)', 'execute')
    and not has_function_privilege('authenticated', 'public.ud_kalibracja_stawek(timestamptz, date)', 'execute')
    and not has_function_privilege('anon', 'public.ud_kalibracja_uruchom()', 'execute')
    and not has_function_privilege('authenticated', 'public.ud_kalibracja_uruchom()', 'execute'));
  perform tk.sprawdz('funkcje: service_role wykona ud_kalibracja_stawek',
    has_function_privilege('service_role', 'public.ud_kalibracja_stawek(timestamptz, date)', 'execute'));
  perform tk.sprawdz('ud_kalibracja_stawek: STABLE, SECURITY INVOKER, search_path pusty',
    (select provolatile = 's' and not prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid = 'public.ud_kalibracja_stawek(timestamptz, date)'::regprocedure));
  perform tk.sprawdz('ud_kalibracja_uruchom: SECURITY DEFINER, token z Vaulta, adres funkcji kalibrator',
    (select prosecdef from pg_proc where oid = 'public.ud_kalibracja_uruchom()'::regprocedure)
    and pg_get_functiondef('public.ud_kalibracja_uruchom()'::regprocedure) like '%vault.decrypted_secrets%edge_cron_token%'
    and pg_get_functiondef('public.ud_kalibracja_uruchom()'::regprocedure) like '%/functions/v1/kalibrator%'
    and public.ud_kalibracja_uruchom() = 1);
end $$;

-- ═══ 13. Zadanie crona: wyłączone, migracja go nie włącza ani nie wyłącza ═══
do $$
begin
  perform tk.sprawdz('cron po migracji: jedno zadanie kalibracja-stawek, pn–pt 05:40 UTC, WYŁĄCZONE',
    (select ile = 1 and aktywne = false and harmonogram = '40 5 * * 1-5'
            and polecenie = 'select public.ud_kalibracja_uruchom();'
       from tk.cron_stan where krok = 'po_pierwszym'));
  perform tk.sprawdz('cron: ponowna migracja nie tworzy drugiego zadania i go nie włącza',
    (select ile = 1 and aktywne = false from tk.cron_stan where krok = 'po_drugim'));
  perform tk.sprawdz('cron: zadanie włączone przez człowieka zostaje włączone po kolejnej migracji',
    (select ile = 1 and aktywne = true from tk.cron_stan where krok = 'po_wlaczeniu_i_trzecim'));
end $$;
