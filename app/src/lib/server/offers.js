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
import { buildOfferSummaryHtml } from './summaryHtml.js';
import { htmlToPdf } from './pdfshift.js';
import { getSettings } from './settings.js';
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
 * @param {string} [p.password] - hasło do zaszyfrowanych PDF (np. Leadenhall)
 * @param {Array<{ name: string, bytes: Uint8Array, password?: string }>} p.files
 * @returns {Promise<{ offerId: string, shareToken: string, documents: any[] }>}
 */
export async function createOfferFromPdfs(p) {
  const sb = createAdminClient();
  const shareToken = generateShareToken();

  // 0) Najpierw sparsuj WSZYSTKIE pliki (z hasłem) — zanim cokolwiek zapiszemy.
  //    Dzięki temu błąd hasła nie zostawia osieroconej oferty.
  const parsedFiles = [];
  for (const f of p.files) {
    let res;
    try {
      res = await parseOfferPdf(f.bytes, { password: p.password || f.password });
    } catch (e) {
      const name = e?.name || '';
      if (name === 'PasswordException' || /password/i.test(e?.message || '')) {
        throw new Error(
          `Plik „${f.name}" jest zabezpieczony hasłem${p.password ? ', a podane hasło jest błędne' : ' — podaj 4-cyfrowe hasło'}.`
        );
      }
      throw new Error(`Nie udało się odczytać „${f.name}": ${e?.message || e}`);
    }
    parsedFiles.push({ file: f, parsed: res.offer, insurer_type: res.insurer_type });
  }

  // Kod dostępu = hasło PDF (jeśli podane) albo losowy 4-cyfrowy.
  // Ten sam kod odblokowuje link do oferty i otwiera pobrane pliki PDF.
  const accessCode = (p.password && /^\d{4,}$/.test(p.password)) ? p.password : generatePin();

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
      access_code: accessCode,
      source: 'pdf_import',
      status: 'draft',
      data: {}
    })
    .select()
    .single();
  if (offerErr) throw new Error('Zapis oferty: ' + offerErr.message);

  const documents = [];
  const insurerTypes = new Set();

  // 2) Każdy PDF: zapis -> upload -> ud_offer_documents + ud_offer_files
  for (let i = 0; i < parsedFiles.length; i++) {
    const { file: f, parsed, insurer_type } = parsedFiles[i];
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

  // 4) Brandowane podsumowanie PDF (PDFShift) — do pobrania przez klienta.
  //    Odporne: brak klucza / błąd nie przerywa tworzenia oferty.
  try {
    const settings = await getSettings();
    const html = buildOfferSummaryHtml({
      clientName: p.clientName,
      offerName: p.offerName,
      documents,
      logoUrl: settings.logo_url || '',
      footerText: settings.pdf_footer || ''
    });
    const pdf = await htmlToPdf(html);
    if (pdf.ok && pdf.buffer) {
      const path = `${offer.id}/podsumowanie.pdf`;
      const bytes = new Uint8Array(pdf.buffer);
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (!upErr) {
        await sb.from('ud_offer_files').insert({
          offer_id: offer.id,
          file_type: 'summary',
          file_name: 'Podsumowanie oferty.pdf',
          storage_bucket: BUCKET,
          storage_path: path,
          size_bytes: bytes.byteLength
        });
      }
    }
  } catch (e) {
    console.warn('[pdfshift] podsumowanie nie wygenerowane:', e?.message || e);
  }

  return { offerId: offer.id, shareToken, documents };
}

/**
 * Dodaje kolejne warianty (pliki PDF) do istniejącej oferty.
 * Parsuje, zapisuje, podpina brakujące OWU i regeneruje podsumowanie.
 * @param {string} offerId
 * @param {Array<{ name: string, bytes: Uint8Array }>} files
 * @param {string|null} [password]
 */
