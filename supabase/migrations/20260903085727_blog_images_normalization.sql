-- Normalizacja zdjęć bloga dla wszystkich platform korzystających z aura_articles.
--
-- Nazwy kolumn po angielsku — tak jak reszta wspólnego schematu CMS-a.
-- Zmiany są wyłącznie addytywne: żadna istniejąca kolumna ani ograniczenie
-- nie zmienia znaczenia, więc jedenaście serwisów czytających tę tabelę
-- działa dalej bez zmian w kodzie.

-- ── 1. Warianty okładki na samym artykule ────────────────────────────────
-- Serwis potrzebuje jednego lekkiego adresu, a nie oryginału z aparatu.
-- images_status daje deterministyczną odpowiedź na pytanie „czy to zdjęcie
-- już jest, czy jeszcze się przetwarza” — bez tego każdy z serwisów musiałby
-- zgadywać po pustym polu.
alter table public.aura_articles
  add column if not exists preview_image_800  text,
  add column if not exists preview_image_1600 text,
  add column if not exists images_status      text not null default 'pending',
  add column if not exists images_error       text,
  add column if not exists images_checked_at  timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'aura_articles_images_status_check'
  ) then
    alter table public.aura_articles
      add constraint aura_articles_images_status_check
      check (images_status in ('pending', 'ready', 'error'));
  end if;
end $$;

comment on column public.aura_articles.preview_image_800 is
  'Okładka przeskalowana do 800 px (WebP) — do kafelków i list. Null = brak zdjęcia.';
comment on column public.aura_articles.preview_image_1600 is
  'Okładka przeskalowana do 1600 px (WebP) — do nagłówka artykułu.';
comment on column public.aura_articles.images_status is
  'pending = czeka na normalizację, ready = warianty aktualne (null w preview_image_800 '
  'znaczy wtedy „artykuł naprawdę nie ma zdjęcia”), error = normalizacja się nie udała.';

-- ── 2. Rejestr wariantów ─────────────────────────────────────────────────
-- Jeden wiersz na jedno źródłowe zdjęcie. Suma kontrolna źródła jest po to,
-- żeby ponowne uruchomienie nie przetwarzało tego samego pliku drugi raz —
-- CMS potrafi wgrać ten sam obrazek dwa razy pod różnymi nazwami.
create table if not exists public.aura_article_images (
  id             uuid primary key default gen_random_uuid(),
  article_id     uuid not null references public.aura_articles(id) on delete cascade,
  image_role     text not null check (image_role in ('cover', 'content')),
  seq            smallint not null default 1,
  source_url     text,
  source_sha256  text not null,
  source_bytes   bigint,
  path_800       text not null,
  path_1600      text not null,
  url_800        text not null,
  url_1600       text not null,
  width          integer,
  height         integer,
  bytes_800      integer,
  bytes_1600     integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (article_id, image_role, seq)
);

create index if not exists aura_article_images_article_idx
  on public.aura_article_images (article_id);
create index if not exists aura_article_images_sha_idx
  on public.aura_article_images (source_sha256);

comment on table public.aura_article_images is
  'Przeskalowane warianty zdjęć artykułów. Zapisuje wyłącznie funkcja brzegowa '
  'normalize-article-images; serwisy tylko czytają.';

alter table public.aura_article_images enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'aura_article_images'
      and policyname = 'aura_article_images_public_read'
  ) then
    create policy aura_article_images_public_read
      on public.aura_article_images for select to anon, authenticated using (true);
  end if;
end $$;

-- Brak polityk insert/update/delete jest celowy: pisze tylko service_role,
-- który i tak omija RLS.

-- ── 3. Kopia treści sprzed przepisania ───────────────────────────────────
-- Funkcja normalizująca wyciąga z content obrazki wklejone jako data URI
-- i podmienia je na adresy plików. To jedyna operacja, która modyfikuje
-- treść artykułu, więc oryginał zapisujemy raz, przed pierwszą podmianą.
create table if not exists public.aura_article_content_backup (
  article_id  uuid primary key references public.aura_articles(id) on delete cascade,
  content     text not null,
  reason      text not null,
  created_at  timestamptz not null default now()
);

comment on table public.aura_article_content_backup is
  'Treść artykułu sprzed automatycznego przepisania adresów obrazków. '
  'Jeden wiersz na artykuł — zapisywany tylko przy pierwszej podmianie.';

alter table public.aura_article_content_backup enable row level security;
-- Zero polityk: kopia zapasowa nie jest treścią publiczną.

-- ── 4. Znacznik „do przeliczenia” ────────────────────────────────────────
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
  if new.images_status is distinct from old.images_status then
    return new;
  end if;

  if new.preview_image_url is distinct from old.preview_image_url
     or new.thumbnail_url is distinct from old.thumbnail_url
     or new.content is distinct from old.content then
    new.images_status := 'pending';
    new.images_error  := null;
  end if;

  return new;
end $$;

drop trigger if exists aura_articles_images_pending on public.aura_articles;
create trigger aura_articles_images_pending
  before insert or update on public.aura_articles
  for each row execute function public.aura_articles_mark_images_pending();

-- ── 5. updated_at w rejestrze ────────────────────────────────────────────
create or replace function public.aura_article_images_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists aura_article_images_touch on public.aura_article_images;
create trigger aura_article_images_touch
  before update on public.aura_article_images
  for each row execute function public.aura_article_images_touch();
