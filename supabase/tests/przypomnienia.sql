-- Reguły wyboru kandydatów do przypomnienia SMS o ofercie
-- (ud_oferty_do_przypomnienia, migracje 20261012123157 i 20261012162649).
-- Uruchamia apps/panel/scripts/test-przypomnienia-sql.mjs na jednorazowym
-- klastrze: stub.sql + migracje leadów + przypomnienia-stub.sql + obie
-- migracje przypomnień, potem ten plik. Każda asercja to NOTICE PASS/FAIL.
--
-- Każda oferta ma własnego klienta (chyba że test dotyczy rodzeństwa ofert),
-- więc przypadki nie wpływają na siebie nawzajem.

create schema if not exists tp;

create function tp.sprawdz(nazwa text, warunek boolean) returns void language plpgsql as $$
begin
  if coalesce(warunek, false) then raise notice 'PASS %', nazwa;
  else raise notice 'FAIL %', nazwa;
  end if;
end $$;

/** Klient z telefonem; zwraca jego id. */
create function tp.klient(nazwa text, telefon text default '504400901') returns uuid language sql as $$
  insert into public.ud_clients (full_name, phone, source) values (nazwa, telefon, 'form') returning id
$$;

/** Oferta wysłana p_dni dni temu; zwraca jej id. */
create function tp.oferta(
  p_nazwa text, p_klient uuid, p_dni numeric, p_status text default 'sent', p_wersja integer default 1
) returns uuid language sql as $$
  insert into public.ud_offers (name, client_id, status, sent_at, wersja)
  values (p_nazwa, p_klient, p_status, now() - make_interval(secs => p_dni * 86400), p_wersja)
  returning id
$$;

/** Lead klienta w etapie o kluczu p_etap. */
create function tp.lead(p_klient uuid, p_etap text, p_archiwum boolean default false) returns void language sql as $$
  insert into public.ud_leady (pipeline_id, etap_id, klient_id, zarchiwizowano_at)
  select e.pipeline_id, e.id, p_klient, case when p_archiwum then now() end
    from public.ud_leady_etap e
    join public.ud_leady_pipeline p on p.id = e.pipeline_id and p.klucz = 'sprzedaz'
   where e.klucz = p_etap
$$;

create function tp.jest(p_oferta uuid) returns boolean language sql as $$
  select exists (select 1 from public.ud_oferty_do_przypomnienia() k where k.offer_id = p_oferta)
$$;

do $$
declare
  k uuid; o uuid; o2 uuid; r record;
