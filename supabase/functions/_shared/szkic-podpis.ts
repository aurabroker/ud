/**
 * Podpis HMAC dla szkiców wniosków — wspólny dla `wniosek-szkic` (weryfikuje)
 * i `wniosek-przypomnienie` (wystawia link do wycofania zgody).
 *
 * Sekret `SZKIC_HMAC_SECRET` leży w Edge Functions → Secrets, nie w kodzie.
 * Podpis obejmuje przedrostek, więc ten sam sekret służy do skrótu IP bez ryzyka,
 * że skrót adresu zadziała jako podpis szkicu (i odwrotnie).
 */

const enc = new TextEncoder();

async function klucz(sekret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(sekret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const odHex = (s: string): Uint8Array | null => {
  if (!/^[0-9a-f]+$/.test(s) || s.length % 2 !== 0) return null;
  return Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
};

/** Podpis linku wycofania zgody dla szkicu o danym id. */
export async function podpiszWycofanie(id: string, sekret: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', await klucz(sekret), enc.encode(`wycofaj:${id}`)));
}

/** Weryfikacja w stałym czasie (crypto.subtle.verify), bez porównywania napisów. */
export async function sprawdzWycofanie(id: string, podpis: string, sekret: string): Promise<boolean> {
  const bajty = odHex(String(podpis ?? '').toLowerCase());
  if (!bajty || bajty.length !== 32) return false;
  return crypto.subtle.verify('HMAC', await klucz(sekret), bajty, enc.encode(`wycofaj:${id}`));
}

/** Skrót adresu IP do limitu żądań — niewracalny bez sekretu, zerowany po dobie. */
export async function skrotIp(ip: string, sekret: string): Promise<string> {
  const pelny = hex(await crypto.subtle.sign('HMAC', await klucz(sekret), enc.encode(`ip:${ip}`)));
  return pelny.slice(0, 32);
}
