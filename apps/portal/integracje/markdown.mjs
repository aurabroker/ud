/**
 * ud:markdown — obok każdej strony kładzie jej odpowiednik w Markdownie.
 *
 * Po co: agent, który wchodzi na stronę po treść, dostaje dziś HTML z nawigacją,
 * stopką, banerem zgód i wyspami Svelte. Musi to wszystko odsiać, żeby dojść do
 * kilku akapitów, po które przyszedł. Markdown daje mu tę samą treść bez szumu —
 * podstrona zawodu schodzi z 60 kB HTML-a do około 5 kB tekstu.
 *
 * Skąd bierzemy treść: z gotowego HTML-a, a nie z osobnych szablonów. Ręcznie
 * pisany wariant markdownowy rozjechałby się z HTML-em przy pierwszej edycji,
 * której ktoś nie powtórzy w dwóch miejscach. Konwersja z builda nie ma jak się
 * rozjechać: gdy zmienia się strona, zmienia się i plik .md.
 *
 * Czego NIE robi: nie zastępuje llms.txt. Tamten plik to indeks i streszczenie
 * w formacie llmstxt.org; ten jest wierną kopią tej konkretnej podstrony.
 *
 * Negocjację nagłówka Accept obsługuje `functions/_middleware.js`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { NodeHtmlMarkdown } from 'node-html-markdown';
/**
 * Kodowanie wskazane wprost, a nie przez domyślny eksport: liczba tokenów nie
 * znaczy nic bez nazwy kodowania, a domyślne potrafi się zmienić z wersją
 * biblioteki. o200k_base to podział używany przez najnowsze modele OpenAI —
 * dla modeli Anthropic wyjdzie liczba zbliżona, ale nie identyczna. To wartość
 * orientacyjna: agent ma z niej wiedzieć, czy dokument zmieści mu się
 * w kontekście, a nie rozliczać po niej rachunek.
 */
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';

/** Elementy, które w tekście są szumem albo nie mają odpowiednika w Markdownie. */
const DO_USUNIECIA = 'script, style, svg, noscript, template, [aria-hidden="true"]';

/**
 * Listy definicji (`<dl>`) nie mają odpowiednika w Markdownie, a stoją na nich
 * opisy ryzyk zawodowych — bez tego hasło i objaśnienie zlewają się w jeden
 * akapit i nie widać, co do czego należy.
 */
const TLUMACZE = {
  dt: { prefix: '**', postfix: '**', surroundingNewlines: 2 },
  dd: { surroundingNewlines: 2 },
};

/** Adresy względne robimy bezwzględnymi — plik .md bywa czytany bez kontekstu strony. */
function nadajPelneAdresy(korzen, serwis) {
  for (const element of korzen.querySelectorAll('a[href], img[src]')) {
    const atrybut = element.tagName === 'A' ? 'href' : 'src';
    const wartosc = element.getAttribute(atrybut);
    if (wartosc?.startsWith('/') && !wartosc.startsWith('//')) {
      element.setAttribute(atrybut, serwis + wartosc);
    }
  }
}

/** Zwraca ścieżki wszystkich index.html w katalogu wyjściowym. */
function stronyWKatalogu(katalog) {
  const znalezione = [];
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const sciezka = join(katalog, wpis.name);
    if (wpis.isDirectory()) znalezione.push(...stronyWKatalogu(sciezka));
    else if (wpis.name === 'index.html') znalezione.push(sciezka);
  }
  return znalezione;
}

/** `dist/programista/index.html` → `/programista/` */
const adresStrony = (dist, plik) =>
  '/' + relative(dist, plik).split(sep).slice(0, -1).map((c) => c + '/').join('');

export function markdownDlaAgentow({ serwis }) {
  return {
    name: 'ud:markdown',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const tokeny = {};
        let bajtowHtml = 0;
        let bajtowMd = 0;

        for (const plik of stronyWKatalogu(dist)) {
          const html = readFileSync(plik, 'utf8');
          const dokument = parse(html);
          const tresc = dokument.querySelector('main#tresc');
          if (!tresc) {
            logger.warn(`${adresStrony(dist, plik)} — brak <main id="tresc">, pomijam`);
            continue;
          }

          tresc.querySelectorAll(DO_USUNIECIA).forEach((w) => w.remove());
          nadajPelneAdresy(tresc, serwis);

          const markdown = NodeHtmlMarkdown
            .translate(tresc.innerHTML, { bulletMarker: '-' }, TLUMACZE)
            // Dwa odnośniki obok siebie (para przycisków) sklejają się w `)[`.
            .replace(/\)\[(?=[^\]]*\]\()/g, ') [')
            // Konwerter ucieka kropkę po cyfrze, bo „1." na początku wiersza
            // zaczyna listę numerowaną. W środku zdania to nic nie zmienia,
            // a „L4\." czyta się gorzej niż „L4.". Cofamy ucieczkę tylko tam,
            // gdzie przed liczbą stoi litera — wtedy na pewno nie jest to
            // początek pozycji listy.
            .replace(/([^\s\d])(\d+)\\\./g, '$1$2.')
            .replace(/\n{3,}/g, '\n\n')
            .trim() + '\n';

          writeFileSync(plik.replace(/index\.html$/, 'index.md'), markdown, 'utf8');
          tokeny[adresStrony(dist, plik)] = countTokens(markdown);
          bajtowHtml += Buffer.byteLength(html);
          bajtowMd += Buffer.byteLength(markdown);
        }

        // Liczby tokenów w jednym pliku, bo `_headers` ma limit stu reguł,
        // a stron jest ponad dwieście. Middleware czyta go raz na izolat.
        writeFileSync(join(dist, 'tokeny-markdown.json'), JSON.stringify(tokeny) + '\n', 'utf8');

        const stron = Object.keys(tokeny).length;
        const ile = (b) => Math.round(b / 1024);
        logger.info(
          `${stron} stron w Markdownie — ${ile(bajtowHtml)} kB HTML-a schodzi do ${ile(bajtowMd)} kB tekstu`,
        );
      },
    },
  };
}
