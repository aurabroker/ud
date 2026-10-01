import { test, expect } from '@playwright/test';
import {
  czytaj, kodFunkcji, AsyncFunction, SZKIC_PODPIS, SEKRET, atrapaBazy,
} from './pomocnicy-funkcji.js';

/**
 * Przypomnienie o niedokończonym wniosku (`wniosek-przypomnienie`).
 *
 * To jest marketing bezpośredni (art. 398 Prawa komunikacji elektronicznej):
 * piszemy wyłącznie za zgodą, jeden raz, bez imienia z formularza i bez słowa
 * o tym, na którym kroku klient przerwał. Test ładuje prawdziwe źródło funkcji
 * i uruchamia je z atrapami Supabase i Resend — tak jak szkice.spec.js.
 *
 * Wybór kandydatów (zgoda, 3 h, 7 dni, jeden mail na adres na 30 dni, zamykanie
 * szkiców z istniejącym wnioskiem) robi funkcja SQL z migracji; tu sprawdzamy to,
 * co dzieje się PO wyborze: bramkę, treść listu, zajęcie szkicu i porażki wysyłki.
 */

const TOKEN_CRONA = 'token-z-vaulta';
const ID_1 = '00000000-0000-4000-8000-0000000000a1';
const ID_2 = '00000000-0000-4000-8000-0000000000a2';

const wiersz = (id, nadpisz = {}) => ({
  id, zgoda_kontakt: true, ukonczony_at: null, przypomnienie_wyslane_at: null,
  ostatni_krok: 'dane', imie: 'Jan Kowalski', email: `${id.slice(-2)}@example.com`, phone: '500100200',
  zgoda_wersja: 'v1', zgoda_tresc: 't', zgoda_at: new Date().toISOString(),
  ...nadpisz,
});

/**
 * Ładuje funkcję. `kandydaci` — to, co zwróciłaby funkcja SQL; `szkice` — wiersze
 * w tabeli (zajęcie szkicu działa na nich); `resend` — odpowiedź atrapy Resend.
 */
async function zaladuj({ env = {}, kandydaci = [], szkice = [], resend = () => ({ ok: true, status: 200 }) } = {}) {
  const baza = atrapaBazy({
    rpcOdpowiedzi: {
      edge_cron_token_matches: ({ token }) => token === TOKEN_CRONA,
      ud_wnioski_do_przypomnienia: () => kandydaci,
    },
  });
  baza.wiersze.push(...szkice);
  const logi = [];
  const wyslane = [];
  let handler = null;

  const zmienne = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'klucz',
    RESEND_API_KEY: 're_klucz', SZKIC_HMAC_SECRET: SEKRET, ...env,
  };
  const Deno = { env: { get: (k) => zmienne[k] }, serve: (h) => { handler = h; } };
  const fetchAtrapa = async (url, opcje) => {
    const cialo = JSON.parse(String(opcje.body));
    wyslane.push({ url: String(url), naglowki: opcje.headers, cialo });
    const wynik = resend(cialo, wyslane.length);
    if (wynik instanceof Error) throw wynik;
    return { ok: wynik.ok, status: wynik.status, text: async () => wynik.tresc ?? '', json: async () => ({ id: 'mail-1' }) };
  };

  await new AsyncFunction('createClient', 'logError', 'podpiszWycofanie', 'Deno', 'fetch', kodFunkcji('functions/wniosek-przypomnienie/index.ts'))(
    () => baza.klient,
    async (zrodlo, wiadomosc, kontekst) => { logi.push({ zrodlo, wiadomosc, kontekst }); },
    SZKIC_PODPIS.podpiszWycofanie,
    Deno,
    fetchAtrapa,
  );

  const wywolaj = async ({ metoda = 'POST', token = TOKEN_CRONA } = {}) => {
    const res = await handler(new Request('https://x.supabase.co/functions/v1/wniosek-przypomnienie', {
      method: metoda,
      headers: token === null ? {} : { 'x-cron-token': token },
      body: metoda === 'GET' ? undefined : '{}',
    }));
    return { status: res.status, tresc: await res.text() };
  };
  return { ...baza, logi, wyslane, wywolaj };
}

