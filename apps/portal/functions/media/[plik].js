/**
 * /media/<plik>.webp — zdjęcia bazy wiedzy podane z naszej domeny.
 *
 * Warianty 800 i 1600 px robi przy publikacji funkcja brzegowa
 * `normalize-article-images` i kładzie je w publicznym kubełku
 * `article-images/normalized/`. Stamtąd szły wprost do przeglądarki — ale
 * Supabase Storage dokleja do KAŻDEJ odpowiedzi `x-robots-tag: none`
 * (sprawdzone curlem 21.10.2026), więc żadne zdjęcie z bloga nie mogło trafić
 * do Grafiki Google ani zostać pokazane przy wyniku. Nagłówka po tamtej
 * stronie nie wyłączymy, bo kubełek obsługuje jedenaście serwisów.
 *
 * Dlatego ta funkcja STRUMIENIUJE plik spod stałego adresu na naszej domenie,
 * jak `functions/owu/[plik].js` robi to z dokumentami OWU. Nagłówki odpowiedzi
 * składamy od zera z krótkiej listy — `x-robots-tag`, `set-cookie` Cloudflare'a
 * z supabase.co i `cache-control: private, no-cache` zostają po tamtej stronie.
 *
 * Adresy przepisuje build (`src/lib/artykuly.ts`, funkcja `przezMedia`):
 * artykuly.json i pliki treści zostają takie jak w bazie.
 *
 * Zmienne (te same, co w functions/owu): SUPABASE_SERVICE_ROLE_KEY — bez niej
 * plik idzie publicznym adresem, przez bufor CDN Supabase (patrz `pobierz`);
 * PUBLIC_SUPABASE_URL — opcjonalna.
 *
 * Funkcja nie jest otwartym proxy do kubełka: przepuszcza wyłącznie warianty
 * z normalizacji (`<slug>-cover-800.webp`, `<slug>-content1-1600.webp`…).
 * Oryginały z aparatu — do 15,9 MB — i każda inna ścieżka dostają 404 bez
 * zapytania do Supabase.
 *
 * ZNANA SŁABOŚĆ: katalog `normalized/` trzyma warianty wszystkich jedenastu
 * serwisów z `aura_articles`, a funkcja sprawdza tylko kształt nazwy — wariant
 * cudzego wpisu, jeśli ktoś zna jego nazwę, wyjdzie spod naszej domeny. Listy
 * slugów nie da się tu zaimportować: wrangler 3 w obrazie budowania Pages
 * (esbuild 0.17) nie zna `import … with { type: 'json' }`, a Node 22 w testach
 * nie wczyta JSON-a bez tego atrybutu. 21.10.2026 build Pages padł na takim
 * imporcie (test/funkcje-skladnia.spec.js pilnuje, żeby nie wrócił). Droga na
 * później: lista nazw generowana w buildzie jako plik statyczny, czytany przez
 * funkcję jak `owu-adresy.json` w functions/owu.
 */

/** Publiczny katalog wariantów. Ten sam prefiks przepisuje `artykuly.ts`. */
export const ZRODLO =
  'https://kukvgsjrmrqtzhkszzum.supabase.co/storage/v1/object/public/article-images/normalized/';

const DOMYSLNY_URL = 'https://kukvgsjrmrqtzhkszzum.supabase.co';

/**
 * Plik z kubełka — prywatną ścieżką Storage z kluczem serwisowym, a gdy
 * klucza nie ma albo ta droga zawiedzie, publicznym adresem.
 *
 * Publiczny adres idzie przez CDN Supabase, który trzyma kopię rok
 * (`max-age` z normalizacji) i nie unieważnia jej, gdy normalizacja nadpisze
 * okładkę pod tą samą nazwą. Zapytanie nie wchodzi do klucza jego bufora,
 * więc `?v=` nic tu nie da (sprawdzone 28.10.2026). Prywatna ścieżka
 * odpowiada `private, no-cache` i omija ten bufor — po podmianie okładki
 * wystarczy wyczyścić nasz.
 *
 * Klucz idzie wyłącznie w nagłówkach zapytania do Supabase; nazwa pliku
 * przeszła już przez `dozwolony()`, więc ścieżka nie wyjdzie poza katalog.
 * Zapasowa droga zostaje, żeby brak sekretu (podgląd bez zmiennych) albo
 * odmowa Storage nie wyłączyły zdjęć na całym blogu.
 */
async function pobierz(plik, env) {
  const klucz = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (klucz) {
    const url = env.PUBLIC_SUPABASE_URL ?? DOMYSLNY_URL;
    try {
      const odp = await fetch(`${url}/storage/v1/object/article-images/normalized/${plik}`, {
        headers: { apikey: klucz, Authorization: `Bearer ${klucz}` },
      });
      if (odp.ok && odp.body) return odp;
      odp.body?.cancel().catch(() => {});
    } catch {
      // Zapasowa droga niżej.
    }
  }
  return fetch(`${ZRODLO}${plik}`);
}

/**
 * Jedyne nazwy, jakie funkcja podaje — dokładnie te, które daje `nazwaPliku()`
 * w funkcji normalizacji. `artykuly.ts` importuje to samo wyrażenie, więc
 * build nie przepisze adresu, którego funkcja potem nie poda.
 */
