import { test, expect } from '@playwright/test';
import { czytaj, bezTypow, AsyncFunction } from './pomocnicy-funkcji.js';

/**
 * Normalizacja zdjęć artykułów (`normalize-article-images`) — numeracja plików
 * i stan po przebiegu przerwanym na limicie.
 *
 * 26.10.2026 („przychodzi-lekarz-do-lekarza": okładka i sześć ikon) pierwsze
 * wywołanie przemieliło trzy obrazki, przepisało treść częściowo i postawiło
 * `ready`. Cron już tego artykułu nie brał, a ręczne wywołanie numerowało
 * pozostałe obrazki od 1 — ikona 3 nadpisałaby plik ikony 1. Funkcja jest
 * wspólna dla jedenastu serwisów, więc test ładuje jej PRAWDZIWE źródło
 * (jak szkice.spec.js) i puszcza je na atrapach bazy, kubełka i ImageMagick.
 *
 * Atrapa bazy odtwarza wyzwalacz `aura_articles_images_pending` — od niego
 * zależy, czy zapis funkcji zostanie, czy wróci do 'pending' z zerem prób.
 */

const URL_BAZY = 'https://projekt.supabase.co';
const TOKEN = 'token-z-vaulta';
const OKLADKA = 'https://generator.example/okladka.png';
const KATALOG_URL = `${URL_BAZY}/storage/v1/object/public/article-images/normalized`;

/** Bajty „obrazka": atrapa ImageMagick czyta z nich nazwę i wymiary. */
const obrazek = (nazwa, w = 256, h = 256) => Buffer.from(`OBRAZ:${nazwa}:${w}x${h}`);
const dataUri = (nazwa) => `data:image/png;base64,${obrazek(nazwa).toString('base64')}`;
const img = (nazwa) => `<img src="${dataUri(nazwa)}" alt="">`;
const zNormalizacji = (slug, nr) => `<img src="${KATALOG_URL}/${slug}-content${nr}-1600.webp" alt="">`;
const ikony = (od, doIl) => Array.from({ length: doIl - od + 1 }, (_, i) => `ikona${od + i}`);

/** Źródło funkcji bez typów i importów — te podaje test. */
function kodNormalizacji() {
  // Import z magick-wasm jest wieloliniowy, więc nie `kodFunkcji()` z pomocników.
  let kod = bezTypow(czytaj('functions/normalize-article-images/index.ts')).replace(/^import [\s\S]+?;$/gm, '');
  const przed = kod;
  // `import.meta` istnieje tylko w module; ścieżka do magick.wasm i tak trafia do atrapy.
  kod = kod.replace(/import\.meta\.resolve\([^)]*\)/, "'file:///magick/'");
  if (kod === przed) throw new Error('w funkcji nie ma już import.meta.resolve — popraw test');
  return kod;
}

const MagickFormat = { Jpeg: 'JPEG', WebP: 'WEBP' };
class MagickReadSettings { setDefine() {} }
const ImageMagick = {
  read(bajty, _ustawienia, dalej) {
    const m = /^OBRAZ:([^:]+):(\d+)x(\d+)$/.exec(Buffer.from(bajty).toString());
    if (!m) throw new Error('atrapa: to nie obrazek testowy');
    if (m[1].startsWith('zepsuty')) throw new Error('atrapa: uszkodzony plik');
    return dalej({
      width: Number(m[2]), height: Number(m[3]), quality: 0,
      autoOrient() {}, strip() {},
      resize(w, h) { this.width = w; this.height = h; },
      write(_format, zapisz) { return zapisz(Buffer.from(`WEBP:${m[1]}:${this.width}x${this.height}`)); },
    });
  },
};

const rozne = (a, b) => (a ?? null) !== (b ?? null);

/**
 * Atrapa Supabase: trzy tabele, kubełek i RPC tokenu. `bladWysylki` — ścieżki,
 * których pierwsza wysyłka do kubełka się nie uda (np. 503 Storage).
 */
