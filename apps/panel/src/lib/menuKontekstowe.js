/**
 * Kiedy panel przejmuje kliknięcie i pokazuje własne menu — wspólna reguła
 * tablicy leadów (src/lib/leady/Tablica.svelte) i listy klientów
 * (src/routes/panel/klienci/+page.svelte). Menu to src/lib/leady/Menu.svelte.
 */

/** Zaznaczony tekst obejmujący element — wtedy kliknięcie kończy zaznaczanie, a nie prosi o menu. @param {Element} cel */
function zaznaczonyTekst(cel) {
  const z = typeof window !== 'undefined' ? window.getSelection?.() : null;
  return Boolean(z && !z.isCollapsed && z.toString().trim() && z.containsNode?.(cel, true));
}

/**
 * Prawy klik: natywne menu przeglądarki zostaje przy Shift (w Firefoksie
 * Shift + prawy klik i tak je wymusza), na linkach („Otwórz w nowej karcie"),
 * w polach formularzy i na zaznaczonym tekście („Kopiuj"). preventDefault
 * tylko wtedy, gdy ta funkcja zwróci false i NAPRAWDĘ otwieramy własne menu.
 * @param {MouseEvent & { target: any }} e
 */
export function czyNatywneMenu(e) {
  if (e.shiftKey) return true;
  if (e.target?.closest?.('a[href], input, textarea, select, [contenteditable="true"]')) return true;
  return zaznaczonyTekst(e.target);
}

/** Elementy, które same obsługują lewy klik — wtedy menu wiersza się nie otwiera. */
const SAME_SIE_KLIKAJA = 'a[href], button, input, textarea, select, label, summary, [contenteditable="true"], [role="button"], [role="menuitem"]';

/**
 * Lewy klik w wiersz listy otwiera menu (decyzja właściciela z 20.11.2026:
 * „dodaj menu do lewego przycisku myszy") — ale nie wtedy, gdy klik trafia w
 * link, przycisk albo pole (mają swoją robotę), kończy zaznaczanie tekstu
 * (agent kopiuje numer), jest drugim kliknięciem dwukliku (zaznacza słowo)
 * albo idzie z klawiszem (Shift rozszerza zaznaczenie, Ctrl/Cmd — nowa karta).
 * @param {MouseEvent & { target: any }} e
 */
export function czyKlikOtwieraMenu(e) {
  if (e.defaultPrevented || e.button !== 0) return false;
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.detail > 1) return false;
  if (e.target?.closest?.(SAME_SIE_KLIKAJA)) return false;
  return !zaznaczonyTekst(e.target);
}
