/**
 * Statystyki sprzedaży z tablicy leadów (etap „Wygrany"). Kto co widzi,
 * rozstrzyga SQL (ud_leady_statystyki): administrator — wszystkich i każdego
 * z osobna, agent — wyłącznie swoje, niezależnie od parametrów adresu.
 *
 * „Według źródła" (ud_leady_statystyki_zrodla, panel v.0.80) ładuje się
 * OSOBNO: jego awaria — także brak funkcji w bazie, gdy panel wyjdzie przed
 * migracją — pokazuje komunikat w tej jednej sekcji i nie zasłania reszty.
 *
 * Przed obiema najpierw synchronizacja leadów (jak przy tablicy i liście
 * klientów): leady powstają tylko w `ud_leady_synchronizuj()`, a statystyki
 * agenta liczą wnioski po leadzie, którego agent jest opiekunem. Bez niej
 * wniosek złożony z linku agenta nie liczyłby się agentowi, dopóki ktoś nie
 * otworzy tablicy albo klientów — a widok „wszyscy" już by go liczył.
 * Synchronizacja nigdy nie rzuca: jej awaria nie zasłania strony.
 */
import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { BladApi, statystyki, statystykiZrodel, synchronizuj } from '$lib/server/leady.js';

export async function load({ locals, url }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  const sb = createAdminClient();

  await synchronizuj(sb);
  const [glowne, zrodla] = await Promise.allSettled([
    statystyki(sb, user.id, url.searchParams),
    statystykiZrodel(sb, user.id, url.searchParams),
  ]);

  let st = null;
  let blad = '';
  if (glowne.status === 'fulfilled') {
    st = glowne.value;
  } else {
    const e = glowne.reason;
    if (e instanceof BladApi && e.status === 403) throw error(403, e.message);
    console.error('[statystyki] load:', e?.message || e);
    blad = 'Nie udało się wczytać statystyk. Odśwież stronę za chwilę.';
  }

  let zr = null;
  let zrBlad = '';
  if (zrodla.status === 'fulfilled') {
    zr = zrodla.value;
  } else {
    const e = zrodla.reason;
    console.error('[statystyki] źródła:', e?.message || e);
    zrBlad = e instanceof BladApi && e.status !== 403 ? e.message : 'Nie udało się wczytać statystyk według źródła.';
  }

  return { st, blad, zr, zrBlad, ja: user.id };
}