function atrapaSupabase(artykuly, { bladWysylki = [] } = {}) {
  const doZepsucia = new Set(bladWysylki);
  const stan = { artykuly, rejestr: [], kopie: [], pliki: new Map(), wysylki: [], odczyty: 0 };

  // public.aura_articles_mark_images_pending() — BEFORE UPDATE.
  const wyzwalacz = (stary, nowy) => {
    if (rozne(nowy.images_status, stary.images_status) || rozne(nowy.images_attempts, stary.images_attempts)) return nowy;
    if (rozne(nowy.preview_image_url, stary.preview_image_url) || rozne(nowy.thumbnail_url, stary.thumbnail_url)
      || rozne(nowy.content, stary.content)) {
      return { ...nowy, images_status: 'pending', images_error: null, images_attempts: 0 };
    }
    return nowy;
  };

  const zapytanie = (tabela) => {
    const st = { op: 'select', patch: null, filtry: [], licz: false, limit: null, opcje: null };
    const b = {
      select(_kolumny, opcje) { if (opcje?.count) st.licz = true; return b; },
      update(p) { st.op = 'update'; st.patch = p; return b; },
      upsert(w, opcje) { st.op = 'upsert'; st.patch = w; st.opcje = opcje; return b; },
      eq(k, v) { st.filtry.push((r) => r[k] === v); return b; },
      lt(k, v) { st.filtry.push((r) => r[k] < v); return b; },
      order() { return b; },
      limit(n) { st.limit = n; return b; },
      then(ok, blad) {
        return Promise.resolve().then(() => {
          if (tabela === 'aura_articles') {
            const trafione = stan.artykuly.filter((r) => st.filtry.every((f) => f(r)));
            if (st.op === 'update') {
              for (const r of trafione) Object.assign(r, wyzwalacz(r, { ...r, ...st.patch }));
              return { data: null, error: null };
            }
            stan.odczyty++;
            if (st.licz) return { count: trafione.length, error: null };
            return { data: structuredClone(trafione.slice(0, st.limit ?? undefined)), error: null };
          }
          if (tabela === 'aura_article_images') {
            if (st.op === 'upsert') {
              const w = st.patch;
              const i = stan.rejestr.findIndex((r) => r.article_id === w.article_id && r.image_role === w.image_role && r.seq === w.seq);
              if (i >= 0) stan.rejestr[i] = { ...w }; else stan.rejestr.push({ ...w });
              return { data: null, error: null };
            }
            return { data: structuredClone(stan.rejestr.filter((r) => st.filtry.every((f) => f(r)))), error: null };
          }
          if (tabela === 'aura_article_content_backup') {
            if (!stan.kopie.some((k) => k.article_id === st.patch.article_id)) stan.kopie.push({ ...st.patch });
            return { data: null, error: null };
          }
          throw new Error(`nieoczekiwana tabela: ${tabela}`);
        }).then(ok, blad);
      },
    };
    return b;
  };

  const klient = {
    from: zapytanie,
    async rpc(nazwa, { token }) {
      if (nazwa !== 'aura_blog_token_matches') throw new Error(`nieoczekiwane rpc: ${nazwa}`);
      return { data: token === TOKEN, error: null };
    },
    storage: {
      from: () => ({
        async upload(sciezka, dane) {
          if (doZepsucia.delete(sciezka)) return { error: { message: 'atrapa: 503 Storage' } };
          const tresc = Buffer.from(dane).toString();
          stan.wysylki.push({ sciezka, tresc });
          stan.pliki.set(sciezka, tresc);
          return { error: null };
        },
      }),
    },
  };
  return { klient, stan };
}

/**
 * `okladkaZmienna` — adres okładki oddaje za każdym razem inne bajty (generator
 * bez stałego pliku); `bladWysylki` — patrz atrapaSupabase().
 */
