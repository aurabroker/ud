import type { APIRoute } from 'astro';
import dane from '../dane/dokumenty.json';
import { slugDokumentu } from '../lib/owu';

/**
 * /owu-adresy.json — mapa slug → dokument, dla funkcji `/owu/<slug>.pdf`.
 *
 * Funkcja brzegowa nie może zaimportować manifestu: jest budowana osobnym
 * pakietem i nie widzi `src/`. Czyta więc ten plik po HTTP, tak samo jak
 * middleware czyta `tokeny-markdown.json`. Plik jest wyłączony spod funkcji
 * w `_routes.json`, więc podaje go warstwa zasobów i nie ma pętli.
 *
 * Kolizja slugów wywala BUILD, nie produkcję — patrz komentarz w `lib/owu.ts`.
 */
export const GET: APIRoute = () => {
  const mapa: Record<string, { id: string; plik: string; tytul: string }> = {};

  for (const d of dane.dokumenty) {
    const slug = slugDokumentu(d.tytul);
    const juz = mapa[slug];
    if (juz) {
      throw new Error(
        `Dwa dokumenty dają ten sam adres /owu/${slug}.pdf:\n`
        + `  ${juz.id}  ${juz.tytul}\n`
        + `  ${d.id}  ${d.tytul}\n`
        + 'Najczęstsza przyczyna: w bibliotece zostały aktywne dwie wersje tego samego OWU. '
        + 'Wycofaj starszą (Panel → OWU, przełącznik active), przelicz dokumenty.json i zbuduj ponownie.',
      );
    }
    mapa[slug] = { id: d.id, plik: d.plik, tytul: d.tytul };
  }

  return new Response(JSON.stringify(mapa), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
