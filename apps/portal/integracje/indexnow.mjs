/**
 * ud:indexnow — po buildzie produkcyjnym mówi Bingowi (i reszcie wyszukiwarek
 * z protokołu IndexNow), które strony są nowe, zmienione albo usunięte.
 *
 * Bez tego Bing dowiaduje się o nowym wpisie z mapy strony, kiedy sam do niej
 * zajrzy — dni, czasem tygodnie. Bing Webmaster Tools zgłaszał 08.11.2026
 * „Protokół IndexNow nie został wdrożony". Google IndexNow nie czyta.
 *
 * Jak wykrywamy zmianę. Build zapisuje `indexnow.json`: dla każdego adresu
 * z mapy strony skrót SHA-256 jego bliźniaczego pliku `.md` (sama treść
 * strony, bez nawigacji, stopki i skryptów — integracja `ud:markdown`). Zmiana
 * w układzie, CSS-ie albo stopce nie zmienia więc żadnego skrótu; zmienia go
 * zdanie w treści. Poprzedni manifest bierzemy z żywej strony — to jest
 * wdrożenie, które ten build za chwilę zastąpi — i zgłaszamy różnicę: nowe
 * i zmienione adresy oraz te, których już nie ma (IndexNow przyjmuje też
 * usunięte). Bazy, crona ani funkcji brzegowej to nie potrzebuje: stanem jest
 * manifest, który i tak leży na stronie.
 *
 * Czego NIE robi: nie przerywa builda. Każdy błąd — brak sieci, odmowa
 * IndexNow, zepsuty manifest — kończy się wpisem w logu i w polu `zgloszenie`
 * manifestu. Wdrożenie portalu jest ważniejsze niż ping do wyszukiwarki.
 *
 * Zgłoszenie idzie z builda, czyli kilkadziesiąt sekund PRZED tym, jak nowe
 * wdrożenie zacznie odpowiadać. Bing nie pobiera stron w tej samej minucie,
 * więc w praktyce trafia na nową wersję; gdyby trafił na starą, przyjdzie po
 * nią i tak, jak przy zwykłym przeglądaniu mapy strony.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Klucz IndexNow. Nie jest sekretem: protokół każe go wystawić pod
 * `/<klucz>.txt` (plik w `public/`, treść = klucz), a wyszukiwarka sprawdza
 * nim, że zgłoszenie pochodzi od właściciela domeny.
 */
export const KLUCZ = 'ab14d61f6bf3411dd6176692785d41e2';

/** Wspólny punkt protokołu — przekazuje zgłoszenie Bingowi, Yandexowi, Seznamowi… */
export const PUNKT = 'https://api.indexnow.org/indexnow';

/**
 * Gałąź produkcyjna projektu Pages `utratadochodu`. Build każdej innej gałęzi
 * to podgląd na `<hash>.utratadochodu.pages.dev` — nie zgłaszamy go, bo
 * zgłoszenie dotyczy zawsze domeny, a ten build na domenę nie trafi.
 */
export const GALAZ_PRODUKCYJNA = 'claude/portal-rebuild-seo-llm-yz2x4t';

/** Protokół przyjmuje do 10 000 adresów w jednym zgłoszeniu. */
const NAJWIECEJ = 10_000;
const CZAS_MS = 10_000;
export const PLIK = 'indexnow.json';

const skrot = (tekst) => createHash('sha256').update(tekst).digest('hex');

/** Adresy z map strony w katalogu wyjściowym (`sitemap-0.xml`, `sitemap-1.xml`…). */
export function adresyZMapy(dist) {
  const adresy = new Set();
  for (const plik of readdirSync(dist)) {
    if (!/^sitemap-\d+\.xml$/.test(plik)) continue;
    const xml = readFileSync(join(dist, plik), 'utf8');
    for (const [, loc] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) adresy.add(loc.trim());
  }
  return [...adresy].sort();
}

/**
 * Manifest: ścieżka → skrót treści. Bierzemy `index.md` (sama treść), a gdy go
 * nie ma — `index.html`. Adres spoza serwisu albo bez pliku pomijamy.
 */
export function manifest(dist, adresy, serwis) {
  const strony = {};
  for (const adres of adresy) {
    if (!adres.startsWith(`${serwis}/`)) continue;
    const sciezka = adres.slice(serwis.length);
    const katalog = join(dist, ...sciezka.split('/').filter(Boolean));
    const plik = [join(katalog, 'index.md'), join(katalog, 'index.html')].find((p) => existsSync(p));
    if (plik) strony[sciezka] = skrot(readFileSync(plik));
  }
  return strony;
}

/** Ścieżki do zgłoszenia: nowe, zmienione i usunięte względem poprzedniego manifestu. */
export function doZgloszenia(stare, nowe) {
  const wynik = new Set();
  for (const [sciezka, hash] of Object.entries(nowe)) {
    if (stare[sciezka] !== hash) wynik.add(sciezka);
  }
  for (const sciezka of Object.keys(stare)) {
    if (!(sciezka in nowe)) wynik.add(sciezka);
  }
  return [...wynik].sort();
}

/**
 * Poprzedni manifest z żywej strony.
 * - `{ strony }` — jest i da się go odczytać,
 * - `{ strony: {} }` — 404: pierwsze wdrożenie z IndexNow, zgłaszamy wszystko,
 * - `{ blad }` — sieć, 5xx, zepsuty plik: NIE wiemy, co się zmieniło, więc nie
 *   zgłaszamy niczego (zgłoszenie całego serwisu przy każdej awarii sieci
 *   uczyłoby wyszukiwarkę ignorować nasze zgłoszenia).
 */