async function zaladuj(artykuly, { okladkaZmienna = false, bladWysylki = [] } = {}) {
  const { klient, stan } = atrapaSupabase(artykuly, { bladWysylki });
  let pobranOkladki = 0;
  let handler = null;
  const zmienne = { SUPABASE_URL: URL_BAZY, SUPABASE_SERVICE_ROLE_KEY: 'klucz' };
  const Deno = {
    env: { get: (k) => zmienne[k] },
    serve: (h) => { handler = h; },
    readFile: async () => new Uint8Array(1),
  };
  const fetchAtrapa = async (adres, opcje = {}) => {
    if (String(adres) !== OKLADKA) throw new Error(`atrapa fetch: nieoczekiwany adres ${adres}`);
    if (opcje.method !== 'HEAD') pobranOkladki++;
    const bajty = obrazek(okladkaZmienna ? `okladka${pobranOkladki}` : 'okladka', 2400, 1600);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(bajty.length), etag: '"okladka-1"', 'content-type': 'image/png' }),
      arrayBuffer: async () => (opcje.method === 'HEAD' ? new ArrayBuffer(0) : bajty.buffer.slice(bajty.byteOffset, bajty.byteOffset + bajty.length)),
    };
  };

  await new AsyncFunction(
    'createClient', 'ImageMagick', 'initializeImageMagick', 'MagickFormat', 'MagickReadSettings', 'Deno', 'fetch',
    kodNormalizacji(),
  )(() => klient, ImageMagick, async () => {}, MagickFormat, MagickReadSettings, Deno, fetchAtrapa);

  const wywolaj = async (cialo = {}, token = TOKEN) => {
    const res = await handler(new Request(`${URL_BAZY}/functions/v1/normalize-article-images`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-blog-token': token },
      body: JSON.stringify(cialo),
    }));
    return { status: res.status, dane: await res.json() };
  };

  /** Co leży w kubełku pod danym numerem obrazka z treści (oba warianty muszą się zgadzać). */
  const wPliku = (slug, nr) => {
    const w800 = stan.pliki.get(`normalized/${slug}-content${nr}-800.webp`);
    const w1600 = stan.pliki.get(`normalized/${slug}-content${nr}-1600.webp`);
    expect(w800, `content${nr}: warianty 800 i 1600 niosą różne obrazki`).toBe(w1600);
    return w800 ? w800.split(':')[1] : null;
  };

  /** Żadna ścieżka w kubełku nie dostała dwóch różnych obrazków. */
  const bezNadpisan = () => {
    const co = new Map();
    for (const { sciezka, tresc } of stan.wysylki) {
      const nazwa = tresc.split(':')[1];
      if (co.has(sciezka)) expect(co.get(sciezka), `${sciezka} nadpisany innym obrazkiem`).toBe(nazwa);
      co.set(sciezka, nazwa);
    }
  };

  return { stan, wywolaj, wPliku, bezNadpisan };
}

const artykul = (nadpisz = {}) => ({
  id: 'a1', slug: 'lekarz', status: 'published', published_at: '2026-10-26T20:05:49Z',
  content: '', preview_image_url: OKLADKA, thumbnail_url: null,
  images_status: 'pending', images_attempts: 0, images_error: null,
  preview_image_800: null, preview_image_1600: null,
  ...nadpisz,
});

