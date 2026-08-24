/* Decyzja o alertach i ich wysyłka.

   Zasady, które chronią przed budzeniem w nocy bez powodu:
   - awarię ogłaszamy dopiero po `progAwarii` porażkach z rzędu,
   - e-mail leci przy każdej awarii, SMS **wyłącznie** przy sprawdzeniach
     oznaczonych `krytyczny` — te budzą o każdej porze, bo to lejek zgłoszeń,
   - dopóki awaria trwa, przypomnienie idzie co PRZYPOMNIENIE_MIN, mailem,
   - powrót do działania zgłaszamy tym samym kanałem, którym poszła awaria.

   `decyduj` jest czystą funkcją — cała logika jest testowalna bez sieci.
*/

export const PRZYPOMNIENIE_MIN = 30;

/* stan: { status: 'up'|'down'|'unknown', odKiedy, pod, ostatniAlert, smsWyslany }
   wynik: { ok, ms, opis, blad }
   zwraca: { stan, akcje: [{ rodzaj, kanaly }] } */
export function decyduj(def, stan, wynik, teraz) {
  const s = {
    status: stan?.status || 'unknown',
    odKiedy: stan?.odKiedy || teraz.toISOString(),
    pod: stan?.pod || 0,
    ostatniAlert: stan?.ostatniAlert || null,
    smsWyslany: stan?.smsWyslany || false,
  };
  const akcje = [];

  if (wynik.ok) {
    if (s.status === 'down') {
      akcje.push({ rodzaj: 'powrot', kanaly: s.smsWyslany ? ['email', 'sms'] : ['email'] });
      s.smsWyslany = false;
      s.odKiedy = teraz.toISOString();
      s.ostatniAlert = null;
    } else if (s.status !== 'up') {
      s.odKiedy = teraz.toISOString();
    }
    s.status = 'up';
    s.pod = 0;
    return { stan: s, akcje };
  }

  s.pod += 1;
  if (s.pod < (def.progAwarii || 2)) return { stan: s, akcje };   // jeszcze nie panikujemy

  if (s.status !== 'down') {
    const kanaly = ['email'];
    if (def.krytyczny) { kanaly.push('sms'); s.smsWyslany = true; }
    s.status = 'down';
    s.odKiedy = teraz.toISOString();
    s.ostatniAlert = teraz.toISOString();
    akcje.push({ rodzaj: 'awaria', kanaly });
    return { stan: s, akcje };
  }

  const odOstatniego = s.ostatniAlert ? (teraz - new Date(s.ostatniAlert)) / 60000 : Infinity;
  if (odOstatniego >= PRZYPOMNIENIE_MIN) {
    s.ostatniAlert = teraz.toISOString();
    akcje.push({ rodzaj: 'przypomnienie', kanaly: ['email'] });
  }
  return { stan: s, akcje };
}

/* ── treści ─────────────────────────────────────────────── */
export function trescAlertu(def, wynik, rodzaj, stan, teraz) {
  const czas = new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'medium',
  }).format(teraz);

  if (rodzaj === 'powrot') {
    const trwala = stan?.odKiedy ? minutySlownie((teraz - new Date(stan.odKiedy)) / 60000) : '—';
    return {
      temat: `[OK] ${def.nazwa} znowu działa`,
      tekst: `${def.nazwa} wróciło do działania.\n\nAwaria trwała: ${trwala}\nCzas: ${czas}`,
      sms: `OK: ${def.nazwa} dziala. Awaria trwala ${trwala}.`,
    };
  }
  const naglowek = rodzaj === 'przypomnienie' ? '[NADAL] ' : '[AWARIA] ';
  return {
    temat: `${naglowek}${def.nazwa}`,
    tekst: [
      `${def.nazwa} nie działa.`,
      ``,
      `Problem: ${wynik.blad}`,
      def.url ? `Adres:   ${def.url}` : null,
      `Czas:    ${czas}`,
      stan?.odKiedy && rodzaj === 'przypomnienie'
        ? `Trwa od: ${new Date(stan.odKiedy).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}` : null,
    ].filter(Boolean).join('\n'),
    sms: `AWARIA: ${def.nazwa}. ${String(wynik.blad).slice(0, 90)}`,
  };
}

function minutySlownie(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} godz. ${m % 60} min`;
}

/* ── wysyłka ────────────────────────────────────────────── */
export async function wyslijEmail(env, temat, tekst, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return { pominiete: 'brak konfiguracji e-mail' };
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.ALERT_EMAIL_FROM || 'monitor@utratadochodu.pl',
      to: env.ALERT_EMAIL.split(',').map(s => s.trim()),
      subject: temat,
      text: tekst,
    }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { ok: true };
}

export async function wyslijSms(env, tresc, fetchImpl = fetch) {
  if (!env.SMSAPI_TOKEN || !env.ALERT_SMS) return { pominiete: 'brak konfiguracji SMS' };
  const params = new URLSearchParams({
    to: env.ALERT_SMS,
    message: tresc.slice(0, 160),
    from: env.SMSAPI_NADAWCA || 'Info',
    format: 'json',
  });
  const res = await fetchImpl('https://api.smsapi.pl/sms.do', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SMSAPI_TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const tekst = await res.text();
  if (!res.ok || tekst.startsWith('ERROR')) throw new Error(`SMSAPI: ${tekst.slice(0, 200)}`);
  return { ok: true };
}

export async function wyslij(env, kanaly, tresci, fetchImpl = fetch) {
  const wyniki = [];
  for (const kanal of kanaly) {
    try {
      if (kanal === 'email') wyniki.push({ kanal, ...(await wyslijEmail(env, tresci.temat, tresci.tekst, fetchImpl)) });
      if (kanal === 'sms')   wyniki.push({ kanal, ...(await wyslijSms(env, tresci.sms, fetchImpl)) });
    } catch (e) {
      wyniki.push({ kanal, blad: e.message });
    }
  }
  return wyniki;
}
