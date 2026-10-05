/**
 * Zaślepka modułów `$app/*` SvelteKita dla serwera testowego (sam Vite, bez
 * routera): układ panelu czyta `page` ze `$app/stores`, strona statystyk woła
 * `goto` z `$app/navigation`. Renderujemy je po stronie serwera — nawigacji
 * tu nie ma, więc `goto` niczego nie robi.
 */

const DOMYSLNA = { url: new URL('http://127.0.0.1/panel/leady'), data: {} };
/** Serwer testowy może podstawić adres i dane strony na czas jednego renderu. */
export const page = { subscribe: (run) => { run(globalThis.__zaslepkaStrony ?? DOMYSLNA); return () => {}; } };
export async function goto() {}
/** Harness statystyk w przeglądarce podstawia tu ponowne pobranie danych strony. */
export async function invalidateAll() {
  if (typeof window !== 'undefined' && window.__invalidateAll) await window.__invalidateAll();
}
