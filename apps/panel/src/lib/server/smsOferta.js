/**
 * smsOferta.js — SMS „wysłaliśmy Ci ofertę" przy wysyłce oferty.
 *
 * Decyzja właściciela z 12.10.2026: po wysłanym e-mailu z ofertą klient
 * dostaje też SMS, że oferta czeka w skrzynce. SMS jest WYŁĄCZNIE
 * zawiadomieniem — bez linku i bez kodu dostępu. Kodem jest PESEL, który
 * klient zna z dowodu (patrz sendOfferToClient), a link w SMS-ie od nieznanego
 * nadawcy uczy klientów klikać w linki z SMS-ów — dokładnie ten nawyk, na
 * którym żerują oszuści „na dopłatę do przesyłki".
 *
 * Treść bez polskich znaków: z nimi SMS przechodzi na UCS-2, gdzie jedna część
 * ma 70 znaków zamiast 160 — ta sama wiadomość kosztowałaby dwa SMS-y.
 * Tak samo pisze wiadomość próbna w Ustawieniach.
 *
 * Plik bez importów `$env` i `$lib`, żeby dało się go sprawdzić zwykłym Node'em
 * (scripts/test-sms-oferta.mjs).
 */

/*
 * „UtrataDochodu", nie „UtrataDochodu.pl": telefon zamienia gołą domenę
 * w klikalny odnośnik, a SMS ma być bez linku (patrz wyżej).
 */
export const SMS_OFERTA =
  'UtrataDochodu: Wlasnie wyslalismy do Ciebie oferte. Sprawdz maila (takze folder Spam). Pytania: 504 400 901';

/** Znaki alfabetu GSM 03.38 bez rozszerzeń — tylko te mieszczą się po 160 w jednej części. */
const GSM = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà]*$/;

/** Czy treść zmieści się w JEDNEJ części SMS-a (GSM 7-bit, ≤ 160 znaków). */
export function jednaCzesc(tresc) {
  return GSM.test(tresc) && tresc.length <= 160;
}

/**
 * Numer do wysyłki w formacie 48XXXXXXXXX albo null.
 *
 * Bierzemy tylko numery polskie (9 cyfr, opcjonalnie z 48 / +48 / 0048).
 * Zagraniczny albo ucięty numer to null: wysyłka nie powinna zgadywać
 * kierunkowego, a SMS pod zły numer to cudza skrzynka z naszą wiadomością.
 */
export function numerDoSms(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('0048')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('48')) d = d.slice(2);
  if (!/^[1-9]\d{8}$/.test(d)) return null;
  return `48${d}`;
}
