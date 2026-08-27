/**
 * Dane spółki — jedno miejsce, z którego bierze je stopka, klauzula RODO,
 * schema.org i informacja o dystrybutorze. Wpisane z odpisu KRS.
 */
export const FIRMA = {
  nazwa: 'Aura Expert sp. z o.o.',
  nazwaPelna: 'Aura Expert spółka z ograniczoną odpowiedzialnością',
  marka: 'UtrataDochodu.pl',

  adres: {
    ulica: 'ul. Bolkowska 2A lok. 28',
    kod: '01-466',
    miasto: 'Warszawa',
    kraj: 'PL',
  },

  krs: '0000599840',
  nip: '5242793544',
  sad: 'Sąd Rejonowy dla m.st. Warszawy, XII Wydział Gospodarczy Krajowego Rejestru Sądowego',
  regon: '363673048',
  kapital: '5 000 zł',

  /** Numer wpisu do Rejestru Pośredników Ubezpieczeniowych KNF. */
  rpu: '11229690/A',
  rejestrUrl: 'https://rpu.knf.gov.pl/',

  telefon: '+48504400901',
  telefonWyswietlany: '504 400 901',
  email: 'biuro@utratadochodu.com',

  ubezpieczyciele: ['Leadenhall Insurance S.A.', 'CEU (Casualty & Enterprise Underwriters)'],
} as const;

export const SERWIS = {
  url: 'https://utratadochodu.pl',
  nazwa: 'UtrataDochodu.pl',
  jezyk: 'pl-PL',
} as const;
