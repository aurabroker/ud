/**
 * /pobierz/<id> — stary adres dokumentu, przekierowanie na nowy.
 *
 * Do 2026-09 ta funkcja podpisywała adres z prywatnego kubełka na 300 sekund.
 * Podpisany adres wygasa, więc treść PDF-ów była niewidoczna dla wyszukiwarek
 * i modeli językowych. Zastąpił ją `/owu/<slug>.pdf`, który strumieniuje plik
 * spod stałego adresu na naszej domenie — patrz `functions/owu/[plik].js`.
 *
 * Ten adres zostaje, bo siedzi w cudzych zakładkach i w wysłanych e-mailach.
 * Odpowiada 301, nie 302: dla wyszukiwarki to sygnał, że wartość starego
 * adresu ma przejść na nowy, a nie że oba mają żyć obok siebie.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const blad = (tekst, status) =>
  new Response(tekst, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet({ params, request }) {
  const id = String(params.id ?? '');
  if (!UUID.test(id)) return blad('Nieprawidłowy identyfikator dokumentu.', 400);

  const mapa = await fetch(new URL('/owu-adresy.json', request.url).toString())
    .then((o) => (o.ok ? o.json() : null))
    .catch(() => null);

  const slug = Object.keys(mapa ?? {}).find((s) => mapa[s].id === id);
  // Brak w mapie znaczy, że dokument jest wycofany albo nigdy nie istniał.
  // Jedno i drugie to dla tego adresu 404 — nie zgadujemy zamiennika.
  if (!slug) return blad('Nie znaleziono dokumentu.', 404);

  return new Response(null, {
    status: 301,
    headers: {
      Location: `/owu/${slug}.pdf`,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
