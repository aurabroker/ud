import { fail, redirect } from '@sveltejs/kit';
import { deleteOffer, refreshOfferDocuments } from '$lib/server/offers.js';

export async function load({ locals }) {
  const { data: offers } = await locals.supabase
    .from('ud_offers')
    .select('id, name, offer_number, client_name, status, source, created_at, sent_at, share_token')
    .eq('source', 'pdf_import')
    .order('created_at', { ascending: false })
    .limit(200);

  return { offers: offers || [] };
}

export const actions = {
  // Zastosowanie aktualnych reguł (parser + układ tabeli) do wcześniej wygenerowanych ofert:
  // ponowny odczyt PDF-ów i regeneracja podsumowań. Nic nie kasuje poza starym plikiem PDF podsumowania.
  refreshAll: async ({ locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');

    const { data: offers } = await locals.supabase
      .from('ud_offers')
      .select('id')
      .eq('source', 'pdf_import')
      .order('created_at', { ascending: false })
      .limit(200);

    let ok = 0;
    const failed = [];
    for (const o of offers || []) {
      try {
        await refreshOfferDocuments(o.id);
        ok++;
      } catch (e) {
        failed.push(o.id);
      }
    }
    return { refreshedAll: { ok, failed: failed.length, total: (offers || []).length } };
  },

  delete: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') || '');
    try {
      await deleteOffer(id);
      return { deleted: true };
    } catch (e) {
      return fail(400, { error: e?.message || 'Błąd usuwania' });
    }
  }
};
