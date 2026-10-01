import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { isVerified } from '$lib/server/clientAuth.js';
import { sendEmail } from '$lib/server/email.js';

export async function POST({ params, request, cookies }) {
  const body = await request.json().catch(() => ({}));
  const action = body.action; // 'choose' | 'reject'
  const documentId = body.documentId || null;

  const sb = createAdminClient();
  const { data: offer } = await sb
    .from('ud_offers')
    .select('id, name, client_name, user_id')
    .eq('share_token', params.token)
    .maybeSingle();
  if (!offer) return json({ ok: false, error: 'Oferta nie istnieje.' }, { status: 404 });
  if (!(await isVerified(cookies, offer.id))) return json({ ok: false, error: 'Wymagane hasło.' }, { status: 403 });

  let choice;
  let status;
  if (action === 'reject') {
    choice = { rejected: true, rejected_at: new Date().toISOString() };
    status = 'rejected';
  } else if (action === 'choose' && documentId) {
    const { data: doc } = await sb
      .from('ud_offer_documents')
      .select('id, insurer_type, offer_number, product_name')
      .eq('id', documentId)
      .eq('offer_id', offer.id)
      .maybeSingle();
    if (!doc) return json({ ok: false, error: 'Nieprawidłowy wariant.' }, { status: 400 });
    choice = {
      document_id: doc.id,
      insurer_type: doc.insurer_type,
      insurer_name: doc.product_name || doc.insurer_type,
      offer_number: doc.offer_number,
      chosen_at: new Date().toISOString()
    };
    status = 'chosen';
  } else {
    return json({ ok: false, error: 'Nieprawidłowa akcja.' }, { status: 400 });
  }

  await sb
    .from('ud_offers')
    .update({ client_choice: choice, status, decided_at: new Date().toISOString() })
    .eq('id', offer.id);

  // Powiadom agenta
  const { data: agent } = await sb.auth.admin.getUserById(offer.user_id).catch(() => ({ data: null }));
  if (agent?.user?.email) {
    const msg =
      status === 'rejected'
        ? `Klient ${offer.client_name || ''} zrezygnował z oferty „${offer.name}".`
        : `Klient ${offer.client_name || ''} wybrał wariant: ${choice.insurer_name} (oferta „${offer.name}").`;
    await sendEmail({
      to: agent.user.email,
      subject: `Decyzja klienta — ${offer.name}`,
      html: `<p>${msg}</p>`
    });
  }

  return json({ ok: true, status });
}
