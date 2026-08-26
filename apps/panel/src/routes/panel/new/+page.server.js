import { fail, redirect } from '@sveltejs/kit';
import { createOfferFromPdfs } from '$lib/server/offers.js';
import { getSettings } from '$lib/server/settings.js';

export async function load({ locals, url }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const [{ data: clients }, settings] = await Promise.all([
    locals.supabase
      .from('ud_clients')
      .select('id, full_name, email, phone, profession, employment_type')
      .order('created_at', { ascending: false })
      .limit(500),
    getSettings()
  ]);

  return {
    clients: clients || [],
    preselectClientId: url.searchParams.get('client') || '',
    defaultMessage: settings.default_broker_message || ''
  };
}

export const actions = {
  default: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');

    const form = await request.formData();
    const offerName = String(form.get('offerName') || '').trim();
    const clientId = String(form.get('clientId') || '').trim() || null;
    let clientName = String(form.get('clientName') || '').trim();
    let clientEmail = String(form.get('clientEmail') || '').trim();
    let clientPhone = String(form.get('clientPhone') || '').trim();
    const brokerMessage = String(form.get('brokerMessage') || '').trim();
    const pdfPassword = String(form.get('pdfPassword') || '').trim();

    // Jeśli wybrano istniejącego klienta — dane bierzemy z bazy (autorytatywnie),
    // z fallbackiem na to, co agent ewentualnie nadpisał w formularzu.
    if (clientId) {
      const { data: c } = await locals.supabase
        .from('ud_clients')
        .select('full_name, email, phone')
        .eq('id', clientId)
        .maybeSingle();
      if (c) {
        clientName = clientName || c.full_name || '';
        clientEmail = clientEmail || c.email || '';
        clientPhone = clientPhone || c.phone || '';
      }
    }

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
        clientId,
        brokerMessage,
        password: pdfPassword || null,
        files
      });
    } catch (e) {
      return fail(400, { error: 'Nie udało się przetworzyć: ' + (e?.message || e) });
    }

    throw redirect(303, `/panel/offer/${result.offerId}`);
  }
};
