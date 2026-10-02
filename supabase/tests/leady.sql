-- Testy SQL tablicy leadów. Uruchamia je apps/panel/scripts/test-leady-sql.mjs
-- na jednorazowym klastrze, po stub.sql, migracjach (szkice + trzy części leadów),
-- pomocnicze.sql i fixture.sql.

-- ─── 1. Synchronizacja ──────────────────────────────────────────────────────
do $$
declare
  w jsonb; w2 jsonb;
begin
  w := public.ud_leady_synchronizuj();
  perform tt.t('sync: 8 klientów, żadnego szkicu', (w->>'klienci')::int = 8 and (select count(*) from public.ud_leady) = 8);
  w2 := public.ud_leady_synchronizuj();
  perform tt.t('sync: drugie wywołanie niczego nie dokłada (idempotencja)',
               (w2->>'klienci')::int = 0 and (select count(*) from public.ud_leady) = 8);

  perform tt.t('sync: klient bez ofert → Nowy',                  tt.etap_leada(tt.lead('Anna Kowalska')) = 'nowy');
  perform tt.t('sync: oferta wysłana → Oferta',                  tt.etap_leada(tt.lead('Bartek Nowak')) = 'oferta');
  perform tt.t('sync: kupiona (nawet zarchiwizowana) → Wygrany', tt.etap_leada(tt.lead('Celina Wygrana')) = 'wygrany');
  perform tt.t('sync: wybór klienta → Decyzja klienta',          tt.etap_leada(tt.lead('Darek Decyzja')) = 'decyzja');
  perform tt.t('sync: zarchiwizowana wysłana oferta nie liczy się → Nowy', tt.etap_leada(tt.lead('Ewa Archiwalna')) = 'nowy');
  perform tt.t('sync: odrzucona → Przegrany z powodem',
               tt.etap_leada(tt.lead('Filip Odrzucony')) = 'przegrany'
               and (select powod_utraty from public.ud_leady where id = tt.lead('Filip Odrzucony')) is not null);
  perform tt.t('sync: oferta robocza → Nowy (Kontakt scalony z Nowym)', tt.etap_leada(tt.lead('Hanna Szkicowa')) = 'nowy');
  perform tt.t('etap Kontakt wyłączony, nie usunięty',
               exists (select 1 from public.ud_leady_etap where klucz = 'kontakt' and not aktywny));
  perform tt.t('sync: kupiona oferta z wyborem wnosi dane sprzedaży z wariantu',
               (select skladka_roczna = 6000 and skladka_mies = 500 and swiadczenie_okresowa = 8000 and swiadczenie_zgon = 50000
                       and swiadczenie_trwala is null and sprzedaz_wariant_id = '0d000000-0000-0000-0000-000000000003'
                       and sprzedano_at is not null
                  from public.ud_leady where id = tt.lead('Celina Wygrana')));

  perform tt.t('sync: opiekun z referred_by',
               (select opiekun_id from public.ud_leady where id = tt.lead('Bartek Nowak')) = tt.id_ula());
  perform tt.t('sync: opiekun z użytkownika oferty',
               (select opiekun_id from public.ud_leady where id = tt.lead('Darek Decyzja')) = tt.id_olek());
  perform tt.t('sync: nieaktywny agent nie zostaje opiekunem',
               (select opiekun_id from public.ud_leady where id = tt.lead('Hanna Szkicowa')) is null);

  perform tt.t('sync: żaden szkic — także ze zgodą — nie jest leadem',
               not exists (select 1 from public.ud_leady where szkic_id is not null)
               and exists (select 1 from public.ud_wnioski_szkice where zgoda_kontakt and ukonczony_at is null));
end $$;

-- ─── 2. Kwoty, karta, prywatność, uprawnienia ───────────────────────────────
do $$
declare
  k jsonb; kolumny text[]; r text; wyjatek boolean;
begin
  perform tt.t('kwota: "8000"',            public.ud_kwota('8000') = 8000);
  perform tt.t('kwota: "8 000,50 zł"',     public.ud_kwota('8 000,50 zł') = 8000.50);
  perform tt.t('kwota: nbsp i PLN',        public.ud_kwota(E'12 000 PLN') = 12000);
  perform tt.t('kwota: "abc" → null',      public.ud_kwota('abc') is null);
  perform tt.t('kwota: pusta → null',      public.ud_kwota('') is null and public.ud_kwota(null) is null);
  perform tt.t('kwota: ujemna → null',     public.ud_kwota('-5') is null);
  perform tt.t('kwota: "1e9" → null',      public.ud_kwota('1e9') is null);
  perform tt.t('kwota: 12 cyfr → null',    public.ud_kwota('123456789012') is null);

  k := public.ud_lead_karta(tt.lead('Anna Kowalska'));
  perform tt.t('karta: nazwa, telefon, wartość', k->>'nazwa' = 'Anna Kowalska' and k->>'telefon' = '500100200' and (k->>'wartosc')::numeric = 8000);
  perform tt.t('karta: BEZ e-maila i PESEL-u', not (k ? 'email') and not (k ? 'pesel') and k::text not like '%80010112345%' and k::text not like '%anna@x.pl%');
  perform tt.t('karta: produkty i źródło', k->'produkty' = '["okresowa"]'::jsonb and k->>'zrodlo' = 'form');
  perform tt.t('karta: opiekun nie jest administratorem, brak danych sprzedaży',
               k->'opiekun_admin' = 'false'::jsonb and k->'sprzedaz' = 'null'::jsonb);
  k := public.ud_lead_karta(tt.lead('Celina Wygrana'));
  perform tt.t('karta Wygranego: dane sprzedaży',
               (k->'sprzedaz'->>'skladka_roczna')::numeric = 6000 and (k->'sprzedaz'->>'skladka_mies')::numeric = 500);

  -- ud_leady nie ma kopii danych osobowych ani PESEL-u.
  select array_agg(column_name::text) into kolumny from information_schema.columns
   where table_schema = 'public' and table_name in ('ud_leady', 'ud_leady_historia', 'ud_leady_widok_uzytkownika');
  perform tt.t('model: brak kolumn z danymi osobowymi',
               not (kolumny && array['email', 'phone', 'telefon', 'imie', 'full_name', 'pesel', 'nazwa']));

  -- Dostęp wyłącznie dla service_role.
  foreach r in array array['ud_leady', 'ud_leady_baza', 'ud_leady_historia', 'ud_leady_notatki', 'ud_leady_etap', 'ud_leady_widok_uzytkownika']
  loop
    wyjatek := false;
    begin
      execute 'set local role anon';
      execute format('select count(*) from public.%I', r);
    exception when insufficient_privilege then wyjatek := true;
    end;
    execute 'reset role';
    perform tt.t('uprawnienia: anon nie czyta ' || r, wyjatek);
    wyjatek := false;
    begin
      execute 'set local role authenticated';
      execute format('select count(*) from public.%I', r);
    exception when insufficient_privilege then wyjatek := true;
    end;
    execute 'reset role';
    perform tt.t('uprawnienia: authenticated nie czyta ' || r, wyjatek);
  end loop;

  foreach r in array array['ud_lead_zmien', 'ud_lead_notatka', 'ud_leady_synchronizuj', 'ud_leady_kolumna', 'ud_leady_liczniki', 'ud_lead_szczegoly', 'ud_leady_zwin', 'ud_leady_statystyki', 'ud_leady_liczba']
  loop
    perform tt.t('uprawnienia: anon i authenticated nie wołają ' || r,
      (select not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
              and has_function_privilege('service_role', p.oid, 'execute')
         from pg_proc p where p.proname = r and p.pronamespace = 'public'::regnamespace));
  end loop;
end $$;

