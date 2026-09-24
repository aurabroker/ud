/**
 * /wspolpraca — zgłoszenie partnera z `/pracuj-z-nami/`, wysyłane e-mailem.
 *
 * Dlaczego osobna funkcja, a nie `contact-submit` jak na stronie kontaktowej:
 * tamta funkcja brzegowa zapisuje do `udochodu_contacts` i obsługuje też stary
 * serwis, a zgłoszenia partnerskie mają trafiać prosto do skrzynki, nie do
 * tabeli leadów klienckich. Przy okazji ta funkcja żyje w repozytorium razem
 * z testami — w odróżnieniu od funkcji brzegowych Supabase, których kopie
 * potrafią być starsze niż to, co stoi na produkcji.
 *
 * Wymagane sekrety w projekcie Pages (typ Secret, nigdy Plain):
 *   TURNSTILE_SECRET_KEY   weryfikacja anty-botowa
 *   RESEND_API_KEY         wysyłka
 * Opcjonalnie:
 *   RESEND_FROM            nadawca; domyślnie ten sam co w panelu
 *   WSPOLPRACA_DO          odbiorca; domyślnie info@utratadochodu.pl
 */
const NADAWCA_DOMYSLNY = 'UtrataDochodu <info@utratadochodu.pl>';
const ODBIORCA_DOMYSLNY = 'info@utratadochodu.pl';

const odpowiedz = (dane, status = 200) =>
  new Response(JSON.stringify(dane), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const blad = (wiadomosc, status) => odpowiedz({ status: 'error', message: wiadomosc }, status);

/** Jedna linia bez znaków sterujących — do tematu wiadomości. */
const jednaLinia = (t, ile) => String(t ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, ile);

async function turnstileOk(token, ip, sekret) {
  const form = new URLSearchParams();
  form.append('secret', sekret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: form,
  });
  const dane = await res.json().catch(() => ({}));
  return dane.success === true;
}

export async function onRequestPost({ request, env }) {
  const cialo = await request.json().catch(() => null);
  if (!cialo) return blad('Puste zgłoszenie.', 400);

  const imie = jednaLinia(cialo.name, 120);
  const email = jednaLinia(cialo.email, 200);
  const telefon = jednaLinia(cialo.phone, 40);

  if (imie.length < 2) return blad('Podaj imię i nazwisko.', 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return blad('Podaj poprawny adres e-mail.', 400);
  if ((telefon.match(/\d/g) ?? []).length < 9) return blad('Podaj numer telefonu — dziewięć cyfr.', 400);
  if (cialo.rodo_consent !== true) return blad('Potwierdź zgodę na kontakt.', 400);

  // Weryfikacja anty-botowa jest OBOWIĄZKOWA, a jej brak to odmowa, nie pominięcie.
  // Funkcja, która przy braku sekretu przepuszcza wszystko, jest otwartym
  // przekaźnikiem poczty — a tu po drugiej stronie stoi nasza skrzynka
  // i reputacja domeny nadawcy.
  const sekret = env.TURNSTILE_SECRET_KEY;
  if (!sekret) return blad('Formularz jest chwilowo niedostępny.', 503);

  const token = jednaLinia(cialo['cf-turnstile-response'], 4096);
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  if (!token || !(await turnstileOk(token, ip, sekret))) {
    return blad('Weryfikacja bezpieczeństwa nie powiodła się. Odśwież stronę i spróbuj ponownie.', 400);
  }

  const klucz = env.RESEND_API_KEY || env.RESEND_API;
  if (!klucz) return blad('Formularz jest chwilowo niedostępny.', 503);

  const tresc = [
    'Zgłoszenie ze strony „Pracuj z nami".',
    '',
    `Imię i nazwisko: ${imie}`,
    `E-mail:          ${email}`,
    `Telefon:         ${telefon}`,
    '',
    `Zgoda RODO:      tak (${new Date().toISOString()})`,
    `IP zgłaszającego: ${ip || 'nieznane'}`,
  ].join('\n');

  const wyslane = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${klucz}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM || NADAWCA_DOMYSLNY,
      to: [env.WSPOLPRACA_DO || ODBIORCA_DOMYSLNY],
      // Odpowiedź menedżera idzie prosto do zgłaszającego, bez przeklejania adresu.
      reply_to: email,
      subject: `Współpraca: ${imie}`,
      text: tresc,
    }),
  }).catch(() => null);

  if (!wyslane || !wyslane.ok) {
    // Zgłoszenie partnera to nie jest ruch, który można stracić po cichu —
    // klient ma zobaczyć błąd i telefon, a nie fałszywe „wysłano".
    return blad('Nie udało się wysłać zgłoszenia. Zadzwoń albo napisz na info@utratadochodu.pl.', 502);
  }

  return odpowiedz({ status: 'success' });
}
