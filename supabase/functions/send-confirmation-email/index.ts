import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RESEND_API_KEY = Deno.env.get("RESEND2_API_KEY")!;
const FROM_EMAIL = "Aura Expert <noreply@utratadochodu.pl>";
const REPLY_TO = "kontakt@utratadochodu.pl";

const WA_PHONE  = "48504400901";
const WA_APIKEY = "5838995";

async function sendWhatsApp(msg: string): Promise<void> {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${WA_PHONE}&text=${encodeURIComponent(msg)}&apikey=${WA_APIKEY}`;
  try {
    const res = await fetch(url);
    const body = await res.text();
    console.log(`CallMeBot [${res.status}]:`, body.substring(0, 300));
  } catch (err) {
    console.error("CallMeBot fetch error:", err);
  }
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: Record<string, unknown>;
  schema: string;
  old_record: null | Record<string, unknown>;
}

function getEmailContent(
  record: Record<string, unknown>,
  isQuick: boolean,
): { subject: string; html: string } {
  const fullName = String(
    record.full_name ?? record.name ?? "",
  );
  const firstName = fullName.split(" ")[0];
  const phone = String(record.phone ?? "");
  const zawod = String(record.profession ?? "");
  const forma = String(record.employment_type ?? "");

  if (isQuick) {
    return {
      subject: "Twoje zapytanie dotarło — oddzwonimy w ciągu 24h",
      html: `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Zapytanie przyjęte</title>
</head>
<body style="margin:0;padding:0;background:#f8f7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f2;padding:40px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e2d8;">
      <tr><td style="background:#0f172a;padding:28px 36px;">
        <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">utratadochodu.pl</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.5);letter-spacing:1px;text-transform:uppercase;">Aura Expert Sp. z o.o.</p>
      </td></tr>
      <tr><td style="padding:32px 36px 24px;">
        <p style="margin:0 0 16px;font-size:16px;color:#334155;">Cześć${firstName ? ` ${firstName}` : ""},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.7;">
          Otrzymaliśmy Twoje zapytanie.${zawod || forma ? ` Na podstawie Twojego profilu${zawod ? ` (${zawod}${forma ? `, ${forma}` : ""})` : ""}` : ""} Nasz doradca przygotuje orientacyjną wycenę i skontaktuje się z Tobą telefonicznie${phone ? ` pod numer <strong>${phone}</strong>` : ""} <strong>w ciągu 24 godzin roboczych</strong>.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
          <tr><td style="height:1px;background:#e5e2d8;"></td></tr>
        </table>
        <p style="margin:0 0 8px;font-size:14px;font-weight:500;color:#0f172a;">Chcesz ofertę szybciej — bez rozmowy?</p>
        <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
          Wypełnij pełny wniosek ubezpieczeniowy (ok. 12 minut) i wyślemy Ci gotowe oferty od CEU i Leadenhall od razu po weryfikacji.
        </p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr><td style="background:#0f172a;border-radius:8px;padding:13px 24px;">
            <a href="https://utratadochodu.pl/formularz.html" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;">Wypełnij pełny wniosek →</a>
          </td></tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
          <tr><td style="height:1px;background:#e5e2d8;"></td></tr>
        </table>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
          Masz pytania zanim zadzwonimy?<br>
          Napisz: <a href="mailto:${REPLY_TO}" style="color:#0f172a;">${REPLY_TO}</a> &nbsp;|&nbsp;
          Zadzwoń: <a href="tel:+48504400901" style="color:#0f172a;">+48 504 400 901</a>
        </p>
      </td></tr>
      <tr><td style="background:#f8f7f2;padding:20px 36px;border-top:1px solid #e5e2d8;">
        <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
          Aura Expert Sp. z o.o. · agent ubezpieczeniowy wpisany do rejestru KNF<br>
          Ubezpieczyciele: Chaucer Europe Underwriting Sp. z o.o. (CEU) oraz Leadenhall Insurance plc<br>
          <a href="https://utratadochodu.pl" style="color:#94a3b8;">utratadochodu.pl</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
    };
  }

  // Pełny wniosek
  return {
    subject: "Wniosek przyjęty — oferta w ciągu 1–2 dni roboczych",
    html: `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wniosek przyjęty</title>
</head>
<body style="margin:0;padding:0;background:#f8f7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f2;padding:40px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e2d8;">
      <tr><td style="background:#0f172a;padding:28px 36px;">
        <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">utratadochodu.pl</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.5);letter-spacing:1px;text-transform:uppercase;">Aura Expert Sp. z o.o.</p>
      </td></tr>
      <tr><td style="padding:32px 36px 24px;">
        <p style="margin:0 0 16px;font-size:16px;color:#334155;">Cześć${firstName ? ` ${firstName}` : ""},</p>
        <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7;">
          Twój kompletny wniosek ubezpieczeniowy dotarł. Przekazaliśmy go do weryfikacji przez naszych partnerów — <strong>CEU</strong> i <strong>Leadenhall Insurance</strong>.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #f1f0eb;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="width:28px;height:28px;background:#e1f5ee;border-radius:50%;text-align:center;vertical-align:middle;">
                  <span style="font-size:12px;font-weight:500;color:#085041;">1</span>
                </td>
                <td style="padding-left:12px;font-size:14px;color:#334155;">Weryfikacja wniosku: <strong>1–2 dni robocze</strong></td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #f1f0eb;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="width:28px;height:28px;background:#e1f5ee;border-radius:50%;text-align:center;vertical-align:middle;">
                  <span style="font-size:12px;font-weight:500;color:#085041;">2</span>
                </td>
                <td style="padding-left:12px;font-size:14px;color:#334155;">Oferta na Twój email z porównaniem obu produktów</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 0;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="width:28px;height:28px;background:#e1f5ee;border-radius:50%;text-align:center;vertical-align:middle;">
                  <span style="font-size:12px;font-weight:500;color:#085041;">3</span>
                </td>
                <td style="padding-left:12px;font-size:14px;color:#334155;">Jeśli będziemy potrzebować uzupełnienia — skontaktujemy się telefonicznie</td>
              </tr></table>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
          <tr><td style="height:1px;background:#e5e2d8;"></td></tr>
        </table>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
          Masz pytania?<br>
          Napisz: <a href="mailto:${REPLY_TO}" style="color:#0f172a;">${REPLY_TO}</a> &nbsp;|&nbsp;
          Zadzwoń: <a href="tel:+48504400901" style="color:#0f172a;">+48 504 400 901</a>
        </p>
      </td></tr>
      <tr><td style="background:#f8f7f2;padding:20px 36px;border-top:1px solid #e5e2d8;">
        <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
          Aura Expert Sp. z o.o. · agent ubezpieczeniowy wpisany do rejestru KNF<br>
          Ubezpieczyciele: Chaucer Europe Underwriting Sp. z o.o. (CEU) oraz Leadenhall Insurance plc<br>
          <a href="https://utratadochodu.pl" style="color:#94a3b8;">utratadochodu.pl</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
  };
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${Deno.env.get("WEBHOOK_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (payload.type !== "INSERT") {
    return new Response("OK — ignored", { status: 200 });
  }

  const record = payload.record;
  const table = payload.table;

  // udochodu_contacts = szybki wniosek, ud_clients = pełny wniosek
  const isQuick = table === "udochodu_contacts";

  const email = String(record.email ?? "");
  if (!email || !email.includes("@")) {
    console.error("Brak emaila w rekordzie:", JSON.stringify(record));
    return new Response("No email", { status: 400 });
  }

  const { subject, html } = getEmailContent(record, isQuick);

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      reply_to: REPLY_TO,
      subject,
      html,
    }),
  });

  if (!resendResponse.ok) {
    const error = await resendResponse.text();
    console.error("Resend error:", error);
    return new Response(`Resend error: ${error}`, { status: 500 });
  }

  const result = await resendResponse.json();
  console.log(`Email wysłany [${table}]:`, result.id, "→", email);

  const name  = String(record.full_name ?? record.name ?? "—");
  const phone = String(record.phone ?? "—");
  const waMsg = isQuick
    ? `📱 Nowy kontakt!\nImię: ${name}\nTel: ${phone}\nEmail: ${email}`
    : `📋 Nowy wniosek!\nImię: ${name}\nTel: ${phone}\nEmail: ${email}\nZawód: ${String(record.profession ?? "—")}`;
  await sendWhatsApp(waMsg);

  return new Response(JSON.stringify({ ok: true, id: result.id }), {
    headers: { "Content-Type": "application/json" },
  });
});
