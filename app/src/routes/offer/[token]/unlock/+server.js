import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { verifyPin, hashPin } from '$lib/server/crypto.js';
import { setVerifiedCookie } from '$lib/server/clientAuth.js';

export async function POST({ params, request, cookies }) {
  const { pin } = await request.json().catch(() => ({}));
  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return json({ ok: false, error: 'Podaj 4-cyfrowe hasło.' }, { status: 400 });
  }

  const sb = createAdminClient();
  const { data: offer } = await sb
    .from('ud_offers')
    .select('id, share_token, access_code')
    .eq('share_token', params.token)
    .maybeSingle();
  if (!offer) return json({ ok: false, error: 'Oferta nie istnieje.' }, { status: 404 });

  let { data: pinRow } = await sb
    .from('ud_offer_pins')
    .select('*')
    .eq('offer_id', offer.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Lazy-provision: link bywa udostępniany ręcznie (Kopiuj → email), zanim agent
  // kliknie „Wyślij". Jeśli oferta ma już kod dostępu (access_code = hasło PDF),
  // tworzymy aktywne hasło w locie — link działa od razu, a limit prób nadal obowiązuje.
  const isValidCode = offer.access_code && /^\d{4}$/.test(String(offer.access_code));
  if ((!pinRow || new Date(pinRow.expires_at) < new Date()) && isValidCode) {
    await sb.from('ud_offer_pins').delete().eq('offer_id', offer.id);
    const expiresAt = new Date(Date.now() + 720 * 3600 * 1000).toISOString(); // 30 dni
    const { data: fresh } = await sb
      .from('ud_offer_pins')
      .insert({ offer_id: offer.id, pin_hash: await hashPin(String(offer.access_code)), expires_at: expiresAt })
      .select('*')
      .single();
    pinRow = fresh;
  }

  if (!pinRow) return json({ ok: false, error: 'Brak aktywnego hasła. Ustaw kod dostępu w panelu lub wyślij ofertę.' }, { status: 400 });
  if (new Date(pinRow.expires_at) < new Date()) {
    return json({ ok: false, error: 'Hasło wygasło. Poproś agenta o nowe.' }, { status: 400 });
  }
  if (pinRow.attempts >= pinRow.max_attempts) {
    return json({ ok: false, error: 'Przekroczono liczbę prób. Poproś agenta o nowe hasło.' }, { status: 429 });
  }

  const good = await verifyPin(String(pin), pinRow.pin_hash);
  if (!good) {
    const attempts = pinRow.attempts + 1;
    await sb.from('ud_offer_pins').update({ attempts }).eq('id', pinRow.id);
    const left = pinRow.max_attempts - attempts;
    return json(
      { ok: false, error: left > 0 ? `Błędne hasło. Pozostało prób: ${left}.` : 'Błędne hasło. Brak kolejnych prób.' },
      { status: 401 }
    );
  }

  const ttlHours = Math.max(1, Math.ceil((new Date(pinRow.expires_at) - new Date()) / 3600000));
  await setVerifiedCookie(cookies, offer.id, offer.share_token, ttlHours);
  await sb.from('ud_offer_pins').update({ verified_at: new Date().toISOString() }).eq('id', pinRow.id);

  return json({ ok: true });
}
