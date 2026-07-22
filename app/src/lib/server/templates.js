/**
 * templates.js — szablony HTML e-maili (Resend).
 */

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Email do klienta z linkiem do oferty. */
export function offerLinkEmail({ clientName, link, ttlHours }) {
  const hi = clientName ? `Szanowny/a Panie/Pani ${esc(clientName.split(/\s+/)[0])},` : 'Dzień dobry,';
  return `<!doctype html><html lang="pl"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <div style="background:#1e293b;color:#fff;border-radius:12px 12px 0 0;padding:20px 24px;font-size:20px;font-weight:800;">Utrata<span style="color:#38bdf8;">Dochodu</span></div>
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:28px 24px;">
      <p style="font-size:15px;">${hi}</p>
      <p style="font-size:15px;line-height:1.6;">przygotowaliśmy dla Ciebie porównanie ofert ubezpieczenia utraty dochodu. Kliknij poniżej, aby je zobaczyć.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${esc(link)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block;">Zobacz swoją ofertę →</a>
      </p>
      <p style="font-size:13px;color:#64748b;line-height:1.6;">Dostęp zabezpieczony jest <strong>4-cyfrowym hasłem</strong>, które wysłaliśmy osobno SMS-em. Hasło jest ważne przez ${ttlHours}h.</p>
      <p style="font-size:12px;color:#94a3b8;margin-top:24px;">Aura Expert sp. z o.o. · Panel Ofertowania</p>
    </div>
  </div></body></html>`;
}

/** Email do agenta z pytaniem klienta. */
export function clientQuestionEmail({ clientName, offerName, question, clientEmail }) {
  return `<!doctype html><html lang="pl"><body style="font-family:Arial,sans-serif;color:#1e293b;">
  <div style="max-width:520px;margin:0 auto;padding:24px;">
    <h2 style="font-size:18px;">Nowe pytanie od klienta</h2>
    <p><strong>Klient:</strong> ${esc(clientName) || '—'}${clientEmail ? ` (${esc(clientEmail)})` : ''}</p>
    <p><strong>Oferta:</strong> ${esc(offerName) || '—'}</p>
    <div style="background:#f1f5f9;border-left:3px solid #2563eb;padding:12px 16px;border-radius:6px;margin:16px 0;font-size:15px;line-height:1.6;">${esc(question)}</div>
    ${clientEmail ? `<p style="font-size:13px;color:#64748b;">Odpowiedz bezpośrednio na adres klienta: <a href="mailto:${esc(clientEmail)}">${esc(clientEmail)}</a></p>` : ''}
  </div></body></html>`;
}
