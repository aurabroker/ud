import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { kategorie, ZAWODY } from '@ud/zawody';

/**
 * Wykrywanie martwych linków wewnętrznych w zbudowanym serwisie.
 *
 * Ten test istnieje, bo martwy link wewnętrzny jest jedną z niewielu wad,
 * których nie widać ani w buildzie, ani przy klikaniu po stronie głównej —
 * ujawnia się dopiero u użytkownika albo w raporcie z indeksowania.
 */

const DIST = 'dist';
/** Katalog aplikacji — Playwright startuje z apps/portal. */
const KORZEN = '.';

/** Wszystkie pliki HTML w buildzie. */
function stronyHtml(katalog = DIST, zebrane = []) {
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const p = join(katalog, wpis.name);
    if (wpis.isDirectory()) stronyHtml(p, zebrane);
    else if (wpis.name.endsWith('.html')) zebrane.push(p);
  }
  return zebrane;
}

/**
 * Trasy obsługiwane przez funkcje Cloudflare Pages. Nie ma ich w `dist`,
 * bo powstają dopiero na krawędzi — a mimo to są żywymi adresami.
 * Segment „[id]" zamieniamy na dopasowanie dowolnego członu ścieżki,
 * „[[sciezka]]" na dopasowanie reszty adresu.
 */
function trasyFunkcji(katalog = 'functions', prefiks = '', zebrane = []) {
  if (!existsSync(katalog)) return zebrane;
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    if (wpis.isDirectory()) {
      trasyFunkcji(join(katalog, wpis.name), `${prefiks}/${wpis.name}`, zebrane);
      continue;
    }
    if (!/\.(js|ts)$/.test(wpis.name)) continue;
    const nazwa = wpis.name.replace(/\.(js|ts)$/, '');
    const sciezka = nazwa === 'index' ? prefiks || '/' : `${prefiks}/${nazwa}`;
    const wzorzec = sciezka
      .replace(/[.*+?^${}()|\\]/g, '\\$&')
      .replace(/\[\[[^\]]+\]\]/g, '.+')
      .replace(/\[[^\]]+\]/g, '[^/]+');
    zebrane.push(new RegExp(`^${wzorzec}/?$`));
  }
  return zebrane;
}

const TRASY_FUNKCJI = trasyFunkcji();

/** Czy ścieżka jest obsłużona przez build, funkcję brzegową albo przekierowanie. */
function istnieje(sciezka, przekierowania) {
  if (przekierowania.has(sciezka)) return true;
  if (TRASY_FUNKCJI.some((t) => t.test(sciezka))) return true;
  const bez = sciezka.replace(/^\//, '').replace(/\/$/, '');
  for (const kandydat of [join(DIST, bez, 'index.html'), join(DIST, bez), join(DIST, bez + '.html')]) {
    if (existsSync(kandydat) && statSync(kandydat).isFile()) return true;
  }
  return false;
}

test('żaden link wewnętrzny nie prowadzi w pustkę', () => {
  const przekierowania = new Set();
  if (existsSync(join(DIST, '_redirects'))) {
    for (const linia of readFileSync(join(DIST, '_redirects'), 'utf8').split('\n')) {
      const [z] = linia.trim().split(/\s+/);
      if (z?.startsWith('/')) przekierowania.add(z);
    }
  }

  const martwe = new Map();
  for (const plik of stronyHtml()) {
    const html = readFileSync(plik, 'utf8');
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      if (href.startsWith('/_astro/') || href.startsWith('/fonts/')) continue;
      if (istnieje(href, przekierowania)) continue;
      if (!martwe.has(href)) martwe.set(href, new Set());
      martwe.get(href).add(relative(DIST, plik).replace(/\/index\.html$/, '/'));
    }
  }

  const opis = [...martwe.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([href, skad]) => `  ${href}  ← ${skad.size} ${skad.size === 1 ? 'strona' : 'stron'} (np. ${[...skad][0]})`)
    .join('\n');

  expect(martwe.size, `martwe linki wewnętrzne:\n${opis}`).toBe(0);
});

const ROZSZERZENIA = /\.(jpe?g|png|webp)$/i;

/**
 * Nazwy zdjęć w katalogu, bez rozszerzenia. Format nie ma znaczenia — liczy się
 * nazwa — ale ten sam slug w dwóch formatach naraz jest błędem: `obrazy.ts`
 * wybrałby jeden po kolejności rozszerzeń, a autor zmiany zobaczyłby losowy.
 */
/** Rozszerzenia, których obrazy.ts szuka dla zdjęcia strony głównej. */
const ROZSZERZENIA_HERO = ['jpg', 'jpeg', 'png', 'webp'];

