/**
 * artykuly.ts — czytanie bazy wiedzy ze zrzutu i naprawianie tego,
 * co wychodzi z edytora CMS-a.
 *
 * Stary blog był jedną stroną z routingiem po hashu (`blog.html#slug`),
 * więc dla wyszukiwarki istniał jako jeden adres, a dla modelu językowego —
 * jako pusty kontener czekający na JavaScript. Osiem artykułów było
 * praktycznie niewidocznych. Tu każdy dostaje własny adres i gotowy HTML.
 *
 * Normalizacja nie jest kosmetyką. Redaktorzy wklejają do edytora tekst
 * z Markdowna, a ten zapisuje go dosłownie: na stronie widać wtedy
 * „## Gdzie najłatwiej popełnić błąd?” zamiast nagłówka. Dla czytelnika to
 * usterka, dla wyszukiwarki — brak struktury nagłówkowej w połowie tekstu.
 */
import dane from '../dane/artykuly.json';

const TRESCI = import.meta.glob<string>('../dane/artykuly/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface Artykul {
  slug: string;
  tytul: string;
  zajawka: string;
  tagi: string[];
  opublikowano: string;
  utworzono: string;
  obraz: string | null;
  tresc: string;
  minuty: number;
  naglowki: { poziom: 2 | 3; tekst: string; id: string }[];
}

/** Slug z polskiego tytułu — do kotwic przy nagłówkach. */
function doSlug(tekst: string): string {
  return tekst
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[żź]/g, 'z')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const bezZnacznikow = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').trim();

/** Akapit złożony wyłącznie z hasztagów — pozostałość po wpisie na social media. */
const samHasztag = (tekst: string) => {
  const slowa = tekst.split(/\s+/).filter(Boolean);
  return slowa.length > 0 && slowa.every((s) => s.startsWith('#'));
};

/**
 * Sprowadza HTML z CMS-a do postaci, którą da się opublikować.
 * Kolejność ma znaczenie: najpierw scalamy przeciekniętego Markdowna
 * w listy, dopiero potem zamieniamy pojedyncze akapity na nagłówki.
 */
export function normalizuj(html: string): string {
  let wynik = html;

  // 1. Puste akapity, które edytor zostawia po każdym Enterze.
  wynik = wynik.replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/g, '');

  // 2. Akapity będące wyłącznie hasztagami. Upychanie słów kluczowych
  //    na końcu tekstu nie pomaga w rankingu, a zaśmieca stronę.
  wynik = wynik.replace(/<p>([^<]*)<\/p>/g, (całość, tresc: string) =>
    samHasztag(tresc.trim()) ? '' : całość);

  // 3. Markdown przeciekły do treści: „- pozycja" w osobnych akapitach.
  //    Sklejamy sąsiadujące w jedną listę.
  wynik = wynik.replace(
    /(?:<p>\s*-\s+[^<]*<\/p>\s*){2,}/g,
    (blok) => {
      const pozycje = [...blok.matchAll(/<p>\s*-\s+([^<]*)<\/p>/g)]
        .map((m) => `<li>${m[1].trim()}</li>`)
        .join('');
      return `<ul>${pozycje}</ul>`;
    },
  );

  // 4. Markdown przeciekły do nagłówków: „## Tytuł" / „### Tytuł".
  wynik = wynik.replace(/<p>\s*(#{2,3})\s+([^<]+?)\s*<\/p>/g,
    (_, kratki: string, tekst: string) => {
      const poziom = kratki.length === 2 ? 2 : 3;
      return `<h${poziom}>${tekst}</h${poziom}>`;
    });

  // 5. Akapit będący samym pogrubieniem zakończonym pytajnikiem to nagłówek
  //    sekcji FAQ, tylko zapisany bez znacznika. Google czyta pytania z <h>,
  //    nie z <strong>.
  wynik = wynik.replace(/<p><strong>([^<]{10,120}\?)<\/strong><\/p>/g, '<h3>$1</h3>');

  // 6. Obrazek bez wymiarów przesuwa układ w trakcie wczytywania (CLS).
  //    Nie znamy ich w buildzie, więc oddajemy decyzję CSS-owi i wymuszamy
  //    leniwe wczytywanie — żaden z tych obrazków nie jest elementem LCP.
  wynik = wynik.replace(/<img /g, '<img loading="lazy" decoding="async" ');

  // 7. Linki wychodzące otwierane w nowej karcie muszą mieć rel — inaczej
  //    strona docelowa dostaje uchwyt do window.opener.
  wynik = wynik.replace(/<a ([^>]*target="_blank"[^>]*)>/g, (całość, atrybuty: string) =>
    atrybuty.includes('rel=') ? całość : `<a ${atrybuty} rel="noopener noreferrer">`);

  return wynik.trim();
}

/** Nagłówki H2/H3 z gotowej treści — spis treści i kotwice. */
function naglowkiZ(html: string) {
  return [...html.matchAll(/<h([23])>(.*?)<\/h\1>/gs)].map((m) => {
    const tekst = bezZnacznikow(m[2]);
    return { poziom: Number(m[1]) as 2 | 3, tekst, id: doSlug(tekst) };
  });
}

/** Wstawia kotwice do nagłówków, żeby dało się linkować do sekcji. */
function zKotwicami(html: string): string {
  return html.replace(/<h([23])>(.*?)<\/h\1>/gs, (_, poziom: string, wnetrze: string) =>
    `<h${poziom} id="${doSlug(bezZnacznikow(wnetrze))}">${wnetrze}</h${poziom}>`);
}

function zbuduj(meta: (typeof dane.artykuly)[number]): Artykul {
  const surowa = TRESCI[`../dane/artykuly/${meta.slug}.html`];
  if (surowa === undefined) {
    throw new Error(
      `Brak treści dla „${meta.slug}". Uruchom „pnpm --filter @ud/portal dane".`,
    );
  }
  const tresc = normalizuj(surowa);
  const slow = bezZnacznikow(tresc).split(/\s+/).filter(Boolean).length;

  return {
    ...meta,
    tagi: meta.tagi ?? [],
    tresc: zKotwicami(tresc),
    // 200 słów na minutę to tempo czytania tekstu użytkowego po polsku.
    minuty: Math.max(1, Math.round(slow / 200)),
    naglowki: naglowkiZ(tresc),
  };
}

export const ARTYKULY: Artykul[] = dane.artykuly
  .map(zbuduj)
  .sort((a, b) => b.opublikowano.localeCompare(a.opublikowano));

export const artykul = (slug: string) => ARTYKULY.find((a) => a.slug === slug);

/** Powiązane wpisy — najpierw po wspólnym tagu, potem po dacie. */
export function powiazane(slug: string, ile = 3): Artykul[] {
  const ten = artykul(slug);
  if (!ten) return ARTYKULY.slice(0, ile);
  const wspolny = (a: Artykul) => a.tagi.filter((t) => ten.tagi.includes(t)).length;
  return ARTYKULY
    .filter((a) => a.slug !== slug)
    .sort((a, b) => wspolny(b) - wspolny(a) || b.opublikowano.localeCompare(a.opublikowano))
    .slice(0, ile);
}

export const dataPl = (iso: string) =>
  new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
