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
 * Funkcja nie jest otwartym proxy do kubełka: przepuszcza wyłącznie warianty
 * z normalizacji (`<slug>-cover-800.webp`, `<slug>-content1-1600.webp`…)
 * i tylko dla slugów wpisów portalu z `artykuly.json`. Katalog `normalized/`
 * trzyma warianty wszystkich jedenastu serwisów z `aura_articles`, więc sam
 * kształt nazwy wpuściłby zdjęcia cudzych marek pod naszą domenę. Oryginały
 * z aparatu — do 15,9 MB — i każda inna ścieżka dostają 404 bez zapytania
 * do Supabase.
 */
import dane from '../../src/dane/artykuly.json' with { type: 'json' };

/** Publiczny katalog wariantów. Ten sam prefiks przepisuje `artykuly.ts`. */
export const ZRODLO =
  'https://kukvgsjrmrqtzhkszzum.supabase.co/storage/v1/object/public/article-images/normalized/';

/**
 * Jedyne nazwy, jakie funkcja podaje — dokładnie te, które daje `nazwaPliku()`
 * w funkcji normalizacji. `artykuly.ts` importuje to samo wyrażenie, więc
 * build nie przepisze adresu, którego funkcja potem nie poda.
 */
export const NAZWA_PLIKU = /^[a-z0-9-]+-(cover|content\d+)-(800|1600)\.webp$/;

/** Slugi wpisów portalu — tylko ich warianty funkcja podaje. */
const SLUGI = new Set(dane.artykuly.map((a) => a.slug));

/**
 * Jedyny warunek dostępu, wspólny dla funkcji i `przezMedia()` w artykuly.ts:
 * build nie przepisze na /media/ adresu, którego funkcja potem nie poda.
 */
export const dozwolony = (plik) =>
  NAZWA_PLIKU.test(plik) && SLUGI.has(plik.replace(/-(cover|content\d+)-(800|1600)\.webp$/, ''));

/**
 * Doba w przeglądarce, tydzień na krawędzi. Bez `immutable`: nazwa pliku nie
 * niesie skrótu treści, a normalizacja po zmianie zdjęcia zapisuje wariant pod
 * TĄ SAMĄ nazwą — poprawiona okładka ma dojść najpóźniej po tygodniu.
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

/** Odpowiedź na HEAD to te same nagłówki bez treści. */
const bezTresci = (odp) => new Response(null, { status: odp.status, headers: odp.headers });

/**
 * Klucz bufora z nagłówkami warunkowymi żądania. Cache API Workers sam
 * odpowiada wtedy 304 (If-None-Match / If-Modified-Since) albo 206 (Range);
 * goły klucz zwracał zawsze pełne 200 i ETag z Supabase do niczego nie służył.
 */
const WARUNKOWE = ['if-none-match', 'if-modified-since', 'range'];
const zWarunkami = (url, request) => {
  const h = new Headers();
  for (const n of WARUNKOWE) {
    const v = request.headers.get(n);
    if (v) h.set(n, v);
  }
  return new Request(url, { method: 'GET', headers: h });
};

/** Czy If-None-Match żądania trafia w ETag pliku (porównanie słabe, RFC 9110). */
const pasujeEtag = (inm, etag) => {
  if (!inm || !etag) return false;
  const bez = (t) => t.trim().replace(/^W\//, '');
  return inm.split(',').some((t) => t.trim() === '*' || bez(t) === bez(etag));
};

export async function onRequest({ params, request, waitUntil }) {
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

  // Klucz bufora bez zapytania i zawsze jako GET: `?v=1`, `?v=2`… nie mogą
  // omijać bufora i za każdym razem wołać Supabase.
  const klucz = new Request(`${adres.origin}/media/${plik}`, { method: 'GET' });
  const bufor = globalThis.caches?.default;

  if (bufor) {
    const zapisana = await bufor.match(zWarunkami(klucz.url, request)).catch(() => undefined);
    if (zapisana) return metoda === 'HEAD' ? bezTresci(zapisana) : zapisana;
  }

  let obiekt;
  try {
    obiekt = await fetch(`${ZRODLO}${plik}`);
  } catch {
    return blad('Nie udało się podać pliku.', 502);
  }

  // Brak obiektu Storage zgłasza jako 400 z `"statusCode":"404"` w treści,
  // nie jako 404. Dla nas to jedno i to samo: takiego pliku nie ma.
  if (obiekt.status === 400 || obiekt.status === 404) {
    return blad('Nie znaleziono pliku.', 404);
  }
  if (!obiekt.ok || !obiekt.body) return blad('Nie udało się podać pliku.', 502);

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

  const odpowiedz = new Response(obiekt.body, { status: 200, headers: naglowki });

  if (bufor) {
    const zapis = bufor.put(klucz, odpowiedz.clone()).catch(() => {});
    if (typeof waitUntil === 'function') waitUntil(zapis);
  }

  // Przy chybieniu w bufor warunek sprawdzamy sami — dopiero PO zapisie do
  // bufora, żeby pierwszy klient z ETagiem nie zostawił bufora pustego.
  if (pasujeEtag(request.headers.get('if-none-match'), naglowki.get('etag'))) {
    odpowiedz.body?.cancel().catch(() => {});
    const h304 = new Headers({ ETag: naglowki.get('etag'), 'Cache-Control': BUFOR });
    const zmieniono = naglowki.get('last-modified');
    if (zmieniono) h304.set('Last-Modified', zmieniono);
    if (podglad) h304.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(null, { status: 304, headers: h304 });
  }

  if (metoda === 'HEAD') {
    // Treść nie wychodzi, więc nie trzymamy otwartego strumienia. Kopia dla
    // bufora czyta dalej — anulowanie jednej gałęzi nie zamyka drugiej.
    odpowiedz.body?.cancel().catch(() => {});
    return bezTresci(odpowiedz);
  }
  return odpowiedz;
}
