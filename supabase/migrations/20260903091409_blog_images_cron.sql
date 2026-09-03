-- Kolejka mieli się sama.
--
-- Co dziesięć minut, bo jedno wywołanie bierze jeden artykuł: przy limicie
-- dwóch sekund procesora na żądanie to jedyny sposób, żeby ciężkie zdjęcie
-- nie zabiło całej porcji. Gdy nie ma nic do zrobienia, funkcja kończy się
-- po jednym zapytaniu — kosztu praktycznie nie ma.
--
-- Token siedzi w funkcji aura_normalize_article_images, nie w treści zadania:
-- cron.job czyta każdy, kto ma dostęp do bazy.
select cron.schedule(
  'normalize-article-images',
  '*/10 * * * *',
  $$ select public.aura_normalize_article_images('{}'::jsonb) $$
);
