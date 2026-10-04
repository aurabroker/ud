-- Testy SQL tablicy leadów. Uruchamia je apps/panel/scripts/test-leady-sql.mjs
-- na jednorazowym klastrze, po stub.sql, migracjach (szkice + cztery części leadów),
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
  foreach r in array array['ud_leady', 'ud_leady_baza', 'ud_leady_historia', 'ud_leady_notatki', 'ud_leady_etap', 'ud_leady_widok_uzytkownika', 'ud_leady_pliki']
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

  foreach r in array array['ud_lead_zmien', 'ud_lead_notatka', 'ud_leady_synchronizuj', 'ud_leady_kolumna', 'ud_leady_liczniki', 'ud_lead_szczegoly', 'ud_leady_zwin', 'ud_leady_statystyki', 'ud_leady_liczba',
                           'ud_leady_widzi', 'ud_lead_plik_dodaj', 'ud_lead_plik', 'ud_klienci_widoczni', 'ud_klient_widoczny']
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
  r := tt.ruch('dzialanie', c1, 1, 'dz-c1-aaaaaaaa', tt.id_adm(), jsonb_build_object('typ', 'telefon', 'termin', teraz - interval '1 day', 'opis', 'Oddzwonić'));
  perform tt.t('działanie: ustawione', r->>'status' = 'ok' and r->'lead'->'dzialanie'->>'typ' = 'telefon' and tt.wersja(c1) = 2);
  perform tt.t('działanie: historia zapisana', tt.hist(c1) = 1);
  r := tt.ruch('dzialanie', c2, 1, 'dz-c2-aaaaaaaa', tt.id_adm(), jsonb_build_object('typ', 'email', 'termin', dzis_wieczor));
  r := tt.ruch('dzialanie', c4, 1, 'dz-c4-aaaaaaaa', tt.id_adm(), jsonb_build_object('typ', 'spotkanie', 'termin', teraz + interval '3 days'));

  perform tt.t('działanie: typ bez terminu → błędne dane',
    tt.ruch('dzialanie', tt.lead('Ewa Archiwalna'), 1, 'dz-bad-aaaaaa1', tt.id_adm(), '{"typ":"telefon"}')->>'status' = 'bledne_dane');
  perform tt.t('działanie: nieznany typ → błędne dane',
    tt.ruch('dzialanie', tt.lead('Ewa Archiwalna'), 1, 'dz-bad-aaaaaa2', tt.id_adm(), jsonb_build_object('typ', 'gołąb', 'termin', teraz))->>'status' = 'bledne_dane');
  perform tt.t('działanie: zły format terminu → błędne dane',
    tt.ruch('dzialanie', tt.lead('Ewa Archiwalna'), 1, 'dz-bad-aaaaaa3', tt.id_adm(), '{"typ":"telefon","termin":"jutro"}')->>'status' = 'bledne_dane');
  perform tt.t('działanie: za długi opis → błędne dane',
    tt.ruch('dzialanie', tt.lead('Ewa Archiwalna'), 1, 'dz-bad-aaaaaa4', tt.id_adm(), jsonb_build_object('typ', 'inne', 'termin', teraz, 'opis', repeat('x', 201)))->>'status' = 'bledne_dane');
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
    (select jsonb_object_agg(e.klucz, l.ile) from public.ud_leady_liczniki(p, '{}', tt.id_adm()) l join public.ud_leady_etap e on e.id = l.etap_id)
    = '{"nowy":4,"oferta":1,"decyzja":1,"wygrany":1,"przegrany":1}'::jsonb);
  perform tt.t('liczniki: składki — Wygrany 6000, reszta 0',
    (select skladki = 6000 and skladki_wszystkich = 6000 from public.ud_leady_liczniki(p, '{}', tt.id_adm()) where etap_id = tt.etap('wygrany'))
    and (select sum(skladki) from public.ud_leady_liczniki(p, '{}', tt.id_adm())) = 6000);
  perform tt.t('liczniki: sumy bez filtra (Nowy = 8000 + 5000 + 12000)',
    (select suma from public.ud_leady_liczniki(p, '{}', tt.id_adm()) where etap_id = tt.etap('nowy')) = 25000);

  -- Filtry.
  perform tt.t('filtr opiekun=ja (Ula widzi tylko swojego Bartka)', (select sum(ile) from public.ud_leady_liczniki(p, '{"opiekun":"ja"}', tt.id_ula())) = 1);
  perform tt.t('filtr opiekun=brak', (select sum(ile) from public.ud_leady_liczniki(p, '{"opiekun":"brak"}', tt.id_adm())) = 6);
  perform tt.t('filtr opiekun=<uuid>', (select sum(ile) from public.ud_leady_liczniki(p, jsonb_build_object('opiekun', tt.id_olek()), tt.id_adm())) = 1);
  perform tt.t('filtr źródło=direct', (select sum(ile) from public.ud_leady_liczniki(p, '{"zrodlo":"direct"}', tt.id_adm())) = 2);
  perform tt.t('filtr źródło=szkic → nic (porzucone wnioski nie są leadami)', (select sum(ile) from public.ud_leady_liczniki(p, '{"zrodlo":"szkic"}', tt.id_adm())) = 0);
  perform tt.t('filtr produkt=okresowa', (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"okresowa"}', tt.id_adm())) = 4);
  perform tt.t('filtr produkt=trwala',   (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"trwala"}', tt.id_adm())) = 1);
  perform tt.t('filtr produkt=zgon',     (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"zgon"}', tt.id_adm())) = 1);
  perform tt.t('filtr produkt=nieznany', (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"nieznany"}', tt.id_adm())) = 4);
  perform tt.t('filtr termin=brak', (select sum(ile) from public.ud_leady_liczniki(p, '{"termin":"brak"}', tt.id_adm())) = 5);
  perform tt.t('filtr termin=przeterminowane zawiera Annę, nie zawiera Darka',
    exists (select 1 from public.ud_leady_dopasowane(p, '{"termin":"przeterminowane"}', tt.id_adm()) where id = tt.lead('Anna Kowalska'))
    and not exists (select 1 from public.ud_leady_dopasowane(p, '{"termin":"przeterminowane"}', tt.id_adm()) where id = tt.lead('Darek Decyzja')));
  perform tt.t('filtr termin=dzisiaj → Bartek',
    (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"termin":"dzisiaj"}', tt.id_adm())) = array['Bartek Nowak']);
  perform tt.t('filtr termin=tydzien → Darek (a nie Anna)',
    exists (select 1 from public.ud_leady_dopasowane(p, '{"termin":"tydzien"}', tt.id_adm()) where id = tt.lead('Darek Decyzja'))
    and not exists (select 1 from public.ud_leady_dopasowane(p, '{"termin":"tydzien"}', tt.id_adm()) where id = tt.lead('Anna Kowalska')));
  perform tt.t('filtry łączą się (AND)',
    (select sum(ile) from public.ud_leady_liczniki(p, '{"produkt":"okresowa","zrodlo":"direct"}', tt.id_adm())) = 1);

  -- Wyszukiwanie.
  perform tt.t('q: imię bez względu na wielkość liter', (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"ANNA kow"}', tt.id_adm())) = array['Anna Kowalska']);
  perform tt.t('q: fragment telefonu (same cyfry)',     (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"500 100"}', tt.id_adm())) = array['Anna Kowalska']);
  perform tt.t('q: fragment e-maila',                   (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"bartek@"}', tt.id_adm())) = array['Bartek Nowak']);
  perform tt.t('q: telefon szkicu nie trafia (szkic nie jest leadem)', (select count(*) from public.ud_leady_dopasowane(p, '{"q":"600 700 8"}', tt.id_adm())) = 0);
  perform tt.t('q: "%" nie jest wzorcem',               (select count(*) from public.ud_leady_dopasowane(p, '{"q":"%"}', tt.id_adm())) = 0);
  perform tt.t('q: "_" trafia tylko w literalny podkreślnik', (select array_agg(nazwa) from public.ud_leady_dopasowane(p, '{"q":"_"}', tt.id_adm())) = array['Gabriel Podkreślnik']);
  perform tt.t('q: "a%b" nie jest wzorcem',             (select count(*) from public.ud_leady_dopasowane(p, '{"q":"a%b"}', tt.id_adm())) = 0);
  perform tt.t('q: puste = bez filtra',                 (select count(*) from public.ud_leady_dopasowane(p, '{"q":"   "}', tt.id_adm())) = 8);

  -- K23: licznik i suma dotyczą całego filtrowanego zbioru, nie załadowanych kart.
  perform tt.t('K23: licznik po filtrze vs bez filtra ("2 z 4") i suma po filtrze (20000 z 25000)',
    (select ile = 2 and ile_wszystkich = 4 and suma = 20000 and suma_wszystkich = 25000
       from public.ud_leady_liczniki(p, '{"produkt":"okresowa"}', tt.id_adm()) where etap_id = tt.etap('nowy')));
  strona := public.ud_leady_kolumna(p, tt.etap('nowy'), '{"produkt":"okresowa"}', 'wartosc', 1, 0, tt.id_adm());
  perform tt.t('K23: załadowana 1 karta, ale razem = 2', jsonb_array_length(strona->'karty') = 1 and (strona->>'razem')::int = 2);

  -- K22: sortowanie.
  strona := public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'wartosc', 10, 0, tt.id_adm());
  perform tt.t('sort: wartość malejąco (12000, 8000, 5000)',
    strona->'karty'->0->>'nazwa' = 'Gabriel Podkreślnik' and strona->'karty'->1->>'nazwa' = 'Anna Kowalska'
    and strona->'karty'->2->>'nazwa' = 'Ewa Archiwalna');
  perform tt.t('sort: wartość — ostatnia karta nie ma kwoty', strona->'karty'->3->>'wartosc' is null);
  strona := public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'dzialanie', 10, 0, tt.id_adm());
  perform tt.t('sort: najbliższe działanie pierwsze (przeterminowane Anny), reszta bez terminu',
    strona->'karty'->0->>'nazwa' = 'Anna Kowalska' and strona->'karty'->1->'dzialanie' = 'null'::jsonb);
  update public.ud_clients set created_at = now() - interval '10 days' where id = 'c0000000-0000-0000-0000-000000000007';
  strona := public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 10, 0, tt.id_adm());
  perform tt.t('sort: data — najnowsze pierwsze (Hanna, Gabriel, Ewa, Anna)',
    (select array_agg(k->>'nazwa' order by o) from jsonb_array_elements(strona->'karty') with ordinality as t(k, o))
    = array['Hanna Szkicowa', 'Gabriel Podkreślnik', 'Ewa Archiwalna', 'Anna Kowalska']);

  -- Stronicowanie: rozłączne strony, razem komplet, stała kolejność.
  select array_agg((k->>'id')::uuid order by o) into s1
    from jsonb_array_elements(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 2, 0, tt.id_adm())->'karty') with ordinality t(k, o);
  select array_agg((k->>'id')::uuid order by o) into s2
    from jsonb_array_elements(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 2, 2, tt.id_adm())->'karty') with ordinality t(k, o);
  wszystkie := s1 || s2;
  perform tt.t('stronicowanie: 2 + 2, bez powtórzeń i luk',
    cardinality(s1) = 2 and cardinality(s2) = 2 and (select count(distinct x) from unnest(wszystkie) x) = 4);
  perform tt.t('stronicowanie: kolejność identyczna z pełną listą',
    wszystkie = (select array_agg((k->>'id')::uuid order by o)
                   from jsonb_array_elements(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 10, 0, tt.id_adm())->'karty') with ordinality t(k, o)));
  perform tt.t('stronicowanie: poza zakresem → pusta lista, razem bez zmian',
    (public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 2, 40, tt.id_adm())->>'razem')::int = 4
    and jsonb_array_length(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 2, 40, tt.id_adm())->'karty') = 0);
  perform tt.t('stronicowanie: limit ograniczony do 100',
    jsonb_array_length(public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 100000, 0, tt.id_adm())->'karty') = 4);
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
    (select z_etapu_id = tt.etap('oferta') and do_etapu_id = tt.etap('decyzja') and wykonawca_id = tt.id_adm() and wykonawca_nazwa = 'Ada Admin'
       from public.ud_leady_historia where lead_id = c2 and typ = 'etap'));
  perform tt.t('K03: liczniki zgodne po przeniesieniu',
    (select jsonb_object_agg(e.klucz, l.ile) from public.ud_leady_liczniki(tt.pipeline(), '{}', tt.id_adm()) l join public.ud_leady_etap e on e.id = l.etap_id)
    = '{"nowy":4,"oferta":0,"decyzja":2,"wygrany":1,"przegrany":1}'::jsonb);

  -- K21: ponowienie z tym samym kluczem po utracie odpowiedzi.
  v := tt.wersja(c2); h := tt.hist(c2);
  r := public.ud_lead_zmien('przenies', c2, v - 1, 'mv-c2-aaaaaaaa', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('decyzja')));
  perform tt.t('K21: ponowienie (nawet ze starą wersją) → ok/powtorzone, bez drugiego skutku',
    r->>'status' = 'ok' and (r->>'powtorzone')::boolean and tt.wersja(c2) = v and tt.hist(c2) = h);
  r := public.ud_lead_zmien('przenies', c2, v - 1, 'mv-c2-aaaaaaaa', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('oferta')));
  perform tt.t('K21: ten sam klucz do innej operacji → klucz_uzyty, bez zmian',
    r->>'status' = 'klucz_uzyty' and tt.etap_leada(c2) = 'decyzja' and tt.hist(c2) = h);
  r := public.ud_lead_zmien('opiekun', c2, v, 'mv-c2-aaaaaaaa', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_adm()));
  perform tt.t('K21: ten sam klucz do innego typu operacji → klucz_uzyty', r->>'status' = 'klucz_uzyty');
  r := public.ud_lead_zmien('przenies', c1, 2, 'mv-c2-aaaaaaaa', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('decyzja')));
  perform tt.t('K21: klucz jest per lead — ten sam klucz na innym leadzie to nowa operacja', r->>'status' = 'ok' and tt.etap_leada(c1) = 'decyzja');
  perform tt.przenies(c1, 'nowy', 'mv-c1-wroc-aaaaaa');

  -- K10: równoległa zmiana — nieaktualna wersja.
  v := tt.wersja(c4);
  r := public.ud_lead_zmien('przenies', c4, v, 'mv-c4-aaaaaaaa', tt.id_olek(), jsonb_build_object('etap_id', tt.etap('oferta')));
  r := public.ud_lead_zmien('przenies', c4, v, 'mv-c4-bbbbbbbb', tt.id_adm(),  jsonb_build_object('etap_id', tt.etap('wygrany')));
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
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-przegr-2', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('przegrany'), 'powod_utraty', '  '));
  perform tt.t('K11: powód z samych spacji = brak', r->>'status' = 'brak_danych');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-przegr-3', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('przegrany'), 'powod_utraty', 'ab'));
  perform tt.t('K11: za krótki powód = brak', r->>'status' = 'brak_danych');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-przegr-4', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('przegrany'), 'powod_utraty', repeat('x', 301)));
  perform tt.t('K11: za długi powód → błędne dane', r->>'status' = 'bledne_dane' and tt.etap_leada(c1) = 'nowy');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-przegr-5', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('przegrany'), 'powod_utraty', 'Wybrał konkurencję'));
  perform tt.t('K11: z powodem → ok i powód zapisany',
    r->>'status' = 'ok' and tt.etap_leada(c1) = 'przegrany' and r->'lead'->>'powod_utraty' = 'Wybrał konkurencję');
  r := tt.przenies(c1, 'nowy', 'mv-c1-powrot-1');
  perform tt.t('wyjście z Przegranego (cofnięcie jako nowa operacja) czyści powód',
    r->>'status' = 'ok' and (select powod_utraty from public.ud_leady where id = c1) is null);
  perform tt.t('powód utraty zostaje w historii',
    exists (select 1 from public.ud_leady_historia where lead_id = c1 and dane->>'powod_utraty' = 'Wybrał konkurencję'));
  r := public.ud_lead_zmien('przenies', c1, tt.wersja(c1), 'mv-c1-nie-przegr', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('oferta'), 'powod_utraty', 'zbędny'));
  perform tt.t('powód podany przy etapie, który go nie wymaga, nie jest zapisywany',
    r->>'status' = 'ok' and (select powod_utraty from public.ud_leady where id = c1) is null);
  perform tt.przenies(c1, 'nowy', 'mv-c1-powrot-2');

  -- Zamknięcie sprawy kasuje zaplanowane działanie (historia je pamięta).
  perform tt.ruch('dzialanie', c1, tt.wersja(c1), 'dz-c1-zamk-aaaa', tt.id_adm(), jsonb_build_object('typ', 'telefon', 'termin', now() + interval '2 days'));
  v := tt.wersja(c1);
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-c1-wygr-aaaa', tt.id_adm(),
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
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-obcy-aaaaaaaa', tt.id_adm(), jsonb_build_object('etap_id', inny_etap));
  perform tt.t('K12: etap z innego pipeline''u → niedozwolony', r->>'status' = 'niedozwolony' and tt.etap_leada(c1) = 'nowy' and tt.wersja(c1) = v);
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-losowy-aaaaaa', tt.id_adm(), jsonb_build_object('etap_id', gen_random_uuid()));
  perform tt.t('K12: nieistniejący etap → niedozwolony', r->>'status' = 'niedozwolony');
  r := tt.przenies(c1, 'kontakt', 'mv-wylaczony-aa');
  perform tt.t('K12: wyłączony etap (Kontakt po scaleniu) → niedozwolony', r->>'status' = 'niedozwolony' and tt.etap_leada(c1) = 'nowy');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-zly-uuid-aaaa', tt.id_adm(), '{"etap_id":"nie-uuid"}');
  perform tt.t('K12: śmieciowy etap_id → błędne dane, nie wyjątek', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('przenies', c1, v, 'mv-brak-etapu-aa', tt.id_adm(), '{}');
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
  r := public.ud_lead_zmien('przenies', gen_random_uuid(), 1, 'mv-brak-leada-aa', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('brak leada → brak_leada', r->>'status' = 'brak_leada');
  r := public.ud_lead_zmien('przenies', c1, v, 'krotki', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('klucz idempotencji za krótki → błędne dane', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('przenies', c1, null, 'mv-bez-wersji-aa', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('brak wersji → błędne dane', r->>'status' = 'bledne_dane');
  r := public.ud_lead_zmien('skasuj', c1, v, 'mv-nieznana-op-a', tt.id_adm(), '{}');
  perform tt.t('nieznana operacja → błędne dane', r->>'status' = 'bledne_dane');
  perform tt.t('wersja z przyszłości → konflikt', public.ud_lead_zmien('przenies', c1, v + 5, 'mv-zla-wersja-bb', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('kontakt')))->>'status' = 'konflikt');
end $$;

-- ─── 5. Opiekun: przydziela wyłącznie administrator (02.10.2026) ──────────
do $$
declare
  c1 uuid := tt.lead('Anna Kowalska');       -- bez opiekuna
  c4 uuid := tt.lead('Darek Decyzja');       -- opiekun Olek
  r jsonb;
begin
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-aaaaaaaa', tt.id_ula(), jsonb_build_object('opiekun_id', tt.id_ula()));
  perform tt.t('opiekun: agent nie przejmuje wolnego leada (nie widzi go) → brak_leada',
    r->>'status' = 'brak_leada' and (select opiekun_id from public.ud_leady where id = c1) is null);
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-bbbbbbbb', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_ula()));
  perform tt.t('opiekun: administrator przydziela lead agentowi', r->>'status' = 'ok' and r->'lead'->>'opiekun_nazwa' = 'Ula Agent');
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-cccccccc', tt.id_ula(), jsonb_build_object('opiekun_id', null));
  perform tt.t('opiekun: agent nie zwalnia własnego leada → brak_uprawnien',
    r->>'status' = 'brak_uprawnien' and (select opiekun_id from public.ud_leady where id = c1) = tt.id_ula());
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-dddddddd', tt.id_ula(), jsonb_build_object('opiekun_id', tt.id_olek()));
  perform tt.t('opiekun: agent nie przepisuje własnego leada na kogoś', r->>'status' = 'brak_uprawnien');
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-eeeeeeee', tt.id_olek(), jsonb_build_object('opiekun_id', tt.id_olek()));
  perform tt.t('opiekun: agent nie bierze cudzego leada → brak_leada', r->>'status' = 'brak_leada'
    and (select opiekun_id from public.ud_leady where id = c1) = tt.id_ula());
  r := public.ud_lead_zmien('opiekun', c1, tt.wersja(c1), 'op-c1-ffffffff', tt.id_adm(), jsonb_build_object('opiekun_id', null));
  perform tt.t('opiekun: administrator zdejmuje opiekuna', r->>'status' = 'ok' and (select opiekun_id from public.ud_leady where id = c1) is null);
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

  r := public.ud_lead_szczegoly(c2, tt.id_ula());
  perform tt.t('szczegóły: kontakt, zawód, notatki i historia z nazwami etapów',
    r->>'email' = 'bartek@x.pl' and r->'kontakt'->>'zawod' = 'Kierowca'
    and jsonb_array_length(r->'notatki') = 2
    and exists (select 1 from jsonb_array_elements(r->'historia') h where h->>'z_etap' = 'Oferta' and h->>'do_etap' = 'Decyzja klienta'));
  perform tt.t('szczegóły: bez PESEL-u', r::text not like '%81010112345%' and not (r ? 'pesel'));
  perform tt.t('szczegóły: nieznany lead → null', public.ud_lead_szczegoly(gen_random_uuid(), tt.id_adm()) is null);
end $$;

-- ─── 7. Archiwizacja ────────────────────────────────────────────────────────
do $$
declare
  c5 uuid := tt.lead('Ewa Archiwalna'); v int; r jsonb; h int;
begin
  v := tt.wersja(c5);
  r := public.ud_lead_zmien('archiwizuj', c5, v, 'ar-c5-aaaaaaaa', tt.id_adm(), '{}');
  perform tt.t('archiwizacja: lead znika z widoku, wiersz zostaje', r->>'status' = 'ok' and (r->>'zarchiwizowano')::boolean
    and not exists (select 1 from public.ud_leady_baza where id = c5) and exists (select 1 from public.ud_leady where id = c5 and zarchiwizowano_at is not null));
  perform tt.t('archiwizacja: znika z liczników (Nowy: 3)',
    (select ile_wszystkich from public.ud_leady_liczniki(tt.pipeline(), '{}', tt.id_adm()) where etap_id = tt.etap('nowy')) = 3);
  h := tt.hist(c5);
  r := public.ud_lead_zmien('archiwizuj', c5, v, 'ar-c5-aaaaaaaa', tt.id_adm(), '{}');
  perform tt.t('archiwizacja: ponowienie → ok/powtorzone, bez drugiego wpisu', r->>'status' = 'ok' and (r->>'powtorzone')::boolean and tt.hist(c5) = h);
  r := public.ud_lead_zmien('przenies', c5, v + 1, 'ar-c5-bbbbbbbb', tt.id_adm(), jsonb_build_object('etap_id', tt.etap('kontakt')));
  perform tt.t('zarchiwizowany lead nie daje się przenieść', r->>'status' = 'brak_leada');
  perform tt.t('zarchiwizowany lead nie ma szczegółów', public.ud_lead_szczegoly(c5, tt.id_adm()) is null);
  perform tt.t('synchronizacja nie wskrzesza zarchiwizowanego leada',
    (public.ud_leady_synchronizuj()->>'klienci')::int = 0 and not exists (select 1 from public.ud_leady_baza where id = c5));
  perform tt.t('notatka do zarchiwizowanego leada → brak_leada', public.ud_lead_notatka(c5, 'nt-c5-aaaaaaaa', tt.id_adm(), 'x')->>'status' = 'brak_leada');
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
  perform public.ud_lead_notatka(ls, 'nt-k6-aaaaaaaa', tt.id_adm(), 'notatka o kliencie');
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
  perform tt.t('sprzedaż: składka roczna 0 = brak składki → brak_danych', r->>'status' = 'brak_danych' and tt.etap_leada(c4) = 'oferta');
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
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object('skladka_roczna', 2400,
                            'swiadczenie_trwala', 0, 'swiadczenie_zgon', '0,00', 'skladka_mies', '')));
  perform tt.t('sprzedaż: sama składka roczna wystarcza, zera w ryzykach = brak ryzyka; sprzedawca = opiekun (Olek)',
    r->>'status' = 'ok' and tt.etap_leada(c4) = 'wygrany'
    and (select skladka_roczna = 2400 and skladka_mies is null and swiadczenie_trwala is null and swiadczenie_zgon is null
                and sprzedawca_id = tt.id_olek() and sprzedano_at is not null
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

  -- Lead bez opiekuna (przenieść go może tylko administrator): sprzedawca = przenoszący.
  -- Potem z powrotem — wyjście z Wygrany zeruje sprzedaż, statystyki bez zmian.
  r := public.ud_lead_zmien('przenies', tt.lead('Hanna Szkicowa'), tt.wersja(tt.lead('Hanna Szkicowa')), 'sp-c8-ok-aaaaaa', tt.id_adm(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object('skladka_roczna', 900)));
  perform tt.t('sprzedaż: lead bez opiekuna → sprzedawcą jest przenoszący (administrator)',
    r->>'status' = 'ok' and (select sprzedawca_id from public.ud_leady where id = tt.lead('Hanna Szkicowa')) = tt.id_adm());
  perform tt.przenies(tt.lead('Hanna Szkicowa'), 'nowy', 'sp-c8-wroc-aaaa');

  -- Gabriel: administrator przydziela go Uli, Ula sprzedaje.
  perform public.ud_lead_zmien('opiekun', c7, tt.wersja(c7), 'op-c7-ula-aaaaa', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_ula()));
  r := public.ud_lead_zmien('przenies', c7, tt.wersja(c7), 'sp-c7-ok-aaaaaa', tt.id_ula(),
         jsonb_build_object('etap_id', wyg, 'sprzedaz', jsonb_build_object('skladka_roczna', 1200)));
  perform tt.t('sprzedaż: przydzielony lead — agent przenosi, sprzedawca = on',
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
  r := public.ud_lead_zmien('sprzedaz', c1, tt.wersja(c1), 'sp-c1-nie-aaaaa', tt.id_adm(), jsonb_build_object('skladka_roczna', 100));
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
    (select skladki_wszystkich from public.ud_leady_liczniki(tt.pipeline(), '{}', tt.id_adm()) where etap_id = tt.etap('wygrany')) = 11436);
end $$;


-- ─── 11. Widoczność: agent widzi i obsługuje tylko swoje leady (02.10.2026) ─
-- Stan wejściowy: Bartek (Ula, Wygrany), Gabriel (Ula, zarchiwizowany),
-- Darek i Olga (Olek), Anna (administrator), reszta bez opiekuna.
do $$
declare
  p uuid := tt.pipeline();
  c2 uuid := tt.lead('Bartek Nowak'); c4 uuid := tt.lead('Darek Decyzja'); c8 uuid := tt.lead('Hanna Szkicowa');
  r jsonb; v int; n int;
begin
  perform tt.t('widoczność: Ula widzi na tablicy wyłącznie swoje leady',
    (select array_agg(nazwa order by nazwa) from public.ud_leady_dopasowane(p, '{}', tt.id_ula())) = array['Bartek Nowak']);
  perform tt.t('widoczność: Olek — tylko swoje',
    (select array_agg(nazwa order by nazwa) from public.ud_leady_dopasowane(p, '{}', tt.id_olek())) = array['Darek Decyzja', 'Olga Bezdanych']);
  perform tt.t('widoczność: administrator widzi wszystkie',
    (select count(*) from public.ud_leady_dopasowane(p, '{}', tt.id_adm())) = (select count(*) from public.ud_leady_baza));
  perform tt.t('widoczność: „wszystkich" w licznikach agenta też tylko jego (bez zdradzania liczby cudzych)',
    (select sum(ile_wszystkich) from public.ud_leady_liczniki(p, '{}', tt.id_ula())) = 1
    and (select sum(skladki_wszystkich) from public.ud_leady_liczniki(p, '{}', tt.id_ula())) = 3036);
  perform tt.t('widoczność: filtr „bez opiekuna" u agenta nic nie daje',
    (select count(*) from public.ud_leady_dopasowane(p, '{"opiekun":"brak"}', tt.id_ula())) = 0);
  perform tt.t('widoczność: kolumna agenta bez cudzych kart',
    (public.ud_leady_kolumna(p, tt.etap('nowy'), '{}', 'data', 50, 0, tt.id_ula())->>'razem')::int = 0);

  perform tt.t('szczegóły: agent — swój tak, cudzy i wolny nie',
    public.ud_lead_szczegoly(c2, tt.id_ula()) is not null and public.ud_lead_szczegoly(c4, tt.id_ula()) is null
    and public.ud_lead_szczegoly(c8, tt.id_ula()) is null and public.ud_lead_szczegoly(c4, tt.id_adm()) is not null);

  v := tt.wersja(c4);
  r := public.ud_lead_zmien('przenies', c4, v, 'wd-c4-aaaaaaaa', tt.id_ula(), jsonb_build_object('etap_id', tt.etap('nowy')));
  perform tt.t('zapis: cudzy lead → brak_leada, bez zmian i bez historii',
    r->>'status' = 'brak_leada' and tt.wersja(c4) = v and not exists (select 1 from public.ud_leady_historia where klucz = 'wd-c4-aaaaaaaa'));
  r := public.ud_lead_zmien('dzialanie', c8, tt.wersja(c8), 'wd-c8-aaaaaaaa', tt.id_ula(), jsonb_build_object('typ', 'telefon', 'termin', now()));
  perform tt.t('zapis: wolny lead → brak_leada', r->>'status' = 'brak_leada');
  perform tt.t('notatka: cudzy lead → brak_leada', public.ud_lead_notatka(c4, 'wd-nt-aaaaaaaa', tt.id_ula(), 'x')->>'status' = 'brak_leada');

  -- Przydział otwiera dostęp, odebranie go zamyka.
  perform public.ud_lead_zmien('opiekun', c8, tt.wersja(c8), 'wd-op-aaaaaaaa', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_ula()));
  r := public.ud_lead_zmien('dzialanie', c8, tt.wersja(c8), 'wd-c8-bbbbbbbb', tt.id_ula(), jsonb_build_object('typ', 'telefon', 'termin', now() + interval '1 day'));
  perform tt.t('przydział: po przypisaniu agent widzi i obsługuje lead',
    r->>'status' = 'ok' and exists (select 1 from public.ud_leady_dopasowane(p, '{}', tt.id_ula()) where id = c8));
  perform public.ud_lead_zmien('opiekun', c8, tt.wersja(c8), 'wd-op-bbbbbbbb', tt.id_adm(), jsonb_build_object('opiekun_id', tt.id_olek()));
  perform tt.t('przydział: po przepisaniu na innego lead znika agentowi',
    not exists (select 1 from public.ud_leady_dopasowane(p, '{}', tt.id_ula()) where id = c8)
    and public.ud_lead_szczegoly(c8, tt.id_ula()) is null and public.ud_lead_szczegoly(c8, tt.id_olek()) is not null);

  -- Konto nieaktywne nie widzi nawet leada, którego jest opiekunem.
  update public.ud_leady set opiekun_id = tt.id_ines() where id = c8;
  perform tt.t('widoczność: nieaktywny agent nie widzi nic (także swojego)',
    public.ud_lead_szczegoly(c8, tt.id_ines()) is null
    and (select count(*) from public.ud_leady_dopasowane(p, '{}', tt.id_ines())) = 0
    and not public.ud_leady_widzi(tt.id_ines(), tt.id_ines()) and not public.ud_leady_widzi(null, null));
  update public.ud_leady set opiekun_id = null where id = c8;
end $$;

-- Klienci widoczni dla agenta: z jego leadów + dodani przez niego, jeszcze bez leada.
insert into public.ud_clients (id, created_at, full_name, email, source, referred_by) values
  ('c0000000-0000-0000-0000-00000000000e', now(), 'Kamil Bezleadu', 'kamil@x.pl', 'manual', 'a0000000-0000-0000-0000-0000000000a2');
do $$
declare
  kb uuid := 'c0000000-0000-0000-0000-00000000000e';
  bartek uuid := (select klient_id from public.ud_leady where id = tt.lead('Bartek Nowak'));
  darek uuid := (select klient_id from public.ud_leady where id = tt.lead('Darek Decyzja'));
  gabriel uuid := (select klient_id from public.ud_leady where id = tt.lead_wszystkie('Gabriel Podkreślnik'));
begin
  perform tt.t('klienci: Ula — klienci jej leadów (także zarchiwizowanego Gabriela) i dodany przez nią bez leada',
    (select array_agg(x order by x) from public.ud_klienci_widoczni(tt.id_ula()) x)
    = (select array_agg(y order by y) from unnest(array[bartek, kb, gabriel]) y));
  perform tt.t('klienci: administrator — wszyscy', (select count(*) from public.ud_klienci_widoczni(tt.id_adm())) = (select count(*) from public.ud_clients));
  perform tt.t('klienci: nieaktywny i nieznany — nikt',
    (select count(*) from public.ud_klienci_widoczni(tt.id_ines())) = 0 and (select count(*) from public.ud_klienci_widoczni(gen_random_uuid())) = 0);
  perform tt.t('klient: pojedynczo — swój tak, cudzy nie, admin każdy',
    public.ud_klient_widoczny(tt.id_ula(), bartek) and public.ud_klient_widoczny(tt.id_ula(), kb)
    and not public.ud_klient_widoczny(tt.id_ula(), darek) and public.ud_klient_widoczny(tt.id_adm(), darek)
    and not public.ud_klient_widoczny(tt.id_ula(), gen_random_uuid()));
  perform public.ud_leady_synchronizuj();
  perform tt.t('klienci: po synchronizacji dodany klient ma lead Uli i dalej jest widoczny',
    (select opiekun_id from public.ud_leady where klient_id = kb) = tt.id_ula() and public.ud_klient_widoczny(tt.id_ula(), kb));
  perform public.ud_lead_zmien('opiekun', (select id from public.ud_leady where klient_id = kb),
                               (select wersja from public.ud_leady where klient_id = kb), 'wd-kb-aaaaaaaa', tt.id_adm(),
                               jsonb_build_object('opiekun_id', tt.id_olek()));
  perform tt.t('klienci: przepisanie leada zabiera też klienta (polecenie nie daje dostępu na zawsze)',
    not public.ud_klient_widoczny(tt.id_ula(), kb) and public.ud_klient_widoczny(tt.id_olek(), kb));
end $$;

-- Pliki (polisy) i kwota zero.
do $$
declare
  c2 uuid := tt.lead('Bartek Nowak'); c4 uuid := tt.lead('Darek Decyzja');
  sc text := tt.lead('Bartek Nowak')::text || '/' || gen_random_uuid()::text || '.pdf';
  r jsonb; f uuid; h int; wyjatek boolean;
begin
  perform tt.t('kubełek ud-polisy: prywatny, tylko PDF, 10 MB',
    exists (select 1 from storage.buckets where id = 'ud-polisy' and not public and file_size_limit = 10485760
                                            and allowed_mime_types = array['application/pdf']));
  h := tt.hist(c2);
  r := public.ud_lead_plik_dodaj(c2, tt.id_ula(), sc, '  Polisa LW044.pdf ', 12345);
  f := (r->'plik'->>'id')::uuid;
  perform tt.t('plik: opiekun dodaje polisę — wiersz, historia, nazwa przycięta',
    r->>'status' = 'ok' and r->'plik'->>'nazwa' = 'Polisa LW044.pdf' and r->'plik'->>'dodal_nazwa' = 'Ula Agent'
    and tt.hist(c2) = h + 1 and exists (select 1 from public.ud_leady_historia where lead_id = c2 and typ = 'plik'));
  perform tt.t('plik: widać go w szczegółach', jsonb_array_length(public.ud_lead_szczegoly(c2, tt.id_ula())->'pliki') = 1
    and public.ud_lead_szczegoly(c2, tt.id_ula())->'pliki'->0->>'nazwa' = 'Polisa LW044.pdf');
  perform tt.t('plik: ścieżka dla opiekuna i administratora, nie dla innego agenta',
    public.ud_lead_plik(f, tt.id_ula())->>'sciezka' = sc and public.ud_lead_plik(f, tt.id_adm()) is not null
    and public.ud_lead_plik(f, tt.id_olek()) is null and public.ud_lead_plik(gen_random_uuid(), tt.id_adm()) is null);
  perform tt.t('plik: cudzy lead → brak_leada',
    public.ud_lead_plik_dodaj(c4, tt.id_ula(), c4::text || '/' || gen_random_uuid()::text || '.pdf', 'x.pdf', 1)->>'status' = 'brak_leada');
  perform tt.t('plik: ścieżka innego leada → błędne dane',
    public.ud_lead_plik_dodaj(c2, tt.id_ula(), c4::text || '/' || gen_random_uuid()::text || '.pdf', 'x.pdf', 1)->>'status' = 'bledne_dane');
  perform tt.t('plik: ścieżka spoza wzorca → błędne dane',
    public.ud_lead_plik_dodaj(c2, tt.id_ula(), c2::text || '/../x.pdf', 'x.pdf', 1)->>'status' = 'bledne_dane');
  perform tt.t('plik: pusta nazwa → „polisa.pdf"',
    public.ud_lead_plik_dodaj(c2, tt.id_ula(), c2::text || '/' || gen_random_uuid()::text || '.pdf', '   ', 1)->'plik'->>'nazwa' = 'polisa.pdf');
  perform tt.t('plik: nieaktywny → brak_uprawnien',
    public.ud_lead_plik_dodaj(c2, tt.id_ines(), c2::text || '/' || gen_random_uuid()::text || '.pdf', 'x.pdf', 1)->>'status' = 'brak_uprawnien');
  wyjatek := false;
  begin
    insert into public.ud_leady_pliki (lead_id, bucket, sciezka, nazwa) values (c2, 'ud-owu', sc || 'x', 'x');
  exception when check_violation then wyjatek := true;
  end;
  perform tt.t('plik: inny kubełek odrzuca baza', wyjatek);

  perform tt.t('kwota: 0 i „0,00 zł" → brak kwoty (null)',
    public.ud_leady_liczba('0'::jsonb) is null and public.ud_leady_liczba('"0,00 zł"'::jsonb) is null);
  wyjatek := false;
  begin perform public.ud_leady_liczba('-1'::jsonb); exception when numeric_value_out_of_range then wyjatek := true; end;
  perform tt.t('kwota: ujemna liczba dalej jest błędem', wyjatek);
  wyjatek := false;
  begin perform public.ud_leady_liczba('"-1"'::jsonb); exception when invalid_text_representation then wyjatek := true; end;
  perform tt.t('kwota: ujemna w tekście dalej jest błędem', wyjatek);
end $$;

-- ─── 12. Link agenta do wniosku: /wniosek/?agent=<kod> → opiekun leada ──────
do $$
declare k_ula text; k_olek text;
begin
  k_ula := public.ud_agent_kod(tt.id_ula());
  k_olek := public.ud_agent_kod(tt.id_olek());
  perform tt.t('kod agenta: nadany kolejno, czterocyfrowy, stały przy kolejnym wywołaniu',
    k_ula ~ '^[0-9]{4}$' and k_olek ~ '^[0-9]{4}$' and k_olek::int = k_ula::int + 1
    and public.ud_agent_kod(tt.id_ula()) = k_ula);
  perform tt.t('kod agenta: nieaktywny i nieznany → brak (nic nie nadane)',
    public.ud_agent_kod(tt.id_ines()) is null and public.ud_agent_kod(gen_random_uuid()) is null
    and (select affiliate_code from public.ud_user_profiles where id = tt.id_ines()) is null);
  update public.ud_user_profiles set affiliate_code = '0777' where id = tt.id_adm();
  perform tt.t('kod agenta: istniejący kod zostaje (np. „0001" Centrali)', public.ud_agent_kod(tt.id_adm()) = '0777');
  update public.ud_user_profiles set affiliate_code = null where id = tt.id_olek();
  perform tt.t('kod agenta: kolejny bierze numer po najwyższym (po 0777 → 0778)', public.ud_agent_kod(tt.id_olek()) = '0778');
end $$;

update public.ud_user_profiles set affiliate_code = '0099' where id = 'a0000000-0000-0000-0000-0000000000a4';   -- Ines (nieaktywna)
insert into public.ud_clients (id, created_at, full_name, email, source, affiliate_code_used, referred_by) values
  ('c0000000-0000-0000-0000-0000000000f1', now(), 'Lena Zlinku',     'lena@x.pl',  'form', (select ' ' || affiliate_code || ' ' from public.ud_user_profiles where id = 'a0000000-0000-0000-0000-0000000000a3'), null),
  ('c0000000-0000-0000-0000-0000000000f2', now(), 'Marek Nieaktywny','marek@x.pl', 'form', '0099', null),
  ('c0000000-0000-0000-0000-0000000000f3', now(), 'Nina Polecona',   'nina@x.pl',  'manual', (select affiliate_code from public.ud_user_profiles where id = 'a0000000-0000-0000-0000-0000000000a3'), 'a0000000-0000-0000-0000-0000000000a2'),
  ('c0000000-0000-0000-0000-0000000000f4', now(), 'Oskar Zlykod',    'oskar@x.pl', 'form', '9999', null);
do $$
declare
  lena uuid := 'c0000000-0000-0000-0000-0000000000f1';
begin
  perform tt.t('link: klient z kodem, jeszcze bez leada — widoczny dla agenta z tym kodem, nie dla innego',
    public.ud_klient_widoczny(tt.id_olek(), lena) and not public.ud_klient_widoczny(tt.id_ula(), lena));
  perform public.ud_leady_synchronizuj();
  perform tt.t('link: lead z wniosku z kodem agenta ma tego agenta jako opiekuna (spacje wokół kodu nie przeszkadzają)',
    (select opiekun_id from public.ud_leady where klient_id = lena) = tt.id_olek());
  perform tt.t('link: kod nieaktywnego agenta → lead bez opiekuna (czeka na przydział)',
    (select opiekun_id from public.ud_leady where klient_id = 'c0000000-0000-0000-0000-0000000000f2') is null);
  perform tt.t('link: dodany w panelu przez agenta ma pierwszeństwo przed kodem',
    (select opiekun_id from public.ud_leady where klient_id = 'c0000000-0000-0000-0000-0000000000f3') = tt.id_ula());
  perform tt.t('link: nieznany kod → bez opiekuna',
    (select opiekun_id from public.ud_leady where klient_id = 'c0000000-0000-0000-0000-0000000000f4') is null);
  perform tt.t('link: agent widzi lead z linku na tablicy',
    exists (select 1 from public.ud_leady_dopasowane(tt.pipeline(), '{}', tt.id_olek()) where klient_id = lena)
    and not exists (select 1 from public.ud_leady_dopasowane(tt.pipeline(), '{}', tt.id_ula()) where klient_id = lena));
  perform tt.t('uprawnienia: ud_agent_kod tylko dla service_role',
    (select not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
            and has_function_privilege('service_role', p.oid, 'execute')
       from pg_proc p where p.proname = 'ud_agent_kod' and p.pronamespace = 'public'::regnamespace));
end $$;

-- ─── 13. Część 5: składka bez opłaty dystrybucyjnej, prowizja, polisa spoza formularza ──
insert into public.ud_clients (id, created_at, full_name, email, source) values
  ('c0000000-0000-0000-0000-0000000000e1', now(), 'Piotr Prowizja', 'piotr@x.pl', 'form');
insert into public.ud_offers (id, user_id, client_id, status, created_at, sent_at, decided_at, client_choice) values
  ('0f000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000e1',
   'bought', now() - interval '3 days', now() - interval '3 days', now() - interval '2 days',
   '{"document_id": "0d000000-0000-0000-0000-0000000000e1"}');
insert into public.ud_offer_documents (id, offer_id, insurer_type, offer_number, death_covered, temp_incapacity_covered,
                                       temp_monthly_benefit, perm_incapacity_covered, perm_sum_insured,
                                       premium_total, premium_monthly, distribution_fee, parsed_raw) values
  ('0d000000-0000-0000-0000-0000000000e1', '0f000000-0000-0000-0000-0000000000e1', 'leadenhall', 'LHQ9/1', false, true,
   5000, false, null, 3036, 253, 276, '{}');
do $$
declare
  piotr uuid; r jsonb; r2 jsonb; s jsonb; k text := 'polisa-0001'; lead uuid; klient uuid; n_klientow int;
  wej jsonb := jsonb_build_object(
    'imie_nazwisko', '  Robert   Polisowy ', 'email', 'Robert@X.pl', 'telefon', '600 700 800', 'pesel', '85010112345',
    'sprzedaz', jsonb_build_object('skladka_roczna', '2 760 zł', 'skladka_mies', 230, 'swiadczenie_okresowa', 4000,
                                   'swiadczenie_trwala', 0, 'swiadczenie_zgon', ''));
begin
  perform tt.t('składka netto: 3036 z opłatą 276 → 2760; rata 253 → 230',
    public.ud_skladka_netto(3036, 276) = 2760 and public.ud_skladka_mies_netto(253, 3036, 276) = 230);
  perform tt.t('składka netto: bez opłaty (CEU), opłata 0 albo większa od składki → kwota bez zmian',
    public.ud_skladka_netto(4200, null) = 4200 and public.ud_skladka_netto(4200, 0) = 4200
    and public.ud_skladka_netto(100, 150) = 100 and public.ud_skladka_mies_netto(null, 4200, null) is null
    and public.ud_skladka_netto(0, 0) is null);

  -- Stawki: Ula 15%, Olek bez stawki (nieustawiona), administrator 20%.
  update public.ud_user_profiles set prowizja_procent = 15 where id = tt.id_ula();
  update public.ud_user_profiles set prowizja_procent = 20 where id = tt.id_adm();

  perform public.ud_leady_synchronizuj();
  piotr := (select id from public.ud_leady where klient_id = 'c0000000-0000-0000-0000-0000000000e1');
  perform tt.t('sync: kupiona z wyborem — składka bez opłaty dystrybucyjnej, stawka sprzedawcy zapisana',
    (select skladka_roczna = 2760 and skladka_mies = 230 and swiadczenie_okresowa = 5000
            and sprzedawca_id = tt.id_ula() and prowizja_procent = 15
       from public.ud_leady where id = piotr));

  -- Zmiana stawki agenta nie przepisuje sprzedaży z zapisaną stawką; poprawka danych jej nie zmienia.
  update public.ud_user_profiles set prowizja_procent = 18 where id = tt.id_ula();
  r := tt.ruch('sprzedaz', piotr, tt.wersja(piotr), 'prow-0001', tt.id_ula(),
               jsonb_build_object('skladka_roczna', 3000, 'swiadczenie_okresowa', 5000));
  perform tt.t('zmiana: poprawka danych sprzedaży zostawia stawkę z chwili sprzedaży',
    r->>'status' = 'ok' and (select prowizja_procent = 15 and skladka_roczna = 3000 from public.ud_leady where id = piotr));
  r := tt.przenies(piotr, 'oferta', 'prow-0002');
  perform tt.t('zmiana: wyjście z Wygrany zeruje stawkę', r->>'status' = 'ok'
    and (select prowizja_procent from public.ud_leady where id = piotr) is null);
  r := tt.ruch('przenies', piotr, tt.wersja(piotr), 'prow-0003', tt.id_ula(),
               jsonb_build_object('etap_id', tt.etap('wygrany'), 'sprzedaz', jsonb_build_object('skladka_roczna', 2760)));
  perform tt.t('zmiana: ponowne wejście do Wygrany bierze aktualną stawkę opiekuna (18%)',
    r->>'status' = 'ok' and (select prowizja_procent from public.ud_leady where id = piotr) = 18);

  s := public.ud_leady_statystyki(tt.id_ula());
  perform tt.t('statystyki agenta: prowizja = składka × stawka, własna stawka w odpowiedzi',
    -- Ula: Piotr 2760 (stawka zapisana 18%), Bartek 3036 i zarchiwizowany Gabriel 1200 (sprzedane przed
    -- ustawieniem stawki — liczą się aktualną, 18%).
    (s->>'stawka')::numeric = 18
    and (s->'podsumowanie'->>'prowizja_suma')::numeric = round(2760 * 0.18, 2) + round(3036 * 0.18, 2) + round(1200 * 0.18, 2)
    and (s->'podsumowanie'->>'z_prowizja')::int = 3 and (s->'podsumowanie'->>'bez_stawki')::int = 0);
  s := public.ud_leady_statystyki(tt.id_olek());
  perform tt.t('statystyki agenta bez stawki: sprzedaże z kwotami liczone jako „bez stawki", prowizja 0',
    (s->>'stawka') is null and (s->'podsumowanie'->>'prowizja_suma')::numeric = 0
    and (s->'podsumowanie'->>'bez_stawki')::int = (s->'podsumowanie'->>'z_danymi')::int);
  s := public.ud_leady_statystyki(tt.id_adm());
  perform tt.t('statystyki administratora: prowizja i stawka w podziale na agentów',
    exists (select 1 from jsonb_array_elements(s->'wg_agentow') a
             where a->>'agent_id' = tt.id_ula()::text and (a->>'stawka')::numeric = 18
               and (a->>'prowizja_suma')::numeric = round(2760 * 0.18, 2) + round(3036 * 0.18, 2) + round(1200 * 0.18, 2))
    and (s->>'stawka') is null);

  -- Polisa spoza formularza.
  n_klientow := (select count(*) from public.ud_clients);
  r := public.ud_lead_polisa_reczna(tt.id_ula(), k, wej);
  lead := (r->>'lead_id')::uuid;
  klient := (select klient_id from public.ud_leady where id = lead);
  perform tt.t('polisa: nowy klient i lead w Wygrany z danymi sprzedaży, opiekun i sprzedawca = agent, jego stawka',
    r->>'status' = 'ok' and tt.etap_leada(lead) = 'wygrany'
    and (select opiekun_id = tt.id_ula() and sprzedawca_id = tt.id_ula() and skladka_roczna = 2760 and skladka_mies = 230
               and swiadczenie_okresowa = 4000 and swiadczenie_trwala is null and swiadczenie_zgon is null
               and prowizja_procent = 18 and sprzedano_at > now() - interval '1 minute' and etap_od = sprzedano_at
          from public.ud_leady where id = lead));
  perform tt.t('polisa: kartoteka — nazwa uporządkowana, źródło „polisa", dane kontaktowe i PESEL zapisane',
    (select full_name = 'Robert Polisowy' and source = 'polisa' and referred_by = tt.id_ula()
            and email = 'robert@x.pl' and phone = '600 700 800' and pesel = '85010112345'
       from public.ud_clients where id = klient));
  perform tt.t('polisa: historia bez danych osobowych (tylko odcisk), z kluczem',
    (select count(*) = 1 and bool_and(typ = 'etap' and do_etapu_id = tt.etap('wygrany') and z_etapu_id is null
                                      and dane->>'zrodlo' = 'polisa' and dane::text !~ '85010112345|robert@x|600 700'
                                      and klucz = k)
       from public.ud_leady_historia where lead_id = lead));
  perform tt.t('polisa: agent widzi lead i klienta, inny agent nie',
    public.ud_lead_szczegoly(lead, tt.id_ula()) is not null and public.ud_lead_szczegoly(lead, tt.id_olek()) is null
    and public.ud_klient_widoczny(tt.id_ula(), klient) and not public.ud_klient_widoczny(tt.id_olek(), klient));
  r2 := public.ud_lead_polisa_reczna(tt.id_ula(), k, wej);
  perform tt.t('polisa: ponowienie tym samym kluczem → ten sam lead, bez drugiego klienta',
    r2->>'status' = 'ok' and (r2->>'powtorzone')::boolean and (r2->>'lead_id')::uuid = lead
    and (select count(*) from public.ud_clients) = n_klientow + 1);
  r2 := public.ud_lead_polisa_reczna(tt.id_ula(), k, wej || '{"telefon": "600 700 801"}');
  perform tt.t('polisa: ten sam klucz, inna treść → klucz_uzyty', r2->>'status' = 'klucz_uzyty');
  r2 := public.ud_lead_polisa_reczna(tt.id_ula(), 'polisa-0002', wej);
  perform tt.t('polisa: ten sam PESEL drugi raz → klient_istnieje z odnośnikiem do widocznego leada',
    r2->>'status' = 'klient_istnieje' and (r2->>'lead_id')::uuid = lead and (select count(*) from public.ud_clients) = n_klientow + 1);
  r2 := public.ud_lead_polisa_reczna(tt.id_olek(), 'polisa-0003', wej);
  perform tt.t('polisa: ten sam PESEL u innego agenta → klient_istnieje bez odnośnika',
    r2->>'status' = 'klient_istnieje' and r2->>'lead_id' is null and r2->>'komunikat' ~ 'administratora');

  r2 := public.ud_lead_polisa_reczna(tt.id_olek(), 'polisa-0004',
          jsonb_build_object('imie_nazwisko', 'Sara Bezmaila', 'agent_id', tt.id_ula(), 'sprzedaz', jsonb_build_object('skladka_roczna', 1000)));
  perform tt.t('polisa: agent nie dodaje sprzedaży innemu agentowi', r2->>'status' = 'brak_uprawnien');
  r2 := public.ud_lead_polisa_reczna(tt.id_adm(), 'polisa-0005',
          jsonb_build_object('imie_nazwisko', 'Sara Bezmaila', 'agent_id', tt.id_olek(), 'data_sprzedazy', '2026-01-15',
                             'sprzedaz', jsonb_build_object('skladka_roczna', 1000)));
  perform tt.t('polisa: administrator dla agenta — opiekun i sprzedawca to agent; data z przeszłości w południe czasu polskiego; bez e-maila i PESEL-u',
    r2->>'status' = 'ok'
    and (select opiekun_id = tt.id_olek() and sprzedawca_id = tt.id_olek() and prowizja_procent is null
               and sprzedano_at = '2026-01-15 12:00 Europe/Warsaw'::timestamptz
          from public.ud_leady where id = (r2->>'lead_id')::uuid)
    and (select email is null and pesel is null and referred_by = tt.id_olek()
           from public.ud_clients c join public.ud_leady l on l.klient_id = c.id where l.id = (r2->>'lead_id')::uuid));
  perform tt.t('polisa: brak składki rocznej → brak_danych',
    public.ud_lead_polisa_reczna(tt.id_ula(), 'polisa-0006', '{"imie_nazwisko": "Tomasz Brak"}')->'pola' = '["skladka_roczna"]');
  perform tt.t('polisa: brak nazwy → brak_danych',
    public.ud_lead_polisa_reczna(tt.id_ula(), 'polisa-0007', '{"imie_nazwisko": " A ", "sprzedaz": {"skladka_roczna": 1}}')->'pola' = '["imie_nazwisko"]');
  perform tt.t('polisa: zły PESEL, e-mail, telefon, data z przyszłości, nieaktywny agent → błędne dane z polem',
    public.ud_lead_polisa_reczna(tt.id_ula(), 'polisa-0008', '{"imie_nazwisko": "Ula Test", "pesel": "1234", "sprzedaz": {"skladka_roczna": 1}}')->'pola' = '["pesel"]'
    and public.ud_lead_polisa_reczna(tt.id_ula(), 'polisa-0009', '{"imie_nazwisko": "Ula Test", "email": "nie-mail", "sprzedaz": {"skladka_roczna": 1}}')->'pola' = '["email"]'
    and public.ud_lead_polisa_reczna(tt.id_ula(), 'polisa-0010', '{"imie_nazwisko": "Ula Test", "telefon": "<b>", "sprzedaz": {"skladka_roczna": 1}}')->'pola' = '["telefon"]'
    and public.ud_lead_polisa_reczna(tt.id_ula(), 'polisa-0011', jsonb_build_object('imie_nazwisko', 'Ula Test', 'data_sprzedazy', (current_date + 2)::text, 'sprzedaz', '{"skladka_roczna": 1}'::jsonb))->'pola' = '["data_sprzedazy"]'
    and public.ud_lead_polisa_reczna(tt.id_adm(), 'polisa-0012', jsonb_build_object('imie_nazwisko', 'Ula Test', 'agent_id', tt.id_ines(), 'sprzedaz', '{"skladka_roczna": 1}'::jsonb))->'pola' = '["agent_id"]'
    and public.ud_lead_polisa_reczna(tt.id_ula(), 'polisa-0013', '{"imie_nazwisko": "Ula Test", "data_sprzedazy": "2026-02-31", "sprzedaz": {"skladka_roczna": 1}}')->>'status' = 'bledne_dane'
    and public.ud_lead_polisa_reczna(tt.id_ula(), 'polisa-0014', '{"imie_nazwisko": "Ula Test", "sprzedaz": {"skladka_roczna": "abc"}}')->>'status' = 'bledne_dane');
  perform tt.t('polisa: odrzucone żądania nie zostawiły klientów',
    not exists (select 1 from public.ud_clients where full_name in ('Tomasz Brak', 'Ula Test', 'A')));
  perform tt.t('polisa: nieaktywny i nieznany użytkownik → brak_uprawnien; brak klucza → błędne dane',
    public.ud_lead_polisa_reczna(tt.id_ines(), 'polisa-0015', wej)->>'status' = 'brak_uprawnien'
    and public.ud_lead_polisa_reczna(gen_random_uuid(), 'polisa-0016', wej)->>'status' = 'brak_uprawnien'
    and public.ud_lead_polisa_reczna(tt.id_ula(), 'krotki', wej)->>'status' = 'bledne_dane');
  perform tt.t('polisa: klucz użyty wcześniej przy zmianie leada → klucz_uzyty',
    public.ud_lead_polisa_reczna(tt.id_ula(), 'prow-0001', wej || '{"pesel": null}')->>'status' = 'klucz_uzyty');
  perform tt.t('uprawnienia: funkcje części 5 tylko dla service_role',
    (select bool_and(not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                     and has_function_privilege('service_role', p.oid, 'execute'))
       from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('ud_lead_polisa_reczna', 'ud_skladka_netto', 'ud_skladka_mies_netto', 'ud_stawka_prowizji',
                          'ud_leady_statystyki')));
end $$;

-- ─── Podsumowanie ───────────────────────────────────────────────────────────
select format('WYNIK: %s PASS, %s FAIL', count(*) filter (where ok), count(*) filter (where not ok)) from tt.wyniki;
