import { error, redirect } from '@sveltejs/kit';
import { ensureSummaryUrl } from '$lib/server/offers.js';
import { createAdminClient } from '$lib/server/supabase.js';

/** Zwraca nazwisko (ostatni człon) z pełnego imienia i nazwiska. */
function surnameOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export async function GET({ params, locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const sb = createAdminClient();
  const { data: offer } = await sb.from('ud_offers').select('client_name').eq('id', params.id).maybeSingle();

  const url = await ensureSummaryUrl(params.id);
  if (!url) throw error(400, 'Nie udało się wygenerować PDF podsumowania.');

  // Strumieniujemy przez naszą domenę — link Supabase nie jest ujawniany.
  const res = await fetch(url);
  if (!res.ok) throw error(502, 'Nie udało się pobrać PDF ze storage.');

  const surname = surnameOf(offer?.client_name).replace(/["\\/]/g, '');
  const filename = (surname ? `${surname} - podsumowanie oferty` : 'podsumowanie oferty') + '.pdf';

  return new Response(res.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}
