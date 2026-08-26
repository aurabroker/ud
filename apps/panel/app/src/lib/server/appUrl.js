/**
 * appUrl.js — bazowy adres aplikacji do budowy linków dla klienta.
 * Nigdy nie zwraca adresu *.pages.dev (roboczy) — jeśli PUBLIC_APP_URL jest
 * pusty lub wskazuje na pages.dev, używamy kanonicznej domeny produkcyjnej.
 */
import { env as pubEnv } from '$env/dynamic/public';

const CANONICAL = 'https://app.utratadochodu.pl';

export function clientBaseUrl() {
  const v = (pubEnv.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  if (!v || /pages\.dev/i.test(v)) return CANONICAL;
  return v;
}