begin
  -- ── Okno czasu i status ──────────────────────────────────────────────────
  k := tp.klient('Podstawowy', '+48 600 100 200');
  o := tp.oferta('podstawowa', k, 5);
  select * into r from public.ud_oferty_do_przypomnienia() x where x.offer_id = o;
  perform tp.sprawdz('oferta wysłana 5 dni temu, bez odpowiedzi — kandydat', r.offer_id = o);
  perform tp.sprawdz('kandydat niesie wersję i telefon z kartoteki', r.wersja = 1 and r.telefon_klienta = '+48 600 100 200' and r.telefon_oferty is null);

  o := tp.oferta('za wcześnie', tp.klient('Wczesny'), 2);
  perform tp.sprawdz('2 dni po wysyłce — jeszcze nie', not tp.jest(o));
  perform tp.sprawdz('… ale z progiem 1 dnia już tak (parametr działa)',
    exists (select 1 from public.ud_oferty_do_przypomnienia(1, 30) x where x.offer_id = o));

  o := tp.oferta('za późno', tp.klient('Późny'), 31);
  perform tp.sprawdz('31 dni po wysyłce — już nie', not tp.jest(o));

  o := tp.oferta('obejrzana', tp.klient('Oglądający'), 6, 'viewed');
  perform tp.sprawdz('obejrzana bez decyzji — kandydat', tp.jest(o));

  o := tp.oferta('robocza', tp.klient('Roboczy'), 6, 'draft');
  perform tp.sprawdz('robocza (draft) — nie', not tp.jest(o));

  o := tp.oferta('archiwalna', tp.klient('Archiwalny'), 6);
  update public.ud_offers set archived_at = now() where id = o;
  perform tp.sprawdz('oferta w archiwum — nie', not tp.jest(o));

  o := tp.oferta('bez wysyłki', tp.klient('Bez daty'), 6);
  update public.ud_offers set sent_at = null where id = o;
  perform tp.sprawdz('bez daty wysyłki — nie', not tp.jest(o));

  -- ── Odpowiedź klienta ────────────────────────────────────────────────────
  o := tp.oferta('z wyborem', tp.klient('Wybierający'), 6, 'viewed');
  update public.ud_offers set client_choice = '{"document_id":"x"}'::jsonb where id = o;
  perform tp.sprawdz('klient wybrał wariant (client_choice) — nie', not tp.jest(o));

  o := tp.oferta('z decyzją', tp.klient('Decydujący'), 6, 'viewed');
  update public.ud_offers set decided_at = now() where id = o;
  perform tp.sprawdz('jest decided_at — nie', not tp.jest(o));

  o := tp.oferta('z pytaniem', tp.klient('Pytający'), 6);
  insert into public.ud_offer_questions (offer_id, asked_at) values (o, now() - interval '1 day');
  perform tp.sprawdz('pytanie klienta po wysyłce — nie', not tp.jest(o));

  o := tp.oferta('ze starym pytaniem', tp.klient('Pytał wcześniej'), 6);
  insert into public.ud_offer_questions (offer_id, asked_at) values (o, now() - interval '10 days');
  perform tp.sprawdz('pytanie sprzed wysyłki nie zamyka sprawy — kandydat', tp.jest(o));

  -- ── Inne oferty tego samego klienta ──────────────────────────────────────
  k := tp.klient('Dwie oferty');
  o := tp.oferta('starsza', k, 10);
  o2 := tp.oferta('nowsza', k, 4);
  perform tp.sprawdz('starsza z dwóch wysłanych — nie', not tp.jest(o));
  perform tp.sprawdz('najnowsza wysłana — kandydat', tp.jest(o2));

  k := tp.klient('Kupił gdzie indziej');
  o := tp.oferta('kupiona', k, 20, 'bought');
  update public.ud_offers set sent_at = now() - interval '40 days' where id = o;
  o2 := tp.oferta('cicha', k, 5);
  perform tp.sprawdz('klient KUPIŁ w innej ofercie — nie (poprawka …162649)', not tp.jest(o2));

  k := tp.klient('Wybrał gdzie indziej');
  o := tp.oferta('wybrana', k, 20, 'chosen');
  update public.ud_offers set sent_at = now() - interval '40 days' where id = o;
  o2 := tp.oferta('cicha', k, 5);
  perform tp.sprawdz('klient WYBRAŁ w innej ofercie — nie (poprawka …162649)', not tp.jest(o2));

  k := tp.klient('Zrezygnował ze starej');
  o := tp.oferta('odrzucona', k, 20, 'rejected');
  update public.ud_offers set sent_at = now() - interval '40 days' where id = o;
  o2 := tp.oferta('nowa propozycja', k, 5);
  perform tp.sprawdz('rezygnacja ze STAREJ oferty nie blokuje przypomnienia o nowej', tp.jest(o2));

  o := tp.oferta('bez klienta', null, 6);
  update public.ud_offers set client_phone = '504400901' where id = o;
  perform tp.sprawdz('oferta bez klienta — nie (poprawka …162649)', not tp.jest(o));

  -- ── Lead na tablicy ──────────────────────────────────────────────────────
  k := tp.klient('Lead otwarty');   o := tp.oferta('o', k, 6); perform tp.lead(k, 'oferta');
  perform tp.sprawdz('lead w otwartym etapie — kandydat', tp.jest(o));
  k := tp.klient('Lead wygrany');   o := tp.oferta('o', k, 6); perform tp.lead(k, 'wygrany');
  perform tp.sprawdz('lead w Wygrany — nie', not tp.jest(o));
  k := tp.klient('Lead przegrany'); o := tp.oferta('o', k, 6); perform tp.lead(k, 'przegrany');
  perform tp.sprawdz('lead w Przegrany — nie', not tp.jest(o));
  k := tp.klient('Lead w archiwum'); o := tp.oferta('o', k, 6); perform tp.lead(k, 'oferta', true);
  perform tp.sprawdz('lead zarchiwizowany — nie (poprawka …162649)', not tp.jest(o));

  -- ── Jedno przypomnienie na wersję i osierocone zajęcia ───────────────────
  o := tp.oferta('przypomniana', tp.klient('Przypomniany'), 6);
  update public.ud_offers set przypomnienie_wersja = 1, przypomnienie_sms_at = now() - interval '2 days' where id = o;
  insert into public.ud_send_log (offer_id, channel, recipient, status, wersja)
  values (o, 'sms_przypomnienie', '48504400901', 'sent', 1);
  perform tp.sprawdz('o tej wersji już przypomnieliśmy — nie', not tp.jest(o));

  o := tp.oferta('wysłana ponownie', tp.klient('Wersja 2'), 4, 'sent', 2);
  update public.ud_offers set przypomnienie_wersja = 1, przypomnienie_sms_at = now() - interval '9 days' where id = o;
  select * into r from public.ud_oferty_do_przypomnienia() x where x.offer_id = o;
  perform tp.sprawdz('nowa wersja po przypomnieniu o starej — kandydat z wersją 2', r.wersja = 2);

  o := tp.oferta('osierocona', tp.klient('Osierocony'), 6);
  update public.ud_offers set przypomnienie_wersja = 1, przypomnienie_sms_at = now() - interval '2 hours' where id = o;
  perform tp.sprawdz('zajęcie sprzed 2 h bez wpisu w dzienniku — wraca do puli (poprawka …162649)', tp.jest(o));

  o := tp.oferta('w toku', tp.klient('W toku'), 6);
  update public.ud_offers set przypomnienie_wersja = 1, przypomnienie_sms_at = now() - interval '10 minutes' where id = o;
  perform tp.sprawdz('zajęcie sprzed 10 min bez wpisu — inne wywołanie w toku, nie', not tp.jest(o));

  o := tp.oferta('pending', tp.klient('Pending'), 6);
  update public.ud_offers set przypomnienie_wersja = 1, przypomnienie_sms_at = now() - interval '2 hours' where id = o;
  insert into public.ud_send_log (offer_id, channel, recipient, status, wersja)
  values (o, 'sms_przypomnienie', '48504400901', 'pending', 1);
  perform tp.sprawdz('wpis „pending" (SMS mógł wyjść) — bez ponowienia', not tp.jest(o));

  o := tp.oferta('zły numer', tp.klient('Zły numer'), 6);
  update public.ud_offers set przypomnienie_wersja = 1, przypomnienie_sms_at = now() - interval '2 hours' where id = o;
  insert into public.ud_send_log (offer_id, channel, recipient, status, wersja, error)
  values (o, 'sms_przypomnienie', '48504400901', 'error', 1, 'SMSAPI błąd 13');
  perform tp.sprawdz('odrzucony numer (zajęcie zostaje, wpis error) — bez ponowienia', not tp.jest(o));

  o := tp.oferta('zwolniona', tp.klient('Zwolniony'), 6);
  insert into public.ud_send_log (offer_id, channel, recipient, status, wersja, error)
  values (o, 'sms_przypomnienie', '48504400901', 'error', 1, 'SMSAPI błąd 103');
  perform tp.sprawdz('zwolniona po błędzie SMSAPI (zajęcie puste) — znów kandydat', tp.jest(o));

  o := tp.oferta('inny kanał', tp.klient('SMS o ofercie'), 6);
  update public.ud_offers set przypomnienie_wersja = 1, przypomnienie_sms_at = now() - interval '2 hours' where id = o;
  insert into public.ud_send_log (offer_id, channel, recipient, status, wersja)
  values (o, 'sms', '48504400901', 'sent', 1);
  perform tp.sprawdz('SMS „wysłaliśmy ofertę" to nie przypomnienie — osierocone zajęcie wraca', tp.jest(o));

  -- ── Uprawnienia i charakter funkcji ──────────────────────────────────────
  perform tp.sprawdz('anon nie wywoła listy kandydatów',
    not has_function_privilege('anon', 'public.ud_oferty_do_przypomnienia(integer, integer)', 'execute'));
  perform tp.sprawdz('authenticated nie wywoła listy kandydatów',
    not has_function_privilege('authenticated', 'public.ud_oferty_do_przypomnienia(integer, integer)', 'execute'));
  perform tp.sprawdz('service_role wywoła listę kandydatów',
    has_function_privilege('service_role', 'public.ud_oferty_do_przypomnienia(integer, integer)', 'execute'));
  perform tp.sprawdz('anon i authenticated nie wywołają crona',
    not has_function_privilege('anon', 'public.ud_oferty_przypomnienia()', 'execute')
    and not has_function_privilege('authenticated', 'public.ud_oferty_przypomnienia()', 'execute'));
  perform tp.sprawdz('lista kandydatów jest tylko do odczytu (stable)',
    (select provolatile = 's' from pg_proc where oid = 'public.ud_oferty_do_przypomnienia(integer, integer)'::regprocedure));
  perform tp.sprawdz('zadanie crona istnieje, co godzinę o :25, WYŁĄCZONE',
    exists (select 1 from cron.job where jobname = 'oferty-przypomnienia-sms' and schedule = '25 * * * *' and active = false));
end $$;