test('okładka i sześć ikon: trzy wywołania crona, każdy plik ma swój obrazek, „ready" dopiero na końcu', async () => {
  const nazwy = ikony(1, 6);
  const tresc = nazwy.map((n, i) => `<p>punkt ${i + 1}</p>${img(n)}`).join('\n');
  const { stan, wywolaj, wPliku, bezNadpisan } = await zaladuj([artykul({ content: tresc })]);
  const a = stan.artykuly[0];

  const r1 = await wywolaj();
  expect(r1.status).toBe(200);
  expect(a.images_status, 'po pierwszym wywołaniu zostały cztery ikony — to nie jest „ready"').toBe('pending');
  expect(r1.dane.zostalo, 'cron musi wiedzieć, że artykuł czeka').toBe(1);
  expect(a.images_attempts, 'przebieg z postępem oddaje próbę').toBe(0);
  expect(a.images_error).toBeNull();

  await wywolaj();
  expect(a.images_status).toBe('pending');

  const r3 = await wywolaj();
  expect(r3.dane.zrobione[0].stan).toBe('ready');
  expect(a.images_status).toBe('ready');
  expect(a.images_error).toBeNull();
  expect(a.images_attempts).toBe(1);

  for (let nr = 1; nr <= 6; nr++) expect(wPliku('lekarz', nr), `content${nr}`).toBe(`ikona${nr}`);
  bezNadpisan();
  expect(stan.pliki.get('normalized/lekarz-cover-1600.webp')).toBe('WEBP:okladka:1600x1067');
  expect(a.preview_image_800).toBe(`${KATALOG_URL}/lekarz-cover-800.webp`);

  const oczekiwana = nazwy.map((_, i) => `<p>punkt ${i + 1}</p>${zNormalizacji('lekarz', i + 1)}`).join('\n');
  expect(a.content, 'treść: każda ikona na swoim miejscu, pod swoim numerem').toBe(oczekiwana);
  expect(stan.kopie[0].content, 'kopia treści sprzed pierwszej podmiany — z kompletem data URI').toBe(tresc);

  const r4 = await wywolaj();
  expect(r4.dane.komunikat).toBe('nic nie czeka');
});

test('artykuł zostawiony przez starą wersję w połowie („ready" z data URI) kończy się bez nadpisania content1–2', async () => {
  // Stan po pierwszym wywołaniu dawnej funkcji: dwie ikony przemielone, cztery w treści.
  const tresc = [zNormalizacji('lekarz', 1), zNormalizacji('lekarz', 2), ...ikony(3, 6).map(img)].join('\n');
  const { stan, wywolaj, wPliku, bezNadpisan } = await zaladuj([artykul({ content: tresc, images_status: 'ready', images_attempts: 1 })]);
  const a = stan.artykuly[0];
  for (const nr of [1, 2]) {
    for (const w of [800, 1600]) stan.pliki.set(`normalized/lekarz-content${nr}-${w}.webp`, `WEBP:ikona${nr}:256x256`);
    stan.rejestr.push({
      article_id: 'a1', image_role: 'content', seq: nr, source_sha256: `stara-suma-${nr}`,
      url_800: `${KATALOG_URL}/lekarz-content${nr}-800.webp`, url_1600: `${KATALOG_URL}/lekarz-content${nr}-1600.webp`,
    });
  }

  await wywolaj({ slug: 'lekarz' });
  expect(a.images_status, 'została jedna ikona — artykuł wraca do kolejki').toBe('pending');
  await wywolaj();
  expect(a.images_status).toBe('ready');

  for (let nr = 1; nr <= 6; nr++) expect(wPliku('lekarz', nr), `content${nr}`).toBe(`ikona${nr}`);
  expect(stan.wysylki.some((w) => /content[12]-/.test(w.sciezka)), 'content1–2 nie mogą dostać nowego pliku').toBe(false);
  bezNadpisan();
  expect(a.content).toBe([1, 2, 3, 4, 5, 6].map((nr) => zNormalizacji('lekarz', nr)).join('\n'));
});

test('do trzech obrazków (z okładką): jedno wywołanie, „ready" i te same nazwy plików co dotąd', async () => {
  const tresc = `<p>wstęp</p>${img('wykres')}<p>dalej</p>${img('tabela')}`;
  const { stan, wywolaj, wPliku } = await zaladuj([artykul({ content: tresc })]);
  const a = stan.artykuly[0];

  const r = await wywolaj();
  expect(r.dane.zrobione[0]).toMatchObject({ zrodel: 3, przetworzonych: 3, zostalo: 0, stan: 'ready', bledy: [] });
  expect(a.images_status).toBe('ready');
  expect(a.images_attempts).toBe(1);
  expect(wPliku('lekarz', 1)).toBe('wykres');
  expect(wPliku('lekarz', 2)).toBe('tabela');
  expect(a.content).toBe(`<p>wstęp</p>${zNormalizacji('lekarz', 1)}<p>dalej</p>${zNormalizacji('lekarz', 2)}`);
  expect([...stan.pliki.keys()].sort()).toEqual([
    'normalized/lekarz-content1-1600.webp', 'normalized/lekarz-content1-800.webp',
    'normalized/lekarz-content2-1600.webp', 'normalized/lekarz-content2-800.webp',
    'normalized/lekarz-cover-1600.webp', 'normalized/lekarz-cover-800.webp',
  ]);
});

