-- Testy ważności linku do oferty: ud_offers.share_expires_at i ud_offer_by_token.
--
-- Jeden blok DO, który na końcu ZAWSZE rzuca wyjątek "TESTY_WYNIK …" — cała transakcja
-- (oferty testowe, zmiany ról) się wycofuje, więc ten sam plik idzie:
--   * lokalnie: apps/panel/scripts/test-link-oferty-sql.mjs,
--   * na produkcji: jako jedno zapytanie (np. MCP execute_sql). Test czyta wyłącznie
--     oferty, które sam wstawił (nazwa i token z prefiksem "zz-test-").
--
-- testy.lokalnie = on (ustawia skrypt lokalny) włącza sprawdzenie oferty wstawionej
-- PRZED migracją: istniejące linki mają dostać datę dopiero po decyzji właściciela.
-- Wynik: wiadomość wyjątku "TESTY_WYNIK pass=N fail=M [| FAIL: …]" i NOTICE PASS/FAIL.

do $testy$
declare
  lokalnie boolean := coalesce(current_setting('testy.lokalnie', true), '') = 'on';
  t_ok text := 'zz-test-' || replace(gen_random_uuid()::text, '-', '');
  t_exp text := 'zz-test-' || replace(gen_random_uuid()::text, '-', '');
  t_null text := 'zz-test-' || replace(gen_random_uuid()::text, '-', '');
  t_arch text := 'zz-test-' || replace(gen_random_uuid()::text, '-', '');
  t_def text := 'zz-test-' || replace(gen_random_uuid()::text, '-', '');
  v_exp timestamptz;
  r record;
  n int;
  wynik text;