function nazwyZdjec(katalog) {
  if (!existsSync(katalog)) return [];
  const nazwy = readdirSync(katalog)
    .filter((f) => ROZSZERZENIA.test(f))
    .map((f) => f.replace(ROZSZERZENIA, ''));

  const podwojne = nazwy.filter((n, i) => nazwy.indexOf(n) !== i);
  expect(podwojne, `ten sam slug w dwóch formatach: ${podwojne.join(', ')}`).toEqual([]);
  return nazwy;
}

/**
 * Kategorie, dla których nie ma jeszcze pliku zdjęcia. Lista jest tymczasowa
 * i ma sama po sobie posprzątać: gdy plik się pojawi, test poniżej wywali się
 * na nieaktualnym wpisie i zmusi do jego usunięcia.
 */
// Komplet — każda z czternastu kategorii ma swoje zdjęcie. Gdy dojdzie nowa
// kategoria bez zdjęcia, wpisz tu jej slug; test przypomni o usunięciu wpisu,
// kiedy plik się pojawi.
const BEZ_ZDJECIA = new Set();

test('każde zdjęcie w src/obrazy/kategorie nosi nazwę istniejącej kategorii', () => {
  /**
   * Wcześniej zdjęcie wisiało przy zawodzie, a kategoria brała je od pierwszego
   * zawodu alfabetycznie — stąd biurowiec na Budownictwie i mężczyzna
   * z niemowlęciem („bezpieczenstwo.jpg") u dwóch prawników. Nazwa pliku równa
   * slugowi kategorii sprawia, że takie rozjechanie jest niewyrażalne.
   */
  const slugi = new Set(kategorie().map((k) => k.slug));
  const pliki = nazwyZdjec(join(KORZEN, 'src/obrazy/kategorie'));

  const osierocone = pliki.filter((f) => !slugi.has(f));
  expect(osierocone, `pliki bez kategorii: ${osierocone.join(', ')}`).toEqual([]);

  const nieaktualne = [...BEZ_ZDJECIA].filter((s) => pliki.includes(s));
  expect(nieaktualne, `zdjęcie już jest — usuń z BEZ_ZDJECIA: ${nieaktualne.join(', ')}`).toEqual([]);

  const brakujace = [...slugi].filter((s) => !pliki.includes(s) && !BEZ_ZDJECIA.has(s));
  expect(brakujace, `kategorie bez zdjęcia: ${brakujace.join(', ')}`).toEqual([]);
});

test('zdjęcia zawodów: nazwa pliku to slug zawodu i strona go pokazuje', () => {
  /**
   * Warstwa nad zdjęciami kategorii: zawód, który ma własne zdjęcie, bierze
   * własne, reszta dziedziczy po branży. Zestaw rośnie zawód po zawodzie,
   * więc jedyne, czego trzeba pilnować, to że nazwa pliku wskazuje na
   * istniejący zawód i że plik faktycznie trafia na jego podstronę.
   */
  const katalog = join(KORZEN, 'src/obrazy/zawody');
  const pliki = nazwyZdjec(katalog);

  const slugi = new Set(ZAWODY.map((z) => z.slug));
  const osierocone = pliki.filter((f) => !slugi.has(f));
  expect(osierocone, `pliki bez zawodu: ${osierocone.join(', ')}`).toEqual([]);

  // Sprawdzamy po opisie alternatywnym, a nie po nazwie assetu: Vite scala
  // pliki o identycznej zawartości pod jedną nazwą, więc nazwa assetu nie
  // rozstrzyga, którą gałęzią poszedł szablon. Opis rozstrzyga.
  for (const slug of pliki) {
    const zawod = ZAWODY.find((z) => z.slug === slug);
    const html = readFileSync(join(DIST, `${slug}/index.html`), 'utf8');
    const alt = html.match(/<img[^>]*\balt="([^"]*)"/)?.[1];
    expect(alt, `/${slug}/ dziedziczy zdjęcie kategorii mimo własnego pliku`)
      .toBe(`Zdjęcie ilustracyjne — ${zawod.odmiana.mianownik.toLowerCase()}`);
  }
});

