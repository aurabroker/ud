import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickReadSettings,
} from 'npm:@imagemagick/magick-wasm@0.0.30';

/**
 * normalize-article-images — sprowadza zdjęcia artykułów do rozmiaru,
 * który da się wysłać przeglądarce.
 *
 * Powód istnienia: kubełek `article-images` zbierał pliki prosto z aparatu —
 * jedenaście plików na 68 MB, największy 15,9 MB. Kafelek na blogu ma 800 px
 * szerokości, więc każdy taki artykuł to kilkanaście sekund oczekiwania na
 * łączu komórkowym i kilkanaście megabajtów transferu za każdą odsłonę.
 * Do tego redaktor potrafi wkleić obrazek prosto do treści jako `data:` URI;
 * jeden taki artykuł ma 1,3 mln znaków HTML-a i nie da się go zbuforować.
 *
 * Naprawa po stronie serwisu byłaby naprawą jednego z jedenastu — pozostałe
 * dalej pobierałyby oryginały. Dlatego normalizacja siedzi przy bazie:
 * zapisuje warianty 800 i 1600 px w WebP, wpisuje ich adresy do
 * `aura_articles.preview_image_800/1600` i podmienia adresy w treści.
 * Każdy serwis czyta gotowy, lekki adres i nie musi nic o tym wiedzieć.
 *
 * Wołana przez pg_cron (co godzinę) i ręcznie przez `net.http_post`.
 * Nie ma tu JWT do sprawdzenia — żądanie idzie z wnętrza bazy — więc wpuszcza
 * wyłącznie nagłówek `x-blog-token` zgodny z sekretem w Vault.
 *
 * `sharp` w Edge Functions nie działa (biblioteka natywna), stąd magick-wasm.
 */

/* Szerokości takie same jak w apps/portal/scripts/synchronizuj.mjs — dzięki temu
 * zrzut do repozytorium i normalizacja w bazie dają ten sam zestaw plików. */
const SZEROKOSCI = [800, 1600] as const;

/* Limity na jedno wywołanie. Worker dostaje około dwóch sekund czasu
 * procesora — przekroczenie kończy się zabiciem całego żądania, bez wyniku
 * i bez wpisu w bazie. Lepiej przemielić kolejkę w kilku przebiegach. */
const MAKS_ARTYKULOW = 1;
const MAKS_ZDJEC = 3;
const MAKS_PROB = 5;
const MAKS_ZRODLA = 20 * 1024 * 1024;

/* Powyżej tego progu nie dotykamy oryginału sami.
 *
 * Rozpakowanie i przekodowanie JPEG-a z aparatu (15,9 MB) nie mieści się
 * w tych dwóch sekundach — sprawdzone, ginie w połowie. Supabase ma własną
 * usługę skalowania (`/render/image/`), która robi to po swojej stronie:
 * ten sam plik wraca stamtąd jako 598 kB. Rozliczana jest za tysiąc zdjęć
 * źródłowych, a mamy ich kilkanaście — i to raz, bo wynik zostaje w kubełku. */
const PROG_RENDERA = 1_500_000;
const CZAS_NA_PRACE = 110_000;

const KUBELEK = 'article-images';
const KATALOG = 'normalized';

const URL_BAZY = Deno.env.get('SUPABASE_URL')!;
const KLUCZ = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const baza = createClient(URL_BAZY, KLUCZ);

