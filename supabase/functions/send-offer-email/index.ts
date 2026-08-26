/**
 * Supabase Edge Function: send-offer-email
 * 
 * Wywoływana po wyborze oferty przez klienta.
 * Generuje PDF i wysyła email do klienta + brokera.
 * 
 * Wymagane zmienne środowiskowe (ustaw w Supabase Dashboard → Settings → Edge Functions):
 * - RESEND_API_KEY: klucz API z https://resend.com
 * - SUPABASE_SERVICE_ROLE_KEY: service role key (do odczytu danych oferty)
 * - BROKER_EMAIL: email brokera (np. biuro@utratadochodu.com)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { offer_id, choice } = await req.json();
    if (!offer_id) throw new Error("Missing offer_id");

    // Init Supabase with service role for full access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const brokerEmail = Deno.env.get("BROKER_EMAIL") || "biuro@utratadochodu.com";

    const sb = createClient(supabaseUrl, serviceKey);

    // Fetch offer data
    const { data: offer, error } = await sb
      .from("ud_offers")
      .select("*")
      .eq("id", offer_id)
      .single();

    if (error || !offer) throw new Error("Offer not found");

    const clientName = offer.client_name || "Klient";
    const offerName = offer.name || "Oferta";
    const chosenInsurer = choice?.insurer_name || "—";
    const chosenAt = choice?.chosen_at ? new Date(choice.chosen_at).toLocaleString("pl-PL") : "—";

    // Get client email if linked
    let clientEmail = null;
    if (offer.client_id) {
      const { data: client } = await sb
        .from("ud_clients")
        .select("email")
        .eq("id", offer.client_id)
        .single();
      clientEmail = client?.email;
    }

    if (!resendKey) {
      console.log("RESEND_API_KEY not set, skipping email send");
      return new Response(JSON.stringify({ success: false, reason: "No RESEND_API_KEY" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send notification to broker
    const brokerHtml = `
      <h2>Klient wybrał ofertę</h2>
      <p><strong>Klient:</strong> ${clientName}</p>
      <p><strong>Oferta:</strong> ${offerName}</p>
      <p><strong>Wybrany ubezpieczyciel:</strong> ${chosenInsurer}</p>
      <p><strong>Data wyboru:</strong> ${chosenAt}</p>
      <p><strong>Wyłączenia zaakceptowane:</strong> ${choice?.exclusions_accepted ? "Tak" : "Nie"}</p>
      <hr>
      <p style="font-size:12px;color:#999;">Wiadomość automatyczna z Panelu Ofertowania UtrataDochodu — Aura Expert sp. z o.o.</p>
    `;

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

    // Send confirmation to client (if email available)
    if (clientEmail) {
      const clientHtml = `
        <h2>Potwierdzenie wyboru oferty</h2>
        <p>Szanowny/a ${clientName},</p>
        <p>Dziękujemy za wybór ubezpieczenia utraty dochodu.</p>
        <p><strong>Wybrany ubezpieczyciel:</strong> ${chosenInsurer}</p>
        <p>Nasz broker skontaktuje się z Tobą w ciągu 24h w celu sfinalizowania polisy.</p>
        <hr>
        <p style="font-size:12px;color:#999;">Aura Expert sp. z o.o. — utratadochodu.pl</p>
      `;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: "UtrataDochodu <noreply@utratadochodu.com>",
          to: [clientEmail],
          subject: `Potwierdzenie wyboru oferty — UtrataDochodu`,
          html: clientHtml,
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
