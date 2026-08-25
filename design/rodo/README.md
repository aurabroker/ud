# Zgody i klauzule RODO — projekt roboczy

`zgody-rodo.html` — pełny dokument: treści zgód przy formularzach, klauzula
informacyjna z art. 13 RODO, szablony SMS i e-mail, treści w widoku oferty,
mapowanie na kolumny w bazie.

**Nie jest opinią prawną.** Przed publikacją wymaga zatwierdzenia przez
prawnika. Miejsca w `[NAWIASACH KWADRATOWYCH]` czekają na dane spółki
(adres, KRS, NIP, numer w rejestrze KNF) oraz na okresy retencji.

## Podstawy prawne przyjęte w dokumencie

| Cel | Podstawa |
|---|---|
| Przygotowanie oferty, kontakt na prośbę klienta | art. 6 ust. 1 lit. b RODO |
| Dane o zdrowiu we wniosku | **art. 9 ust. 2 lit. a RODO** — zgoda wyraźna |
| Marketing e-mail, SMS, telefon | art. 6 ust. 1 lit. a RODO + **art. 398 PKE** |
| Obowiązki z ustawy o dystrybucji ubezpieczeń | art. 6 ust. 1 lit. c RODO |
| Dochodzenie roszczeń | art. 6 ust. 1 lit. f RODO |

Art. 398 ustawy z 12 lipca 2024 r. Prawo komunikacji elektronicznej
(w mocy od 10.11.2024) zastąpił dawne dwie zgody — z UŚUDE i z Prawa
telekomunikacyjnego — jedną.

## Trzy rzeczy do naprawy w kodzie, niezależnie od treści

1. **CallMeBot** — `send-confirmation-email` wysyła imię, telefon i e-mail
   klienta do `api.callmebot.com`, darmowej usługi bez umowy powierzenia.
   Zmienić kanał powiadomień doradcy.
2. **Brak zgody na dane o zdrowiu** — wniosek zbiera 7 (a powyżej 1 mln zł
   dodatkowe 20) pytań medycznych. Obecna jednozdaniowa zgoda nie spełnia
   wymogów art. 9 RODO.
3. **34 kontakty z `rodo_consent = false`** — kolumna istnieje, formularz
   nigdy jej nie wysyłał.

## Nowe kolumny do dodania

```sql
-- udochodu_contacts
marketing_email      boolean not null default false
marketing_email_at   timestamptz
marketing_phone      boolean not null default false
marketing_phone_at   timestamptz
consents_version     text

-- ud_clients
health_consent       boolean not null default false
health_consent_at    timestamptz
consents_version     text
```

Zapisujemy moment i wersję treści, nie samą wartość `true` — przy skardze
trzeba wykazać, kiedy i na jaką treść klient wyraził zgodę.
