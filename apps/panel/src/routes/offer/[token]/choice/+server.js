import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { isVerified } from '$lib/server/clientAuth.js';
import { sendEmail } from '$lib/server/email.js';
import { clientBaseUrl } from '$lib/server/appUrl.js';
import { krotkiOpis } from '$lib/wybranyWariant.js';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
  let wariant = null;
  if (action === 'reject') {
    choice = { rejected: true, rejected_at: new Date().toISOString() };
    status = 'rejected';
  } else if (action === 'choose' && documentId) {
    const { data: doc } = await sb
      .from('ud_offer_documents')
      .select('id, insurer_type, offer_number, product_name, temp_monthly_benefit, indemnity_period, wait_accident, wait_illness, premium_total')
      .eq('id', documentId)
      .eq('offer_id', offer.id)
      .maybeSingle();
    if (!doc) return json({ ok: false, error: 'Nieprawidłowy wariant.' }, { status: 400 });
    wariant = doc;
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

  // Powiadom agenta. Sama nazwa produktu nic nie mówi — w jednej ofercie
  // wszystkie warianty są zwykle tego samego produktu — więc mail niesie
  // numer wariantu i jego kwoty, a do tego link do oferty w panelu.
  const { data: agent } = await sb.auth.admin.getUserById(offer.user_id).catch(() => ({ data: null }));
  if (agent?.user?.email) {
    const kto = esc(offer.client_name || 'Klient');
    const link = `${clientBaseUrl()}/panel/offer/${offer.id}`;
    const msg =
      status === 'rejected'
        ? `${kto} zrezygnował(a) z oferty „${esc(offer.name)}".`
        : `${kto} wybrał(a) wariant <strong>${esc(krotkiOpis(wariant))}</strong> w ofercie „${esc(offer.name)}".`;
    await sendEmail({
      to: agent.user.email,
      subject: `Decyzja klienta — ${offer.name}`,
      html: `<p>${msg}</p><p><a href="${esc(link)}">Otwórz ofertę w panelu</a></p>`
    });
  }

  return json({ ok: true, status });
}
