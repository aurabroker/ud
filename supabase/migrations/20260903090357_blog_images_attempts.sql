-- Licznik prób.
--
-- Zdjęcie, którego nie da się przemielić (za duże, uszkodzone, zniknęło
-- z kubełka), inaczej wracałoby do kolejki przy każdym uruchomieniu
-- harmonogramu — bez końca i bez efektu. Po piątej próbie artykuł wypada
-- z kolejki i czeka na człowieka.
alter table public.aura_articles
  add column if not exists images_attempts integer not null default 0;

comment on column public.aura_articles.images_attempts is
  'Liczba prób normalizacji. 5 = kolejka odpuszcza; zerowanie ręczne albo '
  'automatyczne przy zmianie zdjęcia lub treści.';

-- Zmiana zdjęcia albo treści to nowy materiał — licznik startuje od zera.
create or replace function public.aura_articles_mark_images_pending()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.images_status := coalesce(new.images_status, 'pending');
    return new;
  end if;

  -- Aktualizacja, która sama ustawia stan, pochodzi od funkcji normalizującej.
  -- Bez tego wyjątku funkcja i wyzwalacz kręciłyby się w kółko: funkcja
  -- zapisuje 'ready', wyzwalacz natychmiast wraca do 'pending'.
  if new.images_status is distinct from old.images_status
     or new.images_attempts is distinct from old.images_attempts then
    return new;
  end if;

  if new.preview_image_url is distinct from old.preview_image_url
     or new.thumbnail_url is distinct from old.thumbnail_url
     or new.content is distinct from old.content then
    new.images_status   := 'pending';
    new.images_error    := null;
    new.images_attempts := 0;
  end if;

  return new;
end $$;

comment on column public.aura_article_images.width is
  'Szerokość największego wariantu (1600 px albo mniej, gdy oryginał był mniejszy). '
  'Do atrybutu width w <img>, żeby układ strony nie skakał przy wczytywaniu.';
comment on column public.aura_article_images.height is
  'Wysokość największego wariantu — para do kolumny width.';
