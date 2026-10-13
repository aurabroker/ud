/**
 * kosz.js — kosz ofert na 30 dni (decyzja właściciela z 13.10.2026).
 *
 * Przeniesienie, przywrócenie i lista żyją w SQL (migracja …_oferty_kosz.sql):
 * tam jest blokada wiersza, reguła widoczności i kopia wszystkich wierszy
 * zależnych od oferty. Tu tylko wywołanie, tłumaczenie statusów na zdania
 * dla agenta i czyszczenie kubełka po 30 dniach (plików przez SQL usunąć się
 * nie da — trzeba API Storage).
 *
 * Bez importów `$lib` i `$env`: klient bazy przychodzi parametrem, żeby dało
 * się to sprawdzić zwykłym Node'em (scripts/test-kosz.mjs).
 */

export const KOSZ_DNI = 30;

/** Kubełek z plikami ofert (ten sam co w offers.js). Wspólne OWU leżą w ud-owu i kosz ich nie rusza. */
export const KUBELEK_OFERT = 'ud-offers';

const KOMUNIKATY = {
  brak_uprawnien: 'Twoje konto nie może usuwać ani przywracać ofert (nieaktywne?).',
  brak_oferty: 'Tej oferty nie ma albo nie możesz jej usunąć (usuwa właściciel oferty lub administrator).',
  brak_wpisu: 'Tej oferty nie ma w koszu.',
  oferta_istnieje: 'Ta oferta już jest na liście ofert.',
  po_terminie: 'Minęło 30 dni — ta oferta jest usuwana na dobre i nie da się jej już przywrócić.',
  konflikt_linku: 'Nie da się przywrócić: inna oferta ma ten sam link dla klienta. Zgłoś to administratorowi.'
};

function blad(status) {
  return new Error(KOMUNIKATY[status] || `Nieoczekiwany wynik: ${status}`);
}

/**
 * Przenosi ofertę do kosza. Klient od razu traci dostęp do linku.
 * @returns {Promise<{ koszId: string, offerId: string }>}
 */
export async function przeniesDoKosza(sb, offerId, userId) {
  const { data, error } = await sb.rpc('ud_oferta_do_kosza', { p_offer: offerId, p_user: userId });
  if (error) throw new Error('Kosz: ' + error.message);
  if (data?.status !== 'ok') throw blad(data?.status);
  return { koszId: data.kosz_id, offerId: data.offer_id };
}

/**
 * Przywraca ofertę z kosza — z tym samym id i linkiem dla klienta.
 * @returns {Promise<{ offerId: string }>}
 */
export async function przywrocZKosza(sb, koszId, userId) {
  const { data, error } = await sb.rpc('ud_oferta_z_kosza', { p_kosz: koszId, p_user: userId, p_dni: KOSZ_DNI });
  if (error) throw new Error('Kosz: ' + error.message);
  if (data?.status !== 'ok') throw blad(data?.status);
  return { offerId: data.offer_id };
}

/** Wpisy w koszu widoczne dla użytkownika (właściciel, administrator, usuwający). */
export async function listaKosza(sb, userId) {
  const { data, error } = await sb.rpc('ud_kosz_ofert_lista', { p_user: userId, p_dni: KOSZ_DNI });
  if (error) throw new Error('Kosz: ' + error.message);
  return data || [];
}

/**
 * Usuwa na dobre wpisy starsze niż KOSZ_DNI: najpierw pliki z kubełka, potem
 * wpis. Kolejność ma znaczenie — wpis bez plików da się powtórzyć za godzinę,
 * pliki bez wpisu zostałyby w kubełku na zawsze, nikomu nieznane. SQL zajmuje
 * zwrócone wpisy (czyszczenie_od), więc żadnego z nich nie da się już
 * przywrócić — nawet gdy coś tu padnie między plikami a wpisem.
 *
 * Usuwa tylko ścieżki z katalogu tej oferty (`<offer_id>/…`). Wszystkie pliki
 * ofert tak leżą (sprawdzone 13.10.2026: 157 z 157); ścieżka spoza katalogu
 * byłaby cudzym plikiem i zostaje.
 *
 * @param {{ sb: any, limit?: number }} deps
 * @returns {Promise<{ kandydatow: number, usunieto: number, plikow: number, przerwano?: string }>}
 */
export async function wyczyscKosz({ sb, limit = 20 }) {
  const { data, error } = await sb.rpc('ud_kosz_ofert_do_wyczyszczenia', { p_dni: KOSZ_DNI, p_limit: limit });
  if (error) throw new Error('ud_kosz_ofert_do_wyczyszczenia: ' + error.message);

  const wynik = { kandydatow: (data || []).length, usunieto: 0, plikow: 0 };
  for (const w of data || []) {
    const sciezki = (w.pliki_storage || []).filter(
      (p) => typeof p === 'string' && p.startsWith(`${w.offer_id}/`) && !p.includes('..')
    );
    if (sciezki.length) {
      const { error: bladPlikow } = await sb.storage.from(KUBELEK_OFERT).remove(sciezki);
      if (bladPlikow) {
        wynik.przerwano = `pliki oferty ${w.offer_id}: ${bladPlikow.message || bladPlikow}`;
        break;
      }
      wynik.plikow += sciezki.length;
    }
    const { data: usuniete, error: bladWpisu } = await sb.from('ud_offers_kosz').delete().eq('id', w.id).select('id');
    if (bladWpisu) {
      wynik.przerwano = `wpis kosza ${w.id}: ${bladWpisu.message || bladWpisu}`;
      break;
    }
    // Zero wierszy bez błędu = ktoś usunął wpis w międzyczasie; nie liczymy.
    if (usuniete?.length) wynik.usunieto += 1;
  }
  return wynik;
}
