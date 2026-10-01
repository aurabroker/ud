# Deployment — Cloudflare Pages

Aplikacja (`apps/panel/`) buduje się przez `@sveltejs/adapter-cloudflare` do katalogu
`.svelte-kit/cloudflare` i wdraża jako **Cloudflare Pages**.

---

## A) Podłączenie repo do Cloudflare Pages (raz)

1. `dash.cloudflare.com` → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Wybierz repo `aurabroker/ud`. **Nazwa projektu: `udappnew`** — musi być równa
   `name` w `wrangler.toml`, inaczej Cloudflare może odrzucić build. Stary projekt
   `udapp` budował się z osobnego repozytorium `aurabroker/udapp` i zostaje
   nietknięty, dopóki nowy nie zostanie zweryfikowany.
3. **Gałąź produkcyjna:** dopóki przebudowa nie jest scalona, `main` NIE zadziała —
   nie ma tam nawet katalogu `apps/`, a build kończy się na
   `Cannot find cwd: /opt/buildhome/repo/apps/panel`. Ustaw gałąź roboczą
   (Settings → Builds & deployments → Branch control) albo najpierw scal do `main`.
4. Ustawienia builda:
   - **Root directory (advanced):** `apps/panel`
   - **Build command:** `pnpm install --frozen-lockfile && pnpm --filter @ud/panel build`
   - **Build output directory:** `.svelte-kit/cloudflare`
   Panel zależy od `@ud/wniosek` przez `workspace:*`, więc instalacja musi widzieć
   workspace. `pnpm install` uruchomiony z `apps/panel` sam wychodzi w górę po
   `pnpm-workspace.yaml` — sprawdzone, dowiązanie do `packages/wniosek` zostaje.
   Dlatego `npm install` tu NIE zadziała: npm nie zrozumie `workspace:*`.
5. **Compatibility flags:** dodaj `nodejs_compat` (Settings → Functions → Compatibility flags),
   dla środowiska **Production** i **Preview**. Bez tego unpdf/Web Crypto nie zadziała.
   (Jest też w `wrangler.toml`, ale flagę warto ustawić też w panelu.)
6. Zapisz i uruchom pierwszy deploy.

---

## B) Zmienne środowiskowe — DWA miejsca, nie jedno

**Odkąd w `apps/panel/` leży `wrangler.toml`, panel Cloudflare przestał mieć
znaczenie dla zmiennych jawnych.** Dokumentacja Pages: *„This file becomes the
source of truth when used, meaning that you can not edit the same fields in the
dashboard once you are using this file"* — a `vars` jest jednym z tych pól.

Objaw, gdy się o tym zapomni: sekrety wpisane w panelu działają, a zmienne
jawne wpisane obok wracają z `/health` jako `MISSING`. Bo sekretami wrangler
nie zarządza, a zmiennymi jawnymi tak.

| Rodzaj | Gdzie |
|---|---|
| jawne (`PUBLIC_*`, `PIN_TTL_HOURS`, `RESEND_FROM`) | **`wrangler.toml`, sekcja `[vars]`** |
| sekrety | panel Cloudflare, typ **Secret** |

Dla środowiska **Production** (i **Preview**, jeśli chcesz testować):

### 🔒 Secret (encrypted — po zapisaniu nieodczytywalne)
| Nazwa | Skąd |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` |
| `SMSAPI_TOKEN` | Panel SMSAPI → Tokeny OAuth. **Opcjonalne** — oferty idą samym
e-mailem, token obsługuje już tylko diagnostykę w Ustawieniach i sondę w `health.js`. |
| `RESEND_API_KEY` | resend.com → API Keys |
| `PIN_COOKIE_SECRET` | dowolny losowy ciąg (mamy wygenerowany w `.env`) |

### 📄 Jawne — w `wrangler.toml`, NIE w panelu
| Nazwa | Wartość |
|---|---|
| `PUBLIC_SUPABASE_URL` | `https://kukvgsjrmrqtzhkszzum.supabase.co` |
| `PUBLIC_SUPABASE_ANON_KEY` | klucz anon (publiczny — widać go w źródle strony) |
| `PUBLIC_APP_URL` | adres produkcyjny; `appUrl.js` odrzuca `*.pages.dev` |
| `RESEND_FROM` | domyślnie `UtrataDochodu <info@utratadochodu.pl>` |
| `PIN_TTL_HOURS` | `48` |
| `SMSAPI_SENDER` | opcjonalna, tylko do diagnostyki |

> Po dodaniu/zmianie zmiennych zrób **Retry deployment** — Cloudflare zaciąga env przy buildzie.

Alternatywnie z terminala:
```bash
cd apps/panel
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler pages secret put SMSAPI_TOKEN
# itd.
```

---

## C) Konfiguracja usług zewnętrznych

- **Resend:** zweryfikuj domenę nadawcy (DNS: SPF/DKIM), inaczej maile nie wyjdą.
- **SMSAPI:** wygeneruj token OAuth w panelu SMSAPI, dodaj i zatwierdź **nazwę nadawcy** (pole „from"); numery klientów w formacie `48XXXXXXXXX`.
- **Supabase Auth:** konta agentów (już są w `ud_user_profiles`). Nowych agentów dodaje się
  w Supabase → Authentication → Users (email+hasło), a profil w `ud_user_profiles` (rola `user`/`admin`).
- **Supabase Storage:** buckety `ud-offers` i `ud-owu` już utworzone (prywatne).
- **Biblioteka OWU:** przed wysyłką ofert wgraj OWU w panelu → **Biblioteka OWU**
  (`/panel/owu`). Leadenhall ma 3 OWU, CEU 2 — każdy wariant z własnym **symbolem**
  (klucz dopasowania, np. `LW044/AD_D_TTD_PTD/PL/3`, `LOI PREMIUM`). System podpina
  właściwe OWU do oferty automatycznie po tym symbolu.

---

## D) Test po wdrożeniu (smoke test)

1. Wejdź na `PUBLIC_APP_URL` → przekierowanie na `/login` → zaloguj się jako agent.
   Najpierw uzupełnij **Biblioteka OWU** (`/panel/owu`) — wgraj OWU Leadenhall/CEU.
2. „+ Nowa oferta" → wgraj PDF Leadenhall i/lub CEU → sprawdź sparsowane warianty
   (właściwe OWU podepnie się automatycznie po symbolu).
3. Uzupełnij email + telefon klienta → „Wyślij klientowi".
4. Otwórz link z maila (lub skopiowany) w trybie incognito → wpisz **4 ostatnie cyfry
   PESEL-u klienta** → oferta się odblokuje. SMS-ów nie wysyłamy; ten sam kod otwiera
   pobrane pliki PDF. Wysyłka nie odbędzie się, jeśli klient nie ma PESEL-u w kartotece.
5. Pobierz PDF/OWU, zadaj pytanie, wybierz wariant — sprawdź, czy agent dostał maile.

---

## Lokalny development

```bash
cd apps/panel
cp .env.example .env      # i uzupełnij (public values już są w .env)
pnpm install              # z katalogu apps/panel; pnpm sam znajdzie workspace wyżej
pnpm dev                  # http://localhost:5173
```
Bez kluczy API: SMS/email logują się do konsoli, a PIN testowy pokazuje się agentowi
w panelu po „Wyślij" (do przejścia całego flow bez realnej wysyłki).
