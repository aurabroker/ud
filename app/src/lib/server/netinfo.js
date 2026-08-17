/**
 * netinfo.js — informacje o połączeniu wychodzącym.
 * Cloudflare Workers nie mają stałego IP: adres pochodzi ze współdzielonej puli
 * i może się różnić między żądaniami oraz lokalizacjami. Odczyt służy do
 * zgłoszeń u dostawców, którzy filtrują ruch po adresie (np. SMSPlanet).
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
export async function outboundIp() {
  const [ipv4, ipv6] = await Promise.all([
    probe('https://api4.ipify.org?format=json', asJson).then((v) => v || probe('https://ipv4.icanhazip.com', asText)),
    probe('https://api6.ipify.org?format=json', asJson).then((v) => v || probe('https://ipv6.icanhazip.com', asText))
  ]);

  // Adres faktycznie użyty przy połączeniu — gdy dostępne oba, ruch idzie zwykle po IPv6.
  const ip = ipv6 || ipv4 || (await probe('https://api.ipify.org?format=json', asJson));

  return {
    ip: ip || null,
    ipv4: ipv4 || null,
    ipv6: ipv6 || null,
    ...(ip ? {} : { error: 'Nie udało się ustalić adresu wyjściowego.' })
  };
}
