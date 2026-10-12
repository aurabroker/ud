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

/*
 * Przypomnienie o ofercie bez odpowiedzi (decyzja właściciela z 12.10.2026).
 * Te same zasady co wyżej: bez linku, bez kodu, bez polskich znaków, jedna
 * część SMS-a. Bez „przypominamy o płatności" i podobnych zwrotów — to ma
 * brzmieć jak pomoc w sprawie, o którą klient sam prosił, nie jak ponaglenie.
 */
export const SMS_PRZYPOMNIENIE =
  'UtrataDochodu: Kilka dni temu wyslalismy Ci oferte ubezpieczenia na e-mail. Masz pytania? Chetnie pomozemy: 504 400 901';

/** Po ilu dniach od wysyłki oferty przypominamy i do ilu dni najdłużej. */
export const PRZYPOMNIENIE_PO_DNIACH = 3;
export const PRZYPOMNIENIE_NAJWYZEJ_DNI = 30;

/**
 * Najwięcej prób wysyłki w jednym wywołaniu (cron co godzinę, 10 godzin w dniu
 * roboczym — do 60 SMS-ów dziennie). Więcej nie zmieściłoby się w limicie 50
 * zapytań na wywołanie darmowego planu Workers (patrz przypomnieniaOfert.js).
 */
export const PRZYPOMNIENIA_NA_RAZ = 6;

/** Wielkanoc (niedziela) w kalendarzu gregoriańskim — algorytm Meeusa/Jonesa/Butchera. */
function wielkanoc(rok) {
  const a = rok % 19;
  const b = Math.floor(rok / 100);
  const c = rok % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const miesiac = Math.floor((h + l - 7 * m + 114) / 31);
  const dzien = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(rok, miesiac - 1, dzien);
}

/**
 * Czy dzień (rok, miesiąc 1–12, dzień) jest w Polsce ustawowo wolny od pracy
 * (ustawa o dniach wolnych od pracy; Wigilia od 2025). Niedziele wielkanocna
 * i Zielonych Świątek wypadają w niedzielę, więc odpadają i bez tej listy.
 */
export function swietoWPolsce(rok, miesiac, dzien) {
  const md = `${String(miesiac).padStart(2, '0')}-${String(dzien).padStart(2, '0')}`;
  const stale = ['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26'];
  if (stale.includes(md) || (md === '12-24' && rok >= 2025)) return true;
  const dzienMs = 24 * 3600 * 1000;
  const t = Date.UTC(rok, miesiac - 1, dzien);
  const w = wielkanoc(rok);
  return t === w + dzienMs || t === w + 60 * dzienMs;   // poniedziałek wielkanocny, Boże Ciało
}

/**
 * Czy teraz wolno wysłać przypomnienie: dni robocze (bez sobót, niedziel
 * i świąt), 9:00–18:59 czasu polskiego. SMS o ofercie w sobotę o 7 rano, w
 * nocy albo 11 listopada to prosty sposób, żeby klient zapamiętał nas źle.
 * Czas polski liczymy przez Intl, nie z przesunięcia UTC — zmiana czasu nie
 * przesuwa wtedy okna.
 * @param {Date} [teraz]
 */
export function wOknieWysylki(teraz = new Date()) {
  const czesci = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(teraz).map((p) => [p.type, p.value])
  );
  const godzina = Number(czesci.hour);
  if (['Sat', 'Sun'].includes(czesci.weekday)) return false;
  if (swietoWPolsce(Number(czesci.year), Number(czesci.month), Number(czesci.day))) return false;
  return godzina >= 9 && godzina < 19;
}
