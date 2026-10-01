-- Testy SQL tablicy leadów. Uruchamia je apps/panel/scripts/test-leady-sql.mjs
-- na jednorazowym klastrze, po stub.sql, obu migracjach (szkice + leady),
-- pomocnicze.sql i fixture.sql.

-- ─── 1. Synchronizacja ──────────────────────────────────────────────────────
do $$
declare
  w jsonb; w2 jsonb;
begin
  w := public.ud_leady_synchronizuj();
  perform tt.t('sync: 8 klientów i 1 szkic ze zgodą', (w->>'klienci')::int = 8 and (w->>'szkice')::int = 1);
  w2 := public.ud_leady_synchronizuj();
  perform tt.t('sync: drugie wywołanie niczego nie dokłada (idempotencja)',
               (w2->>'klienci')::int = 0 and (w2->>'szkice')::int = 0 and (select count(*) from public.ud_leady) = 9);

  perform tt.t('sync: klient bez ofert → Nowy',                  tt.etap_leada(tt.lead('Anna Kowalska')) = 'nowy');
  perform tt.t('sync: oferta wysłana → Oferta',                  tt.etap_leada(tt.lead('Bartek Nowak')) = 'oferta');
  perform tt.t('sync: kupiona (nawet zarchiwizowana) → Wygrany', tt.etap_leada(tt.lead('Celina Wygrana')) = 'wygrany');
  perform tt.t('sync: wybór klienta → Decyzja klienta',          tt.etap_leada(tt.lead('Darek Decyzja')) = 'decyzja');
  perform tt.t('sync: zarchiwizowana wysłana oferta nie liczy się → Nowy', tt.etap_leada(tt.lead('Ewa Archiwalna')) = 'nowy');
  perform tt.t('sync: odrzucona → Przegrany z powodem',
               tt.etap_leada(tt.lead('Filip Odrzucony')) = 'przegrany'
               and (select powod_utraty from public.ud_leady where id = tt.lead('Filip Odrzucony')) is not null);
  perform tt.t('sync: oferta robocza → Kontakt',                 tt.etap_leada(tt.lead('Hanna Szkicowa')) = 'kontakt');
  perform tt.t('sync: szkic ze zgodą → Nowy',                    tt.etap_leada(tt.lead('Szymon Szkic')) = 'nowy');

  perform tt.t('sync: opiekun z referred_by',
               (select opiekun_id from public.ud_leady where id = tt.lead('Bartek Nowak')) = tt.id_ula());
  perform tt.t('sync: opiekun z użytkownika oferty',
               (select opiekun_id from public.ud_leady where id = tt.lead('Darek Decyzja')) = tt.id_olek());
  perform tt.t('sync: nieaktywny agent nie zostaje opiekunem',
               (select opiekun_id from public.ud_leady where id = tt.lead('Hanna Szkicowa')) is null);

  perform tt.t('sync: szkic bez zgody nie jest leadem', not exists (select 1 from public.ud_leady where szkic_id = '50000000-0000-0000-0000-000000000002'));
  perform tt.t('sync: ukończony szkic nie jest leadem',  not exists (select 1 from public.ud_leady where szkic_id = '50000000-0000-0000-0000-000000000003'));
  perform tt.t('sync: szkic z wycofaną zgodą nie jest leadem', not exists (select 1 from public.ud_leady where szkic_id = '50000000-0000-0000-0000-000000000004'));
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
  k := public.ud_lead_karta(tt.lead('Szymon Szkic'));
  perform tt.t('karta szkicu: krok i data usunięcia danych, bez wartości',
               (k->>'krok_nr')::int = 1 and k->>'dane_do' is not null and k->>'wartosc' is null and k->>'zrodlo' = 'szkic');

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

  foreach r in array array['ud_lead_zmien', 'ud_lead_notatka', 'ud_leady_synchronizuj', 'ud_leady_kolumna', 'ud_leady_liczniki', 'ud_lead_szczegoly', 'ud_leady_zwin']
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

-- Wartości do testu sum: Anna 8000, Gabriel 12000, Ewa 5000 (bez znacznika ryzyka), szkic bez kwoty.
do $$
declare
  p uuid := tt.pipeline();
  strona jsonb;
  s1 uuid[]; s2 uuid[]; wszystkie uuid[];
