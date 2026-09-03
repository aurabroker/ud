/**
 * Negocjacja treści: agent prosi o Markdown, przeglądarka dostaje HTML.
 *
 * Po co: agent, który przychodzi po treść, dostaje dziś 38 kB HTML-a z nawigacją,
 * stopką, banerem zgód i wyspami Svelte — po to, żeby wyłuskać z tego pięć
 * akapitów. Ten sam tekst w Markdownie ma 5,8 kB. Pliki .md leżą obok stron,
 * kładzie je integracja `ud:markdown` w trakcie builda.
 *
 * Cloudflare ma to samo jako przełącznik na poziomie strefy („Markdown for
 * Agents") — konwertuje HTML w locie. Robimy to u siebie z dwóch powodów:
 * konwersja z builda widzi semantyczny HTML, a nie wynik po CSS-ie, i wchodzi
 * do repozytorium razem z testami. Włączenie przełącznika Cloudflare obok
 * niczego nie psuje: nasza odpowiedź jest już Markdownem.
 *
 * Wariant markdownowy ma też własny, stały adres — `/programista/index.md`.
 * Negocjacja jest wygodą, nie jedyną drogą.
 */

/** Ile pozycji trzymamy w pamięci izolatu; plik ma ~230 wpisów, więc mieści się cały. */
let tokeny = null;

/**
 * Waga typu z nagłówka Accept.
 *
 * Liczy się porządek malejącej szczegółowości: najpierw typ wymieniony
 * imiennie, potem z gwiazdką po ukośniku, na końcu typ zbiorczy z dwiema
 * gwiazdkami. Bez tej kolejności Markdown dostałaby też przeglądarka — jej
 * Accept kończy się typem zbiorczym z wagą 0,8, więc „czy w ogóle pasuje"
 * odpowiada twierdząco na wszystko.
 */
function waga(accept, typ) {
  const [rodzina] = typ.split('/');
  const wzorce = [typ, `${rodzina}/*`, '*/*'];

  for (const pozycja of accept.split(',')) {
    const [nazwa, ...parametry] = pozycja.trim().split(';');
    const dopasowanie = wzorce.indexOf(nazwa.trim().toLowerCase());
    if (dopasowanie === -1) continue;

    const q = parametry
      .map((p) => p.trim().match(/^q=([\d.]+)$/i))
      .find(Boolean);
    return { szczegolowosc: dopasowanie, q: q ? Number(q[1]) : 1 };
  }
  return { szczegolowosc: 3, q: 0 };
}

/**
 * Markdown wysyłamy tylko wtedy, gdy klient chce go bardziej niż HTML-a.
 *
 * - `text/markdown` samo w sobie — tak; HTML nie pasuje wtedy do niczego, q=0.
 * - `text/markdown, text/html;q=0.9` — tak, bo 1 jest większe niż 0,9.
 * - Accept przeglądarki — nie: text/html ma tam q=1, a Markdown wpada pod typ
 *   zbiorczy z q=0,8.
 * - Sam typ zbiorczy, czyli domyślny nagłówek curla — nie. Waga jest równa,
 *   ale żaden z typów nie jest wymieniony imiennie, więc zostaje HTML.
 */
function chceMarkdown(accept) {
  if (!accept) return false;
  const md = waga(accept, 'text/markdown');
  const html = waga(accept, 'text/html');
  if (md.q === 0) return false;
  if (md.q !== html.q) return md.q > html.q;
  // Przy równych wagach wygrywa dopasowanie dokładniejsze: text/markdown
  // wymieniony imiennie bije text/html złapane przez typ zbiorczy.
  return md.szczegolowosc < html.szczegolowosc;
}

/** Adres strony — tylko takie mają wariant .md obok siebie. */
const toStrona = (sciezka) => sciezka.endsWith('/');

