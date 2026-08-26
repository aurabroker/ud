/**
 * templates.js — szablony e-maili (Resend). Każdy zwraca { html, text }.
 */
import { COMPANY_FOOTER } from './pdf/conditionsDoc.js';

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Email do klienta z linkiem do oferty.
 * @param {{clientName?: string, link: string, ttlHours: number, logoUrl?: string, footerText?: string}} p
 * @returns {{ html: string, text: string }}
 */
export function offerLinkEmail({ clientName, link, ttlHours, logoUrl = '', footerText = '' }) {
  // Bez znajomości płci i wołacza każda personalizacja imieniem brzmi niegramatycznie
  // („Szanowny/a Panie/Pani Anna"), dlatego neutralne i zawsze poprawne powitanie.
  const hi = 'Dzień dobry,';
  const footer = String(footerText || '').trim() || COMPANY_FOOTER;

  // W e-mailu logo musi być linkiem — klienty pocztowe blokują obrazy w data:.
  const brand = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="UtrataDochodu" height="34" style="height:34px;width:auto;display:block;border:0;" />`
    : `<span style="font-size:20px;font-weight:800;color:#fff;">Utrata<span style="color:#38bdf8;">Dochodu</span></span>`;

  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="background:#1e293b;border-radius:12px 12px 0 0;padding:18px 24px;">${brand}</div>
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:28px 24px;">
      <p style="font-size:15px;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">przygotowaliśmy dla Pani/Pana porównanie ofert ubezpieczenia utraty dochodu. Prosimy kliknąć poniższy przycisk, aby je zobaczyć.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${esc(link)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block;">Zobacz swoją ofertę &rarr;</a>
      </p>
      <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 6px;">Gdyby przycisk nie działał, prosimy skopiować adres:<br />
        <a href="${esc(link)}" style="color:#2563eb;word-break:break-all;">${esc(link)}</a></p>
      <p style="font-size:13px;color:#64748b;line-height:1.6;margin:14px 0 0;">Dostęp zabezpieczony jest <strong>4-cyfrowym hasłem</strong>, które wysłaliśmy osobno SMS-em. Hasło jest ważne przez ${ttlHours}h.</p>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:22px 0 14px;" />
      <p style="font-size:11px;color:#94a3b8;line-height:1.5;margin:0;">${esc(footer).replace(/\n/g, '<br />')}</p>
    </div>
  </div></body></html>`;

  const text = [
    hi.replace(/&nbsp;/g, ' '),
    '',
    'przygotowaliśmy dla Pani/Pana porównanie ofert ubezpieczenia utraty dochodu.',
    'Oferta dostępna jest pod adresem:',
    link,
    '',
    `Dostęp zabezpieczony jest 4-cyfrowym hasłem, które wysłaliśmy osobno SMS-em. Hasło jest ważne przez ${ttlHours}h.`,
    '',
    '---',
    footer
  ].join('\n');

  return { html, text };
}

/**
 * Email do agenta z pytaniem klienta.
 * @returns {{ html: string, text: string }}
 */
export function clientQuestionEmail({ clientName, offerName, question, clientEmail }) {
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"></head>
  <body style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h2 style="font-size:18px;">Nowe pytanie od klienta</h2>
    <p><strong>Klient:</strong> ${esc(clientName) || '—'}${clientEmail ? ` (${esc(clientEmail)})` : ''}</p>
    <p><strong>Oferta:</strong> ${esc(offerName) || '—'}</p>
    <div style="background:#f1f5f9;border-left:3px solid #2563eb;padding:12px 16px;border-radius:6px;margin:16px 0;font-size:15px;line-height:1.6;">${esc(question)}</div>
    ${clientEmail ? `<p style="font-size:13px;color:#64748b;">Odpowiedz bezpośrednio na adres klienta: <a href="mailto:${esc(clientEmail)}">${esc(clientEmail)}</a></p>` : ''}
  </div></body></html>`;

  const text = [
    'Nowe pytanie od klienta',
    '',
    `Klient: ${clientName || '—'}${clientEmail ? ` (${clientEmail})` : ''}`,
    `Oferta: ${offerName || '—'}`,
    '',
    question,
    '',
    clientEmail ? `Odpowiedz na: ${clientEmail}` : ''
  ].join('\n');

  return { html, text };
}