const kandydat = (id) => ({ szkic_id: id, adres: `${id.slice(-2)}@example.com` });

test.describe('przypomnienie: bramka', () => {
  test('GET i brak nagłówka: odmowa, żadnego odczytu danych', async () => {
    const f = await zaladuj({ kandydaci: [kandydat(ID_1)], szkice: [wiersz(ID_1)] });
    expect((await f.wywolaj({ metoda: 'GET' })).status).toBe(405);
    expect((await f.wywolaj({ token: null })).status).toBe(401);
    expect(f.rpc).toEqual([]);
    expect(f.wyslane).toHaveLength(0);
  });

  test('zły token: 401, a kandydaci nie są nawet odczytywani', async () => {
    const f = await zaladuj({ kandydaci: [kandydat(ID_1)], szkice: [wiersz(ID_1)] });
    expect((await f.wywolaj({ token: 'zgadniety-token' })).status).toBe(401);
    expect(f.rpc.map((r) => r.nazwa)).toEqual(['edge_cron_token_matches']);
    expect(f.wyslane).toHaveLength(0);
    expect(f.wiersze[0].przypomnienie_wyslane_at).toBeNull();
  });

  test('brak klucza Resend albo sekretu podpisu: 503, wpis w ud_errors, nic nie wychodzi', async () => {
    for (const brak of ['RESEND_API_KEY', 'SZKIC_HMAC_SECRET']) {
      const f = await zaladuj({ env: { [brak]: '' }, kandydaci: [kandydat(ID_1)], szkice: [wiersz(ID_1)] });
      const r = await f.wywolaj();
      expect(r.status, brak).toBe(503);
      expect(f.logi.map((l) => l.wiadomosc).join(), brak).toContain(brak);
      expect(f.wyslane).toHaveLength(0);
      expect(f.rpc.map((x) => x.nazwa), 'kandydaci nie powinni być czytani bez kompletu sekretów').toEqual(['edge_cron_token_matches']);
    }
  });

  test('zapytanie o kandydatów niesie opóźnienie 3 godziny', async () => {
    const f = await zaladuj();
    await f.wywolaj();
    const zapytanie = f.rpc.find((r) => r.nazwa === 'ud_wnioski_do_przypomnienia');
    expect(zapytanie.argumenty).toMatchObject({ opoznienie: '3 hours' });
  });
});