/**
 * Czy warstwa zasobów naprawdę oddała plik .md.
 *
 * Sprawdzone na wranglerze: gdy pliku nie ma, Pages nie odpowiada 404, tylko
 * podaje stronę główną ze statusem 200. Samo `response.ok` przepuszcza więc
 * HTML, na którym potem stawiamy nagłówek `text/markdown` — i agent dostaje
 * dokument, który kłamie o swoim typie. Rozstrzyga typ MIME, i to przez
 * zaprzeczenie: pytamy „czy to na pewno nie jest HTML", bo nie chcemy zależeć
 * od tego, jaki dokładnie typ Pages przypisze rozszerzeniu .md.
 */
const naprawdeMarkdown = (odp) =>
  odp.ok && !(odp.headers.get('content-type') ?? '').includes('text/html');

async function liczbaTokenow(next, url) {
  if (tokeny === null) {
    try {
      // Adres musi być bezwzględny — Request w Workers nie przyjmuje ścieżki.
      const odp = await next(new URL('/tokeny-markdown.json', url).toString());
      tokeny = odp.ok ? await odp.json() : {};
    } catch {
      tokeny = {};       // brak pliku nie może wywrócić odpowiedzi
    }
  }
  return tokeny[url.pathname];
}

export async function onRequest({ request, next }) {
  const url = new URL(request.url);

  /* ── Strona wynegocjowana nagłówkiem Accept ─────────────────────────── */
  if (toStrona(url.pathname) && chceMarkdown(request.headers.get('accept'))) {
    const markdown = await next(new URL(`${url.pathname}index.md`, url).toString());

    if (naprawdeMarkdown(markdown)) {
      const naglowki = new Headers(markdown.headers);
      naglowki.set('Content-Type', 'text/markdown; charset=utf-8');
      naglowki.set('Vary', 'Accept');
      naglowki.set('Link', `<${url.href}>; rel="canonical"`);
      // Pod tym adresem indeksowana jest wersja HTML; noindex z pliku .md
      // nie może się tu przenieść, bo dotyczyłby wtedy całej podstrony.
      naglowki.delete('X-Robots-Tag');

      const ile = await liczbaTokenow(next, url);
      if (ile !== undefined) naglowki.set('x-markdown-tokens', String(ile));

      return new Response(markdown.body, { status: 200, headers: naglowki });
    }
    // Brak pliku .md (np. adres spoza builda) — leci normalna odpowiedź niżej.
    // Nie zwracamy podstawionej strony głównej jako Markdownu.
  }

  const odpowiedz = await next();
  const naglowki = new Headers(odpowiedz.headers);
  const przepisz = () => new Response(odpowiedz.body, {
    status: odpowiedz.status,
    statusText: odpowiedz.statusText,
    headers: naglowki,
  });

  /* ── Wejście wprost na /adres/index.md ──────────────────────────────── */
  if (url.pathname.endsWith('.md') && naprawdeMarkdown(odpowiedz)) {
    // Typ MIME ustawiamy sami, zamiast liczyć na to, jak Pages potraktuje
    // rozszerzenie .md. Ten sam tekst stoi pod adresem strony, więc do
    // wyszukiwarki idzie noindex — indeksowana ma być wersja HTML.
    naglowki.set('Content-Type', 'text/markdown; charset=utf-8');
    naglowki.set('X-Robots-Tag', 'noindex');
    naglowki.set('Link', `<${url.href.replace(/index\.md$/, '')}>; rel="canonical"`);
    return przepisz();
  }

  /* ── Zwykły HTML ────────────────────────────────────────────────────── */
  if (naglowki.get('content-type')?.startsWith('text/html')) {
    // Vary na KAŻDEJ odpowiedzi HTML, nie tylko na wynegocjowanej: bez tego
    // bufor pośredni mógłby podać przeglądarce zapisany wcześniej Markdown.
    naglowki.append('Vary', 'Accept');
    if (toStrona(url.pathname)) {
      naglowki.append('Link', `<${url.pathname}index.md>; rel="alternate"; type="text/markdown"`);
    }
    return przepisz();
  }

  return odpowiedz;
}
