/**
 * Kanał RSS bazy wiedzy.
 *
 * Layout linkuje go z <head> na każdej podstronie, więc musi istnieć —
 * ale to nie jest wyłącznie porządek. Czytniki i agregatory to jedno,
 * a dla robotów kanał jest najtańszym sygnałem, że w serwisie pojawia się
 * nowa treść i kiedy dokładnie.
 */
import type { APIRoute } from 'astro';
import { ARTYKULY } from '../../lib/artykuly';
import { SERWIS, FIRMA } from '../../lib/firma';

/** XML nie wybacza gołych ampersandów ani nawiasów ostrych. */
const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const rfc822 = (iso: string) => new Date(iso).toUTCString();

export const GET: APIRoute = () => {
  const najnowszy = ARTYKULY[0]?.opublikowano ?? new Date().toISOString();

  const wpisy = ARTYKULY.map((a) => {
    const url = `${SERWIS.url}/blog/${a.slug}/`;
    return `    <item>
      <title>${esc(a.tytul)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rfc822(a.opublikowano)}</pubDate>
      <description>${esc(a.zajawka)}</description>
${a.tagi.map((t) => `      <category>${esc(t)}</category>`).join('\n')}
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Baza wiedzy ${esc(SERWIS.nazwa)}</title>
    <link>${SERWIS.url}/blog/</link>
    <atom:link href="${SERWIS.url}/blog/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Ile realnie płaci ZUS na zwolnieniu, kto finansuje L4 i gdzie kończy się zakres prywatnej polisy.</description>
    <language>pl-pl</language>
    <copyright>${esc(FIRMA.nazwa)}</copyright>
    <lastBuildDate>${rfc822(najnowszy)}</lastBuildDate>
${wpisy}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
