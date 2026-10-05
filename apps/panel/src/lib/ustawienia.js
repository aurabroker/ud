/**
 * „Ustawienia" w nagłówku panelu (decyzja właściciela z 05.10.2026): dawne
 * zakładki Wysyłki, Panel Admina i Ustawienia pod jedną pozycją obok nazwy
 * konta. Strony zostają pod swoimi adresami — łączy je pasek UstawieniaNav.
 */
export const SEKCJE_USTAWIEN = [
  { href: '/panel/logi', label: 'Wysyłki' },
  { href: '/panel/admin', label: 'Panel Admina', admin: true },
  { href: '/panel/ustawienia', label: 'Ustawienia systemu', admin: true },
];

/** Sekcje dostępne dla roli; pierwsza z nich to cel przycisku w nagłówku. */
export const sekcjeUstawien = (admin) => SEKCJE_USTAWIEN.filter((s) => !s.admin || admin);

export const wSekcji = (sciezka, s) => sciezka === s.href || sciezka.startsWith(s.href + '/');

/** Czy strona należy do „Ustawień" (podświetlenie przycisku w nagłówku). */
export const wUstawieniach = (sciezka) => SEKCJE_USTAWIEN.some((s) => wSekcji(sciezka, s));
