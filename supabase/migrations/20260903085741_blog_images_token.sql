-- Token dostępowy do funkcji normalizującej.
--
-- Funkcja jest wołana przez pg_cron przez net.http_post, a więc z wnętrza bazy,
-- nie z przeglądarki. Nie ma tu żadnego JWT do sprawdzenia, więc wpuszczamy
-- wyłącznie żądania z tym nagłówkiem. Wartość powstaje w bazie i nigdzie
-- indziej nie jest zapisywana — nie widzi jej ani kod, ani logi.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'aura_blog_images_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'aura_blog_images_token',
      'Nagłówek x-blog-token dla funkcji normalize-article-images'
    );
  end if;
end $$;

-- Porównanie po stronie bazy: funkcja brzegowa pyta „czy ten token się zgadza”,
-- a nie „podaj mi token”. Sekret nie opuszcza Postgresa.
create or replace function public.aura_blog_token_matches(token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'aura_blog_images_token'
      and decrypted_secret = token
  );
$$;

revoke execute on function public.aura_blog_token_matches(text) from public;
revoke execute on function public.aura_blog_token_matches(text) from anon;
revoke execute on function public.aura_blog_token_matches(text) from authenticated;
grant execute on function public.aura_blog_token_matches(text) to service_role;
