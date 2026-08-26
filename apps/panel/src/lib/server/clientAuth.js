/**
 * clientAuth.js — bramka PIN dla widoku klienta (bez sesji Supabase).
 * Po poprawnym PIN ustawiamy podpisane HMAC ciasteczko httpOnly.
 */
import { hmacSign, hmacVerify } from './crypto.js';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

function secret() {
  return env.PIN_COOKIE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || 'dev-secret-change-me';
}

export function cookieName(offerId) {
  return `ud_offer_${offerId}`;
}

/** Ustawia ciasteczko potwierdzające weryfikację PIN (scoped do ścieżki oferty). */
export async function setVerifiedCookie(cookies, offerId, token, ttlHours = 48) {
  const signed = await hmacSign(offerId, secret());
  cookies.set(cookieName(offerId), signed, {
    path: `/offer/${token}`,
    httpOnly: true,
    secure: !dev,
    sameSite: 'lax',
    maxAge: ttlHours * 3600
  });
}

/** Czy klient przeszedł już weryfikację PIN dla tej oferty. */
export async function isVerified(cookies, offerId) {
  const c = cookies.get(cookieName(offerId));
  if (!c) return false;
  return (await hmacVerify(c, secret())) === offerId;
}