test('zdjęcia kategorii faktycznie się renderują', () => {
  /**
   * Czternaście zdjęć branż leżało w public/ i było używanych wyłącznie jako
   * obrazek Open Graph — na żadnej stronie serwisu nie renderował się ani
   * jeden <img>. Ten test pilnuje, żeby nie wróciły do roli metadanych.
   */
  const zeZdjeciem = kategorie().filter((k) => !BEZ_ZDJECIA.has(k.slug));

  const glowna = readFileSync(join(DIST, 'index.html'), 'utf8');
  // Liczymy po opisie alternatywnym, a nie po wszystkich <img> na stronie:
  // zdjęcie nagłówka strony głównej też jest <img>, tylko z pustym alt, bo
  // znaczenie niesie nagłówek leżący na nim. Zliczanie wszystkiego kazałoby
  // poprawiać ten test przy każdym zdjęciu dołożonym gdziekolwiek na stronie.
  const kafelki = (glowna.match(/alt="Zdjęcie ilustracyjne — /g) ?? []).length;
  expect(kafelki, `strona główna: ${kafelki} kafelków ze zdjęciem zamiast ${zeZdjeciem.length}`)
    .toBe(zeZdjeciem.length);

  for (const k of zeZdjeciem) {
    const html = readFileSync(join(DIST, `zawody/${k.slug}/index.html`), 'utf8');
    expect((html.match(/<img\b/g) ?? []).length, `/zawody/${k.slug}/ bez zdjęcia`).toBe(1);
  }

  // Podstrona zawodu dziedziczy zdjęcie po swojej kategorii.
  for (const plik of ['stomatolog', 'kierowca-zawodowy', 'copywriter']) {
    const html = readFileSync(join(DIST, `${plik}/index.html`), 'utf8');
    expect((html.match(/<img\b/g) ?? []).length, `/${plik}/ bez zdjęcia`).toBe(1);
  }
});

test('pas strony głównej: zdjęcie albo nic, nigdy sama zasłona', () => {
  /**
   * Strona główna jest jedyną, na której zdjęcie nagłówka bierze się z pliku
   * `src/obrazy/hero.<ext>`, a nie z kategorii czy zawodu. Dopóki pliku nie ma,
   * pas ma zostać samym gradientem — zasłona bez zdjęcia to ciemna plama,
   * przez którą nie prześwituje nic.
   */
  const jestPlik = ROZSZERZENIA_HERO
    .some((ext) => existsSync(join(KORZEN, `src/obrazy/hero.${ext}`)));
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const pas = html.indexOf('relative isolate');
  expect(pas, 'strona główna: brak bloku nagłówka').toBeGreaterThan(-1);

  if (!jestPlik) {
    expect(html, 'zasłona bez zdjęcia — dodaj src/obrazy/hero.<ext>')
      .not.toContain('zaslona-hero');
    return;
  }

  expect(html, 'jest hero.<ext>, a pas bez zasłony').toContain('zaslona-hero');
  const obraz = html.slice(pas).match(/<img[^>]*>/)?.[0] ?? '';
  // Ta sama wartość co na pasach zawodu i kategorii: zdjęcia w tym zestawie
  // mają twarz w górnej tercji, a domyślne object-cover tnie symetrycznie.
  expect(obraz, 'pas strony głównej tnie kadr od środka, nie od 25% wysokości')
    .toContain('object-[50%_25%]');
});

test('nagłówek leży na zdjęciu, nie pod nim', () => {
  /**
   * Zdjęcie było kiedyś osobnym pasem nad nagłówkiem. Musiało być przez to
   * niskie, żeby nie spychać treści poniżej ekranu, i ucinało bohatera w pół.
   * Ten test pilnuje, że obraz, zasłona i nagłówek siedzą w jednym bloku —
   * dopiero wtedy pas może być wysoki, a kadr nie traci połowy wysokości.
   */
  for (const plik of ['stomatolog/index.html', 'zawody/medycyna/index.html']) {
    const html = readFileSync(join(DIST, plik), 'utf8');
    const hero = html.indexOf('relative isolate');
    expect(hero, `${plik}: brak bloku nagłówka ze zdjęciem`).toBeGreaterThan(-1);

    const obraz = html.indexOf('<img', hero);
    const zaslona = html.indexOf('zaslona-hero', hero);
    const naglowek = html.indexOf('<h1', hero);

    expect(obraz, `${plik}: zdjęcie poza blokiem nagłówka`).toBeGreaterThan(hero);
    expect(zaslona, `${plik}: zasłona przed zdjęciem`).toBeGreaterThan(obraz);
    expect(naglowek, `${plik}: nagłówek nie leży na zdjęciu`).toBeGreaterThan(zaslona);
  }

  /**
   * Druga gałąź szablonu: bez zdjęcia nie ma po co odsuwać tekstu od góry ani
   * rezerwować wysokości pasa.
   *
   * Podstrona do sprawdzenia szuka się sama, zamiast stać tu na sztywno.
   * Wcześniej był tu `dekarz` — i przestał pasować w chwili, gdy Budownictwo
   * dostało swoje zdjęcie, bo zawód zaczął je dziedziczyć. Test wywalał się
   * wtedy na zmianie, która niczego nie psuła.
   *
   * Przy komplecie zdjęć kategorii ta gałąź jest nieosiągalna i sprawdzać nie
   * ma czego. Wróci sama, gdy dojdzie kategoria bez zdjęcia.
   */
  const bezZdjecia = ZAWODY
    .map((z) => `${z.slug}/index.html`)
    .find((plik) => {
      const sciezka = join(DIST, plik);
      return existsSync(sciezka) && !readFileSync(sciezka, 'utf8').includes('zaslona-hero');
    });

  if (bezZdjecia) {
    const html = readFileSync(join(DIST, bezZdjecia), 'utf8');
    expect(html, `${bezZdjecia}: zasłona bez zdjęcia`).not.toContain('zaslona-hero');
    expect(html, `${bezZdjecia}: odsunięcie od góry bez zdjęcia`).not.toContain('pt-[17rem]');
  }
});

test('zdjęcia przechodzą przez optymalizację i mają wymiary', () => {
  const html = readFileSync(join(DIST, 'stomatolog/index.html'), 'utf8');
  const img = html.match(/<img[^>]*>/)?.[0] ?? '';

  // Nieprzetworzone zdjęcie zostawiłoby ścieżkę /img/*.jpg zamiast /_astro/*.webp.
  expect(img, 'zdjęcie nie przeszło przez sharpa').toMatch(/\/_astro\/[^"']+\.webp/);
  // Brak wymiarów to skok układu w trakcie wczytywania.
  expect(img, 'brak width').toMatch(/width="\d+"/);
  expect(img, 'brak height').toMatch(/height="\d+"/);
  expect(img, 'brak opisu alternatywnego').toMatch(/alt="[^"]+"/);
});

test('każdy adres starego serwisu ma dokąd prowadzić', () => {
  /**
   * Przepięcie domeny na nowy portal unieważnia wszystkie stare adresy naraz.
   * Podstrony zawodów obsługuje integracja `ud:przekierowania`, ale strony
   * najwyższego poziomu stary serwis trzymał jako pliki .html w korzeniu
   * i te trzeba wymienić z nazwiska.
   *
   * Bez reguły adres nie daje nawet 404: warstwa zasobów Pages podaje wtedy
   * stronę główną ze statusem 200. Google wciąga to do indeksu jako duplikat
   * strony głównej, a użytkownik z zakładki nie trafia tam, gdzie chciał.
   */
  const STARE_ADRESY = [
    '/index.html', '/blog.html', '/formularz.html', '/thankyou.html',
    '/o-nas.html', '/opinia.html', '/pracuj-z-nami.html', '/regulamin.html',
    '/polityka-prywatnosci.html', '/polityka-cookies.html',
    '/sitemap.xml', '/sitemap_professions.xml',
  ];

  const plik = readFileSync(join(DIST, '_redirects'), 'utf8');
  const zrodla = new Set(
    plik.split('\n')
      .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
      .map((l) => l.trim().split(/\s+/)[0]),
  );

  const bezReguly = STARE_ADRESY.filter((a) => !zrodla.has(a));
  expect(bezReguly, `stare adresy bez przekierowania: ${bezReguly.join(', ')}`).toEqual([]);

  // Cel każdej reguły musi istnieć — przekierowanie w pustkę jest gorsze niż jego brak.
  for (const linia of plik.split('\n')) {
    const [z, na] = linia.trim().split(/\s+/);
    if (!z?.startsWith('/') || !na?.startsWith('/')) continue;
    if (na.endsWith('.xml')) continue;                 // mapy strony leżą jako pliki
    const cel = join(DIST, na, 'index.html');
    expect(existsSync(cel), `${z} prowadzi do nieistniejącego ${na}`).toBe(true);
  }
});

test('pas nagłówkowy przycina kadr od góry, nie od środka', () => {
  /**
   * `object-cover` bez `object-position` przycina od środka. Zdjęcia w tym
   * zestawie mają twarz w górnej tercji kadru, a pas jest dużo szerszy niż
   * wysoki — przy oknie 1440 px widoczny fragment farmacji zaczynał się
   * na y≈346, podczas gdy oczy są na y≈300. Na stronie zostawał sam uśmiech.
   * To samo dotyczyło medycyny (oczy 270, kadr od 314) i budownictwa
   * (oczy 350, kadr od 408).
   *
   * Nie jest to kwestia jednego pliku, tylko domyślnego zachowania przycięcia,
   * więc test obejmuje wszystkie trzy rodzaje pasa.
   */
  const PASY = [
    'farmaceuta/index.html',        // zawód dziedziczący zdjęcie kategorii
    'chirurg/index.html',           // zawód z własnym zdjęciem
    'zawody/farmacja/index.html',   // strona kategorii
  ];

  for (const plik of PASY) {
    const html = readFileSync(join(DIST, plik), 'utf8');
    const hero = html.indexOf('relative isolate');
    const obraz = html.slice(hero).match(/<img[^>]*>/)?.[0] ?? '';

    expect(obraz, `${plik}: pas bez zdjęcia`).toMatch(/object-cover/);
    expect(obraz, `${plik}: kadr przycinany od środka — twarz wypada poza pas`)
      .toContain('object-[50%_25%]');
  }
});
