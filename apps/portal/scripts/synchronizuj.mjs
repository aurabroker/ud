/**
 * synchronizuj.mjs — zrzuca treści z Supabase do plików w repozytorium.
 *
 * Dlaczego zrzut, a nie pobieranie w trakcie builda:
 *
 * 1. Build musi być powtarzalny. Gdyby `astro build` odpytywał bazę, ten sam
 *    commit dawałby różne strony, a awaria Supabase wywracałaby deploy.
 * 2. Zrzut jest w gicie, więc widać w diffie, co zmieniło się w treści —
 *    tak samo jak przy zwykłej edycji kodu.
 * 3. Podgląd lokalny działa bez sieci i bez kluczy.
 *
 * Uruchamiaj przed buildem, gdy redakcja opublikuje coś nowego:
 *
 *     PUBLIC_SUPABASE_URL=... PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @ud/portal dane
 *
 * Klucz service_role jest potrzebny wyłącznie do biblioteki OWU
 * (RLS: is_ud_user()). Bez niego skrypt zsynchronizuje artykuły i opinie,
 * a dokumenty zostawi bez zmian.
 */
import { writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KATALOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'dane');
const KATALOG_ARTYKULOW = join(KATALOG, 'artykuly');
const KATALOG_OBRAZKOW = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'blog');

const URL_BAZY = process.env.PUBLIC_SUPABASE_URL ?? 'https://kukvgsjrmrqtzhkszzum.supabase.co';
const KLUCZ_ANON = process.env.PUBLIC_SUPABASE_ANON_KEY;
const KLUCZ_SERWISOWY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KLUCZ_ANON) {
  console.error('Brak PUBLIC_SUPABASE_ANON_KEY — bez niego nie pobiorę artykułów ani opinii.');
  process.exit(1);
}

async function pobierz(sciezka, klucz) {
  const odp = await fetch(`${URL_BAZY}/rest/v1/${sciezka}`, {
    headers: { apikey: klucz, Authorization: `Bearer ${klucz}` },
  });
  if (!odp.ok) throw new Error(`${sciezka} → ${odp.status} ${await odp.text()}`);
  return odp.json();
}

const dzis = new Date().toISOString().slice(0, 10);
const zapisz = (plik, dane) =>
  writeFileSync(join(KATALOG, plik), JSON.stringify(dane, null, 2) + '\n', 'utf8');

/* ── Artykuły ─────────────────────────────────────────────────────────────
 * Treść trzymamy w osobnych plikach .html, a nie w JSON-ie: diff pokazuje
 * wtedy zmienione zdania, a nie jedną długą linię z uciekniętymi cudzysłowami.
 */
{
  const kolumny = 'id,slug,title,excerpt,tags,published_at,created_at,preview_image_url,thumbnail_url,content';
  const surowe = await pobierz(
    `aura_articles?select=${kolumny}&status=eq.published&platforms=cs.{"UtrataDochodu.pl"}&order=published_at.desc`,
    KLUCZ_ANON,
  );

  mkdirSync(KATALOG_ARTYKULOW, { recursive: true });
  mkdirSync(KATALOG_OBRAZKOW, { recursive: true });

  const zachowane = new Set();
  const artykuly = surowe.map((a) => {
    zachowane.add(`${a.slug}.html`);

    /**
     * Redaktor potrafi wkleić do CMS-a obrazek jako data URI. Jeden taki
     * wpis waży 1,3 MB i wjeżdża w kod HTML strony, przez co dokument
     * przestaje się mieścić w budżecie LCP, a przeglądarka nie może go
     * zbuforować osobno. Wyciągamy je do plików obok reszty statyków.
     */
    let numer = 0;
    const tresc = (a.content ?? '').replace(
      /src="data:image\/([a-z]+);base64,([A-Za-z0-9+/=]+)"/g,
      (_, typ, dane) => {
        const nazwa = `${a.slug}-${++numer}.${typ === 'jpeg' ? 'jpg' : typ}`;
        writeFileSync(join(KATALOG_OBRAZKOW, nazwa), Buffer.from(dane, 'base64'));
        return `src="/blog/${nazwa}"`;
      },
    );

    writeFileSync(join(KATALOG_ARTYKULOW, `${a.slug}.html`), tresc, 'utf8');

    return {
      slug: a.slug,
      tytul: a.title,
      zajawka: a.excerpt ?? '',
      tagi: a.tags ?? [],
      opublikowano: a.published_at ?? a.created_at,
      utworzono: a.created_at,
      obraz: a.preview_image_url || a.thumbnail_url || null,
    };
  });

  // Artykuł wycofany z publikacji ma zniknąć także z repo, inaczej jego
  // strona zostanie w buildzie na zawsze.
  for (const plik of readdirSync(KATALOG_ARTYKULOW)) {
    if (!zachowane.has(plik)) rmSync(join(KATALOG_ARTYKULOW, plik));
  }

  zapisz('artykuly.json', {
    pobrano: dzis,
    zrodlo: 'aura_articles (status=published, platforms zawiera UtrataDochodu.pl)',
    artykuly,
  });
  console.log(`artykuły: ${artykuly.length}`);
}

/* ── Opinie ─────────────────────────────────────────────────────────────── */
{
  const surowe = await pobierz(
    'ud_review?select=name,city,zawod,rating,comment,created_at&approved=eq.true&order=created_at.desc',
    KLUCZ_ANON,
  );
  const opinie = surowe.map((o) => ({
    imie: o.name,
    miasto: o.city,
    zawod: o.zawod ?? null,
    ocena: o.rating,
    tresc: o.comment ?? '',
    data: o.created_at,
  }));
  zapisz('opinie.json', { pobrano: dzis, zrodlo: 'ud_review (approved = true)', opinie });
  console.log(`opinie: ${opinie.length}`);
}

/* ── Biblioteka OWU ─────────────────────────────────────────────────────── */
if (!KLUCZ_SERWISOWY) {
  console.log('dokumenty: pominięte (brak SUPABASE_SERVICE_ROLE_KEY)');
} else {
  const surowe = await pobierz(
    'ud_owu_library?select=id,insurer_type,symbol,title,file_name,size_bytes&active=eq.true&order=symbol',
    KLUCZ_SERWISOWY,
  );

  /** Rodzaj rozpoznajemy z tytułu — w bazie nie ma osobnej kolumny. */
  const rodzaj = (tytul) => {
    const t = tytul.toLowerCase();
    if (t.includes('karta produktu') || t.includes('ipid')) return 'ipid';
    if (t.includes('hiv') || t.includes('wzw') || t.includes('szczegól')) return 'warunki-szczegolne';
    return 'owu';
  };

  const dokumenty = surowe.map((d) => ({
    id: d.id,
    ubezpieczyciel: d.insurer_type,
    symbol: d.symbol,
    tytul: d.title,
    rodzaj: rodzaj(d.title ?? ''),
    plik: d.file_name,
    bajty: d.size_bytes,
  }));
  zapisz('dokumenty.json', { pobrano: dzis, zrodlo: 'ud_owu_library (active = true)', dokumenty });
  console.log(`dokumenty: ${dokumenty.length}`);
}