test.describe('przypomnienie: wysyłka', () => {
  test('jeden mail na kandydata: nadawca info@, reply-to info@, adres z szkicu', async () => {
    const f = await zaladuj({ kandydaci: [kandydat(ID_1)], szkice: [wiersz(ID_1)] });
    const r = await f.wywolaj();
    expect(r.status).toBe(200);
    expect(f.wyslane).toHaveLength(1);

    const { url, naglowki, cialo } = f.wyslane[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(naglowki.Authorization).toBe('Bearer re_klucz');
    expect(cialo.from).toBe('UtrataDochodu <info@utratadochodu.pl>');
    expect(cialo.reply_to).toBe('info@utratadochodu.pl');
    expect(cialo.to).toEqual(['a1@example.com']);
    expect(cialo.subject).toBeTruthy();
  });

  test('treść: telefon, link z UTM, stopka firmy, link wycofania z podpisem', async () => {
    const f = await zaladuj({ kandydaci: [kandydat(ID_1)], szkice: [wiersz(ID_1)] });
    await f.wywolaj();
    const { cialo } = f.wyslane[0];

    for (const tresc of [cialo.html, cialo.text]) {
      expect(tresc).toContain('504 400 901');
      expect(tresc).toContain('https://utratadochodu.pl/wniosek/?utm_source=przypomnienie&utm_medium=email&utm_campaign=niedokonczony-wniosek'.replaceAll('&', tresc === cialo.html ? '&amp;' : '&'));
      expect(tresc).toContain('Aura Expert');
      expect(tresc).toContain('0000599840');
      expect(tresc).toContain('11229690/A');
    }

    // Link wycofania: fragment (#id=…&sig=…), a podpis przechodzi weryfikację.
    const m = cialo.text.match(/https:\/\/utratadochodu\.pl\/wycofaj-zgode\/#id=([0-9a-f-]{36})&sig=([0-9a-f]{64})/);
    expect(m, 'link wycofania w wersji tekstowej').toBeTruthy();
    expect(m[1]).toBe(ID_1);
    expect(await SZKIC_PODPIS.sprawdzWycofanie(m[1], m[2], SEKRET)).toBe(true);
    expect(await SZKIC_PODPIS.sprawdzWycofanie(m[1], m[2], 'inny-sekret')).toBe(false);
  });

  test('nagłówki List-Unsubscribe (RFC 8058): jedno kliknięcie w skrzynce pocztowej', async () => {
    const f = await zaladuj({ kandydaci: [kandydat(ID_1)], szkice: [wiersz(ID_1)] });
    await f.wywolaj();
    const h = f.wyslane[0].cialo.headers;
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(h['List-Unsubscribe']).toMatch(
      /^<https:\/\/x\.supabase\.co\/functions\/v1\/wniosek-szkic\?akcja=wycofaj&id=[0-9a-f-]{36}&sig=[0-9a-f]{64}>, <mailto:info@utratadochodu\.pl\?subject=Wycofanie%20zgody>$/,
    );
  });

  test('w liście nie ma imienia z formularza ani informacji o kroku', async () => {
    // Imię wpisuje odwiedzający — bez filtra to kanał do rozsyłania cudzych treści
    // naszym nadawcą. Krok „zdrowie" to informacja o zdrowiu.
    const zlosliwe = '<script>alert(1)</script> Zażółć Gęślą';
    const f = await zaladuj({
      kandydaci: [kandydat(ID_1)],
      szkice: [wiersz(ID_1, { imie: zlosliwe, ostatni_krok: 'zdrowie' })],
    });
    await f.wywolaj();
    const { html, text } = f.wyslane[0].cialo;
    for (const tresc of [html, text]) {
      expect(tresc).not.toContain('Zażółć');
      expect(tresc).not.toContain('script');
      expect(tresc).not.toMatch(/ankiet|zdrow|medyczn|zatrzyma|krok/i);
    }
    expect(JSON.stringify(f.wyslane[0].cialo)).not.toContain('500100200');   // telefon klienta też nie
  });

  test('szkic jest zajęty po wysyłce, a drugie uruchomienie nie pisze ponownie', async () => {
    const f = await zaladuj({ kandydaci: [kandydat(ID_1)], szkice: [wiersz(ID_1)] });
    await f.wywolaj();
    expect(f.wiersze[0].przypomnienie_wyslane_at).toBeTruthy();

    // Funkcja SQL zwróciłaby ten sam szkic jeszcze raz (wyścig dwóch uruchomień) —
    // atomowe zajęcie w WHERE `przypomnienie_wyslane_at is null` go odrzuca.
    await f.wywolaj();
    expect(f.wyslane).toHaveLength(1);
  });

  test('zgoda wycofana między wyborem a zajęciem: nie piszemy', async () => {
    const f = await zaladuj({
      kandydaci: [kandydat(ID_1)],
      szkice: [wiersz(ID_1, { zgoda_kontakt: false, imie: null, email: null, phone: null })],
    });
    expect((await f.wywolaj()).status).toBe(200);
    expect(f.wyslane).toHaveLength(0);
  });

  test('ukończony wniosek między wyborem a zajęciem: nie piszemy', async () => {
    const f = await zaladuj({
      kandydaci: [kandydat(ID_1)],
      szkice: [wiersz(ID_1, { ukonczony_at: new Date().toISOString(), ostatni_krok: 'zgody', email: null, imie: null, phone: null })],
    });
    await f.wywolaj();
    expect(f.wyslane).toHaveLength(0);
  });
});

test.describe('przypomnienie: porażka wysyłki', () => {
  test('odmowa Resend: szkic zwolniony, jeden wpis w ud_errors, kolejne nie są próbowane', async () => {
    const f = await zaladuj({
      kandydaci: [kandydat(ID_1), kandydat(ID_2)],
      szkice: [wiersz(ID_1), wiersz(ID_2)],
      resend: () => ({ ok: false, status: 403, tresc: 'The utratadochodu.pl domain is not verified for jan@example.com' }),
    });
    const r = await f.wywolaj();
    expect(r.status).toBe(502);
    expect(f.wyslane, 'po pierwszej odmowie kończymy').toHaveLength(1);
    // Szkic wraca do puli — następne uruchomienie spróbuje jeszcze raz.
    expect(f.wiersze.map((w) => w.przypomnienie_wyslane_at)).toEqual([null, null]);
    expect(f.logi).toHaveLength(1);
    expect(f.logi[0].wiadomosc).toContain('403');
    // Adres z odpowiedzi dostawcy nie trafia do ud_errors.
    expect(JSON.stringify(f.logi)).not.toContain('jan@example.com');
  });

  test('wyjątek sieciowy też zwalnia szkic', async () => {
    const f = await zaladuj({
      kandydaci: [kandydat(ID_1)], szkice: [wiersz(ID_1)],
      resend: () => new Error('connection reset'),
    });
    expect((await f.wywolaj()).status).toBe(502);
    expect(f.wiersze[0].przypomnienie_wyslane_at, 'szkic nie może zostać „wysłany" bez maila').toBeNull();
  });

  test('sukces dla pierwszego i porażka dla drugiego: pierwszy zostaje oznaczony', async () => {
    const f = await zaladuj({
      kandydaci: [kandydat(ID_1), kandydat(ID_2)],
      szkice: [wiersz(ID_1), wiersz(ID_2)],
      resend: (_c, n) => (n === 1 ? { ok: true, status: 200 } : { ok: false, status: 500, tresc: 'boom' }),
    });
    await f.wywolaj();
    expect(f.wiersze.map((w) => !!w.przypomnienie_wyslane_at)).toEqual([true, false]);
  });
});

test.describe('przypomnienie: źródło', () => {
  const zrodlo = czytaj('functions/wniosek-przypomnienie/index.ts');

  test('token x-cron-token sprawdzany przed pierwszym odczytem danych', () => {
    // Markery to faktyczne wywołania, nie wzmianki w komentarzach nagłówka.
    const naglowek = zrodlo.indexOf('req.headers.get("x-cron-token")');
    const sprawdzenie = zrodlo.indexOf('supabase.rpc("edge_cron_token_matches"');
    const odczyt = zrodlo.indexOf('supabase.rpc("ud_wnioski_do_przypomnienia"');
    expect(naglowek).toBeGreaterThan(-1);
    expect(sprawdzenie).toBeGreaterThan(-1);
    expect(odczyt).toBeGreaterThan(-1);
    expect(naglowek).toBeLessThan(odczyt);
    expect(sprawdzenie).toBeLessThan(odczyt);
  });

  test('każda wstawka w HTML-u listu jest escape’owana', () => {
    const szablon = zrodlo.match(/const html = `([^`]*)`/);
    expect(szablon, 'brak szablonu html').toBeTruthy();
    const surowe = [...szablon[1].matchAll(/\$\{([^}]*)\}/g)]
      .map((m) => m[1].trim())
      .filter((w) => !w.startsWith('esc('));
    expect(surowe, 'wstawki bez esc()').toEqual([]);
  });

  test('szablon nie sięga po imię, telefon ani krok ze szkicu', () => {
    const szablon = zrodlo.slice(zrodlo.indexOf('function zbudujMail'), zrodlo.indexOf('async function wyslij'));
    expect(szablon).not.toMatch(/\bimie\b|\bphone\b|ostatni_krok|\.email\b/);
    // Funkcja czyta ze szkicu wyłącznie id i adres — nic więcej nie ma jak trafić do listu.
    expect(zrodlo).not.toMatch(/\.select\([^)]*imie/);
  });

  test('decyzje właściciela: nadawca info@, opóźnienie 3 h', () => {
    expect(zrodlo).toContain('const FROM_EMAIL = "UtrataDochodu <info@utratadochodu.pl>"');
    expect(zrodlo).toContain('const REPLY_TO = "info@utratadochodu.pl"');
    expect(zrodlo).toMatch(/OPOZNIENIE_GODZIN = 3;/);
  });
});
