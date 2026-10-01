# udapp — SvelteKit (nowa wersja)

Aplikacja ofertowania „Utrata dochodu" — przebudowa ze statycznego HTML/JS na SvelteKit + Cloudflare.

## Stack
- **SvelteKit** + `@sveltejs/adapter-cloudflare` (Cloudflare Pages/Workers)
- **Supabase** — baza (prefiks `ud_`), Auth (agenci), Storage (PDF-y)
- **unpdf** — czytanie ofert Leadenhall/CEU z PDF (działa na Workers)
- **PDFShift** — generowanie branded PDF podsumowań (HTML→PDF)
- **SMSAPI** — PIN do oferty przez SMS (48h)
- **Resend** — email z linkiem + pytania klienta do agenta

## Parser PDF
`src/lib/pdf/` — czyta oba szablony ofert i normalizuje do wspólnego modelu.

```
detectInsurer(text)      -> 'leadenhall' | 'ceu' | null
parseOfferText(text)     -> NormalizedOffer
parseOfferPdf(bytes)     -> { offer, totalPages, insurer_type }
```

Test parsera na realnych PDF-ach:
```
node scripts/test-parser.mjs <leadenhall.pdf> <ceu.pdf>
```

## Model danych (Supabase)
- `ud_offers` (rozszerzone: status, source, sent_at, viewed_at, client_email/phone)
- `ud_offer_documents` — sparsowane warianty z PDF
- `ud_offer_files` — pliki do pobrania (offer_pdf / owu / ipid / summary)
- `ud_offer_pins` — PIN z SMS (bcrypt, 48h, limit prób)
- `ud_offer_questions` — pytania klienta → Resend do agenta
- `ud_owu_library` — OWU wgrywane raz (LW044 / LOI PREMIUM)

Storage buckets (prywatne): `ud-offers`, `ud-owu`. Pobieranie klienta = signed URL z serwera.