begin
  perform set_config('testy.pass', '0', true);
  perform set_config('testy.fail', '0', true);
  perform set_config('testy.lista', '', true);
  create function pg_temp.sprawdz(warunek boolean, nazwa text) returns void language plpgsql as $f$
  begin
    if coalesce(warunek, false) then
      perform set_config('testy.pass', (current_setting('testy.pass')::int + 1)::text, true);
      raise notice 'PASS %', nazwa;
    else
      perform set_config('testy.fail', (current_setting('testy.fail')::int + 1)::text, true);
      perform set_config('testy.lista', current_setting('testy.lista') || '; ' || nazwa, true);
      raise notice 'FAIL %', nazwa;
    end if;
  end $f$;
  grant execute on function pg_temp.sprawdz(boolean, text) to public;

  perform pg_temp.sprawdz(exists (select 1 from information_schema.columns where table_schema = 'public'
                                  and table_name = 'ud_offers' and column_name = 'share_expires_at'),
    'ud_offers ma kolumnę share_expires_at');
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'ud_offers' and column_name = 'share_expires_at') then
    -- Bez kolumny reszta testów nie ma sensu (stan sprzed migracji).
    raise exception 'TESTY_WYNIK pass=% fail=% | FAIL: %', current_setting('testy.pass'),
      current_setting('testy.fail'), substr(current_setting('testy.lista'), 3);
  end if;

  -- ── Dane testowe (z danymi kontaktowymi, żeby sprawdzić, że nie wyciekają) ──
  insert into public.ud_offers (name, offer_number, client_name, client_email, client_phone, access_code,
                                share_token, status, data, share_expires_at)
  values ('zz-test-oferta', 'ZZ/1', 'Klient Testowy', 'klient@example.invalid', '+48000000000', '0000',
          t_ok, 'sent', '{"x": 1}', now() + interval '30 days');
  insert into public.ud_offers (name, client_name, client_email, share_token, status, share_expires_at, archived_at)
  values ('zz-test-oferta', 'Klient Testowy', 'klient@example.invalid', t_exp,  'sent', now() - interval '1 minute', null),
         ('zz-test-oferta', 'Klient Testowy', 'klient@example.invalid', t_null, 'sent', null, null),
         ('zz-test-oferta', 'Klient Testowy', 'klient@example.invalid', t_arch, 'sent', now() + interval '30 days', now());

  -- Nowa oferta bez jawnej daty dostaje domyślną ważność.
  insert into public.ud_offers (name, share_token, status) values ('zz-test-oferta', t_def, 'draft')
    returning share_expires_at into v_exp;
  perform pg_temp.sprawdz(v_exp between now() + interval '59 days' and now() + interval '61 days',
    'nowa oferta: share_expires_at domyślnie ok. 60 dni od utworzenia');

  if lokalnie then
    select count(*) into n from public.ud_offers where name = 'zz-test-sprzed-migracji' and share_expires_at is null;
    perform pg_temp.sprawdz(n = 1, 'oferta sprzed migracji: share_expires_at zostaje puste (decyzja właściciela)');
  end if;

  -- ── Kształt wyniku i uprawnienia ───────────────────────────────────────────
  perform pg_temp.sprawdz(
    pg_get_function_result('public.ud_offer_by_token(text)'::regprocedure)
      !~ '(SETOF|client_name|client_email|client_phone|access_code|broker_message|data jsonb|user_id|client_id)',
    'ud_offer_by_token nie zwraca danych klienta ani kodu dostępu');
  perform pg_temp.sprawdz(not has_function_privilege('anon', 'public.ud_offer_by_token(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.ud_offer_by_token(text)', 'execute'),
    'ud_offer_by_token: brak EXECUTE dla anon i authenticated (strona oferty jej nie używa)');
  perform pg_temp.sprawdz(has_function_privilege('service_role', 'public.ud_offer_by_token(text)', 'execute'),
    'ud_offer_by_token: EXECUTE dla service_role');

  -- ── Ważność linku (jako właściciel funkcji, tak jak service_role) ──────────
  select count(*) into n from public.ud_offer_by_token(t_ok);
  perform pg_temp.sprawdz(n = 1, 'ud_offer_by_token: ważny link — jeden wiersz');
  select * into r from public.ud_offer_by_token(t_ok);
  perform pg_temp.sprawdz(r.name = 'zz-test-oferta' and r.offer_number = 'ZZ/1' and r.share_expires_at > now(),
    'ud_offer_by_token: ważny link — nazwa, numer i data ważności');
  select count(*) into n from public.ud_offer_by_token(t_exp);
  perform pg_temp.sprawdz(n = 0, 'ud_offer_by_token: wygasły link — brak wiersza');
  select count(*) into n from public.ud_offer_by_token(t_null);
  perform pg_temp.sprawdz(n = 0, 'ud_offer_by_token: link bez daty ważności — brak wiersza');
  select count(*) into n from public.ud_offer_by_token(t_arch);
  perform pg_temp.sprawdz(n = 0, 'ud_offer_by_token: oferta w archiwum — brak wiersza');
  select count(*) into n from public.ud_offer_by_token('zz-test-nie-istnieje');
  perform pg_temp.sprawdz(n = 0, 'ud_offer_by_token: nieznany token — brak wiersza');
  select count(*) into n from public.ud_offer_by_token(null);
  perform pg_temp.sprawdz(n = 0, 'ud_offer_by_token: NULL — brak wiersza');

  -- ── anon ───────────────────────────────────────────────────────────────────
  set local role anon;
  set local request.jwt.claims = '{"role": "anon"}';
  begin
    select count(*) into n from public.ud_offer_by_token(t_ok);
    perform pg_temp.sprawdz(false, 'anon: wywołanie ud_offer_by_token odrzucone');
  exception when insufficient_privilege then
    perform pg_temp.sprawdz(true, 'anon: wywołanie ud_offer_by_token odrzucone');
  end;
  select count(*) into n from public.ud_offers;
  perform pg_temp.sprawdz(n = 0, 'anon: SELECT na ud_offers nie zwraca wierszy');
  update public.ud_offers set share_expires_at = now() + interval '10 years' where share_token = t_ok;
  get diagnostics n = row_count;
  perform pg_temp.sprawdz(n = 0, 'anon: UPDATE na ud_offers nie zmienia wierszy');
  reset role;

  wynik := format('TESTY_WYNIK pass=%s fail=%s%s', current_setting('testy.pass'), current_setting('testy.fail'),
                  case when current_setting('testy.lista') <> ''
                       then ' | FAIL: ' || substr(current_setting('testy.lista'), 3) else '' end);
  raise exception '%', wynik;
end
$testy$;
