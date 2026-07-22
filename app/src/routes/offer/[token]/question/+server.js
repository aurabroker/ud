import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { isVerified } from '$lib/server/clientAuth.js';
import { sendEmail } from '$lib/server/email.js';
import { clientQuestionEmail } from '$lib/server/templates.js';

export async function POST({ params, request, cookies }) {
  const { question, email } = await request.json().catch(() => ({}));
  const text = String(question || '').trim();
  if (text.length < 3) return json({ ok: false, error: 'Wpisz treść pytania.' }, { status: 400 });
  if (text.length > 2000) return json({ ok: false, error: 'Pytanie jest zbyt długie.' }, { status: 400 });

  const sb = createAdminClient();
  const { data: offer } = await sb
    .from('ud_offers')
    .select('id, name, client_name, client_email, user_id')
    .eq('share_token', params.token)
    .maybeSingle();
  if (!offer) return json({ ok: false, error: 'Oferta nie istnieje.' }, { status: 404 });
  if (!(await isVerified(cookies, offer.id))) return json({ ok: false, error: 'Wymagane hasło.' }, { status: 403 });

  const clientEmail = String(email || offer.client_email || '').trim() || null;

  // Adres agenta z profilu (auth.users)
  let agentEmail = null;
  const { data: agent } = await sb.auth.admin.getUserById(offer.user_id).catch(() => ({ data: null }));
  if (agent?.user?.email) agentEmail = agent.user.email;

  let notified = false;
  if (agentEmail) {
    const res = await sendEmail({
      to: agentEmail,
      replyTo: clientEmail || undefined,
      subject: `Pytanie od klienta — ${offer.name}`,
      html: clientQuestionEmail({ clientName: offer.client_name, offerName: offer.name, question: text, clientEmail })
    });
    notified = !!res.sent;
  }

  await sb.from('ud_offer_questions').insert({
    offer_id: offer.id,
    question: text,
    client_email: clientEmail,
    notified_agent: notified
  });

  return json({ ok: true });
}
