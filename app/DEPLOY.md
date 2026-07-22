# Deployment — Cloudflare Pages

Aplikacja (`app/`) buduje się przez `@sveltejs/adapter-cloudflare` do katalogu
`.svelte-kit/cloudflare` i wdraża jako **Cloudflare Pages**.

---

## A) Podłączenie repo do Cloudflare Pages (raz)

1. `dash.cloudflare.com` → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Wybierz repo `aurabroker/udapp`, branch produkcyjny (np. `main`)
3. Ustawienia builda:
   - **Root directory (advanced):** `app`
   - **Build command:** `npm run build`
   - **Build output directory:** `.svelte-kit/cloudflare`
4. **Compatibility flags:** dodaj `nodejs_compat` (Settings → Functions → Compatibility flags),
   dla środowiska **Production** i **Preview**. Bez tego unpdf/Web Crypto nie zadziała.
   (Jest też w `wrangler.toml`, ale flagę warto ustawić też w panelu.)
5. Zapisz i uruchom pierwszy deploy.

---

## B) Zmienne środowiskowe (Settings → Variables and Secrets)

Dla środowiska **Production** (i **Preview**, jeśli chcesz testować):

### 🔒 Secret (encrypted — po zapisaniu nieodczytywalne)
| Nazwa | Skąd |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` |
| `SMSAPI_TOKEN` | Panel SMSAPI → API → token OAuth |
| `RESEND_API_KEY` | resend.com → API Keys |
| `PDFSHIFT_API_KEY` | pdfshift.io → API |
| `PIN_COOKIE_SECRET` | dowolny losowy ciąg (mamy wygenerowany w `.env`) |

### 📄 Plaintext
| Nazwa | Wartość |
|---|---|
| `PUBLIC_SUPABASE_URL` | `https://kukvgsjrmrqtzhkszzum.supabase.co` |
| `PUBLIC_SUPABASE_ANON_KEY` | (klucz anon — jak w `.env`) |
| `PUBLIC_APP_URL` | `https://twoja-domena.pl` (adres produkcyjny) |
| `SMSAPI_SENDER` | zatwierdzona nazwa nadawcy w SMSAPI |
| `RESEND_FROM` | np. `Utrata Dochodu <oferty@twoja-domena.pl>` |
| `PIN_TTL_HOURS` | `48` |

> Po dodaniu/zmianie zmiennych zrób **Retry deployment** — Cloudflare zaciąga env przy buildzie.

Alternatywnie z terminala:
```bash
cd app
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler pages secret put SMSAPI_TOKEN
# itd.
```

---

## C) Konfiguracja usług zewnętrznych

- **Resend:** zweryfikuj domenę nadawcy (DNS: SPF/DKIM), inaczej maile nie wyjdą.
- **SMSAPI:** dodaj i zatwierdź **nazwę nadawcy** (pole „from"); numery klientów w formacie `48XXXXXXXXX`.
- **Supabase Auth:** konta agentów (już są w `ud_user_profiles`). Nowych agentów dodaje się
  w Supabase → Authentication → Users (email+hasło), a profil w `ud_user_profiles` (rola `user`/`admin`).
- **Supabase Storage:** buckety `ud-offers` i `ud-owu` już utworzone (prywatne).

---

## D) Test po wdrożeniu (smoke test)

1. Wejdź na `PUBLIC_APP_URL` → przekierowanie na `/login` → zaloguj się jako agent.
2. „+ Nowa oferta" → wgraj PDF Leadenhall i/lub CEU → sprawdź sparsowane warianty.
3. Uzupełnij email + telefon klienta → „Wyślij klientowi".
4. Otwórz link z maila (lub skopiowany) w trybie incognito → wpisz PIN z SMS → oferta się odblokuje.
5. Pobierz PDF/OWU, zadaj pytanie, wybierz wariant — sprawdź, czy agent dostał maile.

---

## Lokalny development

```bash
cd app
cp .env.example .env      # i uzupełnij (public values już są w .env)
npm install
npm run dev               # http://localhost:5173
```
Bez kluczy API: SMS/email logują się do konsoli, a PIN testowy pokazuje się agentowi
w panelu po „Wyślij" (do przejścia całego flow bez realnej wysyłki).
