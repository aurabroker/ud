import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slugDokumentu, adresDokumentu } from '../src/lib/owu.ts';
import { onRequestGet as podajPlik } from '../functions/owu/[plik].js';
import { onRequestGet as przekieruj } from '../functions/pobierz/[id].js';

/**
 * Publiczne serwowanie OWU — stały adres zamiast podpisu na pięć minut.
 *
 * Czego pilnuje: treść warunków ubezpieczenia ma być indeksowalna, a to
 * wymaga adresu, który będzie żył jutro, i odpowiedzi PODANEJ z naszej domeny.
 * Przekierowanie na podpisany adres Supabase spełnia pierwszy warunek tylko
 * pozornie — adres wygasa — a drugiego nie spełnia wcale, bo do indeksu
 * trafiłby cudzy host.
 *
 * Testy nie ruszają sieci: `fetch` jest podstawiony i odpowiada tym, czym
 * odpowiedziałyby mapa adresów, PostgREST i Storage.
 */

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const MAPA = JSON.parse(readFileSync(`${DIST}/owu-adresy.json`, 'utf8'));
const MANIFEST = JSON.parse(readFileSync(fileURLToPath(
  new URL('../src/dane/dokumenty.json', import.meta.url)), 'utf8'));

const ID = 'b37fe690-b620-405b-b1d0-313f672d9939';
const WIERSZ = {
  storage_bucket: 'ud-owu',
  storage_path: 'leadenhall/dbf11f81-c387-42f8-b98a-56067a519b19.pdf',
  file_name: 'LW_044_AD_D_TTD_PTD_PL_5.pdf',
};

/** Podstawiony `fetch`: mapa + PostgREST + Storage. `wiersze` sterują bazą. */
function zamiastSieci({ wiersze = [WIERSZ], obiektOk = true, mapaOk = true } = {}) {
  return async (adres) => {
    const a = String(adres);
    if (a.includes('/owu-adresy.json')) {
      return mapaOk ? new Response(JSON.stringify(MAPA)) : new Response('', { status: 500 });
    }
    if (a.includes('/rest/v1/ud_owu_library')) {
      // Funkcja MUSI pytać o wiersz aktywny — bez tego wycofane OWU wisiałoby
      // pod publicznym adresem, który ktoś ma w zakładkach.
      expect(a, 'zapytanie do bazy bez filtra active').toContain('active=is.true');
      return new Response(JSON.stringify(wiersze));
    }
    if (a.includes('/storage/v1/object/')) {
      return obiektOk
        ? new Response('%PDF-1.4 treść', { headers: { 'content-length': '13' } })
        : new Response('', { status: 403 });
    }
    throw new Error(`nieoczekiwany adres w teście: ${a}`);
  };
}

async function zadanie(sciezka, { env, ...opcje } = {}) {
  const prawdziwy = globalThis.fetch;
  globalThis.fetch = zamiastSieci(opcje);
  try {
    const request = new Request(`https://utratadochodu.pl${sciezka}`);
    const kontekst = {
      request,
      env: env ?? { SUPABASE_SERVICE_ROLE_KEY: 'klucz-testowy' },
      params: sciezka.startsWith('/owu/')
        ? { plik: sciezka.slice('/owu/'.length) }
        : { id: sciezka.slice('/pobierz/'.length) },
    };
    return await (sciezka.startsWith('/owu/') ? podajPlik(kontekst) : przekieruj(kontekst));
  } finally {
    globalThis.fetch = prawdziwy;
  }
}

test('slug znosi polskie znaki i myślnik w tytule', () => {
  expect(slugDokumentu('Leadenhall MEDICA — warunki szczególne HIV/WZW'))
    .toBe('leadenhall-medica-warunki-szczegolne-hiv-wzw');
  expect(slugDokumentu('Karta produktu — CEU Utrata Dochodu dla zatrudniających'))
    .toBe('karta-produktu-ceu-utrata-dochodu-dla-zatrudniajacych');
  // „ł" nie rozkłada się przez normalize('NFD') — gdyby ktoś przeszedł na NFD,
  // ten przypadek pokaże, że to za mało.
  expect(slugDokumentu('Ubezpieczenie dla żłobka')).toBe('ubezpieczenie-dla-zlobka');
  expect(adresDokumentu('Leadenhall Utrata Dochodu')).toBe('/owu/leadenhall-utrata-dochodu.pdf');
});

