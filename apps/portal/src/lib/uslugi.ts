/**
 * uslugi.ts — adresy usług zewnętrznych i klucze publiczne.
 *
 * Wszystkie te wartości i tak są widoczne w źródle każdej strony: adres
 * projektu Supabase, klucz witryny Turnstile, identyfikatory tagów. Nie są
 * sekretami — sekrety (TURNSTILE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY)
 * żyją po stronie funkcji brzegowych.
 *
 * Skoro nie są sekretami, mają tu wartości domyślne. Powód jest praktyczny:
 * brak zmiennej środowiskowej w panelu hostingu kończył się formularzem,
 * który wygląda na sprawny i odrzuca każde zgłoszenie — Turnstile nie
 * dostawał klucza, więc wniosek leciał bez tokenu, a funkcja go odrzucała.
 * Zmienna pozwala je nadpisać, ale jej brak nie może psuć wysyłki.
 */

/** Ustawienie z panelu albo wartość wbudowana. */
const zmienna = (wartosc: string | undefined, domyslna: string) =>
  wartosc && wartosc.trim() !== '' ? wartosc : domyslna;

export const SUPABASE_URL = zmienna(
  import.meta.env.PUBLIC_SUPABASE_URL,
  'https://kukvgsjrmrqtzhkszzum.supabase.co',
);

export const TURNSTILE_KLUCZ = zmienna(
  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY,
  '0x4AAAAAADgSxo_FfjvXKO29',
);

/** Adres funkcji brzegowej — jedno miejsce zamiast czterech sklejeń. */
export const funkcja = (nazwa: string) => `${SUPABASE_URL}/functions/v1/${nazwa}`;
