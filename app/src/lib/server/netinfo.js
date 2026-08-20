/**
 * netinfo.js — informacje o połączeniu wychodzącym.
 * Cloudflare Workers nie mają stałego IP: adres pochodzi ze współdzielonej puli
 * i może się różnić między żądaniami oraz lokalizacjami. Odczyt służy do
 * zgłoszeń u dostawców, którzy filtrują ruch po adresie.
 */

async function probe(url, pick) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const v = pick(await res.text());
    return v ? String(v).trim() : null;
  } catch {
    return null;
  }
}

const asJson = (t) => {
  try { return JSON.parse(t)?.ip; } catch { return null; }
};
const asText = (t) => String(t || '').trim();

/**
 * Adresy wyjściowe aplikacji. Sprawdzamy osobno IPv4 i IPv6, bo Workers
 * najczęściej wychodzą po IPv6, a dostawcy filtrujący ruch pytają o oba.
 * @returns {Promise<{ ip: string|null, ipv4: string|null, ipv6: string|null, error?: string }>}
 */
const isV4 = (a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(a || ''));
const isV6 = (a) => String(a || '').includes(':');

export async function outboundIp() {
  const [a4, a6] = await Promise.all([
    probe('https://api4.ipify.org?format=json', asJson).then((v) => v || probe('https://ipv4.icanhazip.com', asText)),
    probe('https://api6.ipify.org?format=json', asJson).then((v) => v || probe('https://ipv6.icanhazip.com', asText))
  ]);

  // Usługi „v4" potrafią odpowiedzieć adresem IPv6, gdy połączenie i tak poszło
  // po IPv6 — bez sprawdzenia formatu ten sam adres trafiłby do obu pól.
  const ipv4 = isV4(a4) ? a4 : isV4(a6) ? a6 : null;
  const ipv6 = isV6(a6) ? a6 : isV6(a4) ? a4 : null;

  // Ruch wychodzi tym adresem, którym faktycznie nawiązano połączenie.
  const ip = ipv6 || ipv4 || null;

  return {
    ip,
    ipv4,
    ipv6,
    ...(ip ? {} : { error: 'Nie udało się ustalić adresu wyjściowego.' })
  };
}
