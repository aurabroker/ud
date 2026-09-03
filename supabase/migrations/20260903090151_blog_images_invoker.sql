-- Jedno miejsce, z którego wołamy funkcję normalizującą: harmonogram i ręczne
-- uruchomienie idą tą samą drogą, więc token nie rozjeżdża się między nimi
-- i nie ląduje w treści zadania cron (skąd czytałby go każdy z dostępem do bazy).
create or replace function public.aura_normalize_article_images(payload jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/normalize-article-images',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-blog-token', (select decrypted_secret from vault.decrypted_secrets
                       where name = 'aura_blog_images_token')
    ),
    body := payload,
    timeout_milliseconds := 150000
  );
$$;

revoke execute on function public.aura_normalize_article_images(jsonb) from public;
revoke execute on function public.aura_normalize_article_images(jsonb) from anon;
revoke execute on function public.aura_normalize_article_images(jsonb) from authenticated;