test('obrazek dopisany do znormalizowanego artykułu dostaje kolejny numer, a stare pliki zostają', async () => {
  const stara = [1, 2, 3].map((nr) => zNormalizacji('lekarz', nr));
  // Redakcja wkleja nowy obrazek NA POCZĄTKU — dawniej dostawał numer 1.
  const tresc = [img('nowy'), ...stara].join('\n');
  const { stan, wywolaj, wPliku, bezNadpisan } = await zaladuj([artykul({ content: tresc, preview_image_url: null })]);
  for (const nr of [1, 2, 3]) {
    for (const w of [800, 1600]) stan.pliki.set(`normalized/lekarz-content${nr}-${w}.webp`, `WEBP:stary${nr}:256x256`);
    stan.rejestr.push({
      article_id: 'a1', image_role: 'content', seq: nr, source_sha256: `suma-${nr}`,
      url_800: `${KATALOG_URL}/lekarz-content${nr}-800.webp`, url_1600: `${KATALOG_URL}/lekarz-content${nr}-1600.webp`,
    });
  }

  await wywolaj();
  const a = stan.artykuly[0];
  expect(a.images_status).toBe('ready');
  expect(wPliku('lekarz', 4)).toBe('nowy');
  for (const nr of [1, 2, 3]) expect(wPliku('lekarz', nr)).toBe(`stary${nr}`);
  bezNadpisan();
  expect(a.content).toBe([zNormalizacji('lekarz', 4), ...stara].join('\n'));
  expect(a.preview_image_800, 'bez okładki kafelek bierze PIERWSZY obrazek z treści, nie plik nr 1')
    .toBe(`${KATALOG_URL}/lekarz-content4-800.webp`);
});

test('ten sam obrazek wklejony dwa razy dostaje jeden plik', async () => {
  const tresc = [img('logo'), img('logo'), img('wykres')].join('');
  const { stan, wywolaj, wPliku } = await zaladuj([artykul({ content: tresc, preview_image_url: null })]);

  await wywolaj();
  expect(stan.artykuly[0].images_status).toBe('ready');
  expect(wPliku('lekarz', 1)).toBe('logo');
  expect(wPliku('lekarz', 2)).toBe('wykres');
  expect(stan.artykuly[0].content).toBe([1, 1, 2].map((nr) => zNormalizacji('lekarz', nr)).join(''));
});

test('szesnaście obrazków nie utyka na limicie prób (MAKS_PROB)', async () => {
  const tresc = ikony(1, 16).map(img).join('');
  const { stan, wywolaj, wPliku, bezNadpisan } = await zaladuj([artykul({ content: tresc })]);
  const a = stan.artykuly[0];

  let wywolan = 0;
  while (a.images_status === 'pending' && wywolan < 10) { await wywolaj(); wywolan++; }
  expect(wywolan, '17 źródeł po 3 na wywołanie').toBe(6);
  expect(a.images_status).toBe('ready');
  for (let nr = 1; nr <= 16; nr++) expect(wPliku('lekarz', nr)).toBe(`ikona${nr}`);
  bezNadpisan();
});

