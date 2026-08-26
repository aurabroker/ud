import { error } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { isVerified } from '$lib/server/clientAuth.js';
import { getSettings } from '$lib/server/settings.js';
import { OFFER_CONDITIONS_HTML } from '$lib/server/offerConditions.js';

export async function load({ params, cookies }) {
  const sb = createAdminClient();
  const { data: offer } = await sb
    .from('ud_offers')
    .select('id, name, offer_number, client_name, broker_message, share_token, status, client_choice')
    .eq('share_token', params.token)
    .maybeSingle();

  if (!offer) throw error(404, 'Oferta nie istnieje lub link wygasł.');

  const verified = await isVerified(cookies, offer.id);

  if (!verified) {
    // Minimalny payload — bez danych oferty dopóki brak PIN
    return {
      token: params.token,
      requiresPin: true,
      clientName: offer.client_name,
      offerName: offer.name
    };
  }

  // Zweryfikowany — pełne dane + oznacz jako otwarte
  if (offer.status === 'sent') {
    await sb.from('ud_offers').update({ status: 'viewed', viewed_at: new Date().toISOString() }).eq('id', offer.id);
  }

  const [{ data: documents }, { data: files }, settings] = await Promise.all([
    sb.from('ud_offer_documents').select('*').eq('offer_id', offer.id).order('sort_order'),
    sb.from('ud_offer_files').select('id, file_type, file_name, insurer_type').eq('offer_id', offer.id),
    getSettings()
  ]);

  return {
    token: params.token,
    requiresPin: false,
    offer: {
      id: offer.id,
      name: offer.name,
      offer_number: offer.offer_number,
      client_name: offer.client_name,
      broker_message: offer.broker_message,
      status: offer.status,
      client_choice: offer.client_choice
    },
    documents: documents || [],
    files: files || [],
    conditionsHtml: OFFER_CONDITIONS_HTML,
    distributorPdf: settings.distributor_pdf_path
      ? { name: settings.distributor_pdf_name || 'Informacja o dystrybutorze.pdf' }
      : null
  };
}
