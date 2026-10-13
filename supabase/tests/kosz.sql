-- Kosz ofert (migracja …_oferty_kosz.sql): przeniesienie, przywrócenie,
-- widoczność, czyszczenie po 30 dniach. Uruchamia
-- apps/panel/scripts/test-kosz-sql.mjs; każda asercja to NOTICE PASS/FAIL.

create schema if not exists tk;

create function tk.sprawdz(nazwa text, warunek boolean) returns void language plpgsql as $$
begin
  if coalesce(warunek, false) then raise notice 'PASS %', nazwa;
  else raise notice 'FAIL %', nazwa;
  end if;
end $$;

insert into public.ud_user_profiles (id, full_name, role, active) values
  ('a0000000-0000-0000-0000-00000000000a', 'Admin Testowy', 'admin', true),
  ('a0000000-0000-0000-0000-0000000000a1', 'Agent Ala',     'agent', true),
  ('a0000000-0000-0000-0000-0000000000b2', 'Agent Bartek',  'agent', true),
  ('a0000000-0000-0000-0000-0000000000c3', 'Agent Nieaktywny', 'agent', false);

/** Oferta agentki Ali z dwoma wariantami, plikami, PIN-em, pytaniem, wysyłką i leadem w Wygrany. */
create function tk.oferta(p_nr text) returns uuid language plpgsql as $$
declare
  v_klient uuid; v_oferta uuid; v_d1 uuid; v_d2 uuid;
begin
  insert into public.ud_clients (full_name, phone) values ('Klient ' || p_nr, '504400901') returning id into v_klient;
  insert into public.ud_offers (user_id, name, client_id, client_name, client_email, status, sent_at, viewed_at,
                                share_token, access_code, offer_number, wersja, przypomnienie_wersja, data)
  values ('a0000000-0000-0000-0000-0000000000a1', 'Oferta ' || p_nr, v_klient, 'Klient ' || p_nr, 'k@x.pl',
          'viewed', now() - interval '1 day', now() - interval '2 hours',
          'token-' || p_nr, '1442', 'UD/2026/AL/' || p_nr || '/Klient', 2, 1, '{"a": 1}')
  returning id into v_oferta;
  insert into public.ud_offer_documents (offer_id, insurer_type, offer_number, premium_total, sort_order)
    values (v_oferta, 'leadenhall', 'LHQ1', 3036, 0) returning id into v_d1;
  insert into public.ud_offer_documents (offer_id, insurer_type, offer_number, premium_total, sort_order)
    values (v_oferta, 'leadenhall', 'LHQ2', 3600, 1) returning id into v_d2;
  insert into public.ud_offer_files (offer_id, document_id, file_type, storage_path) values
    (v_oferta, v_d1, 'offer', v_oferta || '/' || v_d1 || '.pdf'),
    (v_oferta, v_d2, 'offer', v_oferta || '/' || v_d2 || '.pdf'),
    (v_oferta, null, 'summary', v_oferta || '/podsumowanie.pdf');
  insert into public.ud_offer_files (offer_id, file_type, storage_bucket, storage_path) values
    (v_oferta, 'owu', 'ud-owu', 'LW044.pdf');
  insert into public.ud_offer_pins (offer_id, pin_hash, expires_at, attempts) values (v_oferta, 'hash', now() + interval '1 day', 1);
  insert into public.ud_offer_questions (offer_id, asked_at) values (v_oferta, now() - interval '3 hours');
  insert into public.ud_send_log (offer_id, channel, recipient, status, wersja) values
    (v_oferta, 'email', 'k@x.pl', 'sent', 1), (v_oferta, 'email', 'k@x.pl', 'sent', 2);
  insert into public.ud_leady (pipeline_id, etap_id, klient_id, sprzedaz_wariant_id)
  select e.pipeline_id, e.id, v_klient, v_d2
    from public.ud_leady_etap e join public.ud_leady_pipeline p on p.id = e.pipeline_id and p.klucz = 'sprzedaz'
   where e.klucz = 'wygrany';
  return v_oferta;
end $$;

do $$
declare
  ala   constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  bart  constant uuid := 'a0000000-0000-0000-0000-0000000000b2';
  adm   constant uuid := 'a0000000-0000-0000-0000-00000000000a';
  niea  constant uuid := 'a0000000-0000-0000-0000-0000000000c3';
  o uuid; o2 uuid; r jsonb; k public.ud_offers_kosz%rowtype; przed jsonb; po jsonb;
  v_lead uuid; v_wersja int;
