/**
 * cronBramka.js — sprawdzenie nagłówka x-cron-token w punktach wejścia
 * wołanych przez pg_cron (/api/cron/*). Ta sama wartość z Vaulta co przy
 * funkcjach brzegowych (edge_cron_token_matches, wzorzec z migracji
 * 20260924191031_edge_cron_token.sql).
 *
 * Wspólne, żeby dało się sprawdzić ZACHOWANIEM (scripts/test-kosz.mjs):
 * przepuszcza wyłącznie `true` z bazy — `false`, `null`, brak danych i błąd
 * zapytania to odmowa. Bez importów `$lib`/`$env`.
 *
 * @param {any} sb klient Supabase z kluczem serwisowym
 * @param {string} token wartość nagłówka
 * @returns {Promise<{ ok: true } | { ok: false, status: 401 | 503, error: string, doDziennika?: string }>}
 */
export async function sprawdzTokenCrona(sb, token) {
  if (!token) return { ok: false, status: 401, error: 'brak tokenu' };
  let wynik;
  try {
    wynik = await sb.rpc('edge_cron_token_matches', { token });
  } catch (e) {
    wynik = { data: null, error: e };
  }
  if (wynik?.error) {
    return { ok: false, status: 503, error: 'nie da się sprawdzić tokenu', doDziennika: String(wynik.error?.message || wynik.error) };
  }
  // Zły token bez wpisu w ud_errors: cron bierze token z tego samego Vaulta,
  // więc zły token to zawsze ktoś z zewnątrz — wpis za każde jego żądanie
  // pozwoliłby mu zapchać dziennik błędów.
  if (wynik?.data !== true) return { ok: false, status: 401, error: 'zły token' };
  return { ok: true };
}
