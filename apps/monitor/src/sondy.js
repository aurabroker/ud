/**
 * sondy.js — co właściwie sprawdzamy.
 *
 * Dobór sond nie jest ogólny, tylko wzięty z historii tego projektu.
 * Formularz szybkiego kontaktu był martwy od 15.06.2026, bo funkcja wysyłała
 * do PostgREST kolumnę, której nie ma w tabeli. Nikt tego nie zauważył przez
 * kilka tygodni — strona wyglądała normalnie, przycisk się klikał, leady
 * po prostu znikały. Dlatego obok zwykłego „czy strona odpowiada" mamy tu
 * dwie rzeczy, których zwykły uptime monitor nie robi:
 *
 * 1. Sondy kontraktowe — wysyłają do funkcji brzegowej celowo błędne dane
 *    i sprawdzają, czy odpowiedź ma UMÓWIONY kształt. Funkcja niewdrożona,
 *    źle przekierowana albo wywalająca się na starcie nie odpowie „400 i taki
 *    komunikat", tylko czymkolwiek innym.
 * 2. Sonda ciszy — zlicza zgłoszenia z ostatnich godzin. Zero zgłoszeń
 *    w godzinach pracy przy działającej stronie to dokładnie ten sygnał,
 *    który tamtym razem nie zapalił się nikomu.
 */

/** Pojedynczy pomiar w ustalonym kształcie. */
const wynik = (sonda, ok, extra = {}) => ({ sonda, ok, czas: Date.now(), ...extra });

/** Fetch z twardym limitem czasu — Worker i tak ma budżet, ale wolimy własny. */
async function pobierz(url, opcje = {}, limitMs = 10_000) {
  const stop = new AbortController();
  const budzik = setTimeout(() => stop.abort(), limitMs);
  const start = Date.now();
  try {
    const odp = await fetch(url, { ...opcje, signal: stop.signal, redirect: 'manual' });
    return { odp, ms: Date.now() - start };
  } finally {
    clearTimeout(budzik);
  }
}

/* ── Sondy dostępności ──────────────────────────────────────────────────── */

/**
 * Strona odpowiada, ma oczekiwany status i zawiera fragment, który dowodzi,
 * że to naprawdę ta strona. Sam status 200 potrafi zwrócić strona błędu
 * podstawiona przez CDN.
 */
export function strona({ nazwa, url, zawiera, maxMs = 3000, status = 200 }) {
  return {
    nazwa,
    async uruchom() {
      try {
        const { odp, ms } = await pobierz(url);
        if (odp.status !== status) {
          return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: `oczekiwano ${status}` });
        }
        if (zawiera) {
          const tresc = await odp.text();
          if (!tresc.includes(zawiera)) {
            return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: `brak w treści: „${zawiera}"` });
          }
        }
        if (ms > maxMs) {
          return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: `wolno: ${ms} ms > ${maxMs} ms` });
        }
        return wynik(nazwa, true, { ms, kod: odp.status });
      } catch (e) {
        return wynik(nazwa, false, { szczegoly: e?.name === 'AbortError' ? 'przekroczony czas' : String(e) });
      }
    },
  };
}

/**
 * Przekierowanie — używane do sprawdzenia, czy pobieranie OWU działa.
 * Interesuje nas 302 i to, dokąd prowadzi; samego pliku nie ciągniemy,
 * bo to setki kilobajtów co pięć minut.
 */
export function przekierowanie({ nazwa, url, doDomeny, maxMs = 5000 }) {
  return {
    nazwa,
    async uruchom() {
      try {
        const { odp, ms } = await pobierz(url);
        if (odp.status !== 302) {
          return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: 'oczekiwano 302' });
        }
        const cel = odp.headers.get('location') ?? '';
        if (doDomeny && !cel.includes(doDomeny)) {
          return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: `przekierowanie poza ${doDomeny}` });
        }
        return wynik(nazwa, true, { ms, kod: odp.status });
      } catch (e) {
        return wynik(nazwa, false, { szczegoly: String(e) });
      }
    },
  };
}

/* ── Sondy kontraktowe ──────────────────────────────────────────────────── */

/**
 * Funkcja brzegowa dostaje celowo błędne dane i ma odpowiedzieć umówionym
 * błędem. To sprawdza wdrożenie, routing i obsługę ciała żądania naraz,
 * a nie tworzy żadnego zgłoszenia w bazie.
 */