begin
  -- ── Przeniesienie do kosza ───────────────────────────────────────────────
  o := tk.oferta('00001');
  select jsonb_build_object(
    'oferta', (select to_jsonb(x) from public.ud_offers x where x.id = o),
    'dok', (select jsonb_agg(to_jsonb(d) order by d.sort_order) from public.ud_offer_documents d where d.offer_id = o),
    'pliki', (select jsonb_agg(to_jsonb(f) order by f.storage_path) from public.ud_offer_files f where f.offer_id = o),
    'piny', (select jsonb_agg(to_jsonb(p)) from public.ud_offer_pins p where p.offer_id = o),
    'pytania', (select jsonb_agg(to_jsonb(q)) from public.ud_offer_questions q where q.offer_id = o),
    'wysylki', (select jsonb_agg(to_jsonb(s) order by s.wersja) from public.ud_send_log s where s.offer_id = o))
  into przed;
  select l.id, l.wersja into v_lead, v_wersja from public.ud_leady l
    join public.ud_offer_documents d on d.id = l.sprzedaz_wariant_id where d.offer_id = o;

  r := public.ud_oferta_do_kosza(o, bart);   -- usuwa agent, który NIE jest właścicielem
  perform tk.sprawdz('do kosza: status ok', r->>'status' = 'ok');
  perform tk.sprawdz('oferty nie ma w ud_offers (link klienta przestaje działać)', not exists (select 1 from public.ud_offers where id = o));
  perform tk.sprawdz('warianty, pliki, PIN-y, pytania i wysyłki zniknęły jak przy usunięciu',
    not exists (select 1 from public.ud_offer_documents where offer_id = o)
    and not exists (select 1 from public.ud_offer_files where offer_id = o)
    and not exists (select 1 from public.ud_offer_pins where offer_id = o)
    and not exists (select 1 from public.ud_offer_questions where offer_id = o)
    and not exists (select 1 from public.ud_send_log where offer_id = o));
  perform tk.sprawdz('sprzedany wariant przy leadzie wyzerowany (SET NULL)',
    (select sprzedaz_wariant_id from public.ud_leady where id = v_lead) is null);
  select * into k from public.ud_offers_kosz where offer_id = o;
  perform tk.sprawdz('wpis w koszu: numer, klient, właściciel, kto usunął',
    k.offer_number = 'UD/2026/AL/00001/Klient' and k.client_name = 'Klient 00001'
    and k.wlasciciel_id = ala and k.usunieto_przez = bart);
  perform tk.sprawdz('kopia: 2 warianty, 4 pliki, PIN, pytanie, 2 wysyłki, lead',
    jsonb_array_length(k.dokumenty) = 2 and jsonb_array_length(k.pliki) = 4 and jsonb_array_length(k.piny) = 1
    and jsonb_array_length(k.pytania) = 1 and jsonb_array_length(k.wysylki) = 2 and jsonb_array_length(k.leady) = 1);
  perform tk.sprawdz('do wyczyszczenia tylko pliki z ud-offers (nie wspólne OWU)',
    array_length(k.pliki_storage, 1) = 3 and not ('LW044.pdf' = any(k.pliki_storage)));

  perform tk.sprawdz('ponowne usunięcie tej samej oferty — brak_oferty',
    public.ud_oferta_do_kosza(o, ala)->>'status' = 'brak_oferty');
  o2 := tk.oferta('00002');
  perform tk.sprawdz('konto nieaktywne nie usuwa', public.ud_oferta_do_kosza(o2, niea)->>'status' = 'brak_uprawnien');
  perform tk.sprawdz('nieznany użytkownik nie usuwa',
    public.ud_oferta_do_kosza(o2, 'ffffffff-0000-0000-0000-000000000000')->>'status' = 'brak_uprawnien');
  perform tk.sprawdz('… i oferta zostaje na miejscu', exists (select 1 from public.ud_offers where id = o2));

  -- ── Widoczność ───────────────────────────────────────────────────────────
  perform tk.sprawdz('właścicielka widzi wpis', exists (select 1 from public.ud_kosz_ofert_lista(ala) x where x.offer_id = o));
  perform tk.sprawdz('usuwający widzi wpis (cofnie własną pomyłkę)', exists (select 1 from public.ud_kosz_ofert_lista(bart) x where x.offer_id = o));
  perform tk.sprawdz('administrator widzi wpis', exists (select 1 from public.ud_kosz_ofert_lista(adm) x where x.offer_id = o));
  perform tk.sprawdz('konto nieaktywne nie widzi nic', not exists (select 1 from public.ud_kosz_ofert_lista(niea)));
  perform tk.sprawdz('lista: nazwy, liczba wariantów, data usunięcia na dobre (+30 dni)',
    (select x.wlasciciel = 'Agent Ala' and x.usunieto_przez = 'Agent Bartek' and x.wariantow = 2
            and x.usuniecie_na_dobre = k.usunieto_at + interval '30 days' and x.status = 'viewed'
       from public.ud_kosz_ofert_lista(ala) x where x.offer_id = o));

  -- Oferta Ali usunięta przez Alę: Bartek jej nie widzi i nie przywróci.
  r := public.ud_oferta_do_kosza(o2, ala);
  perform tk.sprawdz('cudzy wpis: inny agent go nie widzi', not exists (select 1 from public.ud_kosz_ofert_lista(bart) x where x.offer_id = o2));
  perform tk.sprawdz('cudzy wpis: inny agent nie przywróci (brak_wpisu)',
    public.ud_oferta_z_kosza((select id from public.ud_offers_kosz where offer_id = o2), bart)->>'status' = 'brak_wpisu');
  perform tk.sprawdz('konto nieaktywne nie przywraca',
    public.ud_oferta_z_kosza((select id from public.ud_offers_kosz where offer_id = o2), niea)->>'status' = 'brak_uprawnien');

  -- ── Przywrócenie ─────────────────────────────────────────────────────────
  r := public.ud_oferta_z_kosza(k.id, ala);
  perform tk.sprawdz('przywrócenie: status ok i to samo id', r->>'status' = 'ok' and (r->>'offer_id')::uuid = o);
  select jsonb_build_object(
    'oferta', (select to_jsonb(x) from public.ud_offers x where x.id = o),
    'dok', (select jsonb_agg(to_jsonb(d) order by d.sort_order) from public.ud_offer_documents d where d.offer_id = o),
    'pliki', (select jsonb_agg(to_jsonb(f) order by f.storage_path) from public.ud_offer_files f where f.offer_id = o),
    'piny', (select jsonb_agg(to_jsonb(p)) from public.ud_offer_pins p where p.offer_id = o),
    'pytania', (select jsonb_agg(to_jsonb(q)) from public.ud_offer_questions q where q.offer_id = o),
    'wysylki', (select jsonb_agg(to_jsonb(s) order by s.wersja) from public.ud_send_log s where s.offer_id = o))
  into po;
  perform tk.sprawdz('oferta wraca bit w bit (link, kod, numer, status, wersja, przypomnienie, daty)', po->'oferta' = przed->'oferta');
  perform tk.sprawdz('warianty wracają z tymi samymi id i danymi', po->'dok' = przed->'dok');
  perform tk.sprawdz('pliki wracają (z powiązaniem z wariantami)', po->'pliki' = przed->'pliki');
  perform tk.sprawdz('PIN, pytanie klienta i historia wysyłek wracają',
    po->'piny' = przed->'piny' and po->'pytania' = przed->'pytania' and po->'wysylki' = przed->'wysylki');
  perform tk.sprawdz('sprzedany wariant wraca do leada, a wersja leada rośnie',
    (select sprzedaz_wariant_id = (przed->'dok'->1->>'id')::uuid and wersja = v_wersja + 1 from public.ud_leady where id = v_lead));
  perform tk.sprawdz('wpis z kosza znika po przywróceniu', not exists (select 1 from public.ud_offers_kosz where id = k.id));
  perform tk.sprawdz('drugie przywrócenie tego samego wpisu — brak_wpisu', public.ud_oferta_z_kosza(k.id, ala)->>'status' = 'brak_wpisu');

  -- Lead, który w międzyczasie wyszedł z „Wygrany", nie dostaje wariantu z powrotem.
  o := tk.oferta('00003');
  select l.id into v_lead from public.ud_leady l join public.ud_offer_documents d on d.id = l.sprzedaz_wariant_id where d.offer_id = o;
  r := public.ud_oferta_do_kosza(o, ala);
  update public.ud_leady set etap_id = (select e.id from public.ud_leady_etap e where e.klucz = 'oferta') where id = v_lead;
  r := public.ud_oferta_z_kosza((select id from public.ud_offers_kosz where offer_id = o), adm);
  perform tk.sprawdz('administrator przywraca cudzą ofertę', r->>'status' = 'ok');
  perform tk.sprawdz('lead już nie w Wygrany — wariant NIE wraca', (select sprzedaz_wariant_id from public.ud_leady where id = v_lead) is null);

  -- Konflikt linku: w międzyczasie powstała oferta z tym samym share_token.
  o := tk.oferta('00004');
  r := public.ud_oferta_do_kosza(o, ala);
  insert into public.ud_offers (user_id, name, status, share_token) values (ala, 'kolizja', 'draft', 'token-00004');
  perform tk.sprawdz('konflikt linku — nie przywraca, wpis zostaje',
    public.ud_oferta_z_kosza((select id from public.ud_offers_kosz where offer_id = o), ala)->>'status' = 'konflikt_linku'
    and exists (select 1 from public.ud_offers_kosz where offer_id = o));

  -- ── Czyszczenie po 30 dniach ─────────────────────────────────────────────
  update public.ud_offers_kosz set usunieto_at = now() - interval '31 days' where offer_id = o;
  perform tk.sprawdz('wpis sprzed 31 dni — do wyczyszczenia, z plikami',
    exists (select 1 from public.ud_kosz_ofert_do_wyczyszczenia() x where x.offer_id = o and array_length(x.pliki_storage, 1) = 3));
  perform tk.sprawdz('wpis sprzed chwili (oferta 00002) — jeszcze nie',
    not exists (select 1 from public.ud_kosz_ofert_do_wyczyszczenia() x where x.offer_id = o2));
  update public.ud_offers_kosz set usunieto_at = now() - interval '29 days 23 hours' where offer_id = o2;
  perform tk.sprawdz('29 dni i 23 godziny — jeszcze nie', not exists (select 1 from public.ud_kosz_ofert_do_wyczyszczenia() x where x.offer_id = o2));
  -- Oferta o tym samym id istnieje (przywrócona inną drogą) — plików nie wolno ruszać.
  insert into public.ud_offers (id, user_id, name, status) values (o, ala, 'odtworzona', 'draft');
  perform tk.sprawdz('istniejąca oferta o tym id — wpis NIE do czyszczenia', not exists (select 1 from public.ud_kosz_ofert_do_wyczyszczenia() x where x.offer_id = o));
  perform tk.sprawdz('… i nie da się jej przywrócić drugi raz (oferta_istnieje)',
    public.ud_oferta_z_kosza((select id from public.ud_offers_kosz where offer_id = o), adm)->>'status' = 'oferta_istnieje');

  -- ── Uprawnienia ──────────────────────────────────────────────────────────
  perform tk.sprawdz('anon/authenticated nie wywołają żadnej funkcji kosza',
    not has_function_privilege('anon', 'public.ud_oferta_do_kosza(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.ud_oferta_do_kosza(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.ud_oferta_z_kosza(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.ud_kosz_ofert_lista(uuid, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.ud_kosz_ofert_do_wyczyszczenia(integer, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.ud_kosz_ofert_czyszczenie()', 'execute'));
  perform tk.sprawdz('service_role wywoła przeniesienie, przywrócenie, listę i czyszczenie',
    has_function_privilege('service_role', 'public.ud_oferta_do_kosza(uuid, uuid)', 'execute')
    and has_function_privilege('service_role', 'public.ud_oferta_z_kosza(uuid, uuid)', 'execute')
    and has_function_privilege('service_role', 'public.ud_kosz_ofert_lista(uuid, integer)', 'execute')
    and has_function_privilege('service_role', 'public.ud_kosz_ofert_do_wyczyszczenia(integer, integer)', 'execute'));
  perform tk.sprawdz('tabela kosza: RLS włączone, bez polityk, bez dostępu dla anon/authenticated',
    (select relrowsecurity from pg_class where oid = 'public.ud_offers_kosz'::regclass)
    and not exists (select 1 from pg_policies where tablename = 'ud_offers_kosz')
    and not has_table_privilege('authenticated', 'public.ud_offers_kosz', 'select')
    and not has_table_privilege('anon', 'public.ud_offers_kosz', 'select'));
  perform tk.sprawdz('zadanie crona: raz dziennie 03:17 UTC, włączone',
    exists (select 1 from cron.job where jobname = 'kosz-ofert-czyszczenie' and schedule = '17 3 * * *' and active));
end $$;
