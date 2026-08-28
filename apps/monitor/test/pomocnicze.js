/**
 * Atrapa D1 na pamięci. Wystarczająco wierna dla zapytań, których używamy:
 * INSERT, SELECT po kluczu, UPSERT i DELETE po czasie. Prawdziwe D1 wymaga
 * workera, a logika alertowania jest zbyt ważna, żeby zostawić ją bez testu.
 */
export function atrapaD1() {
  const pomiary = [];
  const stany = new Map();

  const wykonaj = (sql, args) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('INSERT INTO pomiar')) {
      const [sonda, czas, ok, ms, kod, szczegoly] = args;
      pomiary.push({ sonda, czas, ok, ms, kod, szczegoly });
      return { run: true };
    }
    if (s.startsWith('SELECT ok, pod_rzad')) {
      return { first: stany.get(args[0]) ?? null };
    }
    if (s.startsWith('INSERT INTO stan')) {
      const [sonda, ok, pod_rzad, od, zgloszony, szczegoly] = args;
      stany.set(sonda, { sonda, ok, pod_rzad, od, zgloszony, szczegoly });
      return { run: true };
    }
    if (s.startsWith('SELECT sonda, ok, pod_rzad, od, szczegoly FROM stan')) {
      return { all: [...stany.values()].sort((a, b) => a.sonda.localeCompare(b.sonda)) };
    }
    if (s.startsWith('SELECT sonda, czas, kod, szczegoly FROM pomiar WHERE ok = 0')) {
      return { all: pomiary.filter((p) => p.ok === 0).sort((a, b) => b.czas - a.czas).slice(0, args[0]) };
    }
    if (s.startsWith('DELETE FROM pomiar WHERE czas <')) {
      const przed = pomiary.length;
      for (let i = pomiary.length - 1; i >= 0; i--) if (pomiary[i].czas < args[0]) pomiary.splice(i, 1);
      return { changes: przed - pomiary.length };
    }
    if (s.startsWith('SELECT sonda, COUNT(*)')) {
      const grupy = new Map();
      for (const p of pomiary.filter((p) => p.czas >= args[0])) {
        const g = grupy.get(p.sonda) ?? { sonda: p.sonda, pomiarow: 0, udanych: 0, suma: 0, max_ms: 0 };
        g.pomiarow++; g.udanych += p.ok; g.suma += p.ms ?? 0; g.max_ms = Math.max(g.max_ms, p.ms ?? 0);
        grupy.set(p.sonda, g);
      }
      return { all: [...grupy.values()].map((g) => ({ ...g, srednia_ms: Math.round(g.suma / g.pomiarow) })) };
    }
    throw new Error(`atrapa D1 nie zna zapytania: ${s.slice(0, 70)}`);
  };

  return {
    _pomiary: pomiary,
    _stany: stany,
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async run() { const r = wykonaj(sql, args); return { meta: { changes: r.changes ?? 0 } }; },
        async first() { return wykonaj(sql, args).first ?? null; },
        async all() { return { results: wykonaj(sql, args).all ?? [] }; },
      };
      return api;
    },
  };
}

/** Podstawia globalny fetch na czas jednego testu. */
export function podmienFetch(obsluga) {
  const oryginalny = globalThis.fetch;
  globalThis.fetch = obsluga;
  return () => { globalThis.fetch = oryginalny; };
}

export const odpowiedz = (cialo, init = {}) =>
  new Response(typeof cialo === 'string' ? cialo : JSON.stringify(cialo), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
