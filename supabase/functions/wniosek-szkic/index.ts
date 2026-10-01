import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logError } from '../_shared/logger.ts';
import { skrotIp, sprawdzWycofanie } from '../_shared/szkic-podpis.ts';

/**
 * wniosek-szkic — szkic wniosku z kreatora: lejek + kontakt wyłącznie za zgodą.
 *
 * Plan: PLAN-NIEDOKONCZONE-WNIOSKI.md. Tabela: ud_wnioski_szkice (RLS bez
 * polityk — zapis i odczyt tylko tą funkcją, panelem i funkcją przypomnień).
 *
 * Kreator woła ją „wystrzel i zapomnij": błąd stąd nigdy nie zatrzymuje wniosku,
 * więc funkcja nie musi być łaskawa — ma być ostrożna.
 *
 * CZEGO TU NIGDY NIE PRZYJMUJEMY: PESEL-u ani odpowiedzi z ankiety medycznej
 * (med_*, hs_*, hsd_*). Funkcja czyta z żądania wyłącznie pola wymienione
 * niżej; reszta ciała jest ignorowana, więc przypadkowo dosłany PESEL nie ma
 * dokąd trafić. Dane o zdrowiu z wniosku, którego ktoś nie wysłał, nie mają
 * podstawy prawnej — zgoda z art. 9 RODO pada dopiero w ostatnim kroku.
 *
 * Akcje (POST, JSON):
 *   start    — Turnstile; tworzy szkic po zaliczeniu kroku `kontakt`, zwraca id
 *   kontakt  — zmiana zgody/danych kontaktowych istniejącego szkicu (Wstecz
 *              w kreatorze); Turnstile tylko, gdy zgoda jest udzielana
 *   krok     — przesunięcie `ostatni_krok` do przodu (dane/zakres/zdrowie)
 *   ukoncz   — po udanym form-submit; czyści dane kontaktowe szkicu
 *   wycofaj  — wycofanie zgody linkiem z maila (id + podpis HMAC)
 *
 * Aktualizacje po `id` są dopuszczalne bez Turnstile, bo id (uuid) zna tylko
 * ten, kto dostał je od `start`. Tworzenie szkicu i udzielenie zgody — to jest
 * wejście do rozsyłania naszych maili na cudze adresy — idą wyłącznie przez
 * Turnstile, a „start" dodatkowo przez limit na adres IP.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/**
 * Teksty zgód znane serwerowi. Przeglądarka wysyła tylko WERSJĘ, a treść do bazy
 * dopisuje stąd — rozliczalność (art. 7 ust. 1 RODO) opiera się na tym, co zna
 * serwer, a nie na tekście, który ktoś mógł podstawić w żądaniu.
 *
 * Treść musi być zgodna z `ZGODA_KONTAKT` w packages/wniosek/src/schemat.js
 * (pilnuje tego test/szkice.spec.js). Zmiana treści = NOWA wersja, stare zostają.
 */
const ZGODY: Record<string, string> = {
  'v1-2026-10':
    'Zgadzam się na kontakt e-mailowy i telefoniczny ze strony Aura Expert sp. z o.o. ' +
    'w sprawie mojego wniosku — także wtedy, gdy go nie dokończę. Zgodę mogę wycofać w każdej chwili.',
};

const KROKI = ['kontakt', 'dane', 'zakres', 'zdrowie', 'zgody'];
/** Kroki, o które pyta `krok`. `kontakt` tworzy `start`, `zgody` zamyka `ukoncz`. */
const KROKI_Z_KREATORA = ['dane', 'zakres', 'zdrowie'];
const LIMIT_SZKICOW_NA_GODZINE = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Gdy w projekcie brakuje TURNSTILE_SECRET_KEY, funkcja odmawia zamiast
   wpuszczać bez sprawdzenia — jak form-submit. Brak sekretu trafia do ud_errors. */
const BRAK_WERYFIKACJI = 'Formularz jest chwilowo niedostępny. Zadzwoń: 504 400 901 albo napisz na info@utratadochodu.pl.';

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  // Bez sekretu nie ma czym sprawdzić tokenu — odmowa, nie przepustka.
  if (!secret) return false;

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  return data.success === true;
}

/** Imię, e-mail i telefon — te same reguły co contact-submit. */
function sprawdzKontakt(w: Record<string, unknown>) {
  const imie = String(w.imie ?? '').trim().substring(0, 100);
  const email = String(w.email ?? '').trim().substring(0, 150).toLowerCase();
  const phone = String(w.phone ?? '').trim().substring(0, 30);
  if (!imie) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return null;
  if ((phone.match(/\d/g) ?? []).length < 9) return null;
  return { imie, email, phone };
}

