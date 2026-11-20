/**
 * zrodlo.js — skąd przyszedł klient. JEDNO miejsce z regułą rodzaju źródła.
 *
 * Kreator wniosku (portal, `zrodloZAdresu` w @ud/wniosek) wysyła z wnioskiem
 * pole `zrodlo` z parametrami kampanii z adresu; `form-submit` kopiuje ciało
 * żądania do `ud_clients.form_data` bez zmian, więc źródło żyje w
 * `form_data.zrodlo`, nie w osobnej kolumnie. Kształt (umowa z portalem):
 *
 *   { utm_source?, utm_medium?, utm_campaign?, utm_term?, utm_content?,
 *     gad_source?, gad_campaignid?, platne: boolean, zgoda_marketing: boolean,
 *     gclid? | gbraid? | wbraid?   ← tylko przy zgodzie na cookies marketingowe }
 *
 * Wnioski sprzed wdrożenia, klienci dodani w panelu i wnioski bez żadnego
 * parametru z białej listy nie mają `zrodlo` wcale.
 *
 * Czysty JS bez SvelteKita: tę samą regułę biorą lista klientów, karta klienta
 * i statystyki (SQL `ud_leady_statystyki_zrodla` oddaje SUROWE klucze grup —
 * reguła nie jest powielana w bazie, żeby nie rozjechały się dwie prawdy).
 * Test: scripts/test-zrodlo.mjs.
 *
 * IDENTYFIKATORY KLIKNIĘCIA (gclid, gbraid, wbraid) NIGDY nie wychodzą z tego
 * pliku i nie trafiają do przeglądarki agenta. Zapisujemy je wyłącznie na
 * potrzeby przyszłego importu konwersji (za zgodą klienta); agentowi do niczego
 * nie służą, a to identyfikator kliknięcia konkretnej osoby.
 */

/** @typedef {'ads' | 'agent' | 'inne' | 'brak'} KluczZrodla */

/** @type {KluczZrodla[]} */
export const KLUCZE_ZRODLA = ['ads', 'agent', 'inne', 'brak'];

/** @type {Record<string, string>} */
export const ETYKIETY_ZRODLA = {
  ads: 'Google Ads',
  agent: 'Link agenta',
  inne: 'Inne',
  brak: 'Brak danych',
};

/** Identyfikatory kliknięcia Google — do wycinania, nigdy do pokazywania. */
export const IDENTYFIKATORY_KLIKNIECIA = ['gclid', 'gbraid', 'wbraid'];

// utm_source i utm_medium kampanii UD_2026 (…?utm_source=ads&utm_medium=internet…).
// Bez `platne` (np. klient bez gclid, bo Google go nie dokleił) to nadal reklama.
// Tę samą regułę stosuje licznik /kup-online (portal, functions/kup-online —
// kopia, bo funkcja Pages nie importuje panelu); apps/portal/test/zrodlo.spec.js
// porównuje obie zachowaniem. Zmiana tutaj = zmiana tam.
const ZRODLA_REKLAMY = new Set(['ads', 'google']);
const MEDIA_REKLAMY = new Set(['cpc', 'internet', 'paid']);

const MAKS_ETYKIETY = 40;
/** Najdłuższa wartość źródła, jaką przepuszcza portal (utm_* do 100 znaków). */
const MAKS_KLUCZA = 100;

/**
 * Zwykły obiekt JSON — nie tablica, nie null, nie napis.
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
export const jestObiektem = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Napis po `trim()`, albo '' dla wszystkiego, co napisem nie jest. @param {unknown} v */
const napis = (v) => (typeof v === 'string' ? v.trim() : '');

/** Skraca do `max` znaków (po punktach kodowych — emoji nie rozpada się na pół). @param {string} s @param {number} max */
const skroc = (s, max) => {
  const znaki = Array.from(s);
  return znaki.length > max ? `${znaki.slice(0, max - 1).join('')}…` : s;
};

/**
 * `zrodlo` klienta: pole `zrodlo` (lista czyta je z PostgREST jako
 * `zrodlo:form_data->zrodlo`), a bez niego — `form_data.zrodlo` (karta klienta
 * czyta cały wiersz).
 * @param {unknown} klient
 */
function zrodloZ(klient) {
  if (!jestObiektem(klient)) return undefined;
  if ('zrodlo' in klient) return klient.zrodlo;
  return jestObiektem(klient.form_data) ? klient.form_data.zrodlo : undefined;
}