-- ─── 3. Następne działanie, filtry, liczniki, sortowanie ────────────────────
do $$
declare
  c1 uuid := tt.lead('Anna Kowalska'); c2 uuid := tt.lead('Bartek Nowak'); c4 uuid := tt.lead('Darek Decyzja');
  r jsonb;
  teraz timestamptz := now();
  dzis_wieczor timestamptz := date_trunc('day', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw' + interval '23 hours 55 minutes';
begin
  r := tt.ruch('dzialanie', c1, 1, 'dz-c1-aaaaaaaa', tt.id_ula(), jsonb_build_object('typ', 'telefon', 'termin', teraz - interval '1 day', 'opis', 'Oddzwonić'));
  perform tt.t('działanie: ustawione', r->>'status' = 'ok' and r->'lead'->'dzialanie'->>'typ' = 'telefon' and tt.wersja(c1) = 2);
  perform tt.t('działanie: historia zapisana', tt.hist(c1) = 1);
  r := tt.ruch('dzialanie', c2, 1, 'dz-c2-aaaaaaaa', tt.id_ula(), jsonb_build_object('typ', 'email', 'termin', dzis_wieczor));
  r := tt.ruch('dzialanie', c4, 1, 'dz-c4-aaaaaaaa', tt.id_ula(), jsonb_build_object('typ', 'spotkanie', 'termin', teraz + interval '3 days'));

  perform tt.t('działanie: typ bez terminu → błędne dane',
    tt.ruch('dzialanie', tt.lead('Ewa Archiwalna'), 1, 'dz-bad-aaaaaa1', tt.id_ula(), '{"typ":"telefon"}')->>'status' = 'bledne_dane');
  perform tt.t('działanie: nieznany typ → błędne dane',
    tt.ruch('dzialanie', tt.lead('Ewa Archiwalna'), 1, 'dz-bad-aaaaaa2', tt.id_ula(), jsonb_build_object('typ', 'gołąb', 'termin', teraz))->>'status' = 'bledne_dane');
  perform tt.t('działanie: zły format terminu → błędne dane',
    tt.ruch('dzialanie', tt.lead('Ewa Archiwalna'), 1, 'dz-bad-aaaaaa3', tt.id_ula(), '{"typ":"telefon","termin":"jutro"}')->>'status' = 'bledne_dane');
  perform tt.t('działanie: za długi opis → błędne dane',
    tt.ruch('dzialanie', tt.lead('Ewa Archiwalna'), 1, 'dz-bad-aaaaaa4', tt.id_ula(), jsonb_build_object('typ', 'inne', 'termin', teraz, 'opis', repeat('x', 201)))->>'status' = 'bledne_dane');
  perform tt.t('działanie: błędne żądania nie zmieniają leada', tt.wersja(tt.lead('Ewa Archiwalna')) = 1 and tt.hist(tt.lead('Ewa Archiwalna')) = 0);
end $$;

-- Wartości do testu sum: Anna 8000, Gabriel 12000, Ewa 5000 (bez znacznika ryzyka), Hanna bez kwoty.
do $$
declare
  p uuid := tt.pipeline();
  strona jsonb;
  s1 uuid[]; s2 uuid[]; wszystkie uuid[];
begin
  -- Liczniki bez filtra.
  perform tt.t('liczniki: bez filtra — rozkład po etapach',
    (select jsonb_object_agg(e.klucz, l.ile) from public.ud_leady_liczniki(p, '{}', tt.id_ula()) l join public.ud_leady_etap e on e.id = l.etap_id)
    = '{"nowy":4,"oferta":1,"decyzja":1,"wygrany":1,"przegrany":1}'::jsonb);
  perform tt.t('liczniki: składki — Wygrany 6000, reszta 0',
    (select skladki = 6000 and skladki_wszystkich = 6000 from public.ud_leady_liczniki(p, '{}', tt.id_ula()) where etap_id = tt.etap('wygrany'))
    and (select sum(skladki) from public.ud_leady_liczniki(p, '{}', tt.id_ula())) = 6000);
  perform tt.t('liczniki: sumy bez filtra (Nowy = 8000 + 5000 + 12000)',
    (select suma from public.ud_leady_liczniki(p, '{}', tt.id_ula()) where etap_id = tt.etap('nowy')) = 25000);

  -- Filtry.
  perform tt.t('filtr opiekun=ja', (select sum(ile) from public.ud_leady_liczniki(p, '{"opiekun":"ja"}', tt.id_ula())) = 1);
  perform tt.t('filtr opiekun=brak', (select sum(ile) from public.ud_leady_liczniki(p, '{"opiekun":"brak"}', tt.id_ula())) = 6);
  perform tt.t('filtr opiekun=<uuid>', (select sum(ile) from public.ud_leady_liczniki(p, jsonb_build_object('opiekun', tt.id_olek()), tt.id_ula())) = 1);
  perform tt.t('filtr źródło=direct', (select sum(ile) from public.ud_leady_liczniki(p, '{"zrodlo":"direct"}', tt.id_ula())) = 2);
  perform tt.t('filtr źródło=szkic → nic (porzucone wnioski nie są leadami)', (select sum(ile) from public.ud_leady_liczniki(p, '{"zrodlo":"szkic"}', tt.id_ula())) = 0);
  perform tt.t('filtr produkt=okresowa', (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"okresowa"}', tt.id_ula())) = 4);
  perform tt.t('filtr produkt=trwala',   (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"trwala"}', tt.id_ula())) = 1);
  perform tt.t('filtr produkt=zgon',     (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"zgon"}', tt.id_ula())) = 1);
  perform tt.t('filtr produkt=nieznany', (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"nieznany"}', tt.id_ula())) = 4);
  perform tt.t('filtr termin=brak', (select sum(ile) from public.ud_leady_liczniki(p, '{"termin":"brak"}', tt.id_ula())) = 5);
  perform tt.t('filtr termin=przeterminowane zawiera Annę, nie zawiera Darka',
    exists (select 1 from public.ud_leady_dopasowane(p, '{"termin":"przeterminowane"}', tt.id_ula()) where id = tt.lead('Anna Kowalska'))
    and not exists (select 1 from public.ud_leady_dopasowane(p, '{"termin":"przeterminowane"}', tt.id_ula()) where id = tt.lead('Darek Decyzja')));
  perform tt.t('filtr termin=dzisiaj → Bartek',
    (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"termin":"dzisiaj"}', tt.id_ula())) = array['Bartek Nowak']);
  perform tt.t('filtr termin=tydzien → Darek (a nie Anna)',
    exists (select 1 from public.ud_leady_dopasowane(p, '{"termin":"tydzien"}', tt.id_ula()) where id = tt.lead('Darek Decyzja'))
    and not exists (select 1 from public.ud_leady_dopasowane(p, '{"termin":"tydzien"}', tt.id_ula()) where id = tt.lead('Anna Kowalska')));
  perform tt.t('filtry łączą się (AND)',
    (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"okresowa","zrodlo":"direct"}', tt.id_ula())) = 1);

  -- Wyszukiwanie.
  perform tt.t('q: imię bez względu na wielkość liter', (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"ANNA kow"}', tt.id_ula())) = array['Anna Kowalska']);
  perform tt.t('q: fragment telefonu (same cyfry)',     (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"500 100"}', tt.id_ula())) = array['Anna Kowalska']);
  perform tt.t('q: fragment e-maila',                   (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"bartek@"}', tt.id_ula())) = array['Bartek Nowak']);
  perform tt.t('q: telefon szkicu nie trafia (szkic nie jest leadem)', (select count(*) from public.ud_leady_dopasowane(p, '{"q":"600 700 8"}', tt.id_ula())) = 0);
  perform tt.t('q: "%" nie jest wzorcem',               (select count(*) from public.ud_leady_dopasowane(p, '{"q":"%"}', tt.id_ula())) = 0);
  perform tt.t('q: "_" trafia tylko w literalny podkreślnik', (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"_"}', tt.id_ula())) = array['Gabriel Podkreślnik']);
  perform tt.t('q: "a%b" nie jest wzorcem',             (select count(*) from public.ud_leady_dopasowane(p, '{"q":"a%b"}', tt.id_ula())) = 0);
  perform tt.t('q: puste = bez filtra',                 (select count(*) from public.ud_leady_dopasowane(p, '{"q":"   "}', tt.id_ula())) = 8);

  -- K23: licznik i suma dotyczą całego filtrowanego zbioru, nie załadowanych kart.
  perform tt.t('K23: licznik po filtrze vs bez filtra ("2 z 4") i suma po filtrze (20000 z 25000)',
    (select ile = 2 and ile_wszystkich = 4 and suma = 20000 and suma_wszystkich = 25000
       from public.ud_leady_liczniki(p, '{"produkt":"okresowa"}', tt.id_ula()) where etap_id = tt.etap('nowy')));
  strona := public.ud_leady_kolumna(p, tt.etap('nowy'), '{"produkt":"okresowa"}', 'wartosc', 1, 0, tt.id_ula());
  perform tt.t('K23: załadowana 1 karta, ale razem = 2', jsonb_array_length(strona->'karty') = 1 and (strona->>'razem')::int = 2);

  -- K22: sortowanie.
  strona := public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'wartosc', 10, 0, tt.id_ula());
  perform tt.t('sort: wartość malejąco (12000, 8000, 5000)',
    strona->'karty'->0->>'nazwa' = 'Gabriel Podkreślnik' and strona->'karty'->1->>'nazwa' = 'Anna Kowalska'
    and strona->'karty'->2->>'nazwa' = 'Ewa Archiwalna');
  perform tt.t('sort: wartość — ostatnia karta nie ma kwoty', strona->'karty'->3->>'wartosc' is null);
  strona := public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'dzialanie', 10, 0, tt.id_ula());
  perform tt.t('sort: najbliższe działanie pierwsze (przeterminowane Anny), reszta bez terminu',
    strona->'karty'->0->>'nazwa' = 'Anna Kowalska' and strona->'karty'->1->'dzialanie' = 'null'::jsonb);
  update public.ud_clients set created_at = now() - interval '10 days' where id = 'c0000000-0000-0000-0000-000000000007';
  strona := public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 10, 0, tt.id_ula());
  perform tt.t('sort: data — najnowsze pierwsze (Hanna, Gabriel, Ewa, Anna)',
    (select array_agg(k->>'nazwa' order by o) from jsonb_array_elements(strona->'karty') with ordinality as t(k, o))
    = array['Hanna Szkicowa', 'Gabriel Podkreślnik', 'Ewa Archiwalna', 'Anna Kowalska']);

  -- Stronicowanie: rozłączne strony, razem komplet, stała kolejność.
  select array_agg((k->>'id')::uuid order by o) into s1
    from jsonb_array_elements(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 2, 0, tt.id_ula())->'karty') with ordinality t(k, o);
  select array_agg((k->>'id')::uuid order by o) into s2
    from jsonb_array_elements(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 2, 2, tt.id_ula())->'karty') with ordinality t(k, o);
  wszystkie := s1 || s2;
  perform tt.t('stronicowanie: 2 + 2, bez powtórzeń i luk',
    cardinality(s1) = 2 and cardinality(s2) = 2 and (select count(distinct x) from unnest(wszystkie) x) = 4);
  perform tt.t('stronicowanie: kolejność identyczna z pełną listą',
    wszystkie = (select array_agg((k->>'id')::uuid order by o)
                   from jsonb_array_elements(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 10, 0, tt.id_ula())->'karty') with ordinality t(k, o)));
  perform tt.t('stronicowanie: poza zakresem → pusta lista, razem bez zmian',
    (public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 2, 40, tt.id_ula())->>'razem')::int = 4
    and jsonb_array_length(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 2, 40, tt.id_ula())->'karty') = 0);
  perform tt.t('stronicowanie: limit ograniczony do 100',
    jsonb_array_length(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 100000, 0, tt.id_ula())->'karty') = 4);
end $$;

-- ─── 4. Zmiana etapu: konflikt, idempotencja, dane wymagane, uprawnienia ────
do $$
declare
  c2 uuid := tt.lead('Bartek Nowak'); c6 uuid := tt.lead('Filip Odrzucony'); c4 uuid := tt.lead('Darek Decyzja');
  c1 uuid := tt.lead('Anna Kowalska');
  r jsonb; v int; h int; inny_etap uuid; inny_pipe uuid;
begin
  -- K03: przeniesienie, liczniki i historia.
  v := tt.wersja(c2); h := tt.hist(c2);
  r := tt.przenies(c2, 'decyzja', 'mv-c2-aaaaaaaa');
  perform tt.t('K03: przeniesienie ok, wersja +1, etap_od świeży',
    r->>'status' = 'ok' and tt.wersja(c2) = v + 1 and tt.etap_leada(c2) = 'decyzja'
    and (select etap_od from public.ud_leady where id = c2) > now() - interval '1 minute');
  perform tt.t('K03: odpowiedź niesie kanoniczny stan', (r->'lead'->>'wersja')::int = v + 1 and r->'lead'->>'etap_id' = tt.etap('decyzja')::text);
  perform tt.t('K03: historia — poprzedni i nowy etap, wykonawca',
    (select z_etapu_id = tt.etap('oferta') and do_etapu_id = tt.etap('decyzja') and wykonawca_id = tt.id_ula() and wykonawca_nazwa = 'Ula Agent'
       from public.ud_leady_historia where lead_id = c2 and typ = 'etap'));
  perform tt.t('K03: liczniki zgodne po przeniesieniu',
    (select jsonb_object_agg(e.klucz, l.ile) from public.ud_leady_liczniki(tt.pipeline(), '{}', tt.id_ula()) l join public.ud_leady_etap e on e.id = l.etap_id)
    = '{"nowy":4,"oferta":0,"decyzja":2,"wygrany":1,"przegrany":1}'::jsonb);

  -- K21: ponowienie z tym samym kluczem po utracie odpowiedzi.
  v := tt.wersja(c2); h := tt.hist(c2);
  r := public.ud_lead_zmien('przenies', c2, v - 1, 'mv-c2-aaaaaaaa', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('decyzja')));
  perform tt.t('K21: ponowienie (nawet ze starą wersją) → ok/powtorzone, bez drugiego skutku',
    r->>'status' = 'ok' and (r->>'powtorzone')::boolean and tt.wersja(c2) = v and tt.hist(c2) = h);
  r := public.ud_lead_zmien('przenies', c2, v - 1, 'mv-c2-aaaaaaaa', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('oferta')));
  perform tt.t('K21: ten sam klucz do innej operacji → klucz_uzyty, bez zmian',
    r->>'status' = 'klucz_uzyty' and tt.etap_leada(c2) = 'decyzja' and tt.hist(c2) = h);
  r := public.ud_lead_zmien('opiekun', c2, v, 'mv-c2-aaaaaaaa', tt.id_ula(), jsonb_build_object('opiekun_id', tt.id_ula()));
  perform tt.t('K21: ten sam klucz do innego typu operacji → klucz_uzyty', r->>'status' = 'klucz_uzyty');
  r := public.ud_lead_zmien('przenies', c1, 2, 'mv-c2-aaaaaaaa', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('decyzja')));
  perform tt.t('K21: klucz jest per lead — ten sam klucz na innym leadzie to nowa operacja', r->>'status' = 'ok' and tt.etap_leada(c1) = 'decyzja');
  perform tt.przenies(c1, 'nowy', 'mv-c1-wroc-aaaaaa');

  -- K10: równoległa zmiana — nieaktualna wersja.
  v := tt.wersja(c4);
  r := public.ud_lead_zmien('przenies', c4, v, 'mv-c4-aaaaaaaa', tt.id_olek(), jsonb_build_object('etap_id', tt.etap('oferta')));
  r := public.ud_lead_zmien('przenies', c4, v, 'mv-c4-bbbbbbbb', tt.id_ula(),  jsonb_build_object('etap_id', tt.etap('wygrany')));
  perform tt.t('K10: druga zmiana ze starą wersją → konflikt, bez cichego nadpisania',
    r->>'status' = 'konflikt' and tt.etap_leada(c4) = 'oferta' and (r->'lead'->>'wersja')::int = v + 1
    and r->'lead'->>'etap_id' = tt.etap('oferta')::text);
  perform tt.t('K10: konflikt nie zostawia śladu w historii (klucz można użyć ponownie)',
    not exists (select 1 from public.ud_leady_historia where klucz = 'mv-c4-bbbbbbbb'));

  -- Ten sam etap.
  v := tt.wersja(c4);
  r := tt.przenies(c4, 'oferta', 'mv-c4-cccccccc');
  perform tt.t('przeniesienie na ten sam etap → bez_zmiany, wersja bez zmian', r->>'status' = 'bez_zmiany' and tt.wersja(c4) = v);

  -- K11: pole wymagane.
  v := tt.wersja(c1); h := tt.hist(c1);
  r := tt.przenies(c1, 'przegrany', 'mv-c1-przegr-1');
  perform tt.t('K11: Przegrany bez powodu → brak_danych, lead bez zmian',
    r->>'status' = 'brak_danych' and r->'pola' = '["powod_utraty"]'::jsonb and tt.etap_leada(c1) = 'nowy' and tt.wersja(c1) = v and tt.hist(c1) = h);
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-przegr-2', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('przegrany'), 'powod_utraty', '  '));
  perform tt.t('K11: powód z samych spacji = brak', r->>'status' = 'brak_danych');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-przegr-3', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('przegrany'), 'powod_utraty', 'ab'));
  perform tt.t('K11: za krótki powód = brak', r->>'status' = 'brak_danych');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-przegr-4', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('przegrany'), 'powod_utraty', repeat('x', 301)));
  perform tt.t('K11: za długi powód → błędne dane', r->>'status' = 'bledne_dane' and tt.etap_leada(c1) = 'nowy');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-przegr-5', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('przegrany'), 'powod_utraty', 'Wybrał konkurencję'));
  perform tt.t('K11: z powodem → ok i powód zapisany',
    r->>'status' = 'ok' and tt.etap_leada(c1) = 'przegrany' and r->'lead'->>'powod_utraty' = 'Wybrał konkurencję');
  r := tt.przenies(c1, 'nowy', 'mv-c1-powrot-1');
  perform tt.t('wyjście z Przegranego (cofnięcie jako nowa operacja) czyści powód',
    r->>'status' = 'ok' and (select powod_utraty from public.ud_leady where id = c1) is null);
  perform tt.t('powód utraty zostaje w historii',
    exists (select 1 from public.ud_leady_historia where lead_id = c1 and dane->>'powod_utraty' = 'Wybrał konkurencję'));
  r := public.ud_lead_zmien('przenies', c1, tt.wersja(c1), 'mv-c1-nie-przegr', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('oferta'), 'powod_utraty', 'zbędny'));
  perform tt.t('powód podany przy etapie, który go nie wymaga, nie jest zapisywany',
    r->>'status' = 'ok' and (select powod_utraty from public.ud_leady where id = c1) is null);
  perform tt.przenies(c1, 'nowy', 'mv-c1-powrot-2');

  -- Zamknięcie sprawy kasuje zaplanowane działanie (historia je pamięta).
  perform tt.ruch('dzialanie', c1, tt.wersja(c1), 'dz-c1-zamk-aaaa', tt.id_ula(), jsonb_build_object('typ', 'telefon', 'termin', now() + interval '2 days'));
  v := tt.wersja(c1);
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-wygr-aaaa', tt.id_ula(),
         jsonb_build_object('etap_id', tt.etap('wygrany'), 'sprzedaz', jsonb_build_object('skladka_roczna', 1800)));
  perform tt.t('Wygrany: kasuje zaplanowane działanie, wersja +1, historia pamięta poprzednie',
    r->>'status' = 'ok' and r->'lead'->'dzialanie' = 'null'::jsonb and tt.wersja(c1) = v + 1
    and exists (select 1 from public.ud_leady_historia where lead_id = c1 and klucz = 'mv-c1-wygr-aaaa' and dane->'zamkniete_dzialanie'->>'typ' = 'telefon'));
  r := tt.przenies(c1, 'nowy', 'mv-c1-wygr-bbbb');
  perform tt.t('powrót do etapu otwartego nie przywraca działania', r->>'status' = 'ok' and r->'lead'->'dzialanie' = 'null'::jsonb);
  perform tt.t('wyjście z Wygrany zeruje dane sprzedaży, historia je pamięta',
    (select skladka_roczna is null and sprzedawca_id is null and sprzedano_at is null from public.ud_leady where id = c1)
    and r->'lead'->'sprzedaz' = 'null'::jsonb
    and exists (select 1 from public.ud_leady_historia where lead_id = c1 and klucz = 'mv-c1-wygr-bbbb'
                  and (dane->'poprzednia_sprzedaz'->>'skladka_roczna')::numeric = 1800));

  -- K12: niedozwolony etap — także bezpośrednio przez funkcję (to jest to samo „API").
  insert into public.ud_leady_pipeline (klucz, nazwa) values ('inny', 'Inny') returning id into inny_pipe;
  insert into public.ud_leady_etap (pipeline_id, klucz, nazwa, pozycja) values (inny_pipe, 'obcy', 'Obcy', 10) returning id into inny_etap;
  v := tt.wersja(c1);
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-obcy-aaaaaaaa', tt.id_ula(), jsonb_build_object('etap_id', inny_etap));
  perform tt.t('K12: etap z innego pipeline''u → niedozwolony', r->>'status' = 'niedozwolony' and tt.etap_leada(c1) = 'nowy' and tt.wersja(c1) = v);
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-losowy-aaaaaa', tt.id_ula(), jsonb_build_object('etap_id', gen_random_uuid()));
  perform tt.t('K12: nieistniejący etap → niedozwolony', r->>'status' = 'niedozwolony');
  r := tt.przenies(c1, 'kontakt', 'mv-wylaczony-aa');
  perform tt.t('K12: wyłączony etap (Kontakt po scaleniu) → niedozwolony', r->>'status' = 'niedozwolony' and tt.etap_leada(c1) = 'nowy');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-zly-uuid-aaaa', tt.id_ula(), '{"etap_id":"nie-uuid"}');
  perform tt.t('K12: śmieciowy etap_id → błędne dane, nie wyjątek', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-brak-etapu-aa', tt.id_ula(), '{}');
  perform tt.t('K12: brak etap_id → niedozwolony', r->>'status' = 'niedozwolony');
  begin
    update public.ud_leady set etap_id = inny_etap where id = c1;
    perform tt.t('K12: bezpośredni zapis etapu z innego pipeline''u odrzuca baza (FK)', false);
  exception when foreign_key_violation then
    perform tt.t('K12: bezpośredni zapis etapu z innego pipeline''u odrzuca baza (FK)', true);
  end;

  -- Uprawnienia i walidacja żądania.
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-obcy-user-aaa', gen_random_uuid(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('uprawnienia: nieznany użytkownik → brak_uprawnien', r->>'status' = 'brak_uprawnien' and tt.etap_leada(c1) = 'nowy');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-ines-aaaaaaaa', tt.id_ines(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('uprawnienia: nieaktywny agent → brak_uprawnien', r->>'status' = 'brak_uprawnien' and tt.etap_leada(c1) = 'nowy');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-null-user-aaa', null, jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('uprawnienia: brak użytkownika → brak_uprawnien', r->>'status' = 'brak_uprawnien');
  r := public.ud_lead_zmien('przenies', gen_random_uuid(), 1, 'mv-brak-leada-aa', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('brak leada → brak_leada', r->>'status' = 'brak_leada');
  r := public.ud_lead_zmien('przenies', c1, v, 'krotki', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('klucz idempotencji za krótki → błędne dane', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('przenies', c1, null, 'mv-bez-wersji-aa', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('brak wersji → błędne dane', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('skasuj', c1, v, 'mv-nieznana-op-a', tt.id_ula(), '{}');
  perform tt.t('nieznana operacja → błędne dane', r->>'status' = 'bledne_dane');
  perform tt.t('wersja z przyszłości → konflikt', public.ud_lead_zmien('przenies', c1, v + 5, 'mv-zla-wersja-bb', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('kontakt')))->>'status' = 'konflikt');
end $$;

-- ─── 5. Opiekun ─────────────────────────────────────────────────────────────
do $$
declare
  c1 uuid := tt.lead('Anna Kowalska');       -- bez opiekuna
  c2 uuid := tt.lead('Bartek Nowak');        -- opiekun Ula
  c4 uuid := tt.lead('Darek Decyzja');       -- opiekun Olek
  r jsonb;
begin
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-aaaaaaaa', tt.id_ula(), jsonb_build_object('opiekun_id', tt.id_ula()));
  perform tt.t('opiekun: agent przejmuje wolny lead na siebie', r->>'status' = 'ok' and r->'lead'->>'opiekun_nazwa' = 'Ula Agent');
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-bbbbbbbb', tt.id_olek(), jsonb_build_object('opiekun_id', tt.id_olek()));
  perform tt.t('opiekun: agent nie kradnie cudzego leada', r->>'status' = 'brak_uprawnien' and (select opiekun_id from public.ud_leady where id = c1) = tt.id_ula());
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-cccccccc', tt.id_olek(), jsonb_build_object('opiekun_id', null));
  perform tt.t('opiekun: agent nie zwalnia cudzego leada', r->>'status' = 'brak_uprawnien');
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-dddddddd', tt.id_ula(), jsonb_build_object('opiekun_id', tt.id_olek()));
  perform tt.t('opiekun: agent nie przepisuje własnego leada na kogoś', r->>'status' = 'brak_uprawnien');
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-eeeeeeee', tt.id_ula(), jsonb_build_object('opiekun_id', null));
  perform tt.t('opiekun: agent zwalnia własny lead', r->>'status' = 'ok' and (select opiekun_id from public.ud_leady where id = c1) is null);
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-ffffffff', tt.id_olek(), jsonb_build_object('opiekun_id', tt.id_ula()));
  perform tt.t('opiekun: agent nie przypisuje innej osobie', r->>'status' = 'brak_uprawnien');
  r := public.ud_lead_zmien('opiekun', c4, tt.wersja(c4), 'op-c4-aaaaaaaa', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_ula()));
  perform tt.t('opiekun: administrator przepisuje cudzy lead', r->>'status' = 'ok' and (select opiekun_id from public.ud_leady where id = c4) = tt.id_ula());
  r := public.ud_lead_zmien('opiekun', c4, tt.wersja(c4), 'op-c4-bbbbbbbb', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_ines()));
  perform tt.t('opiekun: nie można przypisać nieaktywnego agenta', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('opiekun', c4, tt.wersja(c4), 'op-c4-cccccccc', tt.id_adm(), jsonb_build_object('opiekun_id', gen_random_uuid()));
  perform tt.t('opiekun: nie można przypisać nieistniejącego użytkownika', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('opiekun', c4, tt.wersja(c4), 'op-c4-dddddddd', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_ula()));
  perform tt.t('opiekun: ten sam opiekun → bez_zmiany', r->>'status' = 'bez_zmiany');
  perform tt.t('opiekun: historia zapisuje poprzedniego', exists (select 1 from public.ud_leady_historia where lead_id = c4 and typ = 'opiekun' and (dane->>'poprzedni')::uuid = tt.id_olek()));
  perform public.ud_lead_zmien('opiekun', c4, tt.wersja(c4), 'op-c4-eeeeeeee', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_olek()));
end $$;

-- ─── 6. Notatki ─────────────────────────────────────────────────────────────
do $$
declare
  c2 uuid := tt.lead('Bartek Nowak'); v int; r jsonb; n int;
begin
  v := tt.wersja(c2);
  r := public.ud_lead_notatka(c2, 'nt-c2-aaaaaaaa', tt.id_ula(), '  Klient prosi o kontakt po 16.  ');
  perform tt.t('notatka: dodana, przycięta, z autorem', r->>'status' = 'ok' and r->'notatka'->>'tresc' = 'Klient prosi o kontakt po 16.' and r->'notatka'->>'autor_nazwa' = 'Ula Agent');
  perform tt.t('notatka: nie zmienia wersji leada', tt.wersja(c2) = v);
  r := public.ud_lead_notatka(c2, 'nt-c2-aaaaaaaa', tt.id_ula(), 'Klient prosi o kontakt po 16.');
  select count(*) into n from public.ud_leady_notatki where lead_id = c2;
  perform tt.t('notatka: ponowienie → ok/powtorzone, jedna notatka', r->>'status' = 'ok' and (r->>'powtorzone')::boolean and n = 1);
  r := public.ud_lead_notatka(c2, 'nt-c2-aaaaaaaa', tt.id_ula(), 'Inna treść');
  perform tt.t('notatka: ten sam klucz, inna treść → klucz_uzyty', r->>'status' = 'klucz_uzyty');
  perform tt.t('notatka: pusta → błędne dane', public.ud_lead_notatka(c2, 'nt-c2-bbbbbbbb', tt.id_ula(), '   ')->>'status' = 'bledne_dane');
  perform tt.t('notatka: 2001 znaków → błędne dane', public.ud_lead_notatka(c2, 'nt-c2-cccccccc', tt.id_ula(), repeat('x', 2001))->>'status' = 'bledne_dane');
  perform tt.t('notatka: 2000 znaków → ok', public.ud_lead_notatka(c2, 'nt-c2-dddddddd', tt.id_ula(), repeat('x', 2000))->>'status' = 'ok');
  perform tt.t('notatka: nieaktywny agent → brak_uprawnien', public.ud_lead_notatka(c2, 'nt-c2-eeeeeeee', tt.id_ines(), 'x')->>'status' = 'brak_uprawnien');
  perform tt.t('notatka: nieznany lead → brak_leada', public.ud_lead_notatka(gen_random_uuid(), 'nt-c2-ffffffff', tt.id_ula(), 'x')->>'status' = 'brak_leada');
  perform tt.t('notatka: klucz użyty wcześniej do przeniesienia → klucz_uzyty', public.ud_lead_notatka(c2, 'mv-c2-aaaaaaaa', tt.id_ula(), 'x')->>'status' = 'klucz_uzyty');

  r := public.ud_lead_szczegoly(c2);
  perform tt.t('szczegóły: kontakt, zawód, notatki i historia z nazwami etapów',
    r->>'email' = 'bartek@x.pl' and r->'kontakt'->>'zawod' = 'Kierowca'
    and jsonb_array_length(r->'notatki') = 2
    and exists (select 1 from jsonb_array_elements(r->'historia') h where h->>'z_etap' = 'Oferta' and h->>'do_etap' = 'Decyzja klienta'));
  perform tt.t('szczegóły: bez PESEL-u', r::text not like '%81010112345%' and not (r ? 'pesel'));
  perform tt.t('szczegóły: nieznany lead → null', public.ud_lead_szczegoly(gen_random_uuid()) is null);
end $$;

-- ─── 7. Archiwizacja ────────────────────────────────────────────────────────
do $$
declare
  c5 uuid := tt.lead('Ewa Archiwalna'); v int; r jsonb; h int;
begin
  v := tt.wersja(c5);
  r := public.ud_lead_zmien('archiwizuj', c5, v, 'ar-c5-aaaaaaaa', tt.id_ula(), '{}');
  perform tt.t('archiwizacja: lead znika z widoku, wiersz zostaje', r->>'status' = 'ok' and (r->>'zarchiwizowano')::boolean
    and not exists (select 1 from public.ud_leady_baza where id = c5) and exists (select 1 from public.ud_leady where id = c5 and zarchiwizowano_at is not null));
  perform tt.t('archiwizacja: znika z liczników (Nowy: 3)',
    (select ile_wszystkich from public.ud_leady_liczniki(tt.pipeline(), '{}', tt.id_ula()) where etap_id = tt.etap('nowy')) = 3);
  h := tt.hist(c5);
  r := public.ud_lead_zmien('archiwizuj', c5, v, 'ar-c5-aaaaaaaa', tt.id_ula(), '{}');
  perform tt.t('archiwizacja: ponowienie → ok/powtorzone, bez drugiego wpisu', r->>'status' = 'ok' and (r->>'powtorzone')::boolean and tt.hist(c5) = h);
  r := public.ud_lead_zmien('przenies', c5, v + 1, 'ar-c5-bbbbbbbb', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('zarchiwizowany lead nie daje się przenieść', r->>'status' = 'brak_leada');
  perform tt.t('zarchiwizowany lead nie ma szczegółów', public.ud_lead_szczegoly(c5) is null);
  perform tt.t('synchronizacja nie wskrzesza zarchiwizowanego leada',
    (public.ud_leady_synchronizuj()->>'klienci')::int = 0 and not exists (select 1 from public.ud_leady_baza where id = c5));
  perform tt.t('notatka do zarchiwizowanego leada → brak_leada', public.ud_lead_notatka(c5, 'nt-c5-aaaaaaaa', tt.id_ula(), 'x')->>'status' = 'brak_leada');
end $$;

-- ─── 8. Osobisty stan zwinięcia ─────────────────────────────────────────────
do $$
declare
  p uuid := tt.pipeline(); w uuid[]; inny_etap uuid; wyjatek boolean;
begin
  w := public.ud_leady_zwin(tt.id_ula(), p, tt.etap('nowy'), true);
  perform tt.t('zwijanie: dodaje etap', w = array[tt.etap('nowy')]);
  w := public.ud_leady_zwin(tt.id_ula(), p, tt.etap('nowy'), true);
  perform tt.t('zwijanie: powtórka nie dubluje', cardinality(w) = 1);
  w := public.ud_leady_zwin(tt.id_ula(), p, tt.etap('oferta'), true);
  perform tt.t('zwijanie: dwa etapy', w @> array[tt.etap('nowy'), tt.etap('oferta')] and cardinality(w) = 2);
  perform tt.t('zwijanie: osobno dla użytkownika — Olek nie ma zwiniętych',
    (select count(*) from public.ud_leady_widok_uzytkownika where user_id = tt.id_olek()) = 0);
  w := public.ud_leady_zwin(tt.id_olek(), p, tt.etap('decyzja'), true);
  perform tt.t('zwijanie: stan Oleka nie dotyka stanu Uli',
    w = array[tt.etap('decyzja')] and (select zwiniete from public.ud_leady_widok_uzytkownika where user_id = tt.id_ula()) @> array[tt.etap('nowy')]);
  w := public.ud_leady_zwin(tt.id_ula(), p, tt.etap('nowy'), false);
  perform tt.t('rozwijanie: zdejmuje etap', w = array[tt.etap('oferta')]);
  w := public.ud_leady_zwin(tt.id_ula(), p, null, false);
  perform tt.t('rozwiń wszystkie: pusty zbiór', cardinality(w) = 0);
  perform tt.t('zwijanie nie zmienia danych leadów ani kolejności etapów',
    (select array_agg(klucz order by pozycja) from public.ud_leady_etap where pipeline_id = p) = array['nowy','kontakt','oferta','decyzja','wygrany','przegrany']
    and (select count(*) from public.ud_leady) = 8);

  insert into public.ud_leady_etap (pipeline_id, klucz, nazwa, pozycja)
    select id, 'obcy2', 'Obcy', 10 from public.ud_leady_pipeline where klucz = 'inny' returning id into inny_etap;
  wyjatek := false;
  begin perform public.ud_leady_zwin(tt.id_ula(), p, inny_etap, true); exception when invalid_parameter_value then wyjatek := true; end;
  perform tt.t('zwijanie: etap z innego pipeline''u odrzucony', wyjatek);
  wyjatek := false;
  begin perform public.ud_leady_zwin(tt.id_ula(), p, tt.etap('kontakt'), true); exception when invalid_parameter_value then wyjatek := true; end;
  perform tt.t('zwijanie: wyłączony etap (Kontakt) odrzucony', wyjatek);
  wyjatek := false;
  begin perform public.ud_leady_zwin(tt.id_ines(), p, tt.etap('nowy'), true); exception when insufficient_privilege then wyjatek := true; end;
  perform tt.t('zwijanie: nieaktywny agent odrzucony', wyjatek);
end $$;

-- ─── 9. Porzucone wnioski nie są leadami (decyzja z 02.10.2026) ────────────
do $$
declare ok boolean;
begin
  perform tt.t('szkice: żaden nie ma leada, synchronizacja ich nie dokłada',
    (public.ud_leady_synchronizuj()->>'klienci')::int = 0 and not exists (select 1 from public.ud_leady where szkic_id is not null));
  ok := false;
  begin
    insert into public.ud_leady (pipeline_id, etap_id, szkic_id)
      values (tt.pipeline(), tt.etap('nowy'), '50000000-0000-0000-0000-000000000001');
  exception when check_violation then ok := true;
  end;
  perform tt.t('szkice: bezpośredni zapis leada ze szkicu odrzuca baza', ok);
end $$;

-- Ukończenie wniosku: działa bez żadnego wyzwalacza; klient staje się leadem
-- przy najbliższej synchronizacji, a retencja szkicu go nie rusza.
insert into public.ud_wnioski_szkice (id, created_at, updated_at, ostatni_krok, imie, email, phone, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
  ('50000000-0000-0000-0000-000000000006', now() - interval '2 hours', now() - interval '1 hour', 'zakres', 'Ignacy Ukończy', 'ignacy@x.pl', '444555666', true, 'v1', 'treść', now() - interval '2 hours');
do $$
declare s uuid := '50000000-0000-0000-0000-000000000006'; klient uuid := 'c0000000-0000-0000-0000-000000000009';
begin
  perform public.ud_leady_synchronizuj();
  perform tt.t('szkic ze zgodą nie dostaje leada', not exists (select 1 from public.ud_leady where szkic_id = s));
  insert into public.ud_clients (id, full_name, email, phone, source, risk_temp_incapacity, temp_incapacity_sum)
    values (klient, 'Ignacy Ukończyłem', 'IGNACY@x.pl', '444555666', 'form', true, '9000');
  perform public.ud_wnioski_szkic_ukoncz(s);
  perform tt.t('ukończenie: szkic zamknięty i powiązany z klientem, dane kontaktowe usunięte',
    (select ukonczony_at is not null and client_id = klient and email is null from public.ud_wnioski_szkice where id = s));
  perform tt.t('ukończenie: synchronizacja dokłada klienta', (public.ud_leady_synchronizuj()->>'klienci')::int = 1);
  perform tt.t('ukończenie: klient jest leadem w Nowym', tt.etap_leada((select id from public.ud_leady where klient_id = klient)) = 'nowy');
end $$;
update public.ud_wnioski_szkice set updated_at = now() - interval '40 days' where id = '50000000-0000-0000-0000-000000000006';
select public.ud_wnioski_szkice_retencja();
do $$
begin
  perform tt.t('retencja: szkic usunięty, lead klienta przeżywa',
    not exists (select 1 from public.ud_wnioski_szkice where id = '50000000-0000-0000-0000-000000000006')
    and exists (select 1 from public.ud_leady where klient_id = 'c0000000-0000-0000-0000-000000000009'));
end $$;

-- Usunięcie klienta z kartoteki usuwa lead (prawo do usunięcia danych).
do $$
declare k uuid := 'c0000000-0000-0000-0000-000000000006'; ls uuid;
begin
  select id into ls from public.ud_leady where klient_id = k;
  perform public.ud_lead_notatka(ls, 'nt-k6-aaaaaaaa', tt.id_ula(), 'notatka o kliencie');
  delete from public.ud_offers where client_id = k;
  delete from public.ud_clients where id = k;
  perform tt.t('usunięcie klienta: lead, notatki i historia znikają', not exists (select 1 from public.ud_leady where id = ls)
    and not exists (select 1 from public.ud_leady_notatki where lead_id = ls));
end $$;

-- Tablica nie dotyka ścieżki zapisu wniosku: żadnych wyzwalaczy — ani na ud_clients,
-- ani (od części 3) na szkicach.
do $$
begin
  perform tt.t('ud_clients nie ma żadnych wyzwalaczy',
    not exists (select 1 from pg_trigger t where t.tgrelid = 'public.ud_clients'::regclass and not t.tgisinternal));
  perform tt.t('tablica leadów nie ma żadnego wyzwalacza (także na szkicach)',
    not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                 where not t.tgisinternal and (p.proname like 'ud_lead%' or t.tgrelid = 'public.ud_wnioski_szkice'::regclass)));
end $$;

-- Dwa pipeline'y: kolumna leadów jednego nie miesza się z drugim.
do $$
begin
  perform tt.t('liczniki innego pipeline''u: tylko jego etapy, bez leadów',
    (select count(*) from public.ud_leady_liczniki((select id from public.ud_leady_pipeline where klucz = 'inny'), '{}', tt.id_ula())) = 2
    and (select sum(ile_wszystkich) from public.ud_leady_liczniki((select id from public.ud_leady_pipeline where klucz = 'inny'), '{}', tt.id_ula())) = 0);
end $$;

-- ─── Plan tablicy ───────────────────────────────────────────────────────────
do $$
declare pl jsonb; p uuid := tt.pipeline();
begin
  perform public.ud_leady_zwin(tt.id_ula(), p, tt.etap('oferta'), true);
  pl := public.ud_leady_plan(tt.id_ula(), null);
  perform tt.t('plan: rola, pipeline, pięć etapów w kolejności (bez Kontaktu)',
    pl->>'rola' = 'user' and pl->'pipeline'->>'klucz' = 'sprzedaz'
    and (select array_agg(e->>'klucz' order by o) from jsonb_array_elements(pl->'etapy') with ordinality t(e, o))
        = array['nowy', 'oferta', 'decyzja', 'wygrany', 'przegrany']);
  perform tt.t('plan: etap „Wygrany" wymaga składki rocznej', (select e->'wymagane_pola' from jsonb_array_elements(pl->'etapy') e where e->>'klucz' = 'wygrany') = '["skladka_roczna"]'::jsonb);
  perform tt.t('plan: zwinięte etapy tego użytkownika', pl->'zwiniete' = jsonb_build_array(tt.etap('oferta')));
  perform tt.t('plan: inny użytkownik ma własne zwinięcia (Olek: tylko Decyzja)', public.ud_leady_plan(tt.id_olek(), null)->'zwiniete' = jsonb_build_array(tt.etap('decyzja')));
  perform tt.t('plan: etap „Przegrany" niesie wymagane pola', (select e->'wymagane_pola' from jsonb_array_elements(pl->'etapy') e where e->>'klucz' = 'przegrany') = '["powod_utraty"]'::jsonb);
  perform tt.t('plan: lista agentów bez nieaktywnych', jsonb_array_length(pl->'agenci') = 3 and pl::text not like '%Ines%');
  perform tt.t('plan: nieznany pipeline → domyślny', public.ud_leady_plan(tt.id_ula(), gen_random_uuid())->'pipeline'->>'klucz' = 'sprzedaz');
  perform tt.t('plan: nieaktywny agent i obcy uuid → null', public.ud_leady_plan(tt.id_ines(), null) is null and public.ud_leady_plan(gen_random_uuid(), null) is null);
  update public.ud_leady_etap set aktywny = false where id = tt.etap('oferta');
  perform tt.t('plan: wyłączony etap znika z planu i ze zwiniętych',
    jsonb_array_length(public.ud_leady_plan(tt.id_ula(), null)->'etapy') = 4 and public.ud_leady_plan(tt.id_ula(), null)->'zwiniete' = '[]'::jsonb);
  update public.ud_leady_etap set aktywny = true where id = tt.etap('oferta');
end $$;

-- ─── 10. Dane sprzedaży i statystyki ───────────────────────────────────────
-- Stan wejściowy: Celina w Wygrany z danymi z wariantu (bez opiekuna), Bartek
-- w Decyzji (opiekun Ula), Darek w Ofercie (opiekun Olek), Gabriel w Nowym
-- (bez opiekuna), Anna w Nowym, Ignacy w Nowym.
do $$
declare
  c2 uuid := tt.lead('Bartek Nowak'); c4 uuid := tt.lead('Darek Decyzja'); c7 uuid := tt.lead('Gabriel Podkreślnik');
  c1 uuid := tt.lead('Anna Kowalska');
  r jsonb; v int; h int;
  wyg uuid := tt.etap('wygrany');
begin
  -- Wejście do Wygrany wymaga składki rocznej.
  v := tt.wersja(c4);
  r := public.ud_lead_zmien('przenies', c4, v, 'sp-c4-brak-aaaa', tt.id_olek(), jsonb_build_object('etap_id', wyg));
  perform tt.t('sprzedaż: Wygrany bez składki → brak_danych, lead bez zmian',
    r->>'status' = 'brak_danych' and r->'pola' = '["skladka_roczna"]'::jsonb and tt.etap_leada(c4) = 'oferta' and tt.wersja(c4) = v);
  r := public.ud_lead_zmien('przenies', c4, v, 'sp-c4-abc-aaaaa', tt.id_olek(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object('skladka_roczna', 'abc')));
  perform tt.t('sprzedaż: kwota „abc" → błędne dane', r->>'status' = 'bledne_dane' and tt.etap_leada(c4) = 'oferta');
  r := public.ud_lead_zmien('przenies', c4, v, 'sp-c4-zero-aaaa', tt.id_olek(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object('skladka_roczna', 0)));
  perform tt.t('sprzedaż: kwota 0 → błędne dane', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('przenies', c4, v, 'sp-c4-minus-aaa', tt.id_olek(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object('skladka_roczna', '-5')));
  perform tt.t('sprzedaż: kwota ujemna → błędne dane', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('przenies', c4, v, 'sp-c4-cudzy-aaa', tt.id_olek(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object('skladka_roczna', 4200,
                            'wariant_id', '0d000000-0000-0000-0000-00000000002b')));
  perform tt.t('sprzedaż: wariant z oferty innego klienta → błędne dane', r->>'status' = 'bledne_dane' and tt.etap_leada(c4) = 'oferta');
  perform tt.t('sprzedaż: odrzucone żądania nie zostawiają historii',
    not exists (select 1 from public.ud_leady_historia where klucz like 'sp-c4-%'));

  r := public.ud_lead_zmien('przenies', c4, v, 'sp-c4-ok-aaaaaa', tt.id_olek(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object('skladka_roczna', 2400)));
  perform tt.t('sprzedaż: sama składka roczna wystarcza; sprzedawca = opiekun (Olek)',
    r->>'status' = 'ok' and tt.etap_leada(c4) = 'wygrany'
    and (select skladka_roczna = 2400 and skladka_mies is null and sprzedawca_id = tt.id_olek() and sprzedano_at is not null
           from public.ud_leady where id = c4));

  -- Wariant z ofert klienta, kwoty tekstem jak z formularza.
  r := public.ud_lead_zmien('przenies', c2, tt.wersja(c2), 'sp-c2-ok-aaaaaa', tt.id_adm(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object(
           'wariant_id', '0d000000-0000-0000-0000-00000000002a', 'skladka_roczna', '3 036,00 zł', 'skladka_mies', '253',
           'swiadczenie_okresowa', 10000)));
  perform tt.t('sprzedaż: wariant klienta i kwoty tekstem; sprzedawca = opiekun (Ula), nie wykonawca (admin)',
    r->>'status' = 'ok' and (r->'lead'->'sprzedaz'->>'skladka_roczna')::numeric = 3036
    and (select sprzedaz_wariant_id = '0d000000-0000-0000-0000-00000000002a' and skladka_mies = 253
                and swiadczenie_okresowa = 10000 and sprzedawca_id = tt.id_ula() from public.ud_leady where id = c2));
  perform tt.t('sprzedaż: historia zapisuje dane sprzedaży',
    exists (select 1 from public.ud_leady_historia where lead_id = c2 and klucz = 'sp-c2-ok-aaaaaa'
              and (dane->'sprzedaz'->>'skladka_roczna')::numeric = 3036));
  r := public.ud_lead_zmien('przenies', c2, tt.wersja(c2) - 1, 'sp-c2-ok-aaaaaa', tt.id_adm(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object(
           'wariant_id', '0d000000-0000-0000-0000-00000000002a', 'skladka_roczna', 3036, 'skladka_mies', 253,
           'swiadczenie_okresowa', '10 000')));
  perform tt.t('sprzedaż: ponowienie z tymi samymi kwotami w innym zapisie → powtórzone', r->>'status' = 'ok' and (r->>'powtorzone')::boolean);

  -- Lead bez opiekuna: sprzedawca = ten, kto przeniósł.
  r := public.ud_lead_zmien('przenies', c7, tt.wersja(c7), 'sp-c7-ok-aaaaaa', tt.id_ula(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object('skladka_roczna', 1200)));
  perform tt.t('sprzedaż: lead bez opiekuna → sprzedawcą jest przenoszący',
    r->>'status' = 'ok' and (select sprzedawca_id from public.ud_leady where id = c7) = tt.id_ula());

  -- Uzupełnienie / poprawka danych w Wygrany.
  v := tt.wersja(c7); h := tt.hist(c7);
  r := public.ud_lead_zmien('sprzedaz', c7, v, 'sp-c7-mies-aaaa', tt.id_ula(), jsonb_build_object('skladka_roczna', 1200, 'skladka_mies', 110));
  perform tt.t('sprzedaż: poprawka — wersja +1, wpis „sprzedaz" z poprzednimi kwotami',
    r->>'status' = 'ok' and tt.wersja(c7) = v + 1 and tt.hist(c7) = h + 1
    and exists (select 1 from public.ud_leady_historia where lead_id = c7 and typ = 'sprzedaz'
                  and (dane->'poprzednia_sprzedaz'->>'skladka_roczna')::numeric = 1200));
  r := public.ud_lead_zmien('sprzedaz', c7, v + 1, 'sp-c7-same-aaaa', tt.id_ula(), jsonb_build_object('skladka_roczna', 1200, 'skladka_mies', 110));
  perform tt.t('sprzedaż: te same kwoty → bez_zmiany', r->>'status' = 'bez_zmiany' and tt.wersja(c7) = v + 1);
  r := public.ud_lead_zmien('sprzedaz', c7, v + 1, 'sp-c7-bez-aaaaa', tt.id_ula(), jsonb_build_object('skladka_mies', 110));
  perform tt.t('sprzedaż: poprawka bez składki rocznej → brak_danych', r->>'status' = 'brak_danych');
  r := public.ud_lead_zmien('sprzedaz', c1, tt.wersja(c1), 'sp-c1-nie-aaaaa', tt.id_ula(), jsonb_build_object('skladka_roczna', 100));
  perform tt.t('sprzedaż: dane sprzedaży poza Wygrany → niedozwolony', r->>'status' = 'niedozwolony');

  -- Kupiona oferta bez zapisanego wyboru: Wygrany „bez danych", do uzupełnienia.
  insert into public.ud_clients (id, created_at, full_name, email, source) values
    ('c0000000-0000-0000-0000-00000000000d', now() - interval '3 days', 'Olga Bezdanych', 'olga@x.pl', 'form');
  insert into public.ud_offers (user_id, client_id, status, created_at, decided_at) values
    ('a0000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-00000000000d', 'bought', now() - interval '3 days', now() - interval '2 days');
  perform public.ud_leady_synchronizuj();
  perform tt.t('sync: kupiona bez wyboru wariantu → Wygrany bez danych sprzedaży',
    tt.etap_leada(tt.lead('Olga Bezdanych')) = 'wygrany'
    and (select skladka_roczna is null and sprzedawca_id is null from public.ud_leady where id = tt.lead('Olga Bezdanych')));

  -- Opiekun-administrator: karta to mówi (panel go wtedy nie pokazuje).
  perform public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-admin-aaa', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_adm()));
  perform tt.t('karta: opiekun-administrator oznaczony', public.ud_lead_karta(c1)->'opiekun_admin' = 'true'::jsonb
    and public.ud_lead_karta(c1)->>'opiekun_nazwa' = 'Ada Admin');
end $$;

do $$
declare
  st jsonb; a jsonb;
  c7 uuid := tt.lead('Gabriel Podkreślnik');
begin
  -- Wygrane: Celina 6000/500 (bez opiekuna), Bartek 3036/253 (Ula), Darek 2400/— (Olek),
  -- Gabriel 1200/110 (Ula), Olga bez danych (opiekun Olek z oferty).
  st := public.ud_leady_statystyki(tt.id_adm());
  perform tt.t('statystyki admina: liczba sprzedaży i komplet danych',
    (st->'podsumowanie'->>'sprzedaze')::int = 5 and (st->'podsumowanie'->>'z_danymi')::int = 4);
  perform tt.t('statystyki admina: składka roczna (suma) = 12636',
    (st->'podsumowanie'->>'skladka_roczna_suma')::numeric = 12636);
  perform tt.t('statystyki admina: składki miesięczne — suma 1063 (Darek 2400/12 = 200), średnia 265.75, 1 wyliczona',
    (st->'podsumowanie'->>'skladka_mies_suma')::numeric = 1063 and (st->'podsumowanie'->>'skladka_mies_srednia')::numeric = 265.75
    and (st->'podsumowanie'->>'skladka_mies_wyliczonych')::int = 1);
  perform tt.t('statystyki admina: świadczenia per ryzyko (łącznie, średnio)',
    (st->'podsumowanie'->'okresowa'->>'n')::int = 2 and (st->'podsumowanie'->'okresowa'->>'suma')::numeric = 18000
    and (st->'podsumowanie'->'okresowa'->>'srednia')::numeric = 9000
    and (st->'podsumowanie'->'zgon'->>'suma')::numeric = 50000 and (st->'podsumowanie'->'trwala'->>'n')::int = 0);
  perform tt.t('statystyki admina: lista „bez danych" = Olga',
    (select array_agg(x->>'nazwa') from jsonb_array_elements(st->'bez_danych') x) = array['Olga Bezdanych']);
  perform tt.t('statystyki admina: podział na agentów (Bez opiekuna 6000, Ula 4236, Olek 2400 + Olga)',
    (select jsonb_agg(jsonb_build_array(x->>'nazwa', (x->>'sprzedaze')::int, (x->>'skladka_roczna_suma')::numeric))
       from jsonb_array_elements(st->'wg_agentow') x)
    = '[["Bez opiekuna", 1, 6000], ["Ula Agent", 2, 4236], ["Olek Agent", 2, 2400]]'::jsonb);
  perform tt.t('statystyki admina: lista agentów do wyboru', jsonb_array_length(st->'agenci') = 3);

  st := public.ud_leady_statystyki(tt.id_adm(), null, null, tt.id_olek());
  perform tt.t('statystyki admina dla wybranego agenta (Olek): tylko jego, bez podziału',
    (st->'podsumowanie'->>'sprzedaze')::int = 2 and (st->'podsumowanie'->>'skladka_roczna_suma')::numeric = 2400
    and st->'wg_agentow' = 'null'::jsonb);

  st := public.ud_leady_statystyki(tt.id_ula(), null, null, tt.id_olek());
  perform tt.t('statystyki agenta: wyłącznie swoje, nawet gdy prosi o cudze',
    (st->'podsumowanie'->>'sprzedaze')::int = 2 and (st->'podsumowanie'->>'skladka_roczna_suma')::numeric = 4236
    and st->>'agent' = tt.id_ula()::text and st->'wg_agentow' = 'null'::jsonb and st->'agenci' = 'null'::jsonb);
  perform tt.t('statystyki: nieaktywny agent i obcy → null',
    public.ud_leady_statystyki(tt.id_ines()) is null and public.ud_leady_statystyki(gen_random_uuid()) is null);
  perform tt.t('statystyki: okres w przyszłości → zero sprzedaży',
    (public.ud_leady_statystyki(tt.id_adm(), now() + interval '1 day', null)->'podsumowanie'->>'sprzedaze')::int = 0);

  -- Archiwizacja nie kasuje sprzedaży ze statystyk.
  perform public.ud_lead_zmien('archiwizuj', c7, tt.wersja(c7), 'ar-c7-aaaaaaaa', tt.id_ula(), '{}');
  perform tt.t('statystyki: zarchiwizowana sprzedaż dalej się liczy',
    (public.ud_leady_statystyki(tt.id_ula())->'podsumowanie'->>'sprzedaze')::int = 2);
  perform tt.t('liczniki: składki w Wygrany bez zarchiwizowanych (6000 + 3036 + 2400)',
    (select skladki_wszystkich from public.ud_leady_liczniki(tt.pipeline(), '{}', tt.id_ula()) where etap_id = tt.etap('wygrany')) = 11436);
end $$;

-- ─── Podsumowanie ───────────────────────────────────────────────────────────
select format('WYNIK: %s PASS, %s FAIL', count(*) filter (where ok), count(*) filter (where not ok)) from tt.wyniki;