export function kontraktFunkcji({ nazwa, url, cialo = '', status = 400, komunikatZawiera, maxMs = 6000 }) {
  return {
    nazwa,
    async uruchom() {
      try {
        const { odp, ms } = await pobierz(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: cialo,
        });
        if (odp.status !== status) {
          return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: `oczekiwano ${status}` });
        }
        const dane = await odp.json().catch(() => null);
        if (komunikatZawiera && !String(dane?.message ?? '').includes(komunikatZawiera)) {
          return wynik(nazwa, false, {
            ms, kod: odp.status,
            szczegoly: `inna odpowiedź niż umówiona: ${JSON.stringify(dane).slice(0, 200)}`,
          });
        }
        if (ms > maxMs) {
          return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: `wolno: ${ms} ms` });
        }
        return wynik(nazwa, true, { ms, kod: odp.status });
      } catch (e) {
        return wynik(nazwa, false, { szczegoly: String(e) });
      }
    },
  };
}

/**
 * Odczyt z PostgREST kluczem anonimowym — pilnuje RLS. Zmiana polityki, przez
 * którą publiczne treści przestają być czytelne, wygląda z zewnątrz jak pusty
 * blog, a nie jak błąd.
 */
export function odczytPubliczny({ nazwa, url, klucz, minWierszy = 1, maxMs = 5000 }) {
  return {
    nazwa,
    async uruchom() {
      try {
        const { odp, ms } = await pobierz(url, {
          headers: { apikey: klucz, Authorization: `Bearer ${klucz}` },
        });
        if (!odp.ok) {
          const tresc = await odp.text();
          return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: tresc.slice(0, 200) });
        }
        const wiersze = await odp.json();
        if (!Array.isArray(wiersze) || wiersze.length < minWierszy) {
          return wynik(nazwa, false, {
            ms, kod: odp.status,
            szczegoly: `${Array.isArray(wiersze) ? wiersze.length : 0} wierszy, oczekiwano ≥ ${minWierszy}`,
          });
        }
        if (ms > maxMs) return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: `wolno: ${ms} ms` });
        return wynik(nazwa, true, { ms, kod: odp.status });
      } catch (e) {
        return wynik(nazwa, false, { szczegoly: String(e) });
      }
    },
  };
}

/* ── Sonda ciszy ────────────────────────────────────────────────────────── */

/** Czy `data` wypada w godzinach pracy w Polsce (pn–pt 8:00–18:00). */
export function wGodzinachPracy(data, przesuniecieGodzin) {
  const lokalna = new Date(data.getTime() + przesuniecieGodzin * 3600_000);
  const dzien = lokalna.getUTCDay();
  const godzina = lokalna.getUTCHours();
  return dzien >= 1 && dzien <= 5 && godzina >= 8 && godzina < 18;
}

/**
 * Brak zgłoszeń przez dłuższy czas w godzinach pracy.
 *
 * To jedyna sonda, która nie sprawdza, czy coś odpowiada, tylko czy coś się
 * dzieje. Awaria formularza z czerwca nie zapaliła żadnej lampki właśnie
 * dlatego, że wszystkie usługi odpowiadały poprawnie — brakowało wyłącznie
 * skutku. Sonda milczy poza godzinami pracy i w weekendy, bo cisza o trzeciej
 * w nocy w niedzielę nic nie znaczy.
 */
export function cisza({ nazwa, url, klucz, godzin = 8, przesuniecieGodzin = 1, teraz = () => new Date() }) {
  return {
    nazwa,
    async uruchom() {
      const chwila = teraz();
      if (!wGodzinachPracy(chwila, przesuniecieGodzin)) {
        return wynik(nazwa, true, { szczegoly: 'poza godzinami pracy — nie oceniam' });
      }
      const od = new Date(chwila.getTime() - godzin * 3600_000).toISOString();
      try {
        const { odp, ms } = await pobierz(`${url}&created_at=gte.${od}`, {
          headers: { apikey: klucz, Authorization: `Bearer ${klucz}`, Prefer: 'count=exact', Range: '0-0' },
        });
        if (!odp.ok) {
          return wynik(nazwa, false, { ms, kod: odp.status, szczegoly: (await odp.text()).slice(0, 200) });
        }
        // PostgREST podaje liczbę w nagłówku Content-Range jako „0-0/12".
        const ile = Number(odp.headers.get('content-range')?.split('/')?.[1] ?? '0');
        if (ile === 0) {
          return wynik(nazwa, false, {
            ms, kod: odp.status,
            szczegoly: `zero zgłoszeń od ${godzin} h w godzinach pracy — sprawdź ścieżkę wysyłki`,
          });
        }
        return wynik(nazwa, true, { ms, kod: odp.status, szczegoly: `${ile} zgłoszeń / ${godzin} h` });
      } catch (e) {
        return wynik(nazwa, false, { szczegoly: String(e) });
      }
    },
  };
}