begin
  -- Liczniki bez filtra.
  perform tt.t('liczniki: bez filtra — rozkład po etapach',
    (select jsonb_object_agg(e.klucz, l.ile) from public.ud_leady_liczniki(p, '{}', tt.id_ula()) l join public.ud_leady_etap e on e.id = l.etap_id)
    = '{"nowy":4,"kontakt":1,"oferta":1,"decyzja":1,"wygrany":1,"przegrany":1}'::jsonb);
  perform tt.t('liczniki: sumy bez filtra (Nowy = 8000 + 5000 + 12000)',
    (select suma from public.ud_leady_liczniki(p, '{}', tt.id_ula()) where etap_id = tt.etap('nowy')) = 25000);

  -- Filtry.
  perform tt.t('filtr opiekun=ja', (select sum(ile) from public.ud_leady_liczniki(p, '{"opiekun":"ja"}', tt.id_ula())) = 1);
  perform tt.t('filtr opiekun=brak', (select sum(ile) from public.ud_leady_liczniki(p, '{"opiekun":"brak"}', tt.id_ula())) = 7);
  perform tt.t('filtr opiekun=<uuid>', (select sum(ile) from public.ud_leady_liczniki(p, jsonb_build_object('opiekun', tt.id_olek()), tt.id_ula())) = 1);
  perform tt.t('filtr źródło=direct', (select sum(ile) from public.ud_leady_liczniki(p, '{"zrodlo":"direct"}', tt.id_ula())) = 2);
  perform tt.t('filtr źródło=szkic',  (select sum(ile) from public.ud_leady_liczniki(p, '{"zrodlo":"szkic"}', tt.id_ula())) = 1);
  perform tt.t('filtr produkt=okresowa', (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"okresowa"}', tt.id_ula())) = 4);
  perform tt.t('filtr produkt=trwala',   (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"trwala"}', tt.id_ula())) = 1);
  perform tt.t('filtr produkt=zgon',     (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"zgon"}', tt.id_ula())) = 1);
  perform tt.t('filtr produkt=nieznany', (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"nieznany"}', tt.id_ula())) = 5);
  perform tt.t('filtr termin=brak', (select sum(ile) from public.ud_leady_liczniki(p, '{"termin":"brak"}', tt.id_ula())) = 6);
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
  perform tt.t('q: telefon szkicu ze spacjami',         (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"600 700 8"}', tt.id_ula())) = array['Szymon Szkic']);
  perform tt.t('q: "%" nie jest wzorcem',               (select count(*) from public.ud_leady_dopasowane(p, '{"q":"%"}', tt.id_ula())) = 0);
  perform tt.t('q: "_" trafia tylko w literalny podkreślnik', (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"_"}', tt.id_ula())) = array['Gabriel Podkreślnik']);
  perform tt.t('q: "a%b" nie jest wzorcem',             (select count(*) from public.ud_leady_dopasowane(p, '{"q":"a%b"}', tt.id_ula())) = 0);
  perform tt.t('q: puste = bez filtra',                 (select count(*) from public.ud_leady_dopasowane(p, '{"q":"   "}', tt.id_ula())) = 9);

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
  perform tt.t('sort: data — najnowsze pierwsze (szkic, potem Gabriel, Ewa, Anna)',
    (select array_agg(k->>'nazwa' order by o) from jsonb_array_elements(strona->'karty') with ordinality as t(k, o))
    = array['Szymon Szkic', 'Gabriel Podkreślnik', 'Ewa Archiwalna', 'Anna Kowalska']);

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
    = '{"nowy":4,"kontakt":1,"oferta":0,"decyzja":2,"wygrany":1,"przegrany":1}'::jsonb);

  -- K21: ponowienie z tym samym kluczem po utracie odpowiedzi.
  v := tt.wersja(c2); h := tt.hist(c2);
  r := public.ud_lead_zmien('przenies', c2, v - 1, 'mv-c2-aaaaaaaa', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('decyzja')));
  perform tt.t('K21: ponowienie (nawet ze starą wersją) → ok/powtorzone, bez drugiego skutku',
    r->>'status' = 'ok' and (r->>'powtorzone')::boolean and tt.wersja(c2) = v and tt.hist(c2) = h);
  r := public.ud_lead_zmien('przenies', c2, v - 1, 'mv-c2-aaaaaaaa', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('kontakt')));
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
  r := public.ud_lead_zmien('przenies', c1, tt.wersja(c1), 'mv-c1-nie-przegr', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('kontakt'), 'powod_utraty', 'zbędny'));
  perform tt.t('powód podany przy etapie, który go nie wymaga, nie jest zapisywany',
    r->>'status' = 'ok' and (select powod_utraty from public.ud_leady where id = c1) is null);
  perform tt.przenies(c1, 'nowy', 'mv-c1-powrot-2');

  -- Zamknięcie sprawy kasuje zaplanowane działanie (historia je pamięta).
  perform tt.ruch('dzialanie', c1, tt.wersja(c1), 'dz-c1-zamk-aaaa', tt.id_ula(), jsonb_build_object('typ', 'telefon', 'termin', now() + interval '2 days'));
  v := tt.wersja(c1);
  r := tt.przenies(c1, 'wygrany', 'mv-c1-wygr-aaaa');
  perform tt.t('Wygrany: kasuje zaplanowane działanie, wersja +1, historia pamięta poprzednie',
    r->>'status' = 'ok' and r->'lead'->'dzialanie' = 'null'::jsonb and tt.wersja(c1) = v + 1
    and exists (select 1 from public.ud_leady_historia where lead_id = c1 and klucz = 'mv-c1-wygr-aaaa' and dane->'zamkniete_dzialanie'->>'typ' = 'telefon'));
  r := tt.przenies(c1, 'nowy', 'mv-c1-wygr-bbbb');
  perform tt.t('powrót do etapu otwartego nie przywraca działania', r->>'status' = 'ok' and r->'lead'->'dzialanie' = 'null'::jsonb);

  -- K12: niedozwolony etap — także bezpośrednio przez funkcję (to jest to samo „API").
  insert into public.ud_leady_pipeline (klucz, nazwa) values ('inny', 'Inny') returning id into inny_pipe;
  insert into public.ud_leady_etap (pipeline_id, klucz, nazwa, pozycja) values (inny_pipe, 'obcy', 'Obcy', 10) returning id into inny_etap;
  v := tt.wersja(c1);
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-obcy-aaaaaaaa', tt.id_ula(), jsonb_build_object('etap_id', inny_etap));
  perform tt.t('K12: etap z innego pipeline''u → niedozwolony', r->>'status' = 'niedozwolony' and tt.etap_leada(c1) = 'nowy' and tt.wersja(c1) = v);
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-losowy-aaaaaa', tt.id_ula(), jsonb_build_object('etap_id', gen_random_uuid()));
  perform tt.t('K12: nieistniejący etap → niedozwolony', r->>'status' = 'niedozwolony');
  update public.ud_leady_etap set aktywny = false where id = tt.etap('kontakt');
  r := tt.przenies(c1, 'kontakt', 'mv-wylaczony-aa');
  perform tt.t('K12: wyłączony etap → niedozwolony', r->>'status' = 'niedozwolony' and tt.etap_leada(c1) = 'nowy');
  update public.ud_leady_etap set aktywny = true where id = tt.etap('kontakt');
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
  w := public.ud_leady_zwin(tt.id_ula(), p, tt.etap('kontakt'), true);
  perform tt.t('zwijanie: dodaje etap', w = array[tt.etap('kontakt')]);
  w := public.ud_leady_zwin(tt.id_ula(), p, tt.etap('kontakt'), true);
  perform tt.t('zwijanie: powtórka nie dubluje', cardinality(w) = 1);
  w := public.ud_leady_zwin(tt.id_ula(), p, tt.etap('oferta'), true);
  perform tt.t('zwijanie: dwa etapy', w @> array[tt.etap('kontakt'), tt.etap('oferta')] and cardinality(w) = 2);
  perform tt.t('zwijanie: osobno dla użytkownika — Olek nie ma zwiniętych',
    (select count(*) from public.ud_leady_widok_uzytkownika where user_id = tt.id_olek()) = 0);
  w := public.ud_leady_zwin(tt.id_olek(), p, tt.etap('decyzja'), true);
  perform tt.t('zwijanie: stan Oleka nie dotyka stanu Uli',
    w = array[tt.etap('decyzja')] and (select zwiniete from public.ud_leady_widok_uzytkownika where user_id = tt.id_ula()) @> array[tt.etap('kontakt')]);
  w := public.ud_leady_zwin(tt.id_ula(), p, tt.etap('kontakt'), false);
  perform tt.t('rozwijanie: zdejmuje etap', w = array[tt.etap('oferta')]);
  w := public.ud_leady_zwin(tt.id_ula(), p, null, false);
  perform tt.t('rozwiń wszystkie: pusty zbiór', cardinality(w) = 0);
  perform tt.t('zwijanie nie zmienia danych leadów ani kolejności etapów',
    (select array_agg(klucz order by pozycja) from public.ud_leady_etap where pipeline_id = p) = array['nowy','kontakt','oferta','decyzja','wygrany','przegrany']
    and (select count(*) from public.ud_leady) = 9);

  insert into public.ud_leady_etap (pipeline_id, klucz, nazwa, pozycja)
    select id, 'obcy2', 'Obcy', 10 from public.ud_leady_pipeline where klucz = 'inny' returning id into inny_etap;
  wyjatek := false;
  begin perform public.ud_leady_zwin(tt.id_ula(), p, inny_etap, true); exception when invalid_parameter_value then wyjatek := true; end;
  perform tt.t('zwijanie: etap z innego pipeline''u odrzucony', wyjatek);
  wyjatek := false;
  begin perform public.ud_leady_zwin(tt.id_ines(), p, tt.etap('kontakt'), true); exception when insufficient_privilege then wyjatek := true; end;
  perform tt.t('zwijanie: nieaktywny agent odrzucony', wyjatek);
end $$;

-- ─── 9. Szkice: zgoda, ukończenie, retencja, wyzwalacz ──────────────────────
do $$
declare
  s1 uuid := '50000000-0000-0000-0000-000000000001'; lead_s uuid; n int;
  k uuid;
begin
  -- Notatka na leadzie szkicu — ma zniknąć razem z nim.
  lead_s := tt.lead('Szymon Szkic');
  perform public.ud_lead_notatka(lead_s, 'nt-s1-aaaaaaaa', tt.id_ula(), 'Dzwoniłam, nie odebrał');
  perform tt.przenies(lead_s, 'kontakt', 'mv-s1-aaaaaaaa');

  -- Wycofanie zgody dokładnie tak, jak robi to funkcja brzegowa.
  update public.ud_wnioski_szkice
     set zgoda_kontakt = false, zgoda_wycofana_at = now(), imie = null, email = null, phone = null, updated_at = now()
   where id = s1;
  perform tt.t('wycofanie zgody: lead znika od razu (wyzwalacz)', not exists (select 1 from public.ud_leady where szkic_id = s1));
  perform tt.t('wycofanie zgody: notatki i historia znikają razem z leadem',
    not exists (select 1 from public.ud_leady_notatki where lead_id = lead_s) and not exists (select 1 from public.ud_leady_historia where lead_id = lead_s));
  perform tt.t('wycofanie zgody: synchronizacja go nie odtwarza', (public.ud_leady_synchronizuj()->>'szkice')::int = 0);
end $$;

-- Cofnięcie zaznaczenia zgody w kroku kontakt (bez wycofania z maila) też usuwa lead.
insert into public.ud_wnioski_szkice (id, ostatni_krok, imie, email, phone, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
  ('50000000-0000-0000-0000-000000000005', 'kontakt', 'Ola Odznacz', 'ola@x.pl', '111222333', true, 'v1', 'treść', now());
select public.ud_leady_synchronizuj();
do $$
declare s uuid := '50000000-0000-0000-0000-000000000005';
begin
  perform tt.t('szkic ze zgodą dostaje lead', exists (select 1 from public.ud_leady where szkic_id = s));
  update public.ud_wnioski_szkice set zgoda_kontakt = false, imie = null, email = null, phone = null where id = s;
  perform tt.t('cofnięcie zaznaczenia zgody: lead znika', not exists (select 1 from public.ud_leady where szkic_id = s));
end $$;

-- Ukończenie wniosku z dopasowanym klientem → lead przechodzi na klienta, notatki zostają.
insert into public.ud_wnioski_szkice (id, created_at, updated_at, ostatni_krok, imie, email, phone, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
  ('50000000-0000-0000-0000-000000000006', now() - interval '2 hours', now() - interval '1 hour', 'zakres', 'Ignacy Ukończy', 'ignacy@x.pl', '444555666', true, 'v1', 'treść', now() - interval '2 hours');
select public.ud_leady_synchronizuj();
do $$
declare s uuid := '50000000-0000-0000-0000-000000000006'; ls uuid; v int; klient uuid := 'c0000000-0000-0000-0000-000000000009';
begin
  select id into ls from public.ud_leady where szkic_id = s;
  perform public.ud_lead_notatka(ls, 'nt-s6-aaaaaaaa', tt.id_ula(), 'Obiecał dokończyć wieczorem');
  perform tt.przenies(ls, 'kontakt', 'mv-s6-aaaaaaaa');
  v := tt.wersja(ls);

  -- Klient składa wniosek (form-submit zapisuje ud_clients), potem kreator woła ukoncz.
  insert into public.ud_clients (id, full_name, email, phone, source, risk_temp_incapacity, temp_incapacity_sum)
    values (klient, 'Ignacy Ukończyłem', 'IGNACY@x.pl', '444555666', 'form', true, '9000');
  perform public.ud_wnioski_szkic_ukoncz(s);

  perform tt.t('ukończenie: ten sam lead przepięty na klienta (id leada bez zmian)',
    exists (select 1 from public.ud_leady where id = ls and klient_id = klient and szkic_id is null));
  perform tt.t('ukończenie: notatka, etap i historia zostają',
    (select count(*) from public.ud_leady_notatki where lead_id = ls) = 1 and tt.etap_leada(ls) = 'kontakt' and tt.hist(ls) >= 3);
  perform tt.t('ukończenie: wersja wzrosła (otwarte karty zgłoszą konflikt, nie nadpiszą)', tt.wersja(ls) = v + 1);
  perform tt.t('ukończenie: karta pokazuje już dane klienta i kwotę',
    (public.ud_lead_karta(ls)->>'nazwa') = 'Ignacy Ukończyłem' and (public.ud_lead_karta(ls)->>'wartosc')::numeric = 9000 and public.ud_lead_karta(ls)->>'dane_do' is null);
  perform tt.t('ukończenie: synchronizacja nie tworzy drugiego leada dla tego klienta',
    (public.ud_leady_synchronizuj()->>'klienci')::int = 0 and (select count(*) from public.ud_leady where klient_id = klient) = 1);
end $$;
update public.ud_wnioski_szkice set updated_at = now() - interval '40 days' where id = '50000000-0000-0000-0000-000000000006';
select public.ud_wnioski_szkice_retencja();
do $$
begin
  perform tt.t('retencja: szkic usunięty, lead klienta (z notatką) przeżywa',
    not exists (select 1 from public.ud_wnioski_szkice where id = '50000000-0000-0000-0000-000000000006')
    and exists (select 1 from public.ud_leady l join public.ud_leady_notatki n on n.lead_id = l.id where l.klient_id = 'c0000000-0000-0000-0000-000000000009'));
end $$;

-- Scalenie: lead klienta powstał (synchronizacja) zanim szkic został oznaczony jako ukończony.
insert into public.ud_wnioski_szkice (id, created_at, updated_at, ostatni_krok, imie, email, phone, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
  ('50000000-0000-0000-0000-000000000007', now() - interval '2 hours', now() - interval '1 hour', 'dane', 'Jola Dubel', 'jola@x.pl', '777888999', true, 'v1', 'treść', now() - interval '2 hours');
select public.ud_leady_synchronizuj();
do $$
declare s uuid := '50000000-0000-0000-0000-000000000007'; ls uuid; klient uuid := 'c0000000-0000-0000-0000-00000000000a'; lk uuid;
begin
  select id into ls from public.ud_leady where szkic_id = s;
  perform public.ud_lead_notatka(ls, 'nt-s7-aaaaaaaa', tt.id_ula(), 'Notatka ze szkicu');
  insert into public.ud_clients (id, full_name, email, source) values (klient, 'Jola Dubel', 'jola@x.pl', 'form');
  perform public.ud_leady_synchronizuj();                              -- lead klienta powstaje, szkic jeszcze „otwarty"
  select id into lk from public.ud_leady where klient_id = klient;
  perform tt.t('scalenie: przed ukończeniem są dwa leady (szkic i klient)', ls is not null and lk is not null and ls <> lk);
  perform public.ud_wnioski_szkic_ukoncz(s);
  perform tt.t('scalenie: zostaje jeden lead klienta, notatka ze szkicu do niego przeniesiona',
    not exists (select 1 from public.ud_leady where id = ls)
    and (select count(*) from public.ud_leady_notatki where lead_id = lk) = 1);
end $$;

-- Ukończenie bez dopasowanego klienta (inny e-mail) → lead znika, nie wisi bez tożsamości.
insert into public.ud_wnioski_szkice (id, ostatni_krok, imie, email, phone, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
  ('50000000-0000-0000-0000-000000000008', 'zdrowie', 'Kuba Bez Dopasowania', 'kuba@x.pl', '123123123', true, 'v1', 'treść', now());
select public.ud_leady_synchronizuj();
do $$
declare s uuid := '50000000-0000-0000-0000-000000000008';
begin
  perform tt.t('szkic ma lead przed ukończeniem', exists (select 1 from public.ud_leady where szkic_id = s));
  perform public.ud_wnioski_szkic_ukoncz(s);
  perform tt.t('ukończenie bez klienta: lead znika', not exists (select 1 from public.ud_leady where szkic_id = s));
end $$;

-- Retencja szkicu bez klienta: lead znika razem z nim (obietnica 30 dni).
insert into public.ud_wnioski_szkice (id, ostatni_krok, imie, email, phone, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
  ('50000000-0000-0000-0000-000000000009', 'kontakt', 'Lena Retencja', 'lena@x.pl', '321321321', true, 'v1', 'treść', now());
select public.ud_leady_synchronizuj();
do $$
declare s uuid := '50000000-0000-0000-0000-000000000009'; ls uuid;
begin
  select id into ls from public.ud_leady where szkic_id = s;
  perform public.ud_lead_notatka(ls, 'nt-s9-aaaaaaaa', tt.id_ula(), 'Do usunięcia razem ze szkicem');
  perform tt.t('retencja: dane szkicu żyją do updated_at + 30 dni', (public.ud_lead_karta(ls)->>'dane_do')::timestamptz > now() + interval '29 days');
  update public.ud_wnioski_szkice set updated_at = now() - interval '31 days' where id = s;
  perform public.ud_wnioski_szkice_retencja();
  perform tt.t('retencja: szkic > 30 dni → lead, notatki i historia znikają',
    not exists (select 1 from public.ud_leady where id = ls)
    and not exists (select 1 from public.ud_leady_notatki where lead_id = ls)
    and not exists (select 1 from public.ud_leady_historia where lead_id = ls));
end $$;

-- Wyzwalacz nie może zepsuć ukończenia wniosku — nawet gdy sam się wywróci.
begin;
create or replace function public.ud_leady_przepnij_szkic(p_szkic uuid, p_klient uuid) returns void language plpgsql as $$
begin raise exception 'awaria wyzwalacza (test)'; end $$;
insert into public.ud_wnioski_szkice (id, ostatni_krok, imie, email, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
  ('50000000-0000-0000-0000-00000000000b', 'dane', 'Wiktor Awaria', 'wiktor@x.pl', true, 'v1', 'treść', now());
insert into public.ud_clients (id, full_name, email, source) values ('c0000000-0000-0000-0000-00000000000b', 'Wiktor Awaria', 'wiktor@x.pl', 'form');
do $$
declare ok boolean := true;
begin
  begin
    perform public.ud_wnioski_szkic_ukoncz('50000000-0000-0000-0000-00000000000b');
  exception when others then ok := false;
  end;
  perform tt.t('wyzwalacz: awaria przepięcia NIE przerywa ukończenia wniosku',
    ok and (select ukonczony_at is not null and client_id = 'c0000000-0000-0000-0000-00000000000b'
              from public.ud_wnioski_szkice where id = '50000000-0000-0000-0000-00000000000b'));
end $$;
rollback;

-- Siatka bezpieczeństwa: bez wyzwalacza widok i tak nie pokazuje danych szkicu bez zgody.
insert into public.ud_wnioski_szkice (id, ostatni_krok, imie, email, phone, zgoda_kontakt, zgoda_wersja, zgoda_tresc, zgoda_at) values
  ('50000000-0000-0000-0000-00000000000c', 'kontakt', 'Zofia Siatka', 'zofia@x.pl', '999000111', true, 'v1', 'treść', now());
select public.ud_leady_synchronizuj();
alter table public.ud_wnioski_szkice disable trigger ud_leady_szkic_zmiana;
update public.ud_wnioski_szkice set zgoda_kontakt = false, zgoda_wycofana_at = now(), imie = null, email = null, phone = null
 where id = '50000000-0000-0000-0000-00000000000c';
do $$
declare s uuid := '50000000-0000-0000-0000-00000000000c';
begin
  perform tt.t('bez wyzwalacza: wiersz leada jeszcze jest, ale widok go nie pokazuje',
    exists (select 1 from public.ud_leady where szkic_id = s) and not exists (select 1 from public.ud_leady_baza where szkic_id = s));
  perform tt.t('bez wyzwalacza: liczniki go nie liczą', (select sum(ile_wszystkich) from public.ud_leady_liczniki(tt.pipeline(), '{}', tt.id_ula())) =
    (select count(*) from public.ud_leady_baza where pipeline_id = tt.pipeline()));
  perform tt.t('bez wyzwalacza: nie da się go ruszyć',
    public.ud_lead_zmien('przenies', (select id from public.ud_leady where szkic_id = s), 1, 'mv-siatka-aaaa', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('kontakt')))->>'status' = 'brak_leada');
  perform public.ud_leady_synchronizuj();
  perform tt.t('bez wyzwalacza: synchronizacja domyka sprzątanie', not exists (select 1 from public.ud_leady where szkic_id = s));
end $$;
alter table public.ud_wnioski_szkice enable trigger ud_leady_szkic_zmiana;

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

-- Wyzwalacz sprzątający nie dotyka ścieżki zapisu wniosku: żadnych wyzwalaczy na ud_clients.
do $$
begin
  perform tt.t('ud_clients nie ma żadnych wyzwalaczy od tablicy leadów',
    not exists (select 1 from pg_trigger t where t.tgrelid = 'public.ud_clients'::regclass and not t.tgisinternal));
  perform tt.t('jedyny wyzwalacz tablicy leadów stoi na szkicach',
    (select array_agg(c.relname::text) from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and p.proname like 'ud_leady%') = array['ud_wnioski_szkice']);
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
  perform tt.t('plan: rola, pipeline, sześć etapów w kolejności',
    pl->>'rola' = 'user' and pl->'pipeline'->>'klucz' = 'sprzedaz'
    and (select array_agg(e->>'klucz' order by o) from jsonb_array_elements(pl->'etapy') with ordinality t(e, o))
        = array['nowy', 'kontakt', 'oferta', 'decyzja', 'wygrany', 'przegrany']);
  perform tt.t('plan: zwinięte etapy tego użytkownika', pl->'zwiniete' = jsonb_build_array(tt.etap('oferta')));
  perform tt.t('plan: inny użytkownik ma własne zwinięcia (Olek: tylko Decyzja)', public.ud_leady_plan(tt.id_olek(), null)->'zwiniete' = jsonb_build_array(tt.etap('decyzja')));
  perform tt.t('plan: etap „Przegrany" niesie wymagane pola', (select e->'wymagane_pola' from jsonb_array_elements(pl->'etapy') e where e->>'klucz' = 'przegrany') = '["powod_utraty"]'::jsonb);
  perform tt.t('plan: lista agentów bez nieaktywnych', jsonb_array_length(pl->'agenci') = 3 and pl::text not like '%Ines%');
  perform tt.t('plan: nieznany pipeline → domyślny', public.ud_leady_plan(tt.id_ula(), gen_random_uuid())->'pipeline'->>'klucz' = 'sprzedaz');
  perform tt.t('plan: nieaktywny agent i obcy uuid → null', public.ud_leady_plan(tt.id_ines(), null) is null and public.ud_leady_plan(gen_random_uuid(), null) is null);
  update public.ud_leady_etap set aktywny = false where id = tt.etap('oferta');
  perform tt.t('plan: wyłączony etap znika z planu i ze zwiniętych',
    jsonb_array_length(public.ud_leady_plan(tt.id_ula(), null)->'etapy') = 5 and public.ud_leady_plan(tt.id_ula(), null)->'zwiniete' = '[]'::jsonb);
  update public.ud_leady_etap set aktywny = true where id = tt.etap('oferta');
end $$;

-- ─── Podsumowanie ───────────────────────────────────────────────────────────
select format('WYNIK: %s PASS, %s FAIL', count(*) filter (where ok), count(*) filter (where not ok)) from tt.wyniki;
