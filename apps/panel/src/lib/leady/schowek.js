/**
 * Tekst do schowka. `navigator.clipboard` wymaga bezpiecznego kontekstu
 * i zgody przeglądarki; bez niej zostaje stary sposób przez ukryte pole.
 */
export async function kopiujDoSchowka(tekst) {
  try {
    await navigator.clipboard.writeText(tekst);
    return true;
  } catch {
    const pole = document.createElement('textarea');
    pole.value = tekst;
    pole.setAttribute('readonly', '');
    pole.style.position = 'fixed';
    pole.style.opacity = '0';
    document.body.append(pole);
    pole.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* brak schowka */ }
    pole.remove();
    return ok;
  }
}