/**
 * Rodzaj źródła. Kolejność reguł ma znaczenie:
 *
 *  a) płatne kliknięcie (`platne === true`) albo utm_source ads/google przy
 *     medium cpc/internet/paid → „Google Ads". Reklama wygrywa z linkiem agenta:
 *     klient z reklamy, który dostał potem link od agenta, i tak przyszedł
 *     z pieniędzy wydanych na reklamę — o to właściciel pyta.
 *  b) kod agenta w `affiliate_code_used` → „Link agenta". Wygrywa z innym
 *     utm_source: link agenta to konkretna osoba, utm na nim to dodatek.
 *  c) inny utm_source → „Inne: <utm_source>".
 *  d) `zrodlo` bez utm_source → „Inne". Kreator zapisuje `zrodlo` tylko wtedy,
 *     gdy w adresie był choć jeden poprawny parametr z białej listy — więc to
 *     wizyta oznaczona (np. samo utm_campaign albo gad_campaignid bez
 *     gad_source), tylko nie wiadomo skąd. „Brak danych" byłoby nieprawdą.
 *  e) bez `zrodlo` → „Brak danych": wniosek sprzed zapisywania źródła, klient
 *     dodany w panelu albo wejście bez żadnego parametru.
 *
 * @param {unknown} klient  { zrodlo?, form_data?, affiliate_code_used? } — cokolwiek innego to „Brak danych"
 * @returns {{ klucz: KluczZrodla, etykieta: string }}
 */
export function rodzajZrodla(klient) {
  const z = zrodloZ(klient);
  const obiekt = jestObiektem(z);
  const zrodlo = obiekt ? napis(z.utm_source) : '';
  const medium = obiekt ? napis(z.utm_medium) : '';

  if (obiekt && (z.platne === true
      || (ZRODLA_REKLAMY.has(zrodlo.toLowerCase()) && MEDIA_REKLAMY.has(medium.toLowerCase())))) {
    return { klucz: 'ads', etykieta: ETYKIETY_ZRODLA.ads };
  }
  if (napis(jestObiektem(klient) ? klient.affiliate_code_used : '')) {
    return { klucz: 'agent', etykieta: ETYKIETY_ZRODLA.agent };
  }
  if (obiekt && zrodlo) return { klucz: 'inne', etykieta: `Inne: ${skroc(zrodlo, MAKS_ETYKIETY)}` };
  if (obiekt) return { klucz: 'inne', etykieta: ETYKIETY_ZRODLA.inne };
  return { klucz: 'brak', etykieta: ETYKIETY_ZRODLA.brak };
}

/**
 * Opis źródła do listy i karty klienta: rodzaj, kampania (utm_campaign, a bez
 * niej gad_campaignid — numer kampanii z automatycznego tagowania) i słowo
 * kluczowe (utm_term). Bez identyfikatorów kliknięcia — zawsze.
 *
 * @param {unknown} klient
 * @returns {{ klucz: KluczZrodla, etykieta: string, kampania: string | null, slowo: string | null }}
 */
export function opisZrodla(klient) {
  const { klucz, etykieta } = rodzajZrodla(klient);
  const z = zrodloZ(klient);
  /** @param {string} k */
  const pole = (k) => (jestObiektem(z) ? skroc(napis(z[k]), 100) || null : null);
  return { klucz, etykieta, kampania: pole('utm_campaign') ?? pole('gad_campaignid'), slowo: pole('utm_term') };
}

/**
 * Płytka kopia `form_data` bez identyfikatorów kliknięcia — w `zrodlo` i na
 * wierzchu (kreator kładzie je tylko w `zrodlo`, ale `form-submit` kopiuje
 * całe ciało żądania, więc ktoś mógł je wysłać obok). Karta klienta oddaje
 * wiersz klienta przeglądarce agenta; tego tam być nie może.
 * @param {any} formData
 * @returns {any}
 */
export function bezIdentyfikatorow(formData) {
  if (!jestObiektem(formData)) return formData;
  const kopia = { ...formData };
  for (const k of IDENTYFIKATORY_KLIKNIECIA) delete kopia[k];
  if (jestObiektem(kopia.zrodlo)) {
    const z = { ...kopia.zrodlo };
    for (const k of IDENTYFIKATORY_KLIKNIECIA) delete z[k];
    kopia.zrodlo = z;
  }
  return kopia;
}

const MIARY = ['wnioski', 'sprzedaze', 'z_danymi', 'skladka_roczna_suma', 'prowizja_suma', 'bez_stawki'];
/**
 * @typedef {{ wnioski: number, sprzedaze: number, z_danymi: number, skladka_roczna_suma: number,
 *             prowizja_suma: number, bez_stawki: number }} Miary
 */
