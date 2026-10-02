/**
 * Klient endpointów tablicy leadów (src/routes/panel/leady/api/*).
 *
 * Najważniejsze: ponawianie z TYM SAMYM kluczem idempotencji. Gdy odpowiedź
 * zginęła po drodze (zerwane połączenie, 502 z proxy), nie wiemy, czy zapis się
 * odbył. Ponowienie z tym samym `idempotencyKey` jest wtedy bezpieczne: serwer
 * zwróci wynik pierwszego wykonania zamiast wykonywać drugi raz. Po wyczerpaniu
 * prób rzucamy BladSieci — wołający MUSI wtedy sprawdzić stan leada zamiast
 * zakładać, że zapis się nie udał.
 *
 * Statusów 4xx (409 konflikt, 403, 404, 422…) nie ponawiamy: to odpowiedź
 * serwera, nie awaria transportu.
 */

/** Nie wiadomo, czy serwer wykonał żądanie. */
export class BladSieci extends Error {
  /** @param {number} proby */
  constructor(proby) {
    super('Nie udało się połączyć z serwerem.');
    this.name = 'BladSieci';
    this.proby = proby;
  }
}

const PONAWIANE = new Set([502, 503, 504]);

/**
 * @param {{ fetch?: typeof fetch, baza?: string, naglowki?: Record<string, string>,
 *           proby?: number, opoznienia?: number[], czekaj?: (ms: number) => Promise<void> }} [opcje]
 */
export function utworzApi({
  fetch: f = globalThis.fetch?.bind(globalThis),
  baza = '/panel/leady/api',
  naglowki = {},
  proby = 3,
  opoznienia = [400, 1200],
  czekaj = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  /** @returns {Promise<{ status: number, body: any }>} */
  async function wyslij(url, opcje, sygnal) {
    for (let proba = 1; ; proba++) {
      let odpowiedz;
      try {
        odpowiedz = await f(url, { ...opcje, signal: sygnal });
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        if (proba >= proby) throw new BladSieci(proba);
        await czekaj(opoznienia[Math.min(proba - 1, opoznienia.length - 1)]);
        continue;
      }

      let body;
      try {
        body = await odpowiedz.json();
      } catch {
        // Strona błędu proxy zamiast JSON-a: to samo co zerwane połączenie.
        if (proba >= proby) throw new BladSieci(proba);
        await czekaj(opoznienia[Math.min(proba - 1, opoznienia.length - 1)]);
        continue;
      }

      if ((PONAWIANE.has(odpowiedz.status) || (odpowiedz.status >= 500 && body?.ponow)) && proba < proby) {
        await czekaj(opoznienia[Math.min(proba - 1, opoznienia.length - 1)]);
        continue;
      }
      return { status: odpowiedz.status, body };
    }
  }

  const post = (sciezka, tresc) =>
    wyslij(`${baza}/${sciezka}`, {
      method: 'POST',
      headers: { ...naglowki, 'content-type': 'application/json' },
      body: JSON.stringify(tresc),
    });

  const get = (sciezka, parametry, sygnal) => {
    const q = parametry instanceof URLSearchParams ? parametry.toString() : new URLSearchParams(parametry).toString();
    return wyslij(`${baza}/${sciezka}${q ? `?${q}` : ''}`, { method: 'GET', headers: { ...naglowki } }, sygnal);
  };

  /** Filtr + sort → parametry zapytania (tylko ustawione). */
  const parametryFiltra = ({ filtr = {}, sort, pipeline, ...reszta }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtr)) if (v) p.set(k, String(v));
    if (sort) p.set('sort', sort);
    if (pipeline) p.set('pipeline', pipeline);
    for (const [k, v] of Object.entries(reszta)) if (v !== undefined && v !== null) p.set(k, String(v));
    return p;
  };

  return {
    zmien: (tresc) => post('zmien', tresc),
    notatka: (tresc) => post('notatka', tresc),
    zwin: (tresc) => post('zwin', tresc),
    kolumna: (parametry, sygnal) => get('kolumna', parametryFiltra(parametry), sygnal),
    liczniki: (parametry, sygnal) => get('liczniki', parametryFiltra(parametry), sygnal),
    lead: (id, sygnal) => get(`lead/${encodeURIComponent(id)}`, {}, sygnal),
    warianty: (id, sygnal) => get(`warianty/${encodeURIComponent(id)}`, {}, sygnal),
  };
}
