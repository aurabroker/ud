-- Funkcje brzegowe wołane przez pg_cron dostają token z Vaulta.
--
-- send-digest-email i sync-beauty-companies miały verify_jwt = false i żadnej
-- bramki w kodzie, bo cron wołał je gołym net.http_post bez nagłówka. Każdy,
-- kto znał adres — także robot, który trafi na niego GET-em — mógł:
--   * wysłać raport zgłoszeń na biuro@ i odczytać z odpowiedzi, ile leadów
--     wpadło w ostatnie dwie godziny,
--   * odpalić pełną synchronizację firm z projektu BEAUTY do CRM-u i dostać
--     w odpowiedzi ich liczbę, a przy błędzie surowy komunikat PostgREST-u
--     tamtego projektu.
-- Że roboty te adresy znajdują, widać w logach: 17.09 SemrushBot zapukał
-- GET-em do div-send-email.
--
-- Wzorzec ten sam co przy normalize-article-images: token leży w Vaulcie,
-- zadanie cron woła funkcję SQL-ową, a ta dokłada nagłówek x-cron-token.
-- Tokenu nie ma w treści zadania, więc nie przeczyta go nikt, kto ogląda
-- cron.job.
--
-- Osobny sekret, nie aura_blog_images_token: wyciek jednego nie otwiera
-- funkcji, które chroni drugi. Wartość powstaje w bazie i jej nie opuszcza —
-- ten plik jej nie zawiera.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'edge_cron_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'edge_cron_token',
      'Nagłówek x-cron-token dla funkcji brzegowych wołanych przez pg_cron'
    );
  end if;
end $$;

-- Sprawdzenie nagłówka po stronie funkcji brzegowej (rpc kluczem serwisowym).
create or replace function public.edge_cron_token_matches(token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'edge_cron_token'
      and decrypted_secret = token
  );
$$;

-- Raport zgłoszeń co dwie godziny. Limit 30 s zamiast domyślnych 5 s: funkcja
-- potrafi pracować ponad 10 s, a przy krótszym limicie net._http_response
-- zapisuje timeout zamiast prawdziwego wyniku i nie widać, czy raport wyszedł.
create or replace function public.ud_send_digest_email()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/send-digest-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets
                       where name = 'edge_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$;

-- Codzienna synchronizacja firm z projektu BEAUTY do CRM-u (tenant Aura Expert).
create or replace function public.aura_sync_beauty_companies()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/sync-beauty-companies',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets
                       where name = 'edge_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$;

revoke all on function public.edge_cron_token_matches(text) from public, anon, authenticated;
revoke all on function public.ud_send_digest_email() from public, anon, authenticated;
revoke all on function public.aura_sync_beauty_companies() from public, anon, authenticated;
grant execute on function public.edge_cron_token_matches(text) to service_role;
grant execute on function public.ud_send_digest_email() to service_role;
grant execute on function public.aura_sync_beauty_companies() to service_role;

-- Przepięcie zadań po identyfikatorze, nie po nazwie: cron.schedule z tą samą
-- nazwą pod innym użytkownikiem założyłby drugie zadanie obok starego (stare
-- dalej wołałoby funkcję bez tokenu), a alter_job przy niezgodności
-- właściciela głośno się wywala. Harmonogramy zostają bez zmian.
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'digest-email-2h'),
  command := 'select public.ud_send_digest_email()'
);
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'sync-beauty-companies-daily'),
  command := 'select public.aura_sync_beauty_companies()'
);

-- Nowa funkcja rpc ma być widoczna dla PostgREST-u od razu, zanim wdroży się
-- funkcje brzegowe, które ją wołają.
notify pgrst, 'reload schema';
