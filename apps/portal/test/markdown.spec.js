import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, sep, relative } from 'node:path';
import { onRequest } from '../functions/_middleware.js';

/**
 * Negocjacja treści: agent prosi o Markdown, przeglądarka dostaje HTML.
 *
 * Te testy nie jadą przez serwer, bo serwer testowy podaje statyczne pliki
 * i nie uruchamia funkcji brzegowych Cloudflare — middleware nigdy by się nie
 * wykonał. Zamiast tego wołamy `onRequest` wprost, podstawiając pod `next`
 * odczyt z katalogu `dist`. Testowany jest więc ten sam kod, który pojedzie
 * na produkcję, i te same pliki, które dostanie przeglądarka.
 */

const DIST = 'dist';

/**
 * Udaje warstwę zasobów Cloudflare Pages.
 *
 * Zachowanie przy braku pliku jest odwzorowane z wranglera, a nie zgadnięte:
 * Pages nie odpowiada wtedy 404, tylko podaje stronę główną ze statusem 200.
 * Gdyby ta atrapa zwracała 404, testy przepuściłyby błąd, przez który agent
 * dostawał HTML opisany jako `text/markdown`.
 */
async function zDysku(wejscie) {
  const sciezka = new URL(typeof wejscie === 'string' ? wejscie : wejscie.url).pathname;
  const plik = join(DIST, sciezka.endsWith('/') ? `${sciezka}index.html` : sciezka);

  if (!existsSync(plik)) {
    return new Response(readFileSync(join(DIST, 'index.html')), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const typ = plik.endsWith('.html') ? 'text/html; charset=utf-8'
    : plik.endsWith('.json') ? 'application/json'
    : plik.endsWith('.md') ? 'text/markdown'
    : 'application/octet-stream';

  return new Response(readFileSync(plik), { status: 200, headers: { 'Content-Type': typ } });
}

function pobierz(sciezka, accept) {
  const request = new Request(`https://utratadochodu.pl${sciezka}`,
    { headers: accept ? { Accept: accept } : {} });
  // Puste `next()` w Cloudflare Pages znaczy „podaj zasób spod adresu żądania".
  return onRequest({ request, next: (wejscie) => zDysku(wejscie ?? request) });
}

/** Wszystkie zbudowane strony, jako adresy zakończone ukośnikiem. */
function strony(katalog = DIST) {
  const znalezione = [];
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const sciezka = join(katalog, wpis.name);
    if (wpis.isDirectory()) znalezione.push(...strony(sciezka));
    else if (wpis.name === 'index.html') {
      znalezione.push('/' + relative(DIST, sciezka).split(sep).slice(0, -1).map((c) => `${c}/`).join(''));
    }
  }
  return znalezione;
}

const WSZYSTKIE = strony();

const ACCEPT_PRZEGLADARKI =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';

test('nagłówek Accept rozstrzyga, co wraca', async () => {
  const przypadki = [
    ['text/markdown',                          'text/markdown', 'agent prosi wprost'],
    ['text/markdown, text/html;q=0.9',          'text/markdown', 'Markdown ważniejszy niż HTML'],
    ['text/markdown;q=0.9, text/html',          'text/html',     'HTML ważniejszy niż Markdown'],
    ['text/*',                                  'text/html',     'sama rodzina text — HTML zostaje domyślny'],
    [ACCEPT_PRZEGLADARKI,                       'text/html',     'przeglądarka'],
    ['*/*',                                     'text/html',     'domyślny nagłówek curla'],
    [undefined,                                 'text/html',     'brak nagłówka Accept'],
    ['',                                        'text/html',     'pusty nagłówek Accept'],
  ];

  for (const [accept, oczekiwany, dlaczego] of przypadki) {
    const odp = await pobierz('/programista/', accept);
    expect(odp.headers.get('content-type'), `${dlaczego} → Accept: ${accept ?? '(brak)'}`)
      .toContain(oczekiwany);
  }
});

test('odpowiedź w Markdownie ma komplet nagłówków', async () => {
  const odp = await pobierz('/programista/', 'text/markdown');

  expect(odp.status).toBe(200);
  expect(odp.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  expect(odp.headers.get('vary')).toContain('Accept');

  // Liczba tokenów — po niej agent pozna, czy dokument zmieści mu się w kontekście.
  const tokenow = Number(odp.headers.get('x-markdown-tokens'));
  expect(tokenow, 'brak nagłówka x-markdown-tokens').toBeGreaterThan(0);

  const tresc = await odp.text();
  // Rząd wielkości: około czterech znaków na token. Rozjazd o rząd znaczy,
  // że nagłówek opisuje inny dokument niż ten, który poszedł w odpowiedzi.
  expect(tokenow).toBeGreaterThan(tresc.length / 12);
  expect(tokenow).toBeLessThan(tresc.length / 1.2);
});

test('HTML dostaje Vary i wskazanie wariantu markdownowego', async () => {
  const odp = await pobierz('/programista/', ACCEPT_PRZEGLADARKI);

  // Bez Vary bufor pośredni mógłby podać przeglądarce zapisany wcześniej Markdown.
  expect(odp.headers.get('vary'), 'brak Vary: Accept na odpowiedzi HTML').toContain('Accept');
  expect(odp.headers.get('link')).toContain('rel="alternate"');
  expect(odp.headers.get('link')).toContain('text/markdown');
});

test('każda zbudowana strona ma swój wariant w Markdownie', () => {
  const bez = WSZYSTKIE.filter((s) => !existsSync(join(DIST, s, 'index.md')));
  expect(bez, `strony bez pliku .md: ${bez.slice(0, 10).join(', ')}`).toEqual([]);
  expect(WSZYSTKIE.length).toBeGreaterThan(200);
});

test('to jest Markdown, a nie przepisany HTML', () => {
  for (const adres of WSZYSTKIE) {
    const md = readFileSync(join(DIST, adres, 'index.md'), 'utf8');
    expect(md, `${adres} — znaczniki HTML w pliku .md`).not.toMatch(/<(div|section|span|script|svg)\b/);
    expect(md.trim().length, `${adres} — pusty plik .md`).toBeGreaterThan(200);
  }
});

test('nagłówek pierwszego stopnia trafia ze strony do Markdownu', () => {
  // To jest test na rozjazd: gdyby konwersja przestała łapać treść strony,
  // plik .md zostałby z samą nawigacją i nikt by tego nie zauważył.
  for (const adres of WSZYSTKIE) {
    const html = readFileSync(join(DIST, adres, 'index.html'), 'utf8');
    const md = readFileSync(join(DIST, adres, 'index.md'), 'utf8');

    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!h1) continue;

    // Porównujemy bez ucieczek: konwerter poprzedza backslashem znaki, które
    // w Markdownie coś znaczą, i to jest poprawne — nie jest to rozjazd treści.
    const bezUcieczek = md.replace(/\\(.)/g, '$1');
    expect(bezUcieczek, `${adres} — nagłówek „${h1}" nie doszedł do Markdownu`).toContain(h1);
  }
});

test('w Markdownie nie ma nawigacji, stopki ani banera zgód', () => {
  const md = readFileSync(join(DIST, 'programista', 'index.md'), 'utf8');
  expect(md, 'stopka wjechała do treści').not.toContain('Rejestru Pośredników');
  expect(md, 'baner zgód wjechał do treści').not.toContain('Ustawienia cookies');
  expect(md, 'sam znacznik nawigacji').not.toContain('Przejdź do treści');
});

test('adresy w Markdownie są bezwzględne', () => {
  const md = readFileSync(join(DIST, 'programista', 'index.md'), 'utf8');
  const wzgledne = [...md.matchAll(/\]\((\/[^)]*)\)/g)].map((t) => t[1]);
  expect(wzgledne, `adresy względne: ${wzgledne.join(', ')}`).toEqual([]);
  expect(md).toContain('https://utratadochodu.pl/');
});

