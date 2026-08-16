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
import { resolveOwus } from './owuMatch.js';
import { buildSummaryDocDefinition } from './pdf/summaryDoc.js';
import { renderPdf, fetchLogo } from './pdf/engine.js';
import { getSettings } from './settings.js';
import { clientBaseUrl } from './appUrl.js';
import { env } from '$env/dynamic/private';

const BUCKET = 'ud-offers';

/** Inicjały agenta z pełnego imienia i nazwiska (np. "Jan Kowalski" -> "JK"). */
function initialsFrom(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'XX';
  const ini = (parts[0][0] || '') + (parts[1]?.[0] || parts[0][1] || 'X');
  return ini.toUpperCase();
}

/** Nazwisko klienta = ostatni człon. */
function surnameFrom(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Numer oferty: UD/{rok}/{inicjały agenta}/{00042}[/{nazwisko}]
 */
async function generateOfferNumber(sb, agentUserId, clientName) {
  const { data: prof } = await sb.from('ud_user_profiles').select('full_name').eq('id', agentUserId).maybeSingle();
  const initials = initialsFrom(prof?.full_name);
  const { data: seq } = await sb.rpc('ud_next_offer_seq');
  const n = String(seq ?? 0).padStart(5, '0');
  const year = new Date().getFullYear();
  const surname = surnameFrom(clientName);
  let num = `UD/${year}/${initials}/${n}`;
  if (surname) num += `/${surname}`;
  return num;
}

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

  // Kod dostępu = hasło PDF (jeśli podane) albo losowy 4-cyfrowy.
  // Ten sam kod odblokowuje link do oferty i otwiera pobrane pliki PDF.
  const accessCode = (p.password && /^\d{4,}$/.test(p.password)) ? p.password : generatePin();
  const offerNumber = await generateOfferNumber(sb, p.agentUserId, p.clientName);

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
      offer_number: offerNumber,
      source: 'pdf_import',
      status: 'draft',
      data: {}
    })
    .select()
    .single();
  if (offerErr) throw new Error('Zapis oferty: ' + offerErr.message);

  const documents = [];
  const insurerTypes = new Set();

  // 2) Każdy PDF osobno: parsowanie -> zapis -> upload -> zwolnienie bajtów.
  //    Trzymanie wszystkich PDF-ów naraz przekraczało limit pamięci Workera (503).
  for (let i = 0; i < p.files.length; i++) {
    const f = p.files[i];
    let res;
    try {
      res = await parseOfferPdf(f.bytes, { password: p.password || f.password });
    } catch (e) {
      await deleteOffer(offer.id).catch(() => {}); // nie zostawiaj osieroconej oferty
      const name = e?.name || '';
      if (name === 'PasswordException' || /password/i.test(e?.message || '')) {
        throw new Error(
          `Plik „${f.name}" jest zabezpieczony hasłem${p.password ? ', a podane hasło jest błędne' : ' — podaj 4-cyfrowe hasło'}.`
        );
      }
      throw new Error(`Nie udało się odczytać „${f.name}": ${e?.message || e}`);
    }
    const { offer: parsed, insurer_type } = res;
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
    f.bytes = null; // zwolnij pamięć przed kolejnym plikiem
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
    const owus = resolveOwus(owuCache[doc.insurer_type], doc);
    for (const owu of owus) {
      if (attachedOwu.has(owu.storage_path)) continue;
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

  // 4) Brandowane podsumowanie PDF (pdfmake) — do pobrania przez klienta.
  //    Odporne: brak klucza / błąd nie przerywa tworzenia oferty.
  try {
    const settings = await getSettings();
    let employmentType = '';
    if (p.clientId) {
      const { data: cl } = await sb.from('ud_clients').select('employment_type').eq('id', p.clientId).maybeSingle();
      employmentType = cl?.employment_type || '';
    }
    const docDef = buildSummaryDocDefinition({
      clientName: p.clientName,
      documents,
      logo: await fetchLogo(settings.logo_url || ''),
      footerText: settings.pdf_footer || '',
      employmentType,
      offerNumber
    });
    const pdf = await renderPdf(docDef);
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
    console.warn('[pdf] podsumowanie nie wygenerowane:', e?.message || e);
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

  // Następny sort_order
  const { data: last } = await sb
    .from('ud_offer_documents')
    .select('sort_order')
    .eq('offer_id', offerId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  let sort = (last?.sort_order ?? -1) + 1;

  // Przetwarzamy plik po pliku: parsowanie -> zapis -> upload -> zwolnienie bajtów.
  // Trzymanie wszystkich PDF-ów i wyników parsowania naraz przekraczało limit
  // pamięci Workera przy większej liczbie wariantów (błąd 503).
  const newDocs = [];
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
    const { offer: parsed, insurer_type } = res;

    const { data: doc, error: docErr } = await sb
      .from('ud_offer_documents')
      .insert({ offer_id: offerId, sort_order: sort++, source_filename: f.name, ...parsed })
      .select()
      .single();
    if (docErr) throw new Error('Zapis dokumentu: ' + docErr.message);

    const storagePath = `${offerId}/${doc.id}.pdf`;
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, f.bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) throw new Error(`Upload „${f.name}": ${upErr.message}`);

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
    f.bytes = null; // zwolnij pamięć przed kolejnym plikiem
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
    const owus = resolveOwus(owuCache[doc.insurer_type], doc);
    for (const owu of owus) {
      if (attached.has(owu.storage_path)) continue;
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

/**
 * Dodaje do oferty dowolny plik PDF (załącznik) — bez parsowania.
 * Trafia do dokumentów widocznych dla klienta jako file_type='attachment'.
 * @param {string} offerId
 * @param {Array<{name: string, bytes: Uint8Array}>} files
 */
export async function addAttachmentsToOffer(offerId, files) {
  const sb = createAdminClient();
  const { data: offer, error } = await sb.from('ud_offers').select('id').eq('id', offerId).single();
  if (error || !offer) throw new Error('Oferta nie znaleziona');

  let added = 0;
  for (const f of files) {
    const safe = String(f.name || 'zalacznik.pdf')
      .replace(/\.pdf$/i, '')
      .replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._-]+/g, '_')
      .slice(0, 60) || 'zalacznik';
    const storagePath = `${offerId}/zalaczniki/${Date.now()}-${safe}.pdf`;

    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, f.bytes, { contentType: 'application/pdf', upsert: false });
    if (upErr) throw new Error(`Upload „${f.name}": ${upErr.message}`);

    const { error: insErr } = await sb.from('ud_offer_files').insert({
      offer_id: offerId,
      file_type: 'attachment',
      file_name: f.name || 'Załącznik.pdf',
      storage_bucket: BUCKET,
      storage_path: storagePath,
      size_bytes: f.bytes.byteLength
    });
    if (insErr) throw new Error(`Zapis „${f.name}": ${insErr.message}`);
    added++;
  }
  return { ok: true, added };
}

/**
 * Odświeża ofertę: ponownie parsuje zapisane PDF-y (hasłem oferty), aktualizuje
 * owu_symbol/parsed_raw i podpina brakujące OWU (baza + Karta + rider HIV/WZW),
 * następnie regeneruje podsumowanie. Naprawia stare oferty bez podpiętych OWU.
 */
export async function refreshOfferDocuments(offerId) {
  const sb = createAdminClient();
  const { data: offer } = await sb.from('ud_offers').select('access_code').eq('id', offerId).single();
  const password = offer?.access_code || undefined;

  const { data: docs } = await sb.from('ud_offer_documents').select('*').eq('offer_id', offerId).order('sort_order');
  const documents = [];
  const errors = [];
  let reparsed = 0;

  for (const doc of docs || []) {
    const { data: pdfFile } = await sb
      .from('ud_offer_files')
      .select('storage_bucket, storage_path')
      .eq('offer_id', offerId)
      .eq('document_id', doc.id)
      .eq('file_type', 'offer_pdf')
      .maybeSingle();

    let merged = doc;
    const nazwa = doc.source_filename || doc.id;
    if (!pdfFile?.storage_path) {
      errors.push(`${nazwa}: brak zapisanego pliku PDF oferty`);
    } else {
      try {
        const { data: blob, error: dlErr } = await sb.storage
          .from(pdfFile.storage_bucket || BUCKET)
          .download(pdfFile.storage_path);
        if (dlErr || !blob) throw new Error('nie udało się pobrać pliku ze storage');

        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { offer: parsed, insurer_type } = await parseOfferPdf(bytes, { password });
        // Zapisujemy WSZYSTKIE sparsowane pola (pokrycia, sumy, składki, OWU),
        // tak samo jak przy pierwszym imporcie — inaczej stare wartości zostają w bazie.
        // `parsed` zawiera wyłącznie kolumny modelu oferty, więc nie nadpisuje
        // offer_id / sort_order / source_filename / storage_path.
        const { error: upErr } = await sb.from('ud_offer_documents').update({ ...parsed }).eq('id', doc.id);
        if (upErr) throw new Error('zapis do bazy: ' + upErr.message);

        merged = { ...doc, ...parsed, insurer_type };
        reparsed++;
      } catch (e) {
        errors.push(`${nazwa}: ${e?.message || 'błąd odczytu PDF'}`);
      }
    }
    documents.push(merged);
  }

  // Podepnij brakujące OWU (dedup względem już podpiętych).
  const { data: existingOwu } = await sb.from('ud_offer_files').select('storage_path').eq('offer_id', offerId).eq('file_type', 'owu');
  const attached = new Set((existingOwu || []).map((r) => r.storage_path));
  const owuCache = {};
  let addedOwu = 0;
  for (const doc of documents) {
    if (!owuCache[doc.insurer_type]) {
      const { data } = await sb.from('ud_owu_library').select('*').eq('insurer_type', doc.insurer_type).eq('active', true);
      owuCache[doc.insurer_type] = data || [];
    }
    for (const owu of resolveOwus(owuCache[doc.insurer_type], doc)) {
      if (attached.has(owu.storage_path)) continue;
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
      addedOwu++;
    }
  }

  await regenerateSummary(sb, offerId);
  return { ok: true, docs: (docs || []).length, reparsed, addedOwu, errors };
}

/** Regeneruje podsumowanie PDF z wszystkich wariantów oferty (usuwa stare). */
async function regenerateSummary(sb, offerId) {
  try {
    const { data: offer } = await sb
      .from('ud_offers')
      .select('name, client_name, client_id, offer_number')
      .eq('id', offerId)
      .single();
    const { data: documents } = await sb.from('ud_offer_documents').select('*').eq('offer_id', offerId).order('sort_order');
    // Bez wariantów nie ma czego porównywać — pomijamy generowanie PDF.
    if (!documents || documents.length === 0) return;

    let employmentType = '';
    if (offer?.client_id) {
      const { data: cl } = await sb.from('ud_clients').select('employment_type').eq('id', offer.client_id).maybeSingle();
      employmentType = cl?.employment_type || '';
    }

    // usuń stare podsumowanie
    const { data: old } = await sb.from('ud_offer_files').select('id, storage_path').eq('offer_id', offerId).eq('file_type', 'summary');
    for (const o of old || []) {
      await sb.storage.from(BUCKET).remove([o.storage_path]).catch(() => {});
      await sb.from('ud_offer_files').delete().eq('id', o.id);
    }

    const settings = await getSettings();
    const docDef = buildSummaryDocDefinition({
      clientName: offer?.client_name,
      documents: documents || [],
      logo: await fetchLogo(settings.logo_url || ''),
      footerText: settings.pdf_footer || '',
      employmentType,
      offerNumber: offer?.offer_number || ''
    });
    const pdf = await renderPdf(docDef);
    if (pdf.ok && pdf.buffer) {
      const path = `${offerId}/podsumowanie.pdf`;
      const bytes = new Uint8Array(pdf.buffer);
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (!upErr) {
        const surname = String(offer?.client_name || '').trim().split(/\s+/).filter(Boolean).pop() || '';
        const summaryName = (surname ? `${surname} - podsumowanie oferty` : 'Podsumowanie oferty') + '.pdf';
        await sb.from('ud_offer_files').insert({
          offer_id: offerId,
          file_type: 'summary',
          file_name: summaryName,
          storage_bucket: BUCKET,
          storage_path: path,
          size_bytes: bytes.byteLength
        });
      }
    }
  } catch (e) {
    console.warn('[pdf] regeneracja podsumowania:', e?.message || e);
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

  const link = `${clientBaseUrl()}/offer/${offer.share_token}`;

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
 * Zwraca signed URL do PDF podsumowania. ZAWSZE regeneruje, żeby PDF
 * odzwierciedlał aktualne ustawienia (stopka, logo).
 * @returns {Promise<string|null>} null gdy nie da się wygenerować
 */
export async function ensureSummaryUrl(offerId) {
  const sb = createAdminClient();
  await regenerateSummary(sb, offerId);
  const { data: file } = await sb
    .from('ud_offer_files')
    .select('storage_bucket, storage_path')
    .eq('offer_id', offerId)
    .eq('file_type', 'summary')
    .maybeSingle();
  if (!file) return null;
  const { data, error } = await sb.storage.from(file.storage_bucket).createSignedUrl(file.storage_path, 300);
  if (error) return null;
  return data.signedUrl;
}

// Przykładowe warianty do wzorca PDF (podgląd ustawień: stopka, logo).
const SAMPLE_DOCS = [
  {
    insurer_type: 'leadenhall', offer_number: 'LHQ0000000/1', insurance_period: '12 miesięcy',
    death_covered: false, temp_incapacity_covered: true, temp_monthly_benefit: 10000,
    temp_sum_insured: null, temp_daily_cap: null, perm_incapacity_covered: false,
    perm_sum_insured: 240000, indemnity_period: '24 miesiące', wait_accident: 14, wait_illness: 21,
    premium_total: 3036, premium_monthly: 253
  },
  {
    insurer_type: 'ceu', offer_number: 'LOIP/0000/000000', insurance_period: '12 miesięcy',
    death_covered: false, temp_incapacity_covered: true, temp_monthly_benefit: 16700,
    temp_sum_insured: 392450, temp_daily_cap: 5000, perm_incapacity_covered: true,
    perm_sum_insured: 2400000, indemnity_period: '24 miesiące', wait_accident: 14, wait_illness: 21,
    premium_total: 13464.96, premium_monthly: 1122.08
  }
];

/**
 * Regeneruje wzorzec PDF (podgląd) z aktualnych ustawień (stopka, logo).
 * Zapisuje do publicznego bucketa i zapisuje URL w ud_settings.sample_pdf_url.
 * @returns {Promise<string|null>}
 */
export async function regenerateSamplePdf() {
  const sb = createAdminClient();
  const settings = await getSettings();
  const docDef = buildSummaryDocDefinition({
    clientName: 'Jan Kowalski (wzór)',
    documents: SAMPLE_DOCS,
    logo: await fetchLogo(settings.logo_url || ''),
    footerText: settings.pdf_footer || '',
    employmentType: 'uop',
    offerNumber: 'UD/2026/AD/00042/Kowalski'
  });
  const pdf = await renderPdf(docDef);
  if (!pdf.ok || !pdf.buffer) return null;

  const path = 'wzorzec.pdf';
  const { error: upErr } = await sb.storage
    .from('ud-public')
    .upload(path, new Uint8Array(pdf.buffer), { contentType: 'application/pdf', upsert: true });
  if (upErr) return null;

  const { data: pub } = sb.storage.from('ud-public').getPublicUrl(path);
  const url = `${pub.publicUrl}?t=${Date.now()}`; // cache-bust
  await sb.from('ud_settings').upsert(
    { key: 'sample_pdf_url', value: url, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  return url;
}

/** Signed URL do pobrania pliku oferty (5 min). */
export async function signedFileUrl(bucket, path, expiresIn = 300) {
  const sb = createAdminClient();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw new Error('Signed URL: ' + error.message);
  return data.signedUrl;
}
