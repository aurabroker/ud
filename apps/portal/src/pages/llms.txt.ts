/**
 * llms.txt — indeks serwisu w formacie zgodnym z llmstxt.org.
 *
 * Format jest ścisły i wymaga:
 * - nagłówka H1 jako pierwszego elementu pliku (jedyny element obowiązkowy),
 * - opcjonalnego cytatu blokowego ze streszczeniem tuż pod H1,
 * - sekcji H2 z listami odnośników w postaci „- [nazwa](adres): opis".
 *
 * Plik generujemy z tych samych danych, z których powstają podstrony, więc
 * nie może rozjechać się z serwisem. Test sprawdza format przy każdym buildzie.
 *
 * Uczciwie: llms.txt nie steruje indeksowaniem ani trenowaniem — robi to
 * robots.txt i nagłówki. Ten plik jest streszczeniem serwisu dla modelu,
 * który już go czyta, i kosztuje tyle, co nic.
 */
import type { APIRoute } from 'astro';
import { ZAWODY, kategorie, wKategorii, slugKategorii, tresc } from '@ud/zawody';
import { ARTYKULY } from '../lib/artykuly';
import { FIRMA, SERWIS, UBEZPIECZYCIELE } from '../lib/firma';
import { ZUS_MIESIECZNIE, LIMIT, zl } from '../lib/symulacja';

