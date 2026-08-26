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
    let reparsed = 0;
    let docs = 0;
    let addedOwu = 0;
    const errors = [];
    for (const o of offers || []) {
      try {
        const r = await refreshOfferDocuments(o.id);
        ok++;
        reparsed += r.reparsed || 0;
        docs += r.docs || 0;
        addedOwu += r.addedOwu || 0;
        for (const e of r.errors || []) errors.push(e);
      } catch (e) {
        errors.push(`Oferta ${o.id}: ${e?.message || 'błąd'}`);
      }
    }
    return { refreshedAll: { ok, total: (offers || []).length, reparsed, docs, addedOwu, errors: errors.slice(0, 20) } };
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
