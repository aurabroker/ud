/**
 * /pobierz/<id> — podpisany odnośnik do dokumentu z prywatnego kubełka.
 *
 * Funkcja Cloudflare Pages. Portal jest statyczny, ale pliki OWU leżą
 * w kubełku `ud-owu` z włączonym RLS, więc adres trzeba podpisać kluczem
 * serwisowym. Robimy to tutaj, a nie w przeglądarce — klucz serwisowy nigdy
 * nie opuszcza serwera.
 *
 * Wymagana zmienna środowiskowa w projekcie Pages:
 *   SUPABASE_SERVICE_ROLE_KEY   (sekret, „Encrypt" w panelu Cloudflare)
 *   PUBLIC_SUPABASE_URL         (opcjonalna, ma wartość domyślną)
 *
 * Ograniczenie, o którym trzeba wiedzieć: podpisany adres żyje 300 sekund,
 * więc treść PDF-ów jest niewidoczna dla wyszukiwarek i modeli językowych.
 * Docelowo aktywne pliki powinny mieć kopię w kubełku publicznym pod stałym,
 * czytelnym adresem — wtedy ta funkcja przekierowuje tam bez podpisywania.
 */
const DOMYSLNY_URL = 'https://kukvgsjrmrqtzhkszzum.supabase.co';
const WAZNOSC_SEKUND = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const blad = (tekst, status) =>
  new Response(tekst, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export async function onRequestGet({ params, env }) {
  const id = String(params.id ?? '');
  // Walidujemy kształt identyfikatora, zanim trafi do zapytania — bez tego
  // ścieżka staje się otwartym proxy do dowolnego wiersza tabeli.
  if (!UUID.test(id)) return blad('Nieprawidłowy identyfikator dokumentu.', 400);

  const url = env.PUBLIC_SUPABASE_URL ?? DOMYSLNY_URL;
  const klucz = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!klucz) return blad('Pobieranie dokumentów jest chwilowo niedostępne.', 503);

  const naglowki = { apikey: klucz, Authorization: `Bearer ${klucz}` };

  // 1. Metadane pliku. Tylko dokumenty aktywne — wycofane OWU nie mogą
  //    wyciekać przez stary link z cudzej zakładki.
  const wiersze = await fetch(
    `${url}/rest/v1/ud_owu_library?select=storage_bucket,storage_path,file_name&id=eq.${id}&active=is.true`,
    { headers: naglowki },
  ).then((o) => (o.ok ? o.json() : null));

  const plik = wiersze?.[0];
  if (!plik) return blad('Nie znaleziono dokumentu.', 404);

  // 2. Podpisanie adresu.
  const podpis = await fetch(
    `${url}/storage/v1/object/sign/${plik.storage_bucket}/${plik.storage_path}`,
    {
      method: 'POST',
      headers: { ...naglowki, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: WAZNOSC_SEKUND }),
    },
  ).then((o) => (o.ok ? o.json() : null));

  if (!podpis?.signedURL) return blad('Nie udało się przygotować pliku do pobrania.', 502);

  const docelowy = new URL(`${url}/storage/v1${podpis.signedURL}`);
  // Nazwa pliku z bazy zamiast UUID-a w nazwie pobranego dokumentu.
  docelowy.searchParams.set('download', plik.file_name);

  return new Response(null, {
    status: 302,
    headers: {
      Location: docelowy.href,
      // Adres wygasa po 300 s, więc pośrednicy nie mogą go buforować.
      'Cache-Control': 'no-store',
    },
  });
}
