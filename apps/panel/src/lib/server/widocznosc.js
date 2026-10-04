/**
 * Klienci widoczni dla użytkownika panelu — ta sama reguła co na tablicy leadów
 * (decyzja właściciela z 02.10.2026): administrator widzi wszystkich, agent
 * tylko klientów swoich leadów i dodanych przez siebie, którzy leada jeszcze
 * nie mają. Rozstrzyga SQL (ud_klienci_widoczni / ud_klient_widoczny); tu jest
 * tylko transport. Strony czytają klientów kluczem serwisowym, więc bez tego
 * filtra nowy agent zobaczyłby w „Klientach" wszystkich z pełnymi danymi.
 */

/** @returns {Promise<string[] | null>} null = wszyscy (administrator) */
export async function klienciWidoczni(sb, userId) {
  const { data: rola, error: eRola } = await sb.rpc('ud_leady_rola', { p_user: userId });
  if (eRola) throw new Error('Rola: ' + eRola.message);
  if (rola === 'admin') return null;
  if (!rola) return [];
  const { data, error } = await sb.rpc('ud_klienci_widoczni', { p_user: userId });
  if (error) throw new Error('Widoczni klienci: ' + error.message);
  // PostgREST zwraca zbiór wartości skalarnych jako tablicę wartości.
  return (data || []).map((x) => (typeof x === 'string' ? x : Object.values(x ?? {})[0])).filter(Boolean);
}

export async function klientWidoczny(sb, userId, klientId) {
  const { data, error } = await sb.rpc('ud_klient_widoczny', { p_user: userId, p_klient: klientId });
  if (error) throw new Error('Widoczność klienta: ' + error.message);
  return data === true;
}
