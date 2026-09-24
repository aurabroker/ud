/**
 * /owu/<slug>.pdf — publiczny, stały adres dokumentu z prywatnego kubełka.
 *
 * Portal jest statyczny, a pliki OWU leżą w kubełku `ud-owu` z włączonym RLS.
 * Wcześniej `/pobierz/<id>` przekierowywał na adres podpisany na 300 sekund
 * i to wystarczało człowiekowi, ale nie robotowi: zaindeksować treść PDF-a
 * można tylko pod adresem, który będzie żył jutro. Skutek był taki, że
 * warunki ubezpieczenia — najbardziej merytoryczna treść, jaką mamy — były
 * dla wyszukiwarek i modeli językowych niewidoczne.
 *
 * Dlatego ta funkcja STRUMIENIUJE plik zamiast przekierowywać. Przekierowanie
 * oddałoby adres końcowy domenie `supabase.co` i to ona wylądowałaby
 * w indeksie razem z naszą treścią.
 *
 * Wymagana zmienna środowiskowa w projekcie Pages:
 *   SUPABASE_SERVICE_ROLE_KEY   (sekret, „Encrypt" w panelu Cloudflare)
 *   PUBLIC_SUPABASE_URL         (opcjonalna, ma wartość domyślną)
 *
 * Dlaczego dwa zapytania, a nie jedno: mapa slug → id pochodzi z builda,
 * ale `active` sprawdzamy NA ŻYWO w bazie. Gdyby aktywność brać z mapy,
 * wycofany dokument byłby serwowany aż do następnego wdrożenia portalu —
 * a wycofanie warunków ubezpieczenia musi działać od razu.
 */
const DOMYSLNY_URL = 'https://kukvgsjrmrqtzhkszzum.supabase.co';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* Bufor krawędziowy trzyma plik krótko, nie godzinami. Dłuższy oszczędziłby
   wywołań, ale wycofane OWU wisiałoby pod publicznym adresem tyle, ile trwa
   wpis w buforze — a to jest dokument, na który klient się powołuje. */
const BUFOR = 'public, max-age=300, s-maxage=600';

const blad = (tekst, status) =>
  new Response(tekst, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** Nazwa pliku do nagłówka: ASCII dla starych klientów + RFC 5987 dla reszty. */
function nazwaPliku(nazwa) {
  const ascii = nazwa.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nazwa)}`;
}

export async function onRequestGet({ params, env, request }) {
  const plik = String(params.plik ?? '');
  if (!plik.endsWith('.pdf')) return blad('Nie znaleziono dokumentu.', 404);

  const slug = plik.slice(0, -4);
  // Walidujemy kształt, zanim cokolwiek pójdzie dalej — bez tego adres staje
  // się otwartym proxy do dowolnego klucza mapy.
  if (!SLUG.test(slug)) return blad('Nieprawidłowy adres dokumentu.', 400);

  const klucz = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!klucz) return blad('Pobieranie dokumentów jest chwilowo niedostępne.', 503);
  const url = env.PUBLIC_SUPABASE_URL ?? DOMYSLNY_URL;

  // 1. Mapa z builda. Czytana zwykłym fetch-em po naszej własnej domenie:
  //    `/owu-adresy.json` jest wyłączone spod funkcji w `_routes.json`, więc
  //    podaje ją warstwa zasobów i nie ma pętli.
  const mapa = await fetch(new URL('/owu-adresy.json', request.url).toString())
    .then((o) => (o.ok ? o.json() : null))
    .catch(() => null);
  const wpis = mapa?.[slug];
  if (!wpis) return blad('Nie znaleziono dokumentu.', 404);

  const naglowki = { apikey: klucz, Authorization: `Bearer ${klucz}` };

  // 2. Wiersz z bazy — TYLKO aktywny. Wycofane OWU nie może wyciekać pod
  //    publicznym adresem, który ktoś ma w zakładkach.
  const wiersze = await fetch(
    `${url}/rest/v1/ud_owu_library`
    + `?select=storage_bucket,storage_path,file_name&id=eq.${wpis.id}&active=is.true`,
    { headers: naglowki },
  ).then((o) => (o.ok ? o.json() : null)).catch(() => null);

  const dokument = wiersze?.[0];
  if (!dokument) return blad('Nie znaleziono dokumentu.', 404);

  // 3. Pobranie obiektu kluczem serwisowym. Bez podpisywania — podpis byłby
  //    tu dodatkowym żądaniem po to, żeby zaraz samemu z niego skorzystać.
  const obiekt = await fetch(
    `${url}/storage/v1/object/${dokument.storage_bucket}/${dokument.storage_path}`,
    { headers: naglowki },
  );
  if (!obiekt.ok || !obiekt.body) return blad('Nie udało się podać pliku.', 502);

  const wyjscie = new Headers({
    'Content-Type': 'application/pdf',
    // `inline`, nie `attachment`: dokument ma się otworzyć, a nie spaść na dysk.
    'Content-Disposition': nazwaPliku(dokument.file_name || `${slug}.pdf`),
    'Cache-Control': BUFOR,
    'X-Content-Type-Options': 'nosniff',
  });
  const dlugosc = obiekt.headers.get('content-length');
  if (dlugosc) wyjscie.set('Content-Length', dlugosc);
  // Podgląd na pages.dev nie może konkurować z domeną o te same pliki.
  if (new URL(request.url).hostname.endsWith('.pages.dev')) {
    wyjscie.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return new Response(obiekt.body, { status: 200, headers: wyjscie });
}
