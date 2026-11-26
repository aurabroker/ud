/**
 * Druga linijka w kolumnie „Akcja" zakładki Klienci (decyzja właściciela
 * z 20.11.2026: „czy user dostał ofertę, czy otworzył?") — stan NAJNOWSZEJ
 * WYSŁANEJ oferty klienta, także zarchiwizowanej. Plakietka nad nią zostaje
 * z etapu leada (akcja.js); ta linijka mówi o samej ofercie.
 *
 * Archiwum to porządki na liście ofert, nie stan klienta (kupiona oferta
 * zostaje kupiona także w archiwum). Gdy najnowsza wysłana leży w archiwum,
 * pokazujemy ją z dopiskiem „w archiwum" — cofnięcie się do starszej oferty
 * spoza archiwum mówiłoby „nieotwarta" o kliencie, który nowszą otworzył albo
 * kupił. Ta sama zasada co w ud_oferty_do_przypomnienia: nowsza wysłana
 * oferta, w archiwum czy nie, zastępuje starszą.
 *
 * Skąd biorą się daty (src/lib/server/offers.js, src/routes/offer/[token]):
 *  - `sent_at` — chwila udanej wysyłki e-maila; KAŻDA kolejna wysyłka nadpisuje
 *    ją, ustawia status z powrotem na `sent` i podbija `wersja`;
 *  - `viewed_at` — pierwsze wejście na stronę oferty PO wpisaniu kodu (4 ostatnie
 *    cyfry PESEL-u), i tylko gdy status jest `sent`. Sam link bez kodu go nie
 *    ustawia.
 *
 * Dlatego „otwarta" = `viewed_at` nie wcześniej niż `sent_at`. Gdy agent wyśle
 * ofertę ponownie po tym, jak klient otworzył poprzednią wersję, `viewed_at`
 * zostaje STARSZE niż `sent_at` (na produkcji 20.11.2026: 6 z 18 ofert
 * w statusie `sent`). Pisanie wtedy „otwarta" byłoby nieprawdą o wersji, którą
 * klient ma teraz w skrzynce — piszemy „nieotwarta (poprzednia wersja otwarta
 * DD.MM)": i to, że nowej nie widział, i to, że ofertą się interesował.
 *
 * Wybór wariantu i rezygnacja wymagają wpisanego kodu, ale klient może je
 * kliknąć w karcie otwartej przed ponowną wysyłką — wtedy nie twierdzimy ani
 * „otwarta", ani „nieotwarta", tylko podajemy decyzję.
 *
 * Słowa bez rodzaju („wariant wybrany", „rezygnacja", „poprzednia wersja
 * otwarta"): klientem bywa kobieta i mężczyzna.
 */

const DZIEN = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit' });
const DATA = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' });

export const OTWARTA_ZNACZY = 'Otwarta = klient wpisał kod i zobaczył ofertę.';

