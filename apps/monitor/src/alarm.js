/**
 * alarm.js — powiadamianie.
 *
 * Monitor, który pisze przy każdym nieudanym pomiarze, zostaje wyciszony
 * po tygodniu i przestaje istnieć. Dlatego wiadomość idzie wyłącznie przy
 * przejściu między stanami (patrz baza.js) i zawiera od razu to, co potrzebne
 * do decyzji: co padło, od kiedy, z jakim błędem i gdzie sprawdzić.
 */

/** Treść wiadomości. Osobno od wysyłki, żeby dało się ją przetestować. */
export function ulozWiadomosc(przejscie, wynik, kontekst = {}) {
  const kiedy = new Date(wynik.czas).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

  if (przejscie === 'awaria') {
    return {
      poziom: 'awaria',
      tytul: `Awaria: ${wynik.sonda}`,
      tresc: [
        `Sonda „${wynik.sonda}" nie odpowiada poprawnie.`,
        `Czas: ${kiedy}`,
        wynik.kod ? `Status HTTP: ${wynik.kod}` : null,
        wynik.szczegoly ? `Szczegóły: ${wynik.szczegoly}` : null,
        kontekst.status ? `Strona statusu: ${kontekst.status}` : null,
      ].filter(Boolean).join('\n'),
    };
  }

  const trwala = kontekst.od ? Math.round((wynik.czas - kontekst.od) / 60_000) : null;
  return {
    poziom: 'powrot',
    tytul: `Powrót: ${wynik.sonda}`,
    tresc: [
      `Sonda „${wynik.sonda}" znowu działa.`,
      `Czas: ${kiedy}`,
      trwala != null ? `Awaria trwała około ${trwala} min.` : null,
    ].filter(Boolean).join('\n'),
  };
}

/**
 * Wysyłka na webhook. Format jest celowo prosty — pasuje do Slacka i Discorda
 * (pole `text` / `content`), a odbiorca własny dostanie komplet w `zdarzenie`.
 *
 * Brak skonfigurowanego adresu nie jest błędem: monitor ma sens także bez
 * alertów, jako strona statusu i historia. Nie chcemy, żeby brak jednej
 * zmiennej wywracał całe przebiegi.
 */
export async function wyslij(webhook, wiadomosc, wynik) {
  if (!webhook) return { wyslano: false, powod: 'brak ALERT_WEBHOOK' };

  const znak = wiadomosc.poziom === 'awaria' ? '🔴' : '🟢';
  const tekst = `${znak} ${wiadomosc.tytul}\n${wiadomosc.tresc}`;

  try {
    const odp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: tekst,        // Slack
        content: tekst,     // Discord
        zdarzenie: { ...wiadomosc, sonda: wynik.sonda, czas: wynik.czas },
      }),
    });
    return { wyslano: odp.ok, kod: odp.status };
  } catch (e) {
    // Nieudany alert nie może przerwać przebiegu — reszta sond ma się wykonać.
    return { wyslano: false, powod: String(e) };
  }
}
