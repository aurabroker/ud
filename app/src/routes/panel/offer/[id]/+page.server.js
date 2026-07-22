import { error, fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { sendOfferToClient } from '$lib/server/offers.js';
import { env as pubEnv } from '$env/dynamic/public';

export async function load({ params, locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const sb = createAdminClient();
  const { data: offer } = await sb.from('ud_offers').select('*').eq('id', params.id).maybeSingle();
  if (!offer) throw error(404, 'Oferta nie znaleziona');

  const [{ data: documents }, { data: files }, { data: questions }, { data: pin }] = await Promise.all([
    sb.from('ud_offer_documents').select('*').eq('offer_id', offer.id).order('sort_order'),
    sb.from('ud_offer_files').select('*').eq('offer_id', offer.id),
    sb.from('ud_offer_questions').select('*').eq('offer_id', offer.id).order('asked_at', { ascending: false }),
    sb.from('ud_offer_pins').select('expires_at, verified_at, attempts').eq('offer_id', offer.id).maybeSingle()
  ]);

  const appUrl = (pubEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  return {
    offer,
    documents: documents || [],
    files: files || [],
    questions: questions || [],
    pin,
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
  }
};
