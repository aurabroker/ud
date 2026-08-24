/* Definicje sprawdzeń.
   To jedyny plik, który zwykle się edytuje przy dodawaniu nowej aplikacji.

   Pola wspólne:
     id           — unikalny, używany jako klucz w bazie (nie zmieniaj po wdrożeniu)
     nazwa        — to widać w alercie i na status page
     typ          — patrz runner.js
     krytyczny    — true = SMS o każdej porze; false = SMS tylko 7:00–22:00
     interwal     — co ile minut sprawdzać (1 = co minutę)
     progAwarii   — ile porażek z rzędu zanim uznamy awarię (chroni przed migotaniem)
*/

const SUPABASE = 'https://kukvgsjrmrqtzhkszzum.supabase.co';

/* Domeny, bez których formularz na stronie przestaje działać.
   To jest sedno tego monitoringu: strona może zwracać 200 OK, a wniosku
   i tak nie da się wysłać, bo CSP blokuje Turnstile. */
const WYMAGANE_CSP = {
  'script-src': [
    'https://challenges.cloudflare.com',
    'https://connect.facebook.net',
  ],
  'frame-src': [
    'https://challenges.cloudflare.com',
  ],
  'connect-src': [
    'https://kukvgsjrmrqtzhkszzum.supabase.co',
    'https://challenges.cloudflare.com',
  ],
};

export const SPRAWDZENIA = [
  /* ── strony ─────────────────────────────────────────────── */
  {
    id: 'ud-strona',
    nazwa: 'utratadochodu.pl — strona główna',
    typ: 'http',
    krytyczny: true,
    interwal: 1,
    progAwarii: 2,
    url: 'https://utratadochodu.pl/',
    zawiera: 'insurance-form',        // brak = strona wstała, ale bez formularza
    maxMs: 5000,
  },
  {
    id: 'ud-formularz',
    nazwa: 'utratadochodu.pl — /formularz.html',
    typ: 'http',
    krytyczny: true,
    interwal: 1,
    progAwarii: 2,
    url: 'https://utratadochodu.pl/formularz.html',
    zawiera: 'insurance-form',
    maxMs: 5000,
  },
  {
    id: 'ud-csp',
    nazwa: 'utratadochodu.pl — polityka CSP (Turnstile, Pixel, Supabase)',
    typ: 'csp',
    krytyczny: true,
    interwal: 15,
    progAwarii: 1,
    url: 'https://utratadochodu.pl/',
    wymagane: WYMAGANE_CSP,
  },
  {
    id: 'ud-skrypty',
    nazwa: 'utratadochodu.pl — pliki JS formularza',
    typ: 'http-wiele',
    krytyczny: true,
    interwal: 5,
    progAwarii: 2,
    urle: [
      'https://utratadochodu.pl/awaria.js',
      'https://utratadochodu.pl/style.js',
      'https://utratadochodu.pl/app.js',
      'https://utratadochodu.pl/tailwind.css',
    ],
  },

  /* ── backend ────────────────────────────────────────────── */
  {
    id: 'sb-form-submit',
    nazwa: 'Supabase — funkcja form-submit (wysyłka wniosku)',
    typ: 'edge-function',
    krytyczny: true,
    interwal: 2,
    progAwarii: 2,
    url: `${SUPABASE}/functions/v1/form-submit`,
    /* Wysyłamy celowo niepełne dane. Żywa funkcja odrzuci je walidacją
       (4xx) — i o to chodzi. Nic nie zapisujemy do bazy. */
    telo: { __monitor: true },
    oczekiwaneStatusy: [400, 401, 403, 422],
    maxMs: 8000,
  },
  {
    id: 'sb-review-submit',
    nazwa: 'Supabase — funkcja review-submit (opinie)',
    typ: 'edge-function',
    krytyczny: false,
    interwal: 5,
    progAwarii: 2,
    url: `${SUPABASE}/functions/v1/review-submit`,
    telo: { __monitor: true },
    oczekiwaneStatusy: [400, 401, 403, 422],
    maxMs: 8000,
  },
  {
    id: 'sb-artykuly',
    nazwa: 'Supabase — REST, artykuły na blogu',
    typ: 'supabase-rest',
    krytyczny: false,
    interwal: 5,
    progAwarii: 2,
    url: `${SUPABASE}/rest/v1/aura_articles?select=id&limit=1`,
    maxMs: 8000,
  },

  /* ── zależności zewnętrzne ──────────────────────────────── */
  {
    id: 'turnstile',
    nazwa: 'Cloudflare Turnstile — skrypt captcha',
    typ: 'http',
    krytyczny: false,
    interwal: 5,
    progAwarii: 3,
    url: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
    maxMs: 8000,
  },

  /* ── pozostałe aplikacje — UZUPEŁNIJ ────────────────────── */
  {
    id: 'app-ud',
    nazwa: 'app.utratadochodu.pl',
    typ: 'http',
    krytyczny: true,
    interwal: 2,
    progAwarii: 2,
    url: 'https://app.utratadochodu.pl/',
    maxMs: 8000,
    wylaczone: true,   // ← zdejmij, gdy potwierdzisz że adres jest właściwy
  },
  {
    id: 'auraexpert',
    nazwa: 'auraexpert.pl',
    typ: 'http',
    krytyczny: false,
    interwal: 5,
    progAwarii: 2,
    url: 'https://auraexpert.pl/',
    maxMs: 8000,
    wylaczone: true,   // ← jw.
  },
];

export const aktywne = () => SPRAWDZENIA.filter(s => !s.wylaczone);
