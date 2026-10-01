import { error, fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { getSettings } from '$lib/server/settings.js';
import { runHealthChecks } from '$lib/server/health.js';
import { regenerateSamplePdf } from '$lib/server/offers.js';
import { sendEmail, emailConfig } from '$lib/server/email.js';
import { sendSms, smsConfig, smsDiagnostics } from '$lib/server/sms.js';
import { outboundIp } from '$lib/server/netinfo.js';

const PUBLIC_BUCKET = 'ud-public';

async function requireAdmin(locals) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  const sb = createAdminClient();
  const { data: me } = await sb.from('ud_user_profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') throw error(403, 'Tylko administrator.');
  return sb;
}

export async function load({ locals }) {
  await requireAdmin(locals);
  const [settings, health] = await Promise.all([getSettings(), runHealthChecks()]);
  return { settings, health };
}

async function setSetting(sb, key, value) {
  await sb.from('ud_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

export const actions = {
  save: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const form = await request.formData();
    const keys = ['company_name', 'company_full', 'default_broker_message', 'exclusions_text', 'pdf_footer'];
    const rows = keys.map((key) => ({ key, value: String(form.get(key) ?? ''), updated_at: new Date().toISOString() }));
    const { error: e } = await sb.from('ud_settings').upsert(rows, { onConflict: 'key' });
    if (e) return fail(400, { error: 'Zapis: ' + e.message });
    await regenerateSamplePdf().catch(() => {}); // odśwież wzorzec PDF
    return { ok: true };
  },

  uploadLogo: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const form = await request.formData();
    const file = form.get('logo');
    if (!file || typeof file !== 'object' || file.size === 0) return fail(400, { error: 'Wybierz plik logo.' });
    if (!/^image\//.test(file.type || '') && !/\.(png|jpe?g|svg|webp)$/i.test(file.name)) {
      return fail(400, { error: 'Logo musi być obrazem (PNG/JPG/SVG/WEBP).' });
    }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = `logo-${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage
      .from(PUBLIC_BUCKET)
      .upload(path, bytes, { contentType: file.type || 'image/png', upsert: true });
    if (upErr) return fail(400, { error: 'Upload: ' + upErr.message });

    const { data: pub } = sb.storage.from(PUBLIC_BUCKET).getPublicUrl(path);
    await setSetting(sb, 'logo_url', pub.publicUrl);
    await setSetting(sb, 'logo_path', path);
    await regenerateSamplePdf().catch(() => {}); // odśwież wzorzec PDF z nowym logo
    return { ok: true };
  },

  removeLogo: async ({ locals }) => {
    const sb = await requireAdmin(locals);
    const settings = await getSettings();
    if (settings.logo_path) await sb.storage.from(PUBLIC_BUCKET).remove([settings.logo_path]).catch(() => {});
    await setSetting(sb, 'logo_url', '');
    await setSetting(sb, 'logo_path', '');
    await regenerateSamplePdf().catch(() => {}); // odśwież wzorzec PDF bez logo
    return { ok: true };
  },

  // Próbna wysyłka e-maila — pokazuje pełną odpowiedź Resend i zapisuje ją w logu.
  testEmail: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const { user } = await locals.safeGetSession();
    const form = await request.formData();
    const to = String(form.get('testTo') || '').trim() || user?.email || '';
    if (!to) return fail(400, { error: 'Podaj adres e-mail do testu.' });

    const cfg = emailConfig();
    const res = await sendEmail({
      to,
      subject: 'UtrataDochodu — e-mail próbny',
      html: `<p>To jest wiadomość próbna z panelu UtrataDochodu.</p>
             <p>Jeśli ją widzisz, wysyłka e-mail działa poprawnie.</p>
             <p style="color:#64748b;font-size:12px">Nadawca: ${cfg.from}</p>`
    });

    await sb
      .from('ud_send_log')
      .insert({
        offer_id: null,
        user_id: user?.id || null,
        channel: 'email',
        recipient: to,
        status: res.sent ? 'sent' : res.stub ? 'stub' : 'error',
        provider_id: res.id || null,
        error: res.error || null
      })
      .then(() => {}, () => {});

    return { testResult: { to, from: cfg.from, fromIsDefault: cfg.fromIsDefault, hasKey: cfg.hasKey, keyHint: cfg.keyHint, ...res } };
  },

  // Próbna wysyłka SMS — pokazuje pełną odpowiedź SMSAPI i zapisuje ją w logu.
  testSms: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const { user } = await locals.safeGetSession();
    const form = await request.formData();
    const to = String(form.get('testPhone') || '').replace(/[^\d]/g, '');
    if (!to) return fail(400, { error: 'Podaj numer telefonu do testu (np. 48601234567).' });

    const cfg = smsConfig();
    const net = await outboundIp();
    const res = await sendSms(to, 'UtrataDochodu - wiadomosc probna z panelu. Jesli ja widzisz, wysylka SMS dziala.');

    await sb
      .from('ud_send_log')
      .insert({
        offer_id: null,
        user_id: user?.id || null,
        channel: 'sms',
        recipient: to,
        status: res.sent ? 'sent' : res.stub ? 'stub' : 'error',
        provider_id: res.id || null,
        error: res.error || null
      })
      .then(() => {}, () => {});

    return { smsResult: { to, ...cfg, ...res, outIp: net.ip, outIpv4: net.ipv4, outIpv6: net.ipv6, outIpError: net.error || '' } };
  },

  // Diagnostyka SMSAPI — odpytuje /profile i /sms/sendernames.
  // Nic nie wysyła i nic nie kosztuje; rozdziela blokadę IP od problemu konta.
  smsDiag: async ({ locals }) => {
    await requireAdmin(locals);
    const net = await outboundIp();
    const diag = await smsDiagnostics();
    return { smsDiag: { ...diag, ...smsConfig(), outIpv4: net.ipv4, outIpv6: net.ipv6 } };
  },

  uploadDistributor: async ({ request, locals }) => {
    const sb = await requireAdmin(locals);
    const form = await request.formData();
    const file = form.get('distributor');
    if (!file || typeof file !== 'object' || file.size === 0) return fail(400, { error: 'Wybierz plik PDF.' });
    if ((file.type && file.type !== 'application/pdf') && !/\.pdf$/i.test(file.name)) {
      return fail(400, { error: 'Informacja o dystrybutorze musi być plikiem PDF.' });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = `dystrybutor-${Date.now()}.pdf`;
    const { error: upErr } = await sb.storage
      .from(PUBLIC_BUCKET)
      .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) return fail(400, { error: 'Upload: ' + upErr.message });
    await setSetting(sb, 'distributor_pdf_path', path);
    await setSetting(sb, 'distributor_pdf_name', file.name || 'Informacja o dystrybutorze.pdf');
    return { ok: true };
  },

  removeDistributor: async ({ locals }) => {
    const sb = await requireAdmin(locals);
    const settings = await getSettings();
    if (settings.distributor_pdf_path) await sb.storage.from(PUBLIC_BUCKET).remove([settings.distributor_pdf_path]).catch(() => {});
    await setSetting(sb, 'distributor_pdf_path', '');
    await setSetting(sb, 'distributor_pdf_name', '');
    return { ok: true };
  }
};
