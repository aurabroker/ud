/**
 * Ile kontaktów czeka na liście „Niedokończone": porzucony wniosek ze zgodą
 * na kontakt, nieukończony i jeszcze nieoznaczony jako „Obsłużony". Ten sam
 * filtr co na stronie listy — zakładka w menu miga, dopóki to nie jest zero.
 *
 * Liczy klient serwisowy (tabela szkiców nie ma polityk RLS), a zwraca samą
 * liczbę: do przeglądarki nie wychodzi żaden kontakt.
 */
export async function liczNiedokonczone(sb) {
  const { count, error } = await sb
    .from('ud_wnioski_szkice')
    .select('id', { count: 'exact', head: true })
    .eq('zgoda_kontakt', true)
    .is('ukonczony_at', null)
    .is('obsluzony_at', null);
  if (error) {
    console.error('[niedokonczone] licznik:', error.code || '', error.message || error);
    return null;
  }
  return count ?? 0;
}
