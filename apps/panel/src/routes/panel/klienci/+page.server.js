import { redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { listaKlientow } from '$lib/server/klienci.js';
import { filtryListy } from '$lib/klienci/lista.js';

export async function load({ locals, url }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  // Filtry w adresie: ?widok=archiwum (klient, którego lead jest w archiwum
  // tablicy, siedzi tam, nie na liście) i ?zrodlo=ads|agent|inne|brak — da się
  // je zapisać w zakładce, sprawdzić w SSR i przenieść na kartę klienta
  // (strzałki „Poprzedni / Następny"). Nieznana wartość = bez filtra.
  const { archiwum, zrodlo } = filtryListy(url.searchParams);
  return {
    clients: await listaKlientow(createAdminClient(), user.id),
    archiwum,
    zrodlo,
  };
}
