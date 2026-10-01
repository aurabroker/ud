import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * send-offer-email — powiadomienie „klient wybrał ofertę" do brokera
 * i potwierdzenie wyboru do klienta.
 *
 * Funkcja ma verify_jwt = false, a wołający (stary klient oferty w udapp,
 * js/client.js) nie jest zalogowany — nie ma kogo uwierzytelnić. Dlatego
 * sama pilnuje, żeby nie dało się jej użyć do rozsyłania poczty:
 *
 * 1. Treść bierze z bazy (`ud_offers.client_choice`), nie z żądania.
 *    Wcześniej `choice.insurer_name` z ciała żądania szło prosto do HTML-a
 *    listu wychodzącego z naszej domeny na adres klienta: kto znał offer_id,
 *    mógł wysłać klientowi dowolny tekst z odnośnikiem.
 * 2. Wysyła tylko tuż po prawdziwym wyborze (OKNO_MINUT). To samo offer_id
 *    wołane później nie wyśle drugiego listu.
 * 3. Wszystko, co trafia do HTML-a, jest escape'owane.
 *
 * Kontrakt wywołania bez zmian: { offer_id }. Pole `choice` z żądania jest
 * ignorowane — stary klient najpierw zapisuje wybór w ofercie, dopiero potem
 * woła tę funkcję, więc w bazie jest to samo.
 *
 * Nowy panel (udapp/app, offer/[token]/choice) powiadamia agenta sam i tej
 * funkcji nie woła.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OKNO_MINUT = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (dane: unknown, status = 200) =>
  new Response(JSON.stringify(dane), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Temat to nagłówek listu — bez znaków nowej linii. */
const temat = (s: string) => s.replace(/[\r\n]+/g, " ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = await req.json().catch(() => null);
  const offerId = String(body?.offer_id ?? "");
  if (!UUID.test(offerId)) return json({ error: "Missing offer_id" }, 400);

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const brokerEmail = Deno.env.get("BROKER_EMAIL") || "biuro@utratadochodu.com";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: offer, error } = await sb
      .from("ud_offers")
      .select("id, name, client_name, client_id, client_choice, decided_at")
      .eq("id", offerId)
      .maybeSingle();
    if (error || !offer) return json({ error: "Offer not found" }, 404);

    const wybor = offer.client_choice as Record<string, unknown> | null;
    if (!wybor || wybor.rejected || !wybor.insurer_name) {
      return json({ success: false, reason: "Oferta nie ma zapisanego wyboru" }, 409);
    }

    // Czas wyboru: kolumna ustawiana przez serwer, a gdy jej nie ma — znacznik
    // zapisany razem z wyborem. Pięć minut tolerancji w przód na zegar klienta.
    const kiedy = Date.parse(String(offer.decided_at ?? wybor.chosen_at ?? ""));
    const wiek = Date.now() - kiedy;
    if (!Number.isFinite(kiedy) || wiek > OKNO_MINUT * 60_000 || wiek < -5 * 60_000) {
      return json({ success: false, reason: "Powiadomienie wysyła się tylko tuż po wyborze" }, 409);
    }

    if (!resendKey) return json({ success: false, reason: "No RESEND_API_KEY" });

    let clientEmail: string | null = null;
    if (offer.client_id) {
      const { data: client } = await sb.from("ud_clients").select("email").eq("id", offer.client_id).maybeSingle();
      clientEmail = client?.email ?? null;
    }

    const clientName = String(offer.client_name || "Klient");
    const offerName = String(offer.name || "Oferta");
    const chosenInsurer = String(wybor.insurer_name);
    const chosenAt = new Date(kiedy).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });

    const brokerHtml = `<h2>Klient wybrał ofertę</h2><p><strong>Klient:</strong> ${esc(clientName)}</p><p><strong>Oferta:</strong> ${esc(offerName)}</p><p><strong>Wybrany ubezpieczyciel:</strong> ${esc(chosenInsurer)}</p><p><strong>Data wyboru:</strong> ${esc(chosenAt)}</p><p><strong>Wyłączenia zaakceptowane:</strong> ${wybor.exclusions_accepted ? "Tak" : "Nie"}</p><hr><p style="font-size:12px;color:#999;">Aura Expert sp. z o.o. — Panel Ofertowania UtrataDochodu</p>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "UtrataDochodu <noreply@utratadochodu.com>",
        to: [brokerEmail],
        subject: temat(`[UD] ${clientName} wybrał: ${chosenInsurer}`),
        html: brokerHtml,
      }),
    });

    if (clientEmail) {
      const clientHtml = `<h2>Potwierdzenie wyboru oferty</h2><p>Szanowny/a ${esc(clientName)},</p><p>Dziękujemy za wybór ubezpieczenia utraty dochodu.</p><p><strong>Wybrany ubezpieczyciel:</strong> ${esc(chosenInsurer)}</p><p>Nasz broker skontaktuje się z Tobą w ciągu 24h.</p><hr><p style="font-size:12px;color:#999;">Aura Expert sp. z o.o. — utratadochodu.pl</p>`;

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

    return json({ success: true });
  } catch (err) {
    console.error("send-offer-email:", err);
    return json({ error: "Błąd wysyłki" }, 500);
  }
});
