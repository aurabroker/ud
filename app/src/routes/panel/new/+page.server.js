import { fail, redirect } from '@sveltejs/kit';
import { createOfferFromPdfs } from '$lib/server/offers.js';

export const actions = {
  default: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');

    const form = await request.formData();
    const offerName = String(form.get('offerName') || '').trim();
    const clientName = String(form.get('clientName') || '').trim();
    const clientEmail = String(form.get('clientEmail') || '').trim();
    const clientPhone = String(form.get('clientPhone') || '').trim();
    const brokerMessage = String(form.get('brokerMessage') || '').trim();

    const uploads = form.getAll('pdfs').filter((f) => f && typeof f === 'object' && f.size > 0);
    if (uploads.length === 0) return fail(400, { error: 'Dodaj przynajmniej jeden plik PDF.' });

    const files = [];
    for (const f of uploads) {
      if (f.type && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
        return fail(400, { error: `Plik „${f.name}" nie jest PDF-em.` });
      }
      files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    }

    let result;
    try {
      result = await createOfferFromPdfs({
        agentUserId: user.id,
        offerName: offerName || clientName || 'Oferta z PDF',
        clientName,
        clientEmail,
        clientPhone,
        brokerMessage,
        files
      });
    } catch (e) {
      return fail(400, { error: 'Nie udało się przetworzyć: ' + (e?.message || e) });
    }

    throw redirect(303, `/panel/offer/${result.offerId}`);
  }
};
