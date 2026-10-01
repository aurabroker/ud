import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logError } from "../_shared/logger.ts";
import { podpiszWycofanie } from "../_shared/szkic-podpis.ts";

/**
 * wniosek-przypomnienie — jedno przypomnienie e-mailem o niedokończonym wniosku.
 *
 * Plan: PLAN-NIEDOKONCZONE-WNIOSKI.md. Woła pg_cron przez funkcję SQL
 * `ud_wnioski_przypomnienia()` (co godzinę; zadanie założone WYŁĄCZONE — włącza
 * się dopiero po akceptacji treści zgody przez prawnika).
 *
 * To jest marketing bezpośredni (art. 398 Prawa komunikacji elektronicznej),
 * więc piszemy WYŁĄCZNIE do szkiców z udzieloną zgodą i nie częściej niż raz
 * na 30 dni na adres — oba warunki egzekwuje funkcja SQL `ud_wnioski_do_przypomnienia`,
 * a nie ten plik.
 *
 * Czego w mailu NIE MA — i nie wolno dopisać:
 *  • imienia z formularza: pole wpisuje odwiedzający, a bez escape'owania
 *    i skrócenia to kanał do rozsyłania cudzych treści naszym nadawcą (por.
 *    `div-send-email` w CLAUDE.md). Wszystko w liście jest naszym tekstem;
 *  • informacji, na którym kroku klient przerwał: „zatrzymałeś się na ankiecie
 *    zdrowotnej" to już informacja o zdrowiu.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Nadawca i reply-to — decyzja właściciela z 01.10.2026. Domena utratadochodu.pl
 *  musi być zweryfikowana w Resend (SPF/DKIM), inaczej Resend odmówi wysyłki. */
const FROM_EMAIL = "UtrataDochodu <info@utratadochodu.pl>";
const REPLY_TO = "info@utratadochodu.pl";
const TELEFON = "504 400 901";
const SERWIS = "https://utratadochodu.pl";

/** Po ilu godzinach od ostatniej aktywności przypominamy — decyzja właściciela. */
const OPOZNIENIE_GODZIN = 3;
const MAKS_NA_URUCHOMIENIE = 50;

const LINK_DO_WNIOSKU =
  `${SERWIS}/wniosek/?utm_source=przypomnienie&utm_medium=email&utm_campaign=niedokonczony-wniosek`;

/** Stopka firmy — ta sama treść co COMPANY_FOOTER w apps/panel (conditionsDoc.js). */
const COMPANY_FOOTER =
  "Aura Expert spółka z ograniczoną odpowiedzialnością z siedzibą w Warszawie przy ul. Bolkowskiej 2A lokal 28, " +
  "wpisana do Krajowego Rejestru Sądowego pod numerem 0000599840 przez Sąd Rejonowy dla m.st. Warszawy, " +
  "XII Wydział Gospodarczy Krajowego Rejestru Sądowego, kapitał zakładowy 5.000 zł. Spółka wpisana jest do " +
  "Rejestru Pośredników Ubezpieczeniowych pod numerem 11229690/A. " +
  "ul. Bolkowska 2A/28, 01-466 Warszawa | REGON 363673048 | NIP 5242793544";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/** Odpowiedź dostawcy do logu: bez adresów e-mail, żeby ud_errors nie zbierało kontaktów. */
