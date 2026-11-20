/**
 * Menu klienta na liście „Klienci" — jeden model dla lewego klika w wiersz,
 * prawego klika i przycisku „⋯" (decyzja właściciela z 20.11.2026). Rysuje je
 * src/lib/leady/Menu.svelte, to samo co na tablicy leadów.
 *
 * E-mail zniknął z tabeli (kolumna „Kontakt" usunięta, telefon stoi pod
 * nazwiskiem) — jest tu, w „Napisz e-mail".
 */
import { zSeparatorami } from '../leady/model.js';

/** Numer do `tel:` — same cyfry i plus; bez cyfr = brak numeru. @param {unknown} telefon */
export function numerTel(telefon) {
  const n = typeof telefon === 'string' ? telefon.replace(/[^\d+]/g, '') : '';
  return /\d/.test(n) ? n : null;
}

/** Adres do `mailto:` — bez odstępów, z jedną małpą w środku; inaczej null. @param {unknown} email */
export function adresEmail(email) {
  const e = typeof email === 'string' ? email.trim() : '';
  return /^[^\s@]+@[^\s@]+$/.test(e) ? e : null;
}

/**
 * @param {{ id: string, phone?: string | null, email?: string | null, akcja?: { link?: string | null } | null }} klient
 * @param {string} zapytanie  filtry listy ('' albo '?widok=…&zrodlo=…') — karta je niesie dalej
 * @returns {({ id: string, etykieta: string, grupa: string, href?: string } | { separator: true })[]}
 */
export function akcjeKlienta(klient, zapytanie = '') {
  const id = encodeURIComponent(klient.id);
  /** @type {{ id: string, etykieta: string, grupa: string, href?: string }[]} */
  const pozycje = [
    { id: 'karta', etykieta: 'Otwórz kartę klienta', grupa: 'klient', href: `/panel/klienci/${id}${zapytanie}` },
    { id: 'oferta', etykieta: 'Utwórz ofertę', grupa: 'klient', href: `/panel/new?client=${id}` },
  ];
  // Zarchiwizowanego leada nie ma na tablicy (akcja.link = null) — pozycji też nie ma.
  if (klient.akcja?.link) pozycje.push({ id: 'tablica', etykieta: 'Pokaż na tablicy', grupa: 'klient', href: klient.akcja.link });
  const tel = numerTel(klient.phone);
  const email = adresEmail(klient.email);
  if (tel) pozycje.push({ id: 'zadzwon', etykieta: `Zadzwoń: ${String(klient.phone).trim()}`, grupa: 'kontakt', href: `tel:${tel}` });
  if (email) pozycje.push({ id: 'email', etykieta: `Napisz e-mail: ${email}`, grupa: 'kontakt', href: `mailto:${email}` });
  if (tel) pozycje.push({ id: 'kopiuj-telefon', etykieta: 'Kopiuj telefon', grupa: 'kontakt' });
  return zSeparatorami(pozycje);
}