/** @param {unknown} s @returns {number | null} */
const ms = (s) => {
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/**
 * @typedef {{ id?: string, offer_number?: string | null, status?: string | null, sent_at?: string | null,
 *             viewed_at?: string | null, wersja?: number | null, decided_at?: string | null,
 *             wybrano_at?: string | null, rezygnacja_at?: string | null, archived_at?: string | null }} OfertaKlienta
 */

/**
 * Najnowsza wysłana oferta (największe `sent_at`, przy remisie — identyfikator).
 * Szkice (bez `sent_at`) się nie liczą; oferty w archiwum — tak (patrz wyżej).
 * @param {OfertaKlienta[] | null | undefined} oferty
 * @returns {OfertaKlienta | null}
 */
export function najnowszaWyslana(oferty) {
  /** @type {OfertaKlienta | null} */ let naj = null;
  for (const o of oferty ?? []) {
    const t = ms(o?.sent_at);
    if (!o || t == null) continue;
    const tn = naj ? /** @type {number} */ (ms(naj.sent_at)) : -Infinity;
    if (t > tn || (t === tn && String(o.id ?? '') > String(naj?.id ?? ''))) naj = o;
  }
  return naj;
}

/**
 * Linijka pod plakietką: { stan, etykieta, tytul } albo null (brak wysłanej oferty).
 *  stan 'otwarta'    — klient otworzył wersję, którą ma teraz;
 *  stan 'nieotwarta' — nie otworzył (może poprzednią — wtedy mówi to etykieta);
 *  stan 'decyzja'    — wybór albo rezygnacja bez wejścia na stronę po ostatniej wysyłce.
 * @param {OfertaKlienta | null | undefined} o
 * @returns {{ stan: 'otwarta' | 'nieotwarta' | 'decyzja', etykieta: string, tytul: string } | null}
 */
export function stanOferty(o) {
  const wyslana = ms(o?.sent_at);
  if (!o || wyslana == null) return null;
  const otwarta = ms(o.viewed_at);
  const wersja = Number.isInteger(o.wersja) ? Number(o.wersja) : 1;
  const ponownie = wersja > 1;

  const czesci = [`wysłana ${ponownie ? 'ponownie ' : ''}${DZIEN.format(wyslana)}`];
  const opis = [`wysłana ${DATA.format(wyslana)}${ponownie ? ` (wersja ${wersja})` : ''}`];

  /** @type {null | { tekst: string, kiedy: number | null }} */
  const decyzja = o.status === 'chosen' ? { tekst: 'wariant wybrany', kiedy: ms(o.wybrano_at) ?? ms(o.decided_at) }
    : o.status === 'rejected' ? { tekst: 'rezygnacja', kiedy: ms(o.rezygnacja_at) ?? ms(o.decided_at) }
    : null;
  const zamknieta = decyzja !== null || o.status === 'bought';

  /** @type {'otwarta' | 'nieotwarta' | 'decyzja'} */
  let stan;
  if (otwarta != null && otwarta >= wyslana) {
    stan = 'otwarta';
    czesci.push(`otwarta ${DZIEN.format(otwarta)}`);
    opis.push(`otwarta ${DATA.format(otwarta)}`);
  } else if (otwarta == null && o.status === 'viewed') {
    // Status „otwarta" bez daty (wiersz sprzed zapisywania viewed_at) — wiemy, że otworzył, nie wiemy kiedy.
    stan = 'otwarta';
    czesci.push('otwarta');
    opis.push('otwarta (bez daty)');
  } else if (zamknieta) {
    // Decyzja bez wejścia na stronę po ostatniej wysyłce (karta otwarta wcześniej) — nie zgadujemy.
    stan = 'decyzja';
  } else if (otwarta != null) {
    stan = 'nieotwarta';
    czesci.push(`nieotwarta (poprzednia wersja otwarta ${DZIEN.format(otwarta)})`);
    opis.push(`ta wersja jeszcze nieotwarta, poprzednia wersja otwarta ${DATA.format(otwarta)}`);
  } else {
    stan = 'nieotwarta';
    czesci.push('nieotwarta');
    opis.push('jeszcze nieotwarta');
  }
  if (decyzja) {
    czesci.push(decyzja.kiedy != null ? `${decyzja.tekst} ${DZIEN.format(decyzja.kiedy)}` : decyzja.tekst);
    opis.push(decyzja.kiedy != null ? `${decyzja.tekst} ${DATA.format(decyzja.kiedy)}` : decyzja.tekst);
  }
  const wArchiwum = Boolean(o.archived_at);
  if (wArchiwum) czesci.push('w archiwum');

  const nr = typeof o.offer_number === 'string' && o.offer_number.trim() ? ` ${o.offer_number.trim()}` : '';
  return {
    stan,
    etykieta: czesci.join(' · '),
    tytul: `Najnowsza wysłana oferta${nr}${wArchiwum ? ' (w archiwum)' : ''}: ${opis.join(', ')}. ${OTWARTA_ZNACZY}`,
  };
}
