/**
 * Zaślepka modułów `$app/*` SvelteKita dla serwera testowego (sam Vite, bez
 * routera): układ panelu czyta `page` ze `$app/stores`, strona statystyk woła
 * `goto` z `$app/navigation`. Renderujemy je po stronie serwera — nawigacji
 * tu nie ma, więc `goto` niczego nie robi.
 */
import { readable } from 'svelte/store';

export const page = readable({ url: new URL('http://127.0.0.1/panel/leady') });
export async function goto() {}
/** Harness statystyk w przeglądarce podstawia tu ponowne pobranie danych strony. */
export async function invalidateAll() {
  if (typeof window !== 'undefined' && window.__invalidateAll) await window.__invalidateAll();
}