export const NAZWA_PLIKU = /^[a-z0-9-]+-(cover|content\d+)-(800|1600)\.webp$/;

/**
 * Warunek dostępu, wspólny dla funkcji i `przezMedia()` w artykuly.ts: build
 * nie przepisze na /media/ adresu, którego funkcja potem nie poda.
 */
export const dozwolony = (plik) => NAZWA_PLIKU.test(plik);

/**
 * Doba w przeglądarce, tydzień na krawędzi. Bez `immutable`: nazwa pliku nie
 * niesie skrótu treści, a normalizacja po zmianie zdjęcia zapisuje wariant pod
 * TĄ SAMĄ nazwą — poprawiona okładka ma dojść najpóźniej po tygodniu.
 *
 * Krawędź to bufor strefy (Cloudflare domyślnie trzyma `.webp`), czyszczony
 * po adresie. Funkcja NIE trzyma niczego w Cache API (`caches.default`):
 * do 28.10.2026 trzymała, a takich wpisów nie usuwa ani czyszczenie po
 * adresie, ani po prefiksie (dokumentacja Cloudflare: tylko „Purge
 * Everything” albo Cache-Tag). Po podmianie okładki „przychodzi-lekarz-do-
 * lekarza” domena podawała stary wariant 1600 z `age` 13 godzin, choć bufor
 * strefy był wyczyszczony, a Supabase dawał już nowy plik.
 */
export const BUFOR = 'public, max-age=86400, s-maxage=604800';

const blad = (tekst, status, dodatkowe = {}) =>
  new Response(tekst, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...dodatkowe,
    },
  });

/** Czy If-None-Match żądania trafia w ETag pliku (porównanie słabe, RFC 9110). */
const pasujeEtag = (inm, etag) => {
  if (!inm || !etag) return false;
  const bez = (t) => t.trim().replace(/^W\//, '');
  return inm.split(',').some((t) => t.trim() === '*' || bez(t) === bez(etag));
};

export async function onRequest({ params, request, env }) {
  const metoda = request.method.toUpperCase();
  if (metoda !== 'GET' && metoda !== 'HEAD') {
    return blad('Metoda niedozwolona.', 405, { Allow: 'GET, HEAD' });
  }

  const plik = String(params?.plik ?? '');
  // Kształt sprawdzamy, zanim cokolwiek pójdzie dalej. Bez tego adres stałby
  // się otwartym proxy do całego publicznego kubełka, z oryginałami włącznie.
  if (!dozwolony(plik)) return blad('Nie znaleziono pliku.', 404);

  const adres = new URL(request.url);
  const podglad = adres.hostname.endsWith('.pages.dev');

  // Bufor strefy ma zapytanie w kluczu, więc `?v=1`, `?v=2`… omijałyby go
  // i za każdym razem wołały Supabase. Jeden adres na plik — reszta dostaje 301.
  if (adres.search) {
    const naglowki = { Location: `/media/${plik}`, 'Cache-Control': BUFOR };
    if (podglad) naglowki['X-Robots-Tag'] = 'noindex, nofollow';
    return new Response(null, { status: 301, headers: naglowki });
  }

  let obiekt;
  try {
    obiekt = await pobierz(plik, env);
  } catch {
    return blad('Nie udało się podać pliku.', 502);
  }

  // Brak obiektu Storage zgłasza jako 400 z `"statusCode":"404"` w treści,
  // nie jako 404. Dla nas to jedno i to samo: takiego pliku nie ma.
  if (obiekt.status === 400 || obiekt.status === 404) {
    obiekt.body?.cancel().catch(() => {});
    return blad('Nie znaleziono pliku.', 404);
  }
  if (!obiekt.ok || !obiekt.body) {
    obiekt.body?.cancel().catch(() => {});
    return blad('Nie udało się podać pliku.', 502);
  }

  const naglowki = new Headers({
    'Content-Type': 'image/webp',
    'Cache-Control': BUFOR,
    'X-Content-Type-Options': 'nosniff',
  });
  for (const nazwa of ['content-length', 'etag', 'last-modified']) {
    const wartosc = obiekt.headers.get(nazwa);
    if (wartosc) naglowki.set(nazwa, wartosc);
  }
  // Podgląd na pages.dev nie może konkurować z domeną o te same pliki.
  if (podglad) naglowki.set('X-Robots-Tag', 'noindex, nofollow');

  // Rewalidacja (przeglądarka po dobie, Googlebot-Image) z aktualnym ETagiem
  // dostaje 304 bez treści. Trafienie w bufor strefy obsługuje Cloudflare sam.
  if (pasujeEtag(request.headers.get('if-none-match'), naglowki.get('etag'))) {
    obiekt.body.cancel().catch(() => {});
    const h304 = new Headers({ ETag: naglowki.get('etag'), 'Cache-Control': BUFOR });
    const zmieniono = naglowki.get('last-modified');
    if (zmieniono) h304.set('Last-Modified', zmieniono);
    if (podglad) h304.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(null, { status: 304, headers: h304 });
  }

  if (metoda === 'HEAD') {
    // Treść nie wychodzi, więc nie trzymamy otwartego strumienia.
    obiekt.body.cancel().catch(() => {});
    return new Response(null, { status: 200, headers: naglowki });
  }
  return new Response(obiekt.body, { status: 200, headers: naglowki });
}
