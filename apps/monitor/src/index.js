/**
 * Monitor UtrataDochodu.pl — worker Cloudflare.
 *
 * Dwa wejścia:
 *   scheduled — co pięć minut przechodzi wszystkie sondy, zapisuje pomiar,
 *               nanosi stan i wysyła alert przy zmianie stanu,
 *   fetch     — strona statusu (HTML) i ten sam obraz w JSON.
 *
 * Świadomie osobny runtime i osobna baza od reszty serwisu. Monitor, który
 * dzieli infrastrukturę z monitorowanym systemem, milknie dokładnie wtedy,
 * gdy jest potrzebny.
 */
import { strona, przekierowanie, kontraktFunkcji, odczytPubliczny, cisza } from './sondy.js';
import { zapiszPomiar, naniesStan, stanSond, podsumowanie, ostatnieAwarie, posprzataj } from './baza.js';
import { ulozWiadomosc, wyslij } from './alarm.js';
import { html } from './strona.js';

const OKNO_GODZIN = 24;

/**
 * Zestaw sond budowany z konfiguracji, nie wpisany na sztywno — dzięki temu
 * ten sam worker obsłuży środowisko testowe pod innym adresem.
 */
export function zbudujSondy(env) {
  const portal = (env.URL_PORTALU ?? 'https://utratadochodu.pl').replace(/\/$/, '');
  const supabase = (env.URL_SUPABASE ?? 'https://kukvgsjrmrqtzhkszzum.supabase.co').replace(/\/$/, '');
  const anon = env.KLUCZ_ANON;
  const serwisowy = env.KLUCZ_SERWISOWY;
  const idDokumentu = env.ID_DOKUMENTU_TESTOWEGO;

  const lista = [
    strona({ nazwa: 'portal / strona główna', url: `${portal}/`, zawiera: 'Ubezpieczenie utraty dochodu' }),
    strona({ nazwa: 'portal / wniosek', url: `${portal}/wniosek/`, zawiera: 'wniosek' }),
    strona({ nazwa: 'portal / kalkulator', url: `${portal}/kalkulator/` }),
    strona({ nazwa: 'portal / dokumenty', url: `${portal}/dokumenty/` }),
    strona({ nazwa: 'portal / blog', url: `${portal}/blog/` }),

    // Zaplecze SEO. Zniknięcie sitemapy albo llms.txt nie psuje strony
    // użytkownikowi i dlatego potrafi zostać niezauważone tygodniami.
    strona({ nazwa: 'seo / sitemap', url: `${portal}/sitemap-index.xml`, zawiera: '<sitemapindex' }),
    strona({ nazwa: 'seo / robots.txt', url: `${portal}/robots.txt`, zawiera: 'Sitemap' }),
    strona({ nazwa: 'seo / llms.txt', url: `${portal}/llms.txt`, zawiera: '# UtrataDochodu.pl' }),

    // Kontrakty funkcji brzegowych — to tutaj formularz umarł po cichu.
    kontraktFunkcji({
      nazwa: 'funkcja / contact-submit',
      url: `${supabase}/functions/v1/contact-submit`,
      cialo: '',
      status: 400,
      komunikatZawiera: 'Brak danych formularza',
    }),
    kontraktFunkcji({
      nazwa: 'funkcja / form-submit',
      url: `${supabase}/functions/v1/form-submit`,
      cialo: '',
      status: 400,
    }),
  ];

  if (anon) {
    lista.push(
      odczytPubliczny({
        nazwa: 'dane / artykuły (RLS anon)',
        url: `${supabase}/rest/v1/aura_articles?select=slug&status=eq.published&limit=1`,
        klucz: anon,
      }),
      odczytPubliczny({
        nazwa: 'dane / opinie (RLS anon)',
        url: `${supabase}/rest/v1/ud_review?select=id&approved=eq.true&limit=1`,
        klucz: anon,
        minWierszy: 0,
      }),
    );
  }

  if (serwisowy) {
    lista.push(
      cisza({
        nazwa: 'lejek / cisza w zgłoszeniach',
        url: `${supabase}/rest/v1/udochodu_contacts?select=id`,
        klucz: serwisowy,
        godzin: Number(env.GODZIN_CISZY ?? 8),
      }),
    );
  }

  if (idDokumentu) {
    lista.push(
      przekierowanie({
        nazwa: 'dokumenty / pobieranie OWU',
        url: `${portal}/pobierz/${idDokumentu}`,
        doDomeny: 'supabase.co',
      }),
    );
  }

  return lista;
}

/** Jeden przebieg: wszystkie sondy równolegle, zapis, alerty. */
export async function przebieg(env) {
  const sondy = zbudujSondy(env);
  const prog = Number(env.PROG_AWARII ?? 2);

  // Równolegle — sondy nie zależą od siebie, a szeregowo 12 sond po kilka
  // sekund potrafi przekroczyć budżet czasu workera.
  const wyniki = await Promise.all(sondy.map((s) => s.uruchom()));

  const alerty = [];
  for (const w of wyniki) {
    await zapiszPomiar(env.DB, w);
    const { przejscie, od } = await naniesStan(env.DB, w, prog);
    if (!przejscie) continue;

    const wiadomosc = ulozWiadomosc(przejscie, w, { od, status: env.URL_STATUSU });
    alerty.push(await wyslij(env.ALERT_WEBHOOK, wiadomosc, w));
  }

  // Sprzątanie raz na dobę wystarczy; przy co-pięciominutowym przebiegu
  // losujemy okno, żeby nie robić DELETE-a przy każdym uruchomieniu.
  let skasowane = 0;
  if (new Date().getUTCHours() === 3 && new Date().getUTCMinutes() < 6) {
    skasowane = await posprzataj(env.DB);
  }

  return { sond: wyniki.length, awarii: wyniki.filter((w) => !w.ok).length, alertow: alerty.length, skasowane };
}

/** Strona statusu jest za tokenem — wymienia wewnętrzne adresy i funkcje. */
function autoryzowany(request, env) {
  if (!env.TOKEN_STATUSU) return true; // brak tokenu = otwarty podgląd (dev)
  const url = new URL(request.url);
  const zNaglowka = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return url.searchParams.get('token') === env.TOKEN_STATUSU || zNaglowka === env.TOKEN_STATUSU;
}

export default {
  async scheduled(_zdarzenie, env, ctx) {
    ctx.waitUntil(przebieg(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/zdrowie') {
      // Sam worker — pozwala sprawdzić z zewnątrz, czy monitor żyje.
      return new Response('ok', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    if (!autoryzowany(request, env)) {
      return new Response('Brak dostępu.', { status: 401 });
    }

    // Ręczne wyzwolenie przebiegu — przydatne po wdrożeniu, żeby nie czekać
    // do następnego crona.
    if (url.pathname === '/uruchom' && request.method === 'POST') {
      const wynik = await przebieg(env);
      return Response.json(wynik);
    }

    const [stan, sumy, awarie] = await Promise.all([
      stanSond(env.DB),
      podsumowanie(env.DB, OKNO_GODZIN),
      ostatnieAwarie(env.DB, 20),
    ]);

    if (url.pathname === '/json') {
      return Response.json(
        { sprawne: stan.every((s) => s.ok === 1), okno: OKNO_GODZIN, stan, podsumowanie: sumy, awarie },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return new Response(html({ stan, podsumowanie: sumy, awarie, okno: OKNO_GODZIN }), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
};