function parsujWejscie(raw: string, req: Request): Record<string, unknown> | null {
  const zapytanie = Object.fromEntries(new URL(req.url).searchParams);
  if (!raw.trim()) return zapytanie;
  try {
    const typ = req.headers.get('content-type') ?? '';
    // RFC 8058 (List-Unsubscribe-Post): skrzynka pocztowa wysyła
    // `List-Unsubscribe=One-Click` jako application/x-www-form-urlencoded,
    // a id i podpis siedzą w adresie.
    const cialo = typ.includes('application/x-www-form-urlencoded')
      ? Object.fromEntries(new URLSearchParams(raw))
      : JSON.parse(raw);
    if (cialo === null || typeof cialo !== 'object' || Array.isArray(cialo)) return null;
    return { ...zapytanie, ...cialo };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // Tylko POST. GET nic nie robi, więc skaner linków w skrzynce, który „klika"
  // adres wycofania, nie wycofa zgody za klienta.
  if (req.method !== 'POST') return json({ status: 'error', message: 'Niedozwolona metoda.' }, 405);

  const ip = req.headers.get('CF-Connecting-IP') ?? '';
  let akcja = '';

  try {
    const wejscie = parsujWejscie(await req.text(), req);
    if (!wejscie) return json({ status: 'error', message: 'Nieprawidłowy format danych.' }, 400);

    akcja = String(wejscie.akcja ?? '');
    const id = String(wejscie.id ?? '');
    const teraz = new Date().toISOString();

    /** Turnstile: brak sekretu to 503 z wpisem w ud_errors, zły token to 400. */
    const bramkaTurnstile = async (): Promise<Response | null> => {
      if (!Deno.env.get('TURNSTILE_SECRET_KEY')) {
        await logError('wniosek-szkic', 'Brak TURNSTILE_SECRET_KEY — szkice wniosków odmawiają przyjęcia', undefined, ip || undefined);
        return json({ status: 'error', message: BRAK_WERYFIKACJI }, 503);
      }
      const token = String(wejscie['cf-turnstile-response'] ?? '').trim();
      if (!token || !(await verifyTurnstile(token, ip))) {
        return json({ status: 'error', message: 'Weryfikacja bezpieczeństwa nie powiodła się.' }, 400);
      }
      return null;
    };

    /**
     * Sekret podpisu. Bez niego nie zbieramy niczego, co dałoby się tylko
     * wycofać linkiem: zgoda, której klient nie może cofnąć, nie jest zgodą.
     */
    const sekret = Deno.env.get('SZKIC_HMAC_SECRET') ?? '';
    const bramkaSekretu = async (): Promise<Response | null> => {
      if (sekret) return null;
      await logError('wniosek-szkic', 'Brak SZKIC_HMAC_SECRET — szkice wniosków odmawiają przyjęcia', undefined, ip || undefined);
      return json({ status: 'error', message: BRAK_WERYFIKACJI }, 503);
    };

    if (!['start', 'kontakt', 'krok', 'ukoncz', 'wycofaj'].includes(akcja)) {
      return json({ status: 'error', message: 'Nieznana akcja.' }, 400);
    }
    if (akcja !== 'start' && !UUID.test(id)) {
      return json({ status: 'error', message: 'Nieprawidłowy identyfikator.' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    /* ── start ─────────────────────────────────────────────────────────── */
    if (akcja === 'start') {
      const odmowa = await bramkaTurnstile();
      if (odmowa) return odmowa;
      const brakSekretu = await bramkaSekretu();
      if (brakSekretu) return brakSekretu;

      const zgoda = wejscie.zgoda === true;
      const wersja = String(wejscie.zgoda_wersja ?? '');
      const kontakt = zgoda ? sprawdzKontakt(wejscie) : null;
      if (zgoda && (!ZGODY[wersja] || !kontakt)) {
        return json({ status: 'error', message: 'Nieprawidłowe dane kontaktowe.' }, 400);
      }

      // Limit szkiców na adres IP. Bez adresu (nagłówka brak) nie limitujemy —
      // wspólny kubełek dla wszystkich bez IP blokowałby prawdziwych klientów,
      // a Turnstile i tak stoi przed zapisem.
      const ipHash = ip ? await skrotIp(ip, sekret) : null;
      if (ipHash) {
        const { count, error } = await supabase
          .from('ud_wnioski_szkice')
          .select('id', { count: 'exact', head: true })
          .eq('ip_hash', ipHash)
          .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
        if (error) throw error;
        if ((count ?? 0) >= LIMIT_SZKICOW_NA_GODZINE) {
          return json({ status: 'error', message: 'Zbyt wiele prób. Spróbuj później.' }, 429);
        }
      }

      const wiersz: Record<string, unknown> = {
        ostatni_krok: 'kontakt',
        ip_hash: ipHash,
        updated_at: teraz,
        zgoda_kontakt: zgoda,
      };
      // Bez zgody do wiersza nie trafia ani imię, ani e-mail, ani telefon —
      // nawet jeśli przyszły w żądaniu. (To samo wymusza ograniczenie w bazie.)
      if (zgoda && kontakt) {
        Object.assign(wiersz, {
          zgoda_wersja: wersja,
          zgoda_tresc: ZGODY[wersja],
          zgoda_at: teraz,
          ...kontakt,
        });
      }

      const { data, error } = await supabase
        .from('ud_wnioski_szkice')
        .insert(wiersz)
        .select('id')
        .single();
      if (error) throw error;
      return json({ status: 'success', id: data.id });
    }

    /* ── kontakt ───────────────────────────────────────────────────────── */
    if (akcja === 'kontakt') {
      const zgoda = wejscie.zgoda === true;
      let zmiana: Record<string, unknown>;

      if (zgoda) {
        // Udzielenie zgody na istniejącym szkicu to ten sam kanał do cudzych
        // skrzynek co `start`, więc ta sama bramka.
        const odmowa = await bramkaTurnstile();
        if (odmowa) return odmowa;
        const brakSekretu = await bramkaSekretu();
        if (brakSekretu) return brakSekretu;

        const wersja = String(wejscie.zgoda_wersja ?? '');
        const kontakt = sprawdzKontakt(wejscie);
        if (!ZGODY[wersja] || !kontakt) {
          return json({ status: 'error', message: 'Nieprawidłowe dane kontaktowe.' }, 400);
        }
        zmiana = {
          zgoda_kontakt: true, zgoda_wersja: wersja, zgoda_tresc: ZGODY[wersja], zgoda_at: teraz,
          ...kontakt, updated_at: teraz,
        };
      } else {
        // Cofnięcie zaznaczenia nie wymaga niczego poza id: zmniejsza zakres
        // danych, nie zwiększa go.
        zmiana = { zgoda_kontakt: false, imie: null, email: null, phone: null, updated_at: teraz };
      }

      const { error } = await supabase
        .from('ud_wnioski_szkice')
        .update(zmiana)
        .eq('id', id)
        .is('ukonczony_at', null);
      if (error) throw error;
      return json({ status: 'success' });
    }

    /* ── krok ──────────────────────────────────────────────────────────── */
    if (akcja === 'krok') {
      const krok = String(wejscie.krok ?? '');
      if (!KROKI_Z_KREATORA.includes(krok)) {
        return json({ status: 'error', message: 'Nieznany krok.' }, 400);
      }
      // Tylko ruch do przodu: aktualizacja trafia w wiersz wyłącznie wtedy, gdy
      // jego obecny krok jest wcześniejszy. Powtórka albo cofnięcie to no-op.
      const { error } = await supabase
        .from('ud_wnioski_szkice')
        .update({ ostatni_krok: krok, updated_at: teraz })
        .eq('id', id)
        .is('ukonczony_at', null)
        .in('ostatni_krok', KROKI.slice(0, KROKI.indexOf(krok)));
      if (error) throw error;
      return json({ status: 'success' });
    }

    /* ── ukoncz ────────────────────────────────────────────────────────── */
    if (akcja === 'ukoncz') {
      const { error } = await supabase.rpc('ud_wnioski_szkic_ukoncz', { p_id: id });
      if (error) throw error;
      return json({ status: 'success' });
    }

    /* ── wycofaj ───────────────────────────────────────────────────────── */
    const brakSekretu = await bramkaSekretu();
    if (brakSekretu) return brakSekretu;
    if (!(await sprawdzWycofanie(id, String(wejscie.sig ?? ''), sekret))) {
      return json({ status: 'error', message: 'Nieprawidłowy lub wygasły link.' }, 403);
    }
    const { error } = await supabase
      .from('ud_wnioski_szkice')
      .update({
        zgoda_kontakt: false, zgoda_wycofana_at: teraz,
        imie: null, email: null, phone: null, updated_at: teraz,
      })
      .eq('id', id);
    if (error) throw error;
    // Zawsze sukces przy poprawnym podpisie — także gdy szkic już zniknął
    // (retencja): tak czy owak nie ma już czego trzymać, a odpowiedź nie
    // zdradza, czy dany identyfikator istniał.
    return json({ status: 'success' });
  } catch (e) {
    // Do ud_errors idzie sama nazwa akcji i komunikat — nie ciało żądania,
    // bo przy zgodzie siedzą w nim e-mail i telefon.
    await logError('wniosek-szkic', String((e as { message?: string })?.message ?? e), { akcja }, ip || undefined);
    return json({ status: 'error', message: 'Nieoczekiwany błąd.' }, 500);
  }
});
