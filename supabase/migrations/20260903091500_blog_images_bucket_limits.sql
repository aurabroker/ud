-- Kubełek na zdjęcia artykułów miał `file_size_limit = null` i żadnego
-- ograniczenia typu MIME. Stąd wzięły się pliki po 15,9 MB prosto z aparatu:
-- CMS przyjmował wszystko, a normalizacja jest sprzątaniem po fakcie.
--
-- 5 MB to tyle samo, co w kubełku `salon-photos`, i tyle, ile z zapasem
-- wystarcza na zdjęcie do artykułu. Ograniczenie działa na nowe wysyłki;
-- pliki już leżące w kubełku zostają nietknięte.
update storage.buckets
set file_size_limit    = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
where id = 'article-images';