test('każdy dokument z manifestu ma własny, niepowtarzalny adres', () => {
  const widziane = new Map();
  for (const d of MANIFEST.dokumenty) {
    const slug = slugDokumentu(d.tytul);
    expect(widziane.get(slug), `dwa dokumenty pod /owu/${slug}.pdf — „${widziane.get(slug)}" `
      + `i „${d.tytul}". Najpewniej w bibliotece zostały aktywne dwie wersje tego samego OWU.`)
      .toBeUndefined();
    widziane.set(slug, d.tytul);
  }
  expect(widziane.size).toBe(MANIFEST.dokumenty.length);
});

test('plik wychodzi z naszej domeny jako PDF, a nie przekierowaniem', async () => {
  const odp = await zadanie('/owu/leadenhall-utrata-dochodu.pdf');

  expect(odp.status, 'przekierowanie oddałoby adres końcowy domenie Supabase').toBe(200);
  expect(odp.headers.get('content-type')).toBe('application/pdf');
  expect(await odp.text()).toContain('%PDF');
});

test('nazwa pliku idzie w nagłówku, inline i w dwóch zapisach', async () => {
  const odp = await zadanie('/owu/leadenhall-utrata-dochodu.pdf');
  const cd = odp.headers.get('content-disposition');

  expect(cd, 'attachment zamiast inline zrzuciłby plik na dysk zamiast go otworzyć').toContain('inline');
  expect(cd).toContain('filename="LW_044_AD_D_TTD_PTD_PL_5.pdf"');
  expect(cd).toContain("filename*=UTF-8''");
});

test('odpowiedź wolno buforować, ale krótko', async () => {
  const odp = await zadanie('/owu/leadenhall-utrata-dochodu.pdf');
  const bufor = odp.headers.get('cache-control');

  expect(bufor).toContain('public');
  // Wycofanie OWU ma działać od razu, więc bufor liczy się w minutach.
  const maks = Number(bufor.match(/s-maxage=(\d+)/)?.[1] ?? bufor.match(/max-age=(\d+)/)?.[1]);
  expect(maks, `bufor ${maks} s — wycofany dokument wisiałby tyle pod publicznym adresem`)
    .toBeLessThanOrEqual(3600);
});

test('wycofany dokument znika spod publicznego adresu', async () => {
  const odp = await zadanie('/owu/leadenhall-utrata-dochodu.pdf', { wiersze: [] });
  expect(odp.status).toBe(404);
});

test('adres spoza mapy i adres o złym kształcie nie wołają bazy', async () => {
  expect((await zadanie('/owu/nie-ma-takiego.pdf')).status).toBe(404);
  expect((await zadanie('/owu/../../etc/passwd.pdf')).status).toBe(400);
  expect((await zadanie('/owu/leadenhall-utrata-dochodu.txt')).status).toBe(404);
});

test('brak klucza serwisowego to 503, nie cicha awaria', async () => {
  const odp = await zadanie('/owu/leadenhall-utrata-dochodu.pdf', { env: {} });
  expect(odp.status).toBe(503);
});

test('błąd kubełka nie udaje pustego PDF-a', async () => {
  const odp = await zadanie('/owu/leadenhall-utrata-dochodu.pdf', { obiektOk: false });
  expect(odp.status).toBe(502);
});

test('stary adres /pobierz/<id> przenosi wartość na nowy', async () => {
  const odp = await zadanie(`/pobierz/${ID}`);

  expect(odp.status, '302 kazałoby wyszukiwarce trzymać oba adresy').toBe(301);
  expect(odp.headers.get('location')).toBe('/owu/leadenhall-utrata-dochodu.pdf');
});

test('stary adres nieznanego dokumentu nie zgaduje zamiennika', async () => {
  expect((await zadanie('/pobierz/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  expect((await zadanie('/pobierz/nie-uuid')).status).toBe(400);
});