/** @returns {Miary} */
const zero = () => ({ wnioski: 0, sprzedaze: 0, z_danymi: 0, skladka_roczna_suma: 0, prowizja_suma: 0, bez_stawki: 0 });
/** @param {Record<string, any>} cel @param {Record<string, any>} g */
const dodaj = (cel, g) => {
  for (const m of MIARY) {
    const n = Number(g?.[m]);
    if (Number.isFinite(n)) cel[m] += n;
  }
};
// Kwoty z bazy to numeric → w JSON-ie liczba z groszami; sumowanie w JS
// zostawia ogon zmiennoprzecinkowy (0.1 + 0.2), więc zaokrąglamy do groszy.
/** @template {Miary} T @param {T} w @returns {T} */
const grosze = (w) => ({ ...w, skladka_roczna_suma: Math.round(w.skladka_roczna_suma * 100) / 100,
  prowizja_suma: Math.round(w.prowizja_suma * 100) / 100 });

export const BEZ_KAMPANII = 'bez nazwy kampanii';
export const BEZ_UTM_SOURCE = 'bez utm_source';

/**
 * Zwija surowe grupy z `ud_leady_statystyki_zrodla` w wiersze tabeli
 * „Według źródła": po jednym na rodzaj (zawsze w kolejności Google Ads, Link
 * agenta, Inne, Brak danych — także z zerami, żeby było widać, że reklama
 * nic nie dała), z podwierszami: kampanie przy Google Ads, utm_source przy Inne.
 *
 * Grupa z SQL: { platne, utm_source, utm_medium, link_agenta, ma_zrodlo,
 * kampania, wnioski, sprzedaze, z_danymi, skladka_roczna_suma, prowizja_suma,
 * bez_stawki } — utm_source i utm_medium już małymi literami i przycięte.
 * Rodzaj liczy ta sama `rodzajZrodla` co na liście klientów.
 *
 * @param {unknown} grupy
 */
export function zrodlaWStatystykach(grupy) {
  /** @typedef {Miary & { klucz: string, etykieta: string }} Podwiersz */
  /** @type {Map<string, Miary & { klucz: KluczZrodla, etykieta: string, pod: Map<string, Podwiersz> }>} */
  const wiersze = new Map(KLUCZE_ZRODLA.map((k) => [k, { klucz: k, etykieta: ETYKIETY_ZRODLA[k], ...zero(), pod: new Map() }]));
  const razem = zero();

  for (const g of Array.isArray(grupy) ? grupy : []) {
    if (!jestObiektem(g)) continue;
    const zrodlo = g.ma_zrodlo === true
      ? { platne: g.platne === true, utm_source: g.utm_source ?? undefined, utm_medium: g.utm_medium ?? undefined }
      : undefined;
    const { klucz } = rodzajZrodla({ zrodlo, affiliate_code_used: g.link_agenta === true ? 'tak' : null });
    const w = wiersze.get(klucz);
    if (!w) continue;
    dodaj(w, g);
    dodaj(razem, g);

    // Klucz podwiersza to wartość ('' = brak) do 100 znaków — tyle przepuszcza
    // portal i tyle oddaje SQL: dwie długie kampanie o tym samym początku nie
    // zleją się po skróceniu etykiety, strona ma unikalny klucz do {#each},
    // a wartość z ręcznie spreparowanego wniosku (form_data bez limitu) nie
    // pojedzie w danych strony w całości.
    const podKlucz = klucz === 'ads' ? skroc(napis(g.kampania), MAKS_KLUCZA)
      : klucz === 'inne' ? skroc(napis(g.utm_source), MAKS_KLUCZA) : null;
    if (podKlucz !== null) {
      const etykieta = podKlucz ? skroc(podKlucz, 60) : klucz === 'ads' ? BEZ_KAMPANII : BEZ_UTM_SOURCE;
      const p = w.pod.get(podKlucz) ?? { klucz: podKlucz, etykieta, ...zero() };
      dodaj(p, g);
      w.pod.set(podKlucz, p);
    }
  }

  /** @param {Podwiersz} a @param {Podwiersz} b */
  const kolejnosc = (a, b) => (b.wnioski + b.sprzedaze) - (a.wnioski + a.sprzedaze) || (a.etykieta < b.etykieta ? -1 : 1);
  return {
    wiersze: [...wiersze.values()].map((w) => grosze({ ...w, pod: [...w.pod.values()].map(grosze).sort(kolejnosc) })),
    razem: grosze(razem),
  };
}
