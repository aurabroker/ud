import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { offer_id, choice } = await req.json();
    if (!offer_id) throw new Error("Missing offer_id");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const brokerEmail = Deno.env.get("BROKER_EMAIL") || "biuro@utratadochodu.com";

    const sb = createClient(supabaseUrl, serviceKey);

    const { data: offer, error } = await sb.from("ud_offers").select("*").eq("id", offer_id).single();
    if (error || !offer) throw new Error("Offer not found");

    const clientName = offer.client_name || "Klient";
    const offerName = offer.name || "Oferta";
    const chosenInsurer = choice?.insurer_name || "—";
    const chosenAt = choice?.chosen_at ? new Date(choice.chosen_at).toLocaleString("pl-PL") : "—";

    let clientEmail = null;
    if (offer.client_id) {
      const { data: client } = await sb.from("ud_clients").select("email").eq("id", offer.client_id).single();
      clientEmail = client?.email;
    }

    if (!resendKey) {
      return new Response(JSON.stringify({ success: false, reason: "No RESEND_API_KEY" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brokerHtml = `<h2>Klient wybrał ofertę</h2><p><strong>Klient:</strong> ${clientName}</p><p><strong>Oferta:</strong> ${offerName}</p><p><strong>Wybrany ubezpieczyciel:</strong> ${chosenInsurer}</p><p><strong>Data wyboru:</strong> ${chosenAt}</p><p><strong>Wyłączenia zaakceptowane:</strong> ${choice?.exclusions_accepted ? "Tak" : "Nie"}</p><hr><p style="font-size:12px;color:#999;">Aura Expert sp. z o.o. — Panel Ofertowania UtrataDochodu</p>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "UtrataDochodu <noreply@utratadochodu.com>",
        to: [brokerEmail],
        subject: `[UD] ${clientName} wybrał: ${chosenInsurer}`,
        html: brokerHtml,
      }),
    });

    if (clientEmail) {
      const clientHtml = `<h2>Potwierdzenie wyboru oferty</h2><p>Szanowny/a ${clientName},</p><p>Dziękujemy za wybór ubezpieczenia utraty dochodu.</p><p><strong>Wybrany ubezpieczyciel:</strong> ${chosenInsurer}</p><p>Nasz broker skontaktuje się z Tobą w ciągu 24h.</p><hr><p style="font-size:12px;color:#999;">Aura Expert sp. z o.o. — utratadochodu.pl</p>`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: "UtrataDochodu <noreply@utratadochodu.com>",
          to: [clientEmail],
          subject: "Potwierdzenie wyboru oferty — UtrataDochodu",
          html: clientHtml,
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