const json = (dane: unknown, status = 200) =>
  new Response(JSON.stringify(dane, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/* ── ImageMagick ──────────────────────────────────────────────────────────
 * Inicjalizacja jest kosztowna, więc dzieje się raz, przy pierwszym żądaniu,
 * a nie przy starcie modułu: gdyby CDN nie odpowiedział, funkcja bez tego
 * w ogóle by się nie uruchomiła i nawet nie zwróciłaby błędu. */
let gotowy: Promise<void> | null = null;

function przygotujMagick(): Promise<void> {
  gotowy ??= (async () => {
    try {
      const sciezka = new URL('magick.wasm', import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.30'));
      await initializeImageMagick(await Deno.readFile(sciezka));
    } catch {
      // Bundler nie zawsze wystawia plik .wasm na dysku — wtedy z CDN-a.
      const odp = await fetch('https://cdn.jsdelivr.net/npm/@imagemagick/magick-wasm@0.0.30/dist/magick.wasm');
      if (!odp.ok) throw new Error(`magick.wasm: ${odp.status}`);
      await initializeImageMagick(new Uint8Array(await odp.arrayBuffer()));
    }
  })();
  return gotowy;
}

/**
 * Skaluje bajty źródłowe do zadanych szerokości i koduje w WebP.
 *
 * Dwie rzeczy trzymają to w budżecie czasu procesora — pierwsza wersja padła
 * na zdjęciu 15,9 MB z komunikatem „CPU Time exceeded”:
 *
 * 1. `jpeg:size` — libjpeg dekoduje plik od razu w mniejszej skali, więc
 *    6000×4000 nie rozpakowuje się do ~96 MB bitmapy, tylko do kilkunastu.
 *    Dla PNG i WebP define jest ignorowany, ale te pliki są tu małe.
 * 2. Jeden odczyt na wszystkie warianty: 800 px powstaje z już zmniejszonego
 *    1600 px, zamiast dekodować oryginał drugi raz.
 */
function przeskaluj(zrodlo: Uint8Array) {
  const najwieksza = Math.max(...SZEROKOSCI);
  const ustawienia = new MagickReadSettings();
  ustawienia.setDefine(MagickFormat.Jpeg, 'size', `${najwieksza}x${najwieksza}`);

  return ImageMagick.read(zrodlo, ustawienia, (obraz) => {
    // Orientacja z EXIF-a — bez tego zdjęcie z telefonu leży na boku.
    try { obraz.autoOrient(); } catch { /* format bez EXIF-a */ }

    if (obraz.width * obraz.height > 40_000_000) {
      throw new Error(`${obraz.width}×${obraz.height} px — za duże na jeden przebieg`);
    }

    // Zdjęcia z aparatu niosą GPS i model urządzenia — do bloga niepotrzebne.
    try { obraz.strip(); } catch { /* starsza wersja biblioteki */ }
    obraz.quality = 80;

    const warianty = new Map<number, Uint8Array>();
    let szerokosc = obraz.width;
    let wysokosc = obraz.height;

    for (const w of [...SZEROKOSCI].sort((a, b) => b - a)) {
      if (obraz.width > w) {
        obraz.resize(w, Math.max(1, Math.round((obraz.height * w) / obraz.width)));
      }
      if (w === najwieksza) {
        szerokosc = obraz.width;
        wysokosc = obraz.height;
      }
      warianty.set(w, obraz.write(MagickFormat.WebP, (d) => new Uint8Array(d)));
    }

    return { warianty, szerokosc, wysokosc };
  });
}

/**
 * Wymiary z nagłówka WebP — pierwsze trzydzieści bajtów pliku.
 *
 * Potrzebne do atrybutów width i height w <img>: bez nich przeglądarka nie
 * wie, ile miejsca zarezerwować, i strona podskakuje w trakcie wczytywania.
 * Czytamy nagłówek zamiast dekodować obrazek, bo dekodowanie kosztuje czas
 * procesora, którego tu nie ma.
 */
function wymiaryWebp(dane: Uint8Array): { szerokosc: number; wysokosc: number } | null {
  if (dane.length < 30) return null;
  const widok = new DataView(dane.buffer, dane.byteOffset, dane.byteLength);
  const znacznik = String.fromCharCode(...dane.subarray(12, 16));

  if (znacznik === 'VP8 ') {
    return {
      szerokosc: widok.getUint16(26, true) & 0x3fff,
      wysokosc: widok.getUint16(28, true) & 0x3fff,
    };
  }
  if (znacznik === 'VP8L') {
    const bity = widok.getUint32(21, true);
    return {
      szerokosc: (bity & 0x3fff) + 1,
      wysokosc: ((bity >> 14) & 0x3fff) + 1,
    };
  }
  if (znacznik === 'VP8X') {
    const licz = (o: number) => (dane[o] | (dane[o + 1] << 8) | (dane[o + 2] << 16)) + 1;
    return { szerokosc: licz(24), wysokosc: licz(27) };
  }
  return null;
}

const suma = async (bajty: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bajty)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const adresPubliczny = (sciezka: string) =>
  `${URL_BAZY}/storage/v1/object/public/${KUBELEK}/${sciezka}`;

/** Ścieżka w naszym Storage albo null, gdy adres prowadzi gdzie indziej. */
function wKubelku(adres: string): string | null {
  const przedrostek = `${URL_BAZY}/storage/v1/object/public/`;
  return adres.startsWith(przedrostek) ? adres.slice(przedrostek.length) : null;
}

const nazwaPliku = (slug: string, rola: string, seq: number, w: number) =>
  `${KATALOG}/${slug}-${rola}${rola === 'content' ? seq : ''}-${w}.webp`;

/** Zamienia data URI na bajty. */
function zDataUri(dane: string): Uint8Array {
  const binarne = atob(dane);
  const bajty = new Uint8Array(binarne.length);
  for (let i = 0; i < binarne.length; i++) bajty[i] = binarne.charCodeAt(i);
  return bajty;
}

type Zrodlo = {
  rola: 'cover' | 'content';
  seq: number;
  /** Adres źródła albo null, gdy obrazek był wklejony w treść jako data URI. */
  adres: string | null;
  /** Dokładny tekst do podmiany w treści; null dla okładki. */
  doPodmiany: string | null;
  bajty: Uint8Array | null;
};

const DATA_URI = /src="data:image\/[a-zA-Z+]+;base64,([^"]+)"/g;
const W_TRESCI = /src="(https:\/\/[^"]*\/storage\/v1\/object\/public\/[^"]+)"/g;

/**
 * Zbiera wszystkie źródła zdjęć jednego artykułu: okładkę, obrazki wklejone
 * jako data URI i obrazki wskazane adresem w treści.
 */
function zrodlaArtykulu(artykul: Record<string, unknown>): Zrodlo[] {
  const zrodla: Zrodlo[] = [];

  const okladka = (artykul.preview_image_url as string) || (artykul.thumbnail_url as string) || null;
  if (okladka && !okladka.includes(`/${KATALOG}/`)) {
    zrodla.push({ rola: 'cover', seq: 1, adres: okladka, doPodmiany: null, bajty: null });
  }

  const tresc = (artykul.content as string) ?? '';
  let seq = 0;

  for (const trafienie of tresc.matchAll(DATA_URI)) {
    zrodla.push({
      rola: 'content',
      seq: ++seq,
      adres: null,
      doPodmiany: trafienie[0],
      bajty: zDataUri(trafienie[1]),
    });
  }

  for (const trafienie of tresc.matchAll(W_TRESCI)) {
    const adres = trafienie[1];
    if (adres.includes(`/${KATALOG}/`)) continue; // już znormalizowany
    zrodla.push({ rola: 'content', seq: ++seq, adres, doPodmiany: adres, bajty: null });
  }

  return zrodla;
}

/**
 * Warianty zrobione przez usługę skalowania Supabase.
 *
 * Zwraca null, gdy usługa nie oddała WebP — wtedy dzwoni druga droga,
 * przez ImageMagick. Nie zapisujemy JPEG-a pod nazwą .webp.
 */
async function wariantyZRenderera(sciezkaWKubelku: string) {
  const warianty = new Map<number, Uint8Array>();
  let szerokosc: number | null = null;
  let wysokosc: number | null = null;

  for (const w of [...SZEROKOSCI].sort((a, b) => b - a)) {
    const adres = `${URL_BAZY}/storage/v1/render/image/public/${sciezkaWKubelku}`
      + `?width=${w}&resize=contain&quality=80`;
    const odp = await fetch(adres, { headers: { Accept: 'image/webp,*/*' } });
    if (!odp.ok) throw new Error(`render ${w}px: ${odp.status}`);

    const typ = odp.headers.get('content-type') ?? '';
    const dane = new Uint8Array(await odp.arrayBuffer());
    if (!typ.includes('webp')) return null;

    if (szerokosc === null) {
      const wymiary = wymiaryWebp(dane);
      szerokosc = wymiary?.szerokosc ?? w;
      wysokosc = wymiary?.wysokosc ?? 0;
    }
    warianty.set(w, dane);
  }

  return { warianty, szerokosc: szerokosc ?? 0, wysokosc: wysokosc ?? 0 };
}

async function wyslij(sciezka: string, dane: Uint8Array) {
  const { error } = await baza.storage.from(KUBELEK).upload(sciezka, dane, {
    contentType: 'image/webp',
    upsert: true,
    // Nazwa pliku zawiera slug i szerokość, więc treść pod danym adresem
    // się nie zmienia — można buforować na rok.
    cacheControl: '31536000',
  });
  if (error) throw new Error(`upload ${sciezka}: ${error.message}`);
}

async function przetworzArtykul(artykul: Record<string, unknown>, budzet: { zdjec: number; koniec: number }) {
  const slug = (artykul.slug as string) || (artykul.id as string);

  // Licznik rośnie PRZED pracą. Gdy worker padnie na limicie pamięci, nie
  // dopisze już niczego do bazy — a ten zapis jest, więc artykuł nie wraca
  // do kolejki w nieskończoność.
  await baza
    .from('aura_articles')
    .update({ images_attempts: ((artykul.images_attempts as number) ?? 0) + 1 })
    .eq('id', artykul.id as string);

  const zrodla = zrodlaArtykulu(artykul);

  let tresc = (artykul.content as string) ?? '';
  const podmiany: Array<[string, string]> = [];
  const bledy: string[] = [];
  let okladka800: string | null = null;
  let okladka1600: string | null = null;
  let zTresci800: string | null = null;
  let zTresci1600: string | null = null;
  let zrobione = 0;

  // Rejestr z poprzedniego przebiegu — po sumie kontrolnej poznajemy, że to
  // samo źródło już przemieliliśmy, i nie robimy tego drugi raz.
  const { data: znane } = await baza
    .from('aura_article_images')
    .select('image_role, seq, source_sha256, url_800, url_1600')
    .eq('article_id', artykul.id as string);

  for (const zrodlo of zrodla) {
    if (budzet.zdjec <= 0 || Date.now() > budzet.koniec) break;

    try {
      const sciezka = zrodlo.adres ? wKubelku(zrodlo.adres) : null;

      // Ile waży źródło — zanim je ściągniemy. Przy pliku 15,9 MB to różnica
      // między jednym żądaniem HEAD a kilkunastoma megabajtami transferu.
      let rozmiar = zrodlo.bajty?.byteLength ?? 0;
      let etag = '';
      if (zrodlo.adres) {
        const glowa = await fetch(zrodlo.adres, { method: 'HEAD' });
        if (!glowa.ok) throw new Error(`pobranie ${glowa.status}`);
        rozmiar = Number(glowa.headers.get('content-length') ?? 0);
        etag = glowa.headers.get('etag') ?? '';
      }
      if (rozmiar > MAKS_ZRODLA) {
        throw new Error(`źródło ${Math.round(rozmiar / 1024 / 1024)} MB — powyżej limitu`);
      }

      const przezRenderer = Boolean(sciezka) && rozmiar > PROG_RENDERA;

      // Tożsamość źródła, po której poznajemy, że nic się nie zmieniło.
      // Dla lekkich plików to suma z bajtów. Dla ciężkich — adres, etag
      // i rozmiar, bo etag jest sumą policzoną po stronie Storage i nie musimy
      // ściągać oryginału tylko po to, żeby stwierdzić, że jest ten sam.
      let bajty = zrodlo.bajty;
      let sha: string;
      if (przezRenderer) {
        sha = await suma(new TextEncoder().encode(`${zrodlo.adres}|${etag}|${rozmiar}`));
      } else {
        if (!bajty) {
          const odp = await fetch(zrodlo.adres!);
          if (!odp.ok) throw new Error(`pobranie ${odp.status}`);
          bajty = new Uint8Array(await odp.arrayBuffer());
        }
        sha = await suma(bajty);
      }
      const wpis = (znane ?? []).find(
        (z) => z.image_role === zrodlo.rola && z.seq === zrodlo.seq && z.source_sha256 === sha,
      );

      let url800: string;
      let url1600: string;

      if (wpis) {
        url800 = wpis.url_800;
        url1600 = wpis.url_1600;
      } else {
        budzet.zdjec--;
        const zRenderera = przezRenderer ? await wariantyZRenderera(sciezka!) : null;
        if (przezRenderer && !zRenderera) {
          throw new Error('usługa skalowania nie oddała WebP — oryginał za ciężki na przekodowanie tutaj');
        }
        const { warianty, szerokosc, wysokosc } = zRenderera ?? przeskaluj(bajty!);
        const sciezki = SZEROKOSCI.map((w) => nazwaPliku(slug, zrodlo.rola, zrodlo.seq, w));
        for (let i = 0; i < SZEROKOSCI.length; i++) await wyslij(sciezki[i], warianty.get(SZEROKOSCI[i])!);

        url800 = adresPubliczny(sciezki[0]);
        url1600 = adresPubliczny(sciezki[1]);

        const { error } = await baza.from('aura_article_images').upsert({
          article_id: artykul.id,
          image_role: zrodlo.rola,
          seq: zrodlo.seq,
          source_url: zrodlo.adres,
          source_sha256: sha,
          source_bytes: rozmiar,
          path_800: sciezki[0],
          path_1600: sciezki[1],
          url_800: url800,
          url_1600: url1600,
          width: szerokosc,
          height: wysokosc,
          bytes_800: warianty.get(800)!.byteLength,
          bytes_1600: warianty.get(1600)!.byteLength,
        }, { onConflict: 'article_id,image_role,seq' });
        if (error) throw new Error(`rejestr: ${error.message}`);
        zrobione++;
      }

      if (zrodlo.rola === 'cover') {
        okladka800 = url800;
        okladka1600 = url1600;
      } else if (zrodlo.doPodmiany) {
        if (zrodlo.seq === 1) {
          zTresci800 = url800;
          zTresci1600 = url1600;
        }
        podmiany.push([zrodlo.doPodmiany, zrodlo.doPodmiany.startsWith('src="') ? `src="${url1600}"` : url1600]);
      }
    } catch (e) {
      bledy.push(`${zrodlo.rola}${zrodlo.seq}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Treść przepisujemy dopiero, gdy wszystkie warianty leżą w kubełku —
  // inaczej artykuł wskazywałby na plik, którego nie ma.
  if (podmiany.length) {
    // Oryginał zapisujemy raz, przed pierwszą podmianą. Bez tego nie da się
    // cofnąć automatycznej zmiany w treści, którą czyta jedenaście serwisów.
    await baza.from('aura_article_content_backup').upsert({
      article_id: artykul.id,
      content: artykul.content as string,
      reason: 'normalize-article-images: podmiana adresów obrazków',
    }, { onConflict: 'article_id', ignoreDuplicates: true });

    for (const [z, na] of podmiany) tresc = tresc.replaceAll(z, na);
  }

  // Redakcja bywa, że wstawia zdjęcie do treści, a pola okładki zostawia puste
  // — cztery z trzynastu artykułów tak wyglądały. Artykuł ma wtedy zdjęcie,
  // tylko nikt go nie wskazał; bierzemy pierwsze z treści, zamiast pokazywać
  // na liście kafelek zastępczy. Przy powtórnym przebiegu treść jest już
  // przepisana i regexp nic w niej nie znajdzie — wtedy pyta rejestr.
  if (!okladka800) {
    const pierwsze = zTresci800
      ? { url_800: zTresci800, url_1600: zTresci1600 as string }
      : (znane ?? []).find((z) => z.image_role === 'content' && z.seq === 1);
    if (pierwsze) {
      okladka800 = pierwsze.url_800;
      okladka1600 = pierwsze.url_1600;
    }
  }

  const zmiana: Record<string, unknown> = {
    images_status: bledy.length ? 'error' : 'ready',
    images_error: bledy.length ? bledy.join('; ').slice(0, 1000) : null,
    images_checked_at: new Date().toISOString(),
  };
  if (okladka800) {
    zmiana.preview_image_800 = okladka800;
    zmiana.preview_image_1600 = okladka1600;
  }
  if (tresc !== artykul.content) zmiana.content = tresc;

  const { error } = await baza.from('aura_articles').update(zmiana).eq('id', artykul.id as string);
  if (error) throw new Error(`zapis artykułu ${slug}: ${error.message}`);

  return {
    slug,
    zrodel: zrodla.length,
    przetworzonych: zrobione,
    trescPrzepisana: podmiany.length > 0,
    okladka: Boolean(okladka800),
    bledy,
  };
}

Deno.serve(async (req) => {
  const token = req.headers.get('x-blog-token') ?? '';
  const { data: zgadzaSie, error: bladTokenu } = await baza.rpc('aura_blog_token_matches', { token });
  if (bladTokenu) return json({ blad: 'nie mogę sprawdzić tokenu', szczegoly: bladTokenu.message }, 500);
  if (zgadzaSie !== true) return json({ blad: 'brak lub zły nagłówek x-blog-token' }, 401);

  let opcje: { limit?: number; slug?: string; wszystkie?: boolean } = {};
  try { opcje = await req.json(); } catch { /* puste ciało = domyślne ustawienia */ }

  let zapytanie = baza
    .from('aura_articles')
    .select('id, slug, content, preview_image_url, thumbnail_url, images_status, images_attempts')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(opcje.limit ?? MAKS_ARTYKULOW, 10));

  if (opcje.slug) zapytanie = zapytanie.eq('slug', opcje.slug);
  else if (!opcje.wszystkie) {
    zapytanie = zapytanie.eq('images_status', 'pending').lt('images_attempts', MAKS_PROB);
  }

  const { data: artykuly, error } = await zapytanie;
  if (error) return json({ blad: 'odczyt artykułów', szczegoly: error.message }, 500);
  if (!artykuly?.length) return json({ zrobione: [], zostalo: 0, komunikat: 'nic nie czeka' });

  await przygotujMagick();

  const budzet = { zdjec: MAKS_ZDJEC, koniec: Date.now() + CZAS_NA_PRACE };
  const zrobione = [];
  for (const artykul of artykuly) {
    try {
      zrobione.push(await przetworzArtykul(artykul, budzet));
    } catch (e) {
      zrobione.push({ slug: artykul.slug, bledy: [e instanceof Error ? e.message : String(e)] });
    }
    if (Date.now() > budzet.koniec) break;
  }

  const { count } = await baza
    .from('aura_articles')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .eq('images_status', 'pending')
    .lt('images_attempts', MAKS_PROB);

  return json({ zrobione, zostalo: count ?? 0 });
});