function bezAdresow(tekst: string): string {
  return tekst.replace(/[^\s@"'<>]+@[^\s@"'<>]+/g, "[adres]").substring(0, 300);
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Treść maila. Jedyne zmienne to adresy zbudowane z uuid i podpisu hex —
 * i tak przechodzą przez esc(). Żadnych pól z formularza.
 */
function zbudujMail(linkWycofania: string) {
  const temat = "Pomożemy dokończyć wniosek o ubezpieczenie utraty dochodu";

  const tekst = [
    "Dzień dobry,",
    "",
    "wniosek o ubezpieczenie utraty dochodu na UtrataDochodu.pl nie został dokończony. " +
      "Jeśli coś się po drodze zacięło — wątpliwość, pytanie o zakres ochrony, brakująca informacja — chętnie pomożemy.",
    "",
    `Zadzwoń: ${TELEFON} — przejdziemy przez wniosek razem. Możesz też odpowiedzieć na tę wiadomość.`,
    "",
    `Jeśli wolisz wrócić do wniosku sam(a): ${LINK_DO_WNIOSKU}`,
    "Wniosek wypełnia się od nowa — zajmuje około pięciu minut.",
    "",
    "—",
    "Dostajesz tę wiadomość, ponieważ na UtrataDochodu.pl udzielono zgody na kontakt w sprawie wniosku " +
      "z tego adresu e-mail. Piszemy jednorazowo i nie częściej niż raz na 30 dni.",
    `Wycofaj zgodę jednym kliknięciem: ${linkWycofania}`,
    "",
    COMPANY_FOOTER,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f2;padding:32px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e5e2d8;">
      <tr><td style="background:#0f172a;padding:22px 32px;">
        <p style="margin:0;font-size:17px;font-weight:700;color:#fff;">UtrataDochodu.pl</p>
      </td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#0f172a;">Dzień dobry,</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">
          wniosek o ubezpieczenie utraty dochodu na UtrataDochodu.pl nie został dokończony.
          Jeśli coś się po drodze zacięło — wątpliwość, pytanie o zakres ochrony, brakująca
          informacja — chętnie pomożemy.
        </p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#334155;">
          Zadzwoń: <a href="tel:+48504400901" style="color:#0f172a;font-weight:700;">${esc(TELEFON)}</a>
          — przejdziemy przez wniosek razem. Możesz też odpowiedzieć na tę wiadomość.
        </p>
        <p style="margin:0 0 8px;">
          <a href="${esc(LINK_DO_WNIOSKU)}"
             style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;">
            Wróć do wniosku
          </a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#64748b;">
          Wniosek wypełnia się od nowa — zajmuje około pięciu minut.
        </p>
      </td></tr>
      <tr><td style="padding:20px 32px 28px;border-top:1px solid #f1f0eb;">
        <p style="margin:0 0 10px;font-size:12px;line-height:1.55;color:#64748b;">
          Dostajesz tę wiadomość, ponieważ na UtrataDochodu.pl udzielono zgody na kontakt
          w sprawie wniosku z tego adresu e-mail. Piszemy jednorazowo i nie częściej niż raz
          na 30 dni. <a href="${esc(linkWycofania)}" style="color:#0f172a;">Wycofaj zgodę jednym kliknięciem.</a>
        </p>
        <p style="margin:0;font-size:11px;line-height:1.55;color:#94a3b8;">${esc(COMPANY_FOOTER)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { temat, tekst, html };
}

async function wyslij(resendKey: string, adres: string, id: string, sekret: string) {
  const sig = await podpiszWycofanie(id, sekret);
  // Strona wycofania dostaje id i podpis we FRAGMENCIE (#), nie w zapytaniu:
  // fragment nie wychodzi do serwera ani do analityki.
  const linkWycofania = `${SERWIS}/wycofaj-zgode/#id=${encodeURIComponent(id)}&sig=${encodeURIComponent(sig)}`;
  // RFC 8058: skrzynka pocztowa wycofuje zgodę jednym POST-em na ten adres.
  const linkOneClick =
    `${SUPABASE_URL}/functions/v1/wniosek-szkic?akcja=wycofaj&id=${encodeURIComponent(id)}&sig=${encodeURIComponent(sig)}`;

  const { temat, tekst, html } = zbudujMail(linkWycofania);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [adres],
      reply_to: REPLY_TO,
      subject: temat,
      html,
      text: tekst,
      headers: {
        "List-Unsubscribe": `<${linkOneClick}>, <mailto:${REPLY_TO}?subject=Wycofanie%20zgody>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (res.ok) return { ok: true as const };
  return { ok: false as const, status: res.status, odpowiedz: bezAdresow(await res.text()) };
}

Deno.serve(async (req: Request) => {
  // Tylko POST od crona. GET od robota nie robi nic — jak w send-digest-email.
  if (req.method !== "POST") return new Response("niedozwolona metoda", { status: 405 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Bramka: token z Vaulta, sprawdzany PRZED pierwszym odczytem danych.
  const token = req.headers.get("x-cron-token") ?? "";
  if (!token) return new Response("brak nagłówka x-cron-token", { status: 401 });
  const { data: zgoda, error: bladTokenu } = await supabase.rpc("edge_cron_token_matches", { token });
  if (bladTokenu) {
    console.error("Przypomnienie: nie mogę sprawdzić tokenu:", bladTokenu.message);
    return new Response("nie mogę sprawdzić tokenu", { status: 500 });
  }
  if (zgoda !== true) return new Response("zły nagłówek x-cron-token", { status: 401 });

  try {
    // Klucz Resend: ten sam, którego używa send-offer-email (RESEND_API_KEY);
    // send-digest-email i send-confirmation-email mają RESEND2_API_KEY.
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? Deno.env.get("RESEND2_API_KEY");
    const sekret = Deno.env.get("SZKIC_HMAC_SECRET");
    if (!resendKey || !sekret) {
      await logError("wniosek-przypomnienie",
        `Brak ${!resendKey ? "RESEND_API_KEY" : "SZKIC_HMAC_SECRET"} — przypomnienia nie wychodzą`);
      return json({ ok: false, powod: "brak sekretu" }, 503);
    }

    const { data: kandydaci, error } = await supabase.rpc("ud_wnioski_do_przypomnienia", {
      opoznienie: `${OPOZNIENIE_GODZIN} hours`,
      maks: MAKS_NA_URUCHOMIENIE,
    });
    if (error) throw error;

    let wyslano = 0;
    for (const k of (kandydaci ?? []) as { szkic_id: string; adres: string }[]) {
      // Zajmujemy szkic ZANIM wyślemy: dwa nakładające się uruchomienia crona
      // nie napiszą dwa razy do tego samego człowieka. Warunki w WHERE powtarzają
      // te z funkcji SQL — między wyborem a zajęciem ktoś mógł wycofać zgodę.
      const teraz = new Date().toISOString();
      const { data: zajety, error: bladZajecia } = await supabase
        .from("ud_wnioski_szkice")
        .update({ przypomnienie_wyslane_at: teraz, updated_at: teraz })
        .eq("id", k.szkic_id)
        .eq("zgoda_kontakt", true)
        .is("ukonczony_at", null)
        .is("przypomnienie_wyslane_at", null)
        .select("id");
      if (bladZajecia) throw bladZajecia;
      if (!zajety?.length) continue;

      // Wyjątek sieciowy to taka sama porażka jak odmowa Resend: zwalniamy szkic
      // poniżej. Bez tego szkic zostałby oznaczony jako „wysłany", choć mail nie wyszedł.
      const wynik = await wyslij(resendKey, k.adres, k.szkic_id, sekret)
        .catch((e) => ({ ok: false as const, status: 0, odpowiedz: bezAdresow(String(e)) }));
      if (!wynik.ok) {
        // Zwalniamy szkic, żeby następne uruchomienie spróbowało jeszcze raz,
        // i kończymy: jeśli Resend odmawia (np. domena nadawcy niezweryfikowana),
        // pięćdziesiąt kolejnych prób nie pomoże, a zalałoby ud_errors.
        await supabase.from("ud_wnioski_szkice")
          .update({ przypomnienie_wyslane_at: null })
          .eq("id", k.szkic_id);
        await logError("wniosek-przypomnienie", `Resend odmówił wysyłki (HTTP ${wynik.status})`,
          { status: wynik.status, odpowiedz: wynik.odpowiedz });
        return json({ ok: false, powod: "resend", status: wynik.status, wyslano }, 502);
      }
      wyslano += 1;
    }

    return json({ ok: true, kandydatow: kandydaci?.length ?? 0, wyslano });
  } catch (e) {
    await logError("wniosek-przypomnienie", String((e as { message?: string })?.message ?? e));
    return json({ ok: false, powod: "błąd" }, 500);
  }
});
