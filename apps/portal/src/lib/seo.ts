/**
 * seo.ts — dane strukturalne i meta.
 *
 * Dwa odbiorniki, jeden format. Google używa schema.org do rich results,
 * a modele językowe czytają ten sam JSON-LD jako najczystszą dostępną
 * reprezentację treści strony — bez nawigacji, reklam i szumu.
 *
 * Dlatego trzymamy się kilku zasad:
 * - jeden blok @graph na stronę, nie pięć osobnych skryptów,
 * - każdy węzeł ma @id, żeby dało się je referencjonować zamiast duplikować,
 * - opisy w danych strukturalnych to te same zdania, które widzi człowiek.
 *   Rozjazd między jednym a drugim Google traktuje jak spam, a model jak
 *   powód do nieufności wobec całej strony.
 */
import { FIRMA, SERWIS } from './firma';

export type Okruszek = { nazwa: string; url: string };

/** Bezwzględny adres z względnej ścieżki. */
export function abs(sciezka: string): string {
  return new URL(sciezka, SERWIS.url).href;
}

/** Węzeł organizacji — referencjonowany przez wszystkie pozostałe. */
export function organizacja() {
  return {
    '@type': 'InsuranceAgency',
    '@id': `${SERWIS.url}/#organizacja`,
    name: SERWIS.nazwa,
    legalName: FIRMA.nazwaPelna,
    url: SERWIS.url,
    telephone: FIRMA.telefon,
    email: FIRMA.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: FIRMA.adres.ulica,
      postalCode: FIRMA.adres.kod,
      addressLocality: FIRMA.adres.miasto,
      addressCountry: FIRMA.adres.kraj,
    },
    vatID: FIRMA.nip,
    identifier: [
      { '@type': 'PropertyValue', name: 'KRS', value: FIRMA.krs },
      { '@type': 'PropertyValue', name: 'NIP', value: FIRMA.nip },
      { '@type': 'PropertyValue', name: 'REGON', value: FIRMA.regon },
      { '@type': 'PropertyValue', name: 'Rejestr Pośredników Ubezpieczeniowych KNF', value: FIRMA.rpu },
    ],
    areaServed: { '@type': 'Country', name: 'Polska' },
    knowsLanguage: 'pl',
  };
}

/** Ścieżka okruszków. Google pokazuje ją w wynikach zamiast gołego adresu. */
export function okruszki(sciezka: Okruszek[]) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${abs(sciezka.at(-1)!.url)}#okruszki`,
    itemListElement: sciezka.map((o, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: o.nazwa,
      item: abs(o.url),
    })),
  };
}

/** Węzeł strony. */
export function strona(opts: {
  url: string;
  tytul: string;
  opis: string;
  okruszki?: Okruszek[];
  zmodyfikowano?: Date;
}) {
  return {
    '@type': 'WebPage',
    '@id': `${abs(opts.url)}#strona`,
    url: abs(opts.url),
    name: opts.tytul,
    description: opts.opis,
    inLanguage: SERWIS.jezyk,
    isPartOf: { '@id': `${SERWIS.url}/#serwis` },
    publisher: { '@id': `${SERWIS.url}/#organizacja` },
    ...(opts.okruszki ? { breadcrumb: { '@id': `${abs(opts.url)}#okruszki` } } : {}),
    ...(opts.zmodyfikowano ? { dateModified: opts.zmodyfikowano.toISOString().slice(0, 10) } : {}),
    /**
     * speakable wskazuje asystentom głosowym, którą część strony przeczytać.
     * Kierujemy je na nagłówek i pierwszy akapit odpowiedzi — czyli dokładnie
     * tam, gdzie stoi odpowiedź na pytanie z nagłówka.
     */
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['h1', '[data-odpowiedz]'],
    },
  };
}

/** Węzeł serwisu — jeden na całą domenę. */
export function serwis() {
  return {
    '@type': 'WebSite',
    '@id': `${SERWIS.url}/#serwis`,
    url: SERWIS.url,
    name: SERWIS.nazwa,
    inLanguage: SERWIS.jezyk,
    publisher: { '@id': `${SERWIS.url}/#organizacja` },
  };
}

/**
 * FAQ. Google wymaga, żeby pytania i odpowiedzi były widoczne na stronie —
 * schemat opisujący treść ukrytą jest naruszeniem wytycznych i grozi ręczną karą.
 * Dlatego ten sam zestaw pytań renderujemy w HTML i tu.
 */
export function faq(pytania: { pytanie: string; odpowiedz: string }[], url: string) {
  return {
    '@type': 'FAQPage',
    '@id': `${abs(url)}#faq`,
    mainEntity: pytania.map((p) => ({
      '@type': 'Question',
      name: p.pytanie,
      acceptedAnswer: { '@type': 'Answer', text: p.odpowiedz },
    })),
  };
}

/** Usługa — ubezpieczenie utraty dochodu dla konkretnej grupy zawodowej. */
export function usluga(opts: { nazwa: string; opis: string; url: string; grupa: string }) {
  return {
    '@type': 'Service',
    '@id': `${abs(opts.url)}#usluga`,
    name: opts.nazwa,
    description: opts.opis,
    serviceType: 'Ubezpieczenie utraty dochodu',
    provider: { '@id': `${SERWIS.url}/#organizacja` },
    areaServed: { '@type': 'Country', name: 'Polska' },
    audience: { '@type': 'Audience', audienceType: opts.grupa },
  };
}

/** Składa gotowy blok @graph. */
export function graf(wezly: object[]) {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': wezly });
}