test('przebieg bez postępu zużywa próbę, a po MAKS_PROB kończy się błędem zamiast wisieć w kolejce', async () => {
  // Trzy uszkodzone obrazki zjadają budżet każdego wywołania; czwarty nigdy nie dochodzi do kolejki.
  const tresc = [img('zepsuty1'), img('zepsuty2'), img('zepsuty3'), img('ikona1')].join('');
  const { stan, wywolaj } = await zaladuj([artykul({ content: tresc, preview_image_url: null })]);
  const a = stan.artykuly[0];

  for (let i = 1; i <= 4; i++) {
    await wywolaj();
    expect(a.images_status, `wywołanie ${i}`).toBe('pending');
    expect(a.images_attempts).toBe(i);
  }
  await wywolaj();
  expect(a.images_status).toBe('error');
  expect(a.images_error).toContain('przerwane po 5 próbach');
  expect(a.images_error).toContain('content1: atrapa: uszkodzony plik');
  expect(a.content, 'bez postępu treść zostaje nietknięta').toBe(tresc);

  const r = await wywolaj();
  expect(r.dane.komunikat, 'artykuł z błędem nie wraca do crona').toBe('nic nie czeka');
});

test('pełny przebieg z błędem jednego obrazka: „error" jak dotąd, reszta podmieniona, numery bez przesunięć', async () => {
  const tresc = [img('ikona1'), img('zepsuty'), img('ikona3')].join('|');
  const { stan, wywolaj, wPliku } = await zaladuj([artykul({ content: tresc, preview_image_url: null })]);
  const a = stan.artykuly[0];

  const r = await wywolaj();
  expect(a.images_status).toBe('error');
  expect(a.images_error).toBe('content2: atrapa: uszkodzony plik');
  expect(r.dane.zrobione[0]).toMatchObject({ zostalo: 0, stan: 'error' });
  expect(wPliku('lekarz', 1)).toBe('ikona1');
  expect(wPliku('lekarz', 3)).toBe('ikona3');
  expect(a.content).toBe([zNormalizacji('lekarz', 1), img('zepsuty'), zNormalizacji('lekarz', 3)].join('|'));
});

test('wyczerpany budżet zdjęć: następnego artykułu nie ruszamy (dawniej dostawał „ready" bez obejrzenia)', async () => {
  const pierwszy = artykul({ content: ikony(1, 3).map(img).join('') });
  const drugi = artykul({ id: 'a2', slug: 'drugi', published_at: '2026-10-01T00:00:00Z', content: img('inny') });
  const { stan, wywolaj } = await zaladuj([pierwszy, drugi]);

  const r = await wywolaj({ limit: 2 });
  expect(r.dane.zrobione).toHaveLength(1);
  expect(stan.artykuly[0].images_status).toBe('pending');
  expect(stan.artykuly[1]).toMatchObject({ images_status: 'pending', images_attempts: 0, content: img('inny') });
});

test('zły token: 401 i ani jednego odczytu artykułów', async () => {
  const { stan, wywolaj } = await zaladuj([artykul({ content: img('ikona1') })]);
  const r = await wywolaj({}, 'zly');
  expect(r.status).toBe(401);
  expect(stan.odczyty).toBe(0);
  expect(stan.artykuly[0].images_attempts).toBe(0);
});

test('ręczne wywołanie artykułu z licznikiem na limicie oddaje go z powrotem cronowi', async () => {
  // Pięć nieudanych przebiegów (np. usługa skalowania leżała) — status 'error',
  // licznik 5. Po naprawie przyczyny ktoś woła funkcję ręcznie dla tego slugu.
  const tresc = ikony(1, 6).map(img).join('');
  const { stan, wywolaj, wPliku } = await zaladuj([artykul({ content: tresc, images_status: 'error', images_attempts: 5 })]);
  const a = stan.artykuly[0];

  await wywolaj({ slug: 'lekarz' });
  expect(a.images_status).toBe('pending');
  expect(a.images_attempts, 'z 5 cron by go już nie wziął').toBe(4);
  await wywolaj();
  await wywolaj();
  expect(a.images_status).toBe('ready');
  for (let nr = 1; nr <= 6; nr++) expect(wPliku('lekarz', nr)).toBe(`ikona${nr}`);
});