export async function poprzedni(serwis, { fetch: pobierz = globalThis.fetch } = {}) {
  try {
    const odp = await pobierz(`${serwis}/${PLIK}`, {
      headers: { 'cache-control': 'no-cache', accept: 'application/json' },
      signal: AbortSignal.timeout(CZAS_MS),
    });
    if (odp.status === 404) return { strony: {}, pierwszy: true };
    if (!odp.ok) return { blad: `manifest z żywej strony: HTTP ${odp.status}` };
    const dane = await odp.json();
    if (!dane || typeof dane.strony !== 'object' || Array.isArray(dane.strony)) {
      return { blad: 'manifest z żywej strony bez pola „strony"' };
    }
    return { strony: dane.strony };
  } catch (e) {
    return { blad: `manifest z żywej strony: ${e?.name === 'TimeoutError' ? 'brak odpowiedzi' : String(e?.message ?? e)}` };
  }
}

/** Zgłoszenie do IndexNow. Zwraca status HTTP albo opis błędu — nigdy nie rzuca. */
export async function zglos(serwis, sciezki, { fetch: pobierz = globalThis.fetch } = {}) {
  const host = new URL(serwis).host;
  const urlList = sciezki.slice(0, NAJWIECEJ).map((s) => `${serwis}${s}`);
  try {
    const odp = await pobierz(PUNKT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: KLUCZ, keyLocation: `${serwis}/${KLUCZ}.txt`, urlList }),
      signal: AbortSignal.timeout(CZAS_MS),
    });
    // 200 — przyjęte; 202 — przyjęte, klucz sprawdzą później (pierwsze zgłoszenie).
    return { status: odp.status, przyjete: odp.status === 200 || odp.status === 202, adresow: urlList.length };
  } catch (e) {
    return { blad: e?.name === 'TimeoutError' ? 'brak odpowiedzi IndexNow' : String(e?.message ?? e), adresow: urlList.length };
  }
}

/**
 * Cały przebieg dla katalogu wyjściowego. `env`, `fetch` i `teraz` są
 * parametrami, żeby test mógł go uruchomić bez sieci i bez zmiennych Pages.
 */
export async function przebieg({ dist, serwis, env = process.env, fetch: pobierz = globalThis.fetch, teraz = () => new Date() }) {
  const strony = manifest(dist, adresyZMapy(dist), serwis);
  let zgloszenie;

  if (env.CF_PAGES !== '1' || env.CF_PAGES_BRANCH !== GALAZ_PRODUKCYJNA) {
    zgloszenie = { stan: 'pominiete', powod: 'build nieprodukcyjny' };
  } else if (Object.keys(strony).length === 0) {
    // Pusta mapa strony to awaria builda, nie „wszystko usunięte".
    zgloszenie = { stan: 'pominiete', powod: 'brak adresów w mapie strony' };
  } else {
    const stary = await poprzedni(serwis, { fetch: pobierz });
    if (stary.blad) {
      zgloszenie = { stan: 'pominiete', powod: stary.blad };
    } else {
      const sciezki = doZgloszenia(stary.strony, strony);
      if (sciezki.length === 0) {
        zgloszenie = { stan: 'bez-zmian' };
      } else {
        const wynik = await zglos(serwis, sciezki, { fetch: pobierz });
        zgloszenie = {
          stan: wynik.przyjete ? 'zgloszono' : 'odmowa',
          ...(wynik.status ? { status: wynik.status } : {}),
          ...(wynik.blad ? { powod: wynik.blad } : {}),
          adresow: wynik.adresow,
          ...(stary.pierwszy ? { pierwsze: true } : {}),
          // Pełna lista tylko przy małych zgłoszeniach — pierwsze to cały serwis.
          ...(sciezki.length <= 50 ? { sciezki } : {}),
        };
      }
    }
  }

  const tresc = {
    wersja: 1,
    commit: env.CF_PAGES_COMMIT_SHA ?? null,
    zgloszenie: { ...zgloszenie, kiedy: teraz().toISOString() },
    strony,
  };
  writeFileSync(join(dist, PLIK), JSON.stringify(tresc) + '\n', 'utf8');
  return tresc;
}

export function indexNow({ serwis }) {
  return {
    name: 'ud:indexnow',
    hooks: {
      // Musi stać PO `ud:markdown` (skróty liczy z plików .md) i po sitemap
      // (adresy bierze z mapy strony) — hooki idą w kolejności z listy.
      'astro:build:done': async ({ dir, logger }) => {
        try {
          const { strony, zgloszenie } = await przebieg({ dist: fileURLToPath(dir), serwis });
          const opis = { pominiete: `pominięte (${zgloszenie.powod})`, 'bez-zmian': 'bez zmian w treści',
            zgloszono: `zgłoszono ${zgloszenie.adresow} adresów (HTTP ${zgloszenie.status})`,
            odmowa: `NIE zgłoszono ${zgloszenie.adresow} adresów: ${zgloszenie.powod ?? `HTTP ${zgloszenie.status}`}` };
          const linia = `${Object.keys(strony).length} stron w manifeście — ${opis[zgloszenie.stan]}`;
          if (zgloszenie.stan === 'odmowa') logger.warn(linia);
          else logger.info(linia);
        } catch (e) {
          logger.warn(`IndexNow pominięty: ${e?.message ?? e}`);
        }
      },
    },
  };
}
