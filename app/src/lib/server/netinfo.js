/**
 * netinfo.js — informacje o połączeniu wychodzącym.
 * Cloudflare Workers nie mają stałego IP: adres pochodzi ze współdzielonej puli
 * i może się różnić między żądaniami oraz lokalizacjami. Odczyt służy do
 * zgłoszeń u dostawców, którzy filtrują ruch po adresie (np. SMSPlanet).
 */

/**
 * @returns {Promise<{ ip: string|null, source: string, error?: string }>}
 */
export async function outboundIp() {
  const probes = [
    { url: 'https://api.ipify.org?format=json', pick: (t) => JSON.parse(t)?.ip },
    { url: 'https://api64.ipify.org?format=json', pick: (t) => JSON.parse(t)?.ip },
    { url: 'https://icanhazip.com', pick: (t) => String(t || '').trim() }
  ];

  for (const p of probes) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(p.url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const ip = p.pick(await res.text());
      if (ip) return { ip: String(ip), source: new URL(p.url).host };
    } catch {
      /* następna próba */
    }
  }
  return { ip: null, source: '', error: 'Nie udało się ustalić adresu wyjściowego.' };
}