test('okładka spod zmiennego adresu i uszkodzone obrazki nie kręcą się w cronie bez końca', async () => {
  // Okładka przerabiana w każdym przebiegu to nie postęp: treść stoi w miejscu.
  const tresc = [img('zepsuty1'), img('zepsuty2'), img('zepsuty3'), img('ikona1')].join('');
  const { stan, wywolaj } = await zaladuj([artykul({ content: tresc })], { okladkaZmienna: true });
  const a = stan.artykuly[0];

  let wywolan = 0;
  while (a.images_status === 'pending' && wywolan < 20) { await wywolaj(); wywolan++; }
  expect(wywolan, 'MAKS_PROB przebiegów bez postępu').toBe(5);
  expect(a.images_status).toBe('error');
  expect(a.images_error).toContain('przerwane po 5 próbach');
});

test('numer bierze się też z adresów w treści, gdy rejestr tego artykułu jest pusty (skopiowany wiersz)', async () => {
  const tresc = [zNormalizacji('lekarz', 2), img('nowy')].join('');
  const { stan, wywolaj, wPliku } = await zaladuj([artykul({ content: tresc, preview_image_url: null })]);

  await wywolaj();
  expect(wPliku('lekarz', 3)).toBe('nowy');
  expect(stan.wysylki.some((w) => w.sciezka.includes('content2-')), 'plik content2 należy do treści — nie ruszamy').toBe(false);
  expect(stan.artykuly[0].content).toBe([zNormalizacji('lekarz', 2), zNormalizacji('lekarz', 3)].join(''));
});

test('bez okładki: redakcja podmienia jedyny obrazek — kafelek idzie za nowym, nie za usuniętym', async () => {
  const { stan, wywolaj, wPliku } = await zaladuj([artykul({
    content: `<p>tekst</p>${img('nowy')}`,
    preview_image_url: null,
    preview_image_800: `${KATALOG_URL}/lekarz-content1-800.webp`,
    preview_image_1600: `${KATALOG_URL}/lekarz-content1-1600.webp`,
  })]);
  for (const w of [800, 1600]) stan.pliki.set(`normalized/lekarz-content1-${w}.webp`, 'WEBP:stary:256x256');
  stan.rejestr.push({
    article_id: 'a1', image_role: 'content', seq: 1, source_sha256: 'suma-starego',
    url_800: `${KATALOG_URL}/lekarz-content1-800.webp`, url_1600: `${KATALOG_URL}/lekarz-content1-1600.webp`,
  });

  await wywolaj();
  const a = stan.artykuly[0];
  expect(wPliku('lekarz', 2)).toBe('nowy');
  expect(wPliku('lekarz', 1), 'stary plik zostaje nietknięty').toBe('stary');
  expect(a.content).toBe(`<p>tekst</p>${zNormalizacji('lekarz', 2)}`);
  expect(a.preview_image_800).toBe(`${KATALOG_URL}/lekarz-content2-800.webp`);
});

test('bez okładki: pierwszy obrazek padł po nadaniu numeru — kafelek i tak dostaje pierwszy z treści', async () => {
  const { stan, wywolaj, wPliku } = await zaladuj(
    [artykul({ content: [img('pierwszy'), img('drugi')].join(''), preview_image_url: null })],
    { bladWysylki: ['normalized/lekarz-content1-800.webp'] },
  );
  const a = stan.artykuly[0];

  await wywolaj();
  expect(a.images_status).toBe('error');
  expect(a.images_error).toContain('content1: upload normalized/lekarz-content1-800.webp: atrapa: 503 Storage');

  await wywolaj({ slug: 'lekarz' });
  expect(a.images_status).toBe('ready');
  expect(wPliku('lekarz', 3)).toBe('pierwszy');
  expect(wPliku('lekarz', 2)).toBe('drugi');
  expect(a.content).toBe([zNormalizacji('lekarz', 3), zNormalizacji('lekarz', 2)].join(''));
  expect(a.preview_image_800, 'kafelek: pierwszy obrazek z treści, choć numeru 1 nie ma wcale')
    .toBe(`${KATALOG_URL}/lekarz-content3-800.webp`);
});
