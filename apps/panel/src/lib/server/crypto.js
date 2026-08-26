/**
 * crypto.js — PIN i tokeny. Web Crypto (natywne na Cloudflare Workers).
 * Brak zależności zewnętrznych.
 */

const enc = new TextEncoder();

/** Losowy token współdzielenia (URL-safe, 24 znaki). */
export function generateShareToken() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let t = '';
  for (let i = 0; i < 24; i++) t += c[bytes[i] % c.length];
  return t;
}

/** 4-cyfrowy PIN (0000-9999) z bezpiecznego źródła losowości. */
export function generatePin() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return String(n).padStart(4, '0');
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash PIN przez PBKDF2-SHA256 z losową solą.
 * Zwraca string "pbkdf2$<iter>$<saltHex>$<hashHex>".
 */
export async function hashPin(pin, iterations = 100000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `pbkdf2$${iterations}$${toHex(salt)}$${toHex(bits)}`;
}

/**
 * Podpisuje wartość HMAC-SHA256. Zwraca "<value>.<sigHex>".
 * Używane do zabezpieczenia ciasteczka potwierdzenia PIN (klient nie sfałszuje).
 */
export async function hmacSign(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return `${value}.${toHex(sig)}`;
}

/** Weryfikuje podpisaną wartość. Zwraca oryginalną wartość lub null. */
export async function hmacVerify(signed, secret) {
  if (!signed || typeof signed !== 'string') return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const expected = await hmacSign(value, secret);
  if (expected.length !== signed.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signed.charCodeAt(i);
  return diff === 0 ? value : null;
}

/** Weryfikacja PIN względem zapisanego hasha (stały czas porównania hex). */
export async function verifyPin(pin, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, iterStr, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const iterations = parseInt(iterStr, 10);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const computed = toHex(bits);
  // porównanie w stałym czasie
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}
