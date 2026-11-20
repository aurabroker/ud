import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { kartaKlienta } from '$lib/server/klienci.js';
import { filtryListy } from '$lib/klienci/lista.js';

export async function load({ params, locals, url }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  // Dane karty składa src/lib/server/klienci.js (ta sama funkcja w teście SSR):
  // widoczność, form_data bez identyfikatorów kliknięcia, opis źródła, strzałki
  // „Poprzedni / Następny klient" po liście z filtrami z adresu (?widok, ?zrodlo).
  const karta = await kartaKlienta(createAdminClient(), user.id, params.id, filtryListy(url.searchParams));
  // Cudzy klient wygląda dla agenta jak nieistniejący — bez zdradzania, że jest.
  if (!karta) throw error(404, 'Klient nie znaleziony');
  return karta;
}
