import { error, fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { sendOfferToClient, deleteOffer, deleteOfferDocument } from '$lib/server/offers.js';
import { env as pubEnv } from '$env/dynamic/public';

export async function load({ params, locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const sb = createAdminClient();
  const { data: offer } = await sb.from('ud_offers').select('*').eq('id', params.id).maybeSingle();
  if (!offer) throw error(404, 'Oferta nie znaleziona');

  const [{ data: documents }, { data: files }, { data: questions }, { data: pin }, { data: clients }] =
    await Promise.all([
      sb.from('ud_offer_documents').select('*').eq('offer_id', offer.id).order('sort_order'),
      sb.from('ud_offer_files').select('*').eq('offer_id', offer.id),
      sb.from('ud_offer_questions').select('*').eq('offer_id', offer.id).order('asked_at', { ascending: false }),
      sb.from('ud_offer_pins').select('expires_at, verified_at, attempts').eq('offer_id', offer.id).maybeSingle(),
      sb.from('ud_clients').select('id, full_name, email, phone').order('created_at', { ascending: false }).limit(500)
    ]);

  const appUrl = (pubEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  return {
    offer,
    documents: documents || [],
    files: files || [],
    questions: questions || [],
    pin,
    clients: clients || [],
    link: `${appUrl}/offer/${offer.share_token}`
  };
}

export const actions = {
  send: async ({ params, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');
    try {
      const res = await sendOfferToClient(params.id);
      return { sent: true, sms: res.sms, email: res.email, pinDev: res.pinDev };
    } catch (e) {
      return fail(400, { error: e?.message || 'Błąd wysyłki' });
    }
  },

  save: async ({ params, request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');
    const form = await request.formData();
    const clientId = String(form.get('clientId') || '').trim() || null;
    const patch = {
      name: String(form.get('name') || '').trim() || 'Oferta',
      client_id: clientId,
      client_name: String(form.get('clientName') || '').trim() || null,
      client_email: String(form.get('clientEmail') || '').trim() || null,
      client_phone: String(form.get('clientPhone') || '').trim() || null,
      broker_message: String(form.get('brokerMessage') || '').trim() || null,
      access_code: String(form.get('accessCode') || '').trim() || null,
      updated_at: new Date().toISOString()
    };
    const sb = createAdminClient();
    const { error: e } = await sb.from('ud_offers').update(patch).eq('id', params.id);
    if (e) return fail(400, { error: 'Zapis: ' + e.message });
    return { saved: true };
  },

  deleteDoc: async ({ params, request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');
    const form = await request.formData();
    const documentId = String(form.get('documentId') || '');
    try {
      await deleteOfferDocument(params.id, documentId);
      return { saved: true };
    } catch (e) {
      return fail(400, { error: e?.message || 'Błąd usuwania wariantu' });
    }
  },

  delete: async ({ params, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');
    try {
      await deleteOffer(params.id);
    } catch (e) {
      return fail(400, { error: e?.message || 'Błąd usuwania' });
    }
    throw redirect(303, '/panel');
  }
};