export async function addDocumentsToOffer(offerId, files, password) {
  const sb = createAdminClient();
  const { data: offer, error } = await sb.from('ud_offers').select('*').eq('id', offerId).single();
  if (error || !offer) throw new Error('Oferta nie znaleziona');

  // Parsuj wszystkie przed zapisem (błąd hasła nie zostawia śmieci).
  const parsedFiles = [];
  for (const f of files) {
    let res;
    try {
      res = await parseOfferPdf(f.bytes, { password: password || undefined });
    } catch (e) {
      const name = e?.name || '';
      if (name === 'PasswordException' || /password/i.test(e?.message || '')) {
        throw new Error(`Plik „${f.name}" jest zabezpieczony hasłem${password ? ', a podane hasło jest błędne' : ' — podaj hasło'}.`);
      }
      throw new Error(`Nie udało się odczytać „${f.name}": ${e?.message || e}`);
    }
    parsedFiles.push({ file: f, parsed: res.offer, insurer_type: res.insurer_type });
  }

  // Następny sort_order
  const { data: last } = await sb
    .from('ud_offer_documents')
    .select('sort_order')
    .eq('offer_id', offerId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  let sort = (last?.sort_order ?? -1) + 1;

  const newDocs = [];
  for (const { file: f, parsed, insurer_type } of parsedFiles) {
    const { data: doc, error: docErr } = await sb
      .from('ud_offer_documents')
      .insert({ offer_id: offerId, sort_order: sort++, source_filename: f.name, ...parsed })
      .select()
      .single();
    if (docErr) throw new Error('Zapis dokumentu: ' + docErr.message);

    const storagePath = `${offerId}/${doc.id}.pdf`;
    await sb.storage.from(BUCKET).upload(storagePath, f.bytes, { contentType: 'application/pdf', upsert: true });
    await sb.from('ud_offer_documents').update({ storage_path: storagePath }).eq('id', doc.id);
    await sb.from('ud_offer_files').insert({
      offer_id: offerId,
      document_id: doc.id,
      file_type: 'offer_pdf',
      file_name: f.name,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      insurer_type,
      size_bytes: f.bytes.byteLength
    });
    newDocs.push({ ...doc, insurer_type });
  }

  // OWU dla nowych wariantów (dedup względem już podpiętych).
  const { data: existingOwu } = await sb
    .from('ud_offer_files')
    .select('storage_path')
    .eq('offer_id', offerId)
    .eq('file_type', 'owu');
  const attached = new Set((existingOwu || []).map((r) => r.storage_path));
  const owuCache = {};
  for (const doc of newDocs) {
    if (!owuCache[doc.insurer_type]) {
      const { data } = await sb.from('ud_owu_library').select('*').eq('insurer_type', doc.insurer_type).eq('active', true);
      owuCache[doc.insurer_type] = data || [];
    }
    const owu = pickOwu(owuCache[doc.insurer_type], doc.owu_symbol);
    if (owu && !attached.has(owu.storage_path)) {
      attached.add(owu.storage_path);
      await sb.from('ud_offer_files').insert({
        offer_id: offerId,
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

  await regenerateSummary(sb, offerId);
  return { ok: true, added: newDocs.length };
}

/** Regeneruje podsumowanie PDF z wszystkich wariantów oferty (usuwa stare). */
async function regenerateSummary(sb, offerId) {
  try {
    const { data: offer } = await sb.from('ud_offers').select('name, client_name').eq('id', offerId).single();
    const { data: documents } = await sb.from('ud_offer_documents').select('*').eq('offer_id', offerId).order('sort_order');

    // usuń stare podsumowanie
    const { data: old } = await sb.from('ud_offer_files').select('id, storage_path').eq('offer_id', offerId).eq('file_type', 'summary');
    for (const o of old || []) {
      await sb.storage.from(BUCKET).remove([o.storage_path]).catch(() => {});
      await sb.from('ud_offer_files').delete().eq('id', o.id);
    }

    const settings = await getSettings();
    const html = buildOfferSummaryHtml({
      clientName: offer?.client_name,
      offerName: offer?.name,
      documents: documents || [],
      logoUrl: settings.logo_url || '',
      footerText: settings.pdf_footer || ''
    });
    const pdf = await htmlToPdf(html);
    if (pdf.ok && pdf.buffer) {
      const path = `${offerId}/podsumowanie.pdf`;
      const bytes = new Uint8Array(pdf.buffer);
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (!upErr) {
        await sb.from('ud_offer_files').insert({
          offer_id: offerId,
          file_type: 'summary',
          file_name: 'Podsumowanie oferty.pdf',
          storage_bucket: BUCKET,
          storage_path: path,
          size_bytes: bytes.byteLength
        });
      }
    }
  } catch (e) {
    console.warn('[pdfshift] regeneracja podsumowania:', e?.message || e);
  }
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

  // Jeden kod: access_code (= hasło PDF lub losowy). Odblokowuje link i otwiera pliki.
  let pin = offer.access_code;
  if (!pin) {
    pin = generatePin();
    await sb.from('ud_offers').update({ access_code: pin }).eq('id', offerId);
  }
  const ttlHours = parseInt(env.PIN_TTL_HOURS || '48', 10);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  // Unieważnij poprzednie PIN-y, zapisz nowy (hash tego samego kodu)
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
      `Haslo do oferty: ${pin} (otwiera link i pliki PDF, wazne ${ttlHours}h). Otworz: ${link}`
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

  // Po wysyłce upewnij się, że PDF podsumowania jest wygenerowany (do pobrania).
  await ensureSummaryUrl(offerId).catch(() => {});

  // pinDev zwracany tylko w trybie stub (brak realnej wysyłki), do testów
  const pinDev = sms.stub || email.stub ? pin : undefined;
  return { ok: true, sms, email, pinDev };
}

/**
 * Usuwa ofertę wraz z plikami w Storage (tylko bucket ud-offers — NIE ruszamy
 * współdzielonych OWU z ud-owu). Rekordy potomne kasuje FK ON DELETE CASCADE.
 */
export async function deleteOffer(offerId) {
  const sb = createAdminClient();
  const { data: files } = await sb
    .from('ud_offer_files')
    .select('storage_bucket, storage_path')
    .eq('offer_id', offerId);
  const paths = (files || []).filter((f) => f.storage_bucket === BUCKET).map((f) => f.storage_path);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths).catch(() => {});
  const { error } = await sb.from('ud_offers').delete().eq('id', offerId);
  if (error) throw new Error('Usuwanie oferty: ' + error.message);
  return { ok: true };
}

/** Usuwa pojedynczy wariant (dokument) oferty + jego pliki w ud-offers. */
export async function deleteOfferDocument(offerId, documentId) {
  const sb = createAdminClient();
  const { data: files } = await sb
    .from('ud_offer_files')
    .select('storage_bucket, storage_path')
    .eq('offer_id', offerId)
    .eq('document_id', documentId);
  const paths = (files || []).filter((f) => f.storage_bucket === BUCKET).map((f) => f.storage_path);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths).catch(() => {});
  await sb.from('ud_offer_documents').delete().eq('id', documentId).eq('offer_id', offerId);
  return { ok: true };
}

/**
 * Zwraca signed URL do PDF podsumowania; generuje go, jeśli jeszcze nie istnieje.
 * @returns {Promise<string|null>} null gdy nie da się wygenerować (brak PDFShift)
 */
export async function ensureSummaryUrl(offerId) {
  const sb = createAdminClient();
  let { data: file } = await sb
    .from('ud_offer_files')
    .select('storage_bucket, storage_path')
    .eq('offer_id', offerId)
    .eq('file_type', 'summary')
    .maybeSingle();

  if (!file) {
    await regenerateSummary(sb, offerId);
    ({ data: file } = await sb
      .from('ud_offer_files')
      .select('storage_bucket, storage_path')
      .eq('offer_id', offerId)
      .eq('file_type', 'summary')
      .maybeSingle());
  }
  if (!file) return null;
  const { data, error } = await sb.storage.from(file.storage_bucket).createSignedUrl(file.storage_path, 300);
  if (error) return null;
  return data.signedUrl;
}

/** Signed URL do pobrania pliku oferty (5 min). */
export async function signedFileUrl(bucket, path, expiresIn = 300) {
  const sb = createAdminClient();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw new Error('Signed URL: ' + error.message);
  return data.signedUrl;
}