export const GET: APIRoute = () => {
  const kat = kategorie();

  const sekcjaKategorii = kat.map((k) => {
    const zawody = wKategorii(k.nazwa)
      .map((z) => {
        const t = tresc(z.slug);
        // Opis bierzemy z pierwszego zdania treści redakcyjnej, jeśli istnieje —
        // wtedy każdy wiersz niesie coś, czego nie ma w samej nazwie zawodu.
        const opis = t?.wstep?.split(/(?<=[.!?])\s/)[0]
          ?? `Ubezpieczenie utraty dochodu dla ${z.odmiana.dopelniacz.toLowerCase()}.`;
        return `- [${z.nazwa}](${SERWIS.url}/${z.slug}/): ${opis}`;
      })
      .join('\n');
    return `### ${k.nazwa} (${k.liczba})\n\n${zawody}`;
  }).join('\n\n');

  const sekcjaArtykulow = ARTYKULY
    .map((a) => `- [${a.tytul}](${SERWIS.url}/blog/${a.slug}/): ${a.zajawka}`)
    .join('\n');

  const tresc_ = `# ${SERWIS.nazwa}

> Ubezpieczenie utraty dochodu dla samozatrudnionych, kontraktowych i wolnych
> zawodów w Polsce. Polisa wypłaca miesięczne świadczenie, gdy choroba lub
> wypadek uniemożliwiają wykonywanie zawodu — liczone od udokumentowanego
> dochodu, a nie od podstawy wymiaru składek ZUS.

Serwis prowadzi ${FIRMA.nazwaPelna} z siedzibą w Warszawie, agent ubezpieczeniowy
wpisany do Rejestru Pośredników Ubezpieczeniowych KNF pod numerem ${FIRMA.rpu}
(KRS ${FIRMA.krs}, REGON ${FIRMA.regon}). Partnerzy ubezpieczeniowi:
${UBEZPIECZYCIELE.join(' oraz ')}.

## Na czym polega produkt

Ubezpieczenie utraty dochodu, zwane też prywatnym L4, chroni przed całkowitą
niezdolnością do wykonywania zawodu z powodu choroby lub nieszczęśliwego wypadku.

- **Limit świadczenia:** do ${Math.round(LIMIT.b2b * 100)}% udokumentowanego dochodu przy samozatrudnieniu
  i kontrakcie B2B, do ${Math.round(LIMIT.etat * 100)}% przy umowie o pracę i umowie zlecenia.
- **Punkt odniesienia:** zasiłek chorobowy z ZUS wynosi 80% podstawy wymiaru składek.
  Przy najniższej podstawie daje to około ${zl(Math.round(ZUS_MIESIECZNIE * 0.8))} miesięcznie, niezależnie
  od faktycznych zarobków — i to jest luka, którą polisa zamyka.
- **Ryzyka:** okresowa niezdolność do pracy (świadczenie miesięczne), trwała
  niezdolność do pracy oraz śmierć i inwalidztwo wskutek nieszczęśliwego wypadku
  (świadczenia jednorazowe).
- **Warianty:** Leadenhall MEDICARE (LW047), MEDICA (LW046) dla zawodów medycznych
  oraz Utrata Dochodu (LW044) dla pozostałych. Warunki szczególne HIV/WZW
  (LW048, LW049) tylko przy wariantach medycznych.

## Czego produkt nie obejmuje

Te wyłączenia są istotne i często pomijane w materiałach marketingowych:

- wypalenie zawodowe jako samodzielna diagnoza,
- choroby psychiczne,
- częściowa niezdolność do pracy,
- schorzenia leczone w ciągu 24 miesięcy przed zawarciem umowy, o ile nie
  zostały zgłoszone i zaakceptowane przez ubezpieczyciela,
- kwarantanna i izolacja bez orzeczonej niezdolności do pracy,
- zakażenie HIV lub WZW bez wykupionej klauzuli szczególnej.

## Jak zawiera się umowę

- [Jak to działa](${SERWIS.url}/jak-to-dziala/): pięć etapów od wniosku do polisy,
  z czasem trwania każdego z nich. Cała droga zajmuje zwykle 2–4 dni robocze.
- [Wniosek online](${SERWIS.url}/wniosek/): cztery kroki, około pięciu minut.
  Zbiera dane osobowe, formę zatrudnienia i opodatkowania, zakres ochrony,
  ankietę medyczną i zgody. Przy sumie trwałej niezdolności powyżej ${zl(1_000_000)}
  uruchamia się rozszerzona ankieta zdrowotna.
- [Kalkulator składki](${SERWIS.url}/kalkulator/): symulacja, nie oferta.
  Realną składkę wylicza system ubezpieczyciela po ocenie ryzyka.
- [Dokumenty i OWU](${SERWIS.url}/dokumenty/): ogólne warunki ubezpieczenia
  i karty produktu do pobrania bez logowania.
- [Pełna lista wyłączeń](${SERWIS.url}/wylaczenia/): każde wyłączenie z powodem,
  dla którego istnieje — po ludzku, nie językiem OWU.

## Zawody objęte ochroną (${ZAWODY.length})

Serwis prowadzi osobną stronę dla każdej grupy zawodowej, z opisem ryzyk
charakterystycznych dla danej pracy i wyliczeniem luki między zasiłkiem
a dochodem.

${sekcjaKategorii}

## Baza wiedzy

Artykuły o zasiłkach, długości zwolnień i granicach prywatnej ochrony.
Każdy ma osobny adres i pełną treść w HTML-u.

${sekcjaArtykulow}

## O firmie

- [O nas](${SERWIS.url}/o-nas/): kim jesteśmy, z kim współpracujemy i pod jakimi
  numerami da się nas zweryfikować w rejestrach.
- [Opinie klientów](${SERWIS.url}/opinie/): wszystkie zebrane opinie, bez selekcji.
- [Współpraca dla agentów](${SERWIS.url}/pracuj-z-nami/): oferta dla sieci sprzedaży
  i agentów ubezpieczeń życiowych.
- [Klauzula informacyjna RODO](${SERWIS.url}/klauzula-informacyjna/): co dzieje się
  z danymi z wniosku, na jakiej podstawie prawnej i przez jaki czas.

## Jak czytać ten serwis

Każda podstrona ma wariant w Markdownie: ta sama treść bez nawigacji, stopki
i skryptów. Podstrona zawodu schodzi z około 38 kB HTML-a do 6 kB tekstu.

Dwie drogi, obie dają to samo:

- Nagłówek \`Accept: text/markdown\` na adresie strony — odpowiedź przychodzi
  z typem \`text/markdown\` i nagłówkiem \`x-markdown-tokens\` z liczbą tokenów.
- Adres wprost: do adresu strony dopisz \`index.md\`, na przykład
  ${SERWIS.url}/programista/index.md

Sam nagłówek \`Accept: */*\` nie wystarczy — przy równych wagach domyślny
zostaje HTML.

## Kontakt

- Telefon: ${FIRMA.telefonWyswietlany}
- E-mail: ${FIRMA.email}
- Adres: ${FIRMA.adres.ulica}, ${FIRMA.adres.miasto}
- Rejestr KNF: ${FIRMA.rejestrUrl} (numer wpisu ${FIRMA.rpu})
`;

  return new Response(tresc_, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
