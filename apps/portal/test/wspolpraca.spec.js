import { test, expect } from '@playwright/test';
import { onRequestPost } from '../functions/wspolpraca.js';

/**
 * /wspolpraca — zgłoszenie partnera wysyłane e-mailem przez Resend.
 *
 * Najważniejsza rzecz, której te testy pilnują: funkcja, która przy braku
 * sekretu Turnstile przepuszcza żądanie, jest OTWARTYM PRZEKAŹNIKIEM POCZTY.
 * Po drugiej stronie stoi nasza skrzynka i reputacja domeny nadawcy, więc brak
 * sekretu musi być odmową, a nie pominięciem weryfikacji. Funkcja brzegowa
 * `form-submit` robi w tym miejscu odwrotnie (`if (!secret) return true`),
 * bo tam kosztem jest wiersz w tabeli, a nie wysłany e-mail.
 */

const ENV = { TURNSTILE_SECRET_KEY: 'sekret', RESEND_API_KEY: 're_test' };
const ZGLOSZENIE = {
  name: 'Jan Kowalski',
  email: 'jan@example.com',
  phone: '500 600 700',
  rodo_consent: true,
  'cf-turnstile-response': 'token',
};

/** Podstawiony `fetch`: Turnstile + Resend. Zapisuje, co poszło do Resend. */
function zamiastSieci({ turnstileOk = true, resendOk = true, zapis = {} } = {}) {
  return async (adres, opcje) => {
    const a = String(adres);
    if (a.includes('challenges.cloudflare.com')) {
      return new Response(JSON.stringify({ success: turnstileOk }));
    }
    if (a.includes('api.resend.com')) {
      zapis.naglowki = opcje?.headers ?? {};
      zapis.tresc = JSON.parse(opcje?.body ?? '{}');
      return resendOk
        ? new Response(JSON.stringify({ id: 'mail-1' }))
        : new Response('', { status: 422 });
    }
    throw new Error(`nieoczekiwany adres w teście: ${a}`);
  };
}

async function wyslij(cialo, { env = ENV, ...opcje } = {}) {
  const zapis = {};
  const prawdziwy = globalThis.fetch;
  globalThis.fetch = zamiastSieci({ ...opcje, zapis });
  try {
    const request = new Request('https://utratadochodu.pl/wspolpraca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
      body: JSON.stringify(cialo),
    });
    const odp = await onRequestPost({ request, env });
    return { odp, dane: await odp.clone().json().catch(() => ({})), zapis };
  } finally {
    globalThis.fetch = prawdziwy;
  }
}

test('poprawne zgłoszenie idzie e-mailem, z odpowiedzią do zgłaszającego', async () => {
  const { odp, dane, zapis } = await wyslij(ZGLOSZENIE);

  expect(odp.status).toBe(200);
  expect(dane.status).toBe('success');
  expect(zapis.tresc.to, 'zgłoszenie nie poszło na skrzynkę firmową').toContain('info@utratadochodu.pl');
  expect(zapis.tresc.reply_to,
    'bez reply_to menedżer musi przeklejać adres z treści').toBe('jan@example.com');
  expect(zapis.tresc.text).toContain('Jan Kowalski');
  expect(zapis.tresc.text).toContain('500 600 700');
  expect(zapis.naglowki.Authorization).toContain('re_test');
});

test('brak sekretu Turnstile to ODMOWA, nie pominięcie weryfikacji', async () => {
  const { odp, zapis } = await wyslij(ZGLOSZENIE, { env: { RESEND_API_KEY: 're_test' } });

  expect(odp.status, 'przepuszczone żądanie = otwarty przekaźnik poczty').toBe(503);
  expect(zapis.tresc, 'mimo braku weryfikacji poszedł e-mail').toBeUndefined();
});

test('nieudana weryfikacja anty-botowa nie wysyła nic', async () => {
  const { odp, zapis } = await wyslij(ZGLOSZENIE, { turnstileOk: false });
  expect(odp.status).toBe(400);
  expect(zapis.tresc).toBeUndefined();
});

test('brak tokenu nie wysyła nic', async () => {
  const { odp, zapis } = await wyslij({ ...ZGLOSZENIE, 'cf-turnstile-response': '' });
  expect(odp.status).toBe(400);
  expect(zapis.tresc).toBeUndefined();
});

test('walidacja odrzuca niekompletne zgłoszenia przed wysyłką', async () => {
  for (const [co, zmiana] of [
    ['imię', { name: 'J' }],
    ['e-mail', { email: 'to-nie-jest-adres' }],
    ['telefon', { phone: '123' }],
    ['zgoda RODO', { rodo_consent: false }],
  ]) {
    const { odp, zapis } = await wyslij({ ...ZGLOSZENIE, ...zmiana });
    expect(odp.status, `${co}: przeszło mimo błędu`).toBe(400);
    expect(zapis.tresc, `${co}: poszedł e-mail mimo błędu`).toBeUndefined();
  }
});

test('awaria Resend nie udaje wysłanego zgłoszenia', async () => {
  const { odp, dane } = await wyslij(ZGLOSZENIE, { resendOk: false });

  expect(odp.status).toBe(502);
  expect(dane.status).toBe('error');
  // Klient ma dostać drogę awaryjną, a nie sam komunikat o błędzie.
  expect(dane.message).toContain('info@utratadochodu.pl');
});

test('znaki sterujące z formularza nie wchodzą do tematu wiadomości', async () => {
  const { zapis } = await wyslij({ ...ZGLOSZENIE, name: 'Jan\r\nBcc: ktos@example.com' });
  expect(zapis.tresc.subject).not.toMatch(/[\r\n]/);
});

test('puste ciało żądania nie wywraca funkcji', async () => {
  const prawdziwy = globalThis.fetch;
  globalThis.fetch = zamiastSieci({});
  try {
    const request = new Request('https://utratadochodu.pl/wspolpraca', { method: 'POST', body: 'nie-json' });
    const odp = await onRequestPost({ request, env: ENV });
    expect(odp.status).toBe(400);
  } finally {
    globalThis.fetch = prawdziwy;
  }
});
