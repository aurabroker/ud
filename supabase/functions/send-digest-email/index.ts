import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY  = Deno.env.get("RESEND2_API_KEY")!;
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TO_EMAIL   = "biuro@utratadochodu.com";
const FROM_EMAIL = "UtrataDochodu.pl <noreply@utratadochodu.com>";

function fmt(dt: string) {
  return new Date(dt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", hour12: false });
}

function buildHtml(
  contacts: Record<string, unknown>[],
  clients: Record<string, unknown>[],
  since: string,
): string {
  const total = contacts.length + clients.length;
  const sinceStr = fmt(since);

  const contactRows = contacts.map(c => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f0eb;font-size:13px;color:#334155;">${c.name ?? "—"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f0eb;font-size:13px;color:#334155;">${c.phone ?? "—"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f0eb;font-size:13px;color:#334155;">${c.email}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f0eb;font-size:13px;color:#94a3b8;">${fmt(String(c.created_at))}</td>
    </tr>`).join("");

  const clientRows = clients.map(c => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f0eb;font-size:13px;color:#334155;">${c.full_name ?? "—"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f0eb;font-size:13px;color:#334155;">${c.phone ?? "—"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f0eb;font-size:13px;color:#334155;">${c.email}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f0eb;font-size:13px;color:#334155;">${c.profession ?? "—"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f0eb;font-size:13px;color:#94a3b8;">${fmt(String(c.created_at))}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f2;padding:32px 20px;">
  <tr><td align="center">
    <table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e2d8;">

      <tr><td style="background:#0f172a;padding:24px 32px;">
        <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">utratadochodu.pl — Raport zgłoszeń</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.5);">Ostatnie 2 godziny · od ${sinceStr}</p>
      </td></tr>

      <tr><td style="padding:24px 32px 8px;">
        <p style="margin:0;font-size:15px;color:#334155;">
          Łącznie nowych zgłoszeń: <strong style="color:#0f172a;">${total}</strong>
          &nbsp;(${contacts.length} szybkich kontaktów, ${clients.length} pełnych wniosków)
        </p>
      </td></tr>

      ${contacts.length > 0 ? `
      <tr><td style="padding:20px 32px 8px;">
        <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.5px;">📱 Szybkie kontakty (${contacts.length})</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e2d8;border-radius:8px;overflow:hidden;">
          <tr style="background:#f8f7f2;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">IMIĘ</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">TELEFON</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">EMAIL</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">GODZ.</th>
          </tr>
          ${contactRows}
        </table>
      </td></tr>` : ""}

      ${clients.length > 0 ? `
      <tr><td style="padding:20px 32px 8px;">
        <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.5px;">📋 Pełne wnioski (${clients.length})</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e2d8;border-radius:8px;overflow:hidden;">
          <tr style="background:#f8f7f2;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">IMIĘ</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">TELEFON</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">EMAIL</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">ZAWÓD</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">GODZ.</th>
          </tr>
          ${clientRows}
        </table>
      </td></tr>` : ""}

      <tr><td style="padding:20px 32px 24px;">
        <a href="https://supabase.com/dashboard/project/kukvgsjrmrqtzhkszzum/editor"
           style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-size:13px;font-weight:500;padding:10px 20px;border-radius:8px;">
          Otwórz bazę danych →
        </a>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const [{ data: contacts = [] }, { data: clients = [] }] = await Promise.all([
    supabase
      .from("udochodu_contacts")
      .select("name, email, phone, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false }),
    supabase
      .from("ud_clients")
      .select("full_name, email, phone, profession, employment_type, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false }),
  ]);

  const total = (contacts?.length ?? 0) + (clients?.length ?? 0);
  if (total === 0) {
    console.log("Digest: brak nowych zgłoszeń w ostatnich 2h");
    return new Response("ok — brak zgłoszeń", { status: 200 });
  }

  const html = buildHtml(contacts ?? [], clients ?? [], since);
  const subject = `[${total} zgłoszeń] Raport UtrataDochodu.pl — ${new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", hour12: false })}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [TO_EMAIL], subject, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend digest error:", err);
    return new Response(`Error: ${err}`, { status: 500 });
  }

  const result = await res.json();
  console.log(`Digest wysłany (${total} zgłoszeń):`, result.id);
  return new Response(JSON.stringify({ ok: true, total, id: result.id }), {
    headers: { "Content-Type": "application/json" },
  });
});