test('wariant markdownowy ma też własny, stały adres', async () => {
  const odp = await pobierz('/programista/index.md', ACCEPT_PRZEGLADARKI);

  expect(odp.status).toBe(200);
  expect(odp.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  // Ten sam tekst stoi pod adresem strony — dwa adresy z jedną treścią to
  // duplikat, więc wyszukiwarka ma indeksować wersję HTML.
  expect(odp.headers.get('x-robots-tag')).toBe('noindex');
  expect(odp.headers.get('link')).toContain('https://utratadochodu.pl/programista/');
  expect(await odp.text()).toContain('# Ubezpieczenie utraty dochodu dla programisty');
});

test('wynegocjowana strona nie dziedziczy noindex po pliku .md', async () => {
  // Gdyby nagłówek przeszedł, pierwszy agent proszący o Markdown wypisałby
  // podstronę z indeksu — pod tym adresem stoi przecież wersja HTML.
  const odp = await pobierz('/programista/', 'text/markdown');
  expect(odp.headers.get('x-robots-tag')).toBeNull();
  expect(odp.headers.get('link')).toContain('rel="canonical"');
});

test('nieistniejący adres nie dostaje strony głównej podanej jako Markdown', async () => {
  // Warstwa zasobów Pages podstawia wtedy /index.html ze statusem 200. Samo
  // `response.ok` tego nie odsiewa — dlatego middleware patrzy na typ MIME.
  const odp = await pobierz('/nie-ma-takiej-strony/', 'text/markdown');

  expect(odp.headers.get('content-type'), 'HTML opisany jako Markdown').toContain('text/html');
  expect(odp.headers.get('x-markdown-tokens'), 'liczba tokenów dla dokumentu, którego nie ma').toBeNull();
});

test('adres .md spoza builda też nie udaje Markdownu', async () => {
  const odp = await pobierz('/nie-ma-takiej-strony/index.md', ACCEPT_PRZEGLADARKI);
  expect(odp.headers.get('content-type')).not.toContain('markdown');
});

test('strona główna wskazuje zasoby maszynowe nagłówkiem Link', async () => {
  const odp = await pobierz('/', ACCEPT_PRZEGLADARKI);
  const link = odp.headers.get('link') ?? '';

  const wymagane = [
    ['</llms.txt>; rel="describedby"',            'streszczenie serwisu'],
    ['rel="alternate"; type="application/rss+xml"', 'kanał RSS'],
    ['</polityka-prywatnosci/>; rel="privacy-policy"', 'polityka prywatności'],
    ['</regulamin/>; rel="terms-of-service"',     'regulamin'],
    ['</o-nas/>; rel="author"',                   'wydawca'],
    ['</index.md>; rel="alternate"; type="text/markdown"', 'wariant markdownowy'],
  ];
  for (const [fragment, co] of wymagane) {
    expect(link, `brak odnośnika: ${co}`).toContain(fragment);
  }
});

test('Link nie obiecuje API, którego nie ma', () => {
  // Odnośnik do katalogu, którego nie ma, kosztuje agenta jedno żądanie
  // i kończy się błędem zamiast odpowiedzią. Serwis nie wystawia publicznego
  // API, więc tych trzech relacji tu nie ma — i mają nie wrócić przez pomyłkę.
  const zrodlo = readFileSync('functions/_middleware.js', 'utf8');
  for (const relacja of ['api-catalog', 'service-desc', 'service-doc']) {
    expect(zrodlo, `middleware wskazuje na ${relacja}, a serwis go nie wystawia`)
      .not.toContain(`rel="${relacja}"`);
  }
});

test('każda podstrona dostaje ten sam zestaw odnośników', async () => {
  for (const adres of ['/', '/programista/', '/blog/', '/kontakt/']) {
    const link = (await pobierz(adres, ACCEPT_PRZEGLADARKI)).headers.get('link') ?? '';
    expect(link, `${adres} bez odnośnika do llms.txt`).toContain('rel="describedby"');
    expect(link, `${adres} bez wariantu markdownowego`).toContain(`<${adres}index.md>`);
  }
});
