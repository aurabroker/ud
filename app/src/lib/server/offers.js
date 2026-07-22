/**
 * offers.js — logika ofert po stronie serwera (service_role).
 * Tworzenie oferty z PDF, wysyłka do klienta (PIN), pobrania (signed URL).
 */
import { createAdminClient } from './supabase.js';
import { parseOfferPdf } from '$lib/pdf/index.js';
import { generateShareToken, generatePin, hashPin } from './crypto.js';
import { sendSms } from './sms.js';
import { sendEmail } from './email.js';
import { offerLinkEmail } from './templates.js';
import { pickOwu } from './owuMatch.js';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';

const BUCKET = 'ud-offers';

/**
 * Tworzy ofertę z jednego lub wielu PDF-ów (Leadenhall/CEU).
 * @param {Object} p
 * @param {string} p.agentUserId - auth.users.id agenta (właściciel)
 * @param {string} p.offerName
 * @param {string} [p.clientName]
 * @param {string} [p.clientEmail]
 * @param {string} [p.clientPhone]
 * @param {string|null} [p.clientId] - opcjonalne powiązanie z ud_clients
 * @param {string} [p.brokerMessage]
 * @param {Array<{ name: string, bytes: Uint8Array }>} p.files
 * @returns {Promise<{ offerId: string, shareToken: string, documents: any[] }>}
 */
export async function createOfferFromPdfs(p) {
  const sb = createAdminClient();
  const shareToken = generateShareToken();

  // 1) Parent ud_offers
  const { data: offer, error: offerErr } = await sb
    .from('ud_offers')
    .insert({
      user_id: p.agentUserId,
      name: p.offerName || 'Oferta z PDF',
      client_name: p.clientName || null,
      client_id: p.clientId || null,
      client_email: p.clientEmail || null,
      client_phone: p.clientPhone || null,
      broker_message: p.brokerMessage || null,
      share_token: shareToken,
      source: 'pdf_import',
      status: 'draft',
      data: {}
    })
    .select()
    .single();
  if (offerErr) throw new Error('Zapis oferty: ' + offerErr.message);

  const documents = [];
  const insurerTypes = new Set();

  // 2) Każdy PDF: parse -> upload -> ud_offer_documents + ud_offer_files
  for (let i = 0; i < p.files.length; i++) {
    const f = p.files[i];
    const { offer: parsed, insurer_type } = await parseOfferPdf(f.bytes);
    insurerTypes.add(insurer_type);

    const { data: doc, error: docErr } = await sb
      .from('ud_offer_documents')
      .insert({ offer_id: offer.id, sort_order: i, source_filename: f.name, ...parsed })
      .select()
      .single();
    if (docErr) throw new Error('Zapis dokumentu: ' + docErr.message);

    const storagePath = `${offer.id}/${doc.id}.pdf`;
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, f.bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) throw new Error('Upload PDF: ' + upErr.message);

    await sb.from('ud_offer_documents').update({ storage_path: storagePath }).eq('id', doc.id);
    await sb.from('ud_offer_files').insert({
      offer_id: offer.id,
      document_id: doc.id,
      file_type: 'offer_pdf',
      file_name: f.name,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      insurer_type,
      size_bytes: f.bytes.byteLength
    });

    documents.push({ ...doc, storage_path: storagePath, insurer_type });
  }

  // 3) Podepnij właściwe OWU do każdego wariantu — dopasowanie po symbolu.
  //    Leadenhall ma 3 OWU, CEU 2 — oferta wskazuje swój symbol (owu_symbol).
  const attachedOwu = new Set(); // dedup po storage_path
  const owuCache = {}; // insurer_type -> lista aktywnych OWU
  for (const doc of documents) {
    if (!owuCache[doc.insurer_type]) {
      const { data } = await sb
        .from('ud_owu_library')
        .select('*')
        .eq('insurer_type', doc.insurer_type)
        .eq('active', true);
      owuCache[doc.insurer_type] = data || [];
    }
    const owu = pickOwu(owuCache[doc.insurer_type], doc.owu_symbol);
    if (owu && !attachedOwu.has(owu.storage_path)) {
      attachedOwu.add(owu.storage_path);
      await sb.from('ud_offer_files').insert({
        offer_id: offer.id,
        document_id: doc.id,
        file_type: 'owu',
        file_name: owu.file_name || `OWU ${owu.title}.pdf`,
        storage_bucket: owu.storage_bucket,
        storage_path: owu.storage_path,
        insurer_type: doc.insurer_type,
        size_bytes: owu.size_bytes || null
      });
    }
  }

  return { offerId: offer.id, shareToken, documents };
}

/**
 * Generuje PIN, zapisuje hash (48h), wysyła SMS + email z linkiem.
 * @param {string} offerId
 * @returns {Promise<{ ok: boolean, sms: any, email: any, pinDev?: string }>}
 */
export async function sendOfferToClient(offerId) {
  const sb = createAdminClient();
  const { data: offer, error } = await sb.from('ud_offers').select('*').eq('id', offerId).single();
  if (error || !offer) throw new Error('Oferta nie znaleziona');

  const pin = generatePin();
  const ttlHours = parseInt(env.PIN_TTL_HOURS || '48', 10);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  // Unieważnij poprzednie PIN-y, zapisz nowy
  await sb.from('ud_offer_pins').delete().eq('offer_id', offerId);
  await sb.from('ud_offer_pins').insert({
    offer_id: offerId,
    pin_hash: await hashPin(pin),
    expires_at: expiresAt
  });

  const appUrl = (pubEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const link = `${appUrl}/offer/${offer.share_token}`;

  let sms = { sent: false };
  if (offer.client_phone) {
    sms = await sendSms(
      offer.client_phone,
      `Twoje haslo do oferty: ${pin} (wazne ${ttlHours}h). Otworz: ${link}`
    );
  }

  let email = { sent: false };
  if (offer.client_email) {
    email = await sendEmail({
      to: offer.client_email,
      subject: 'Twoja oferta ubezpieczenia utraty dochodu',
      html: offerLinkEmail({ clientName: offer.client_name, link, ttlHours })
    });
  }

  await sb
    .from('ud_offers')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', offerId);

  // pinDev zwracany tylko w trybie stub (brak realnej wysyłki), do testów
  const pinDev = sms.stub || email.stub ? pin : undefined;
  return { ok: true, sms, email, pinDev };
}

/** Signed URL do pobrania pliku oferty (5 min). */
export async function signedFileUrl(bucket, path, expiresIn = 300) {
  const sb = createAdminClient();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw new Error('Signed URL: ' + error.message);
  return data.signedUrl;
}
