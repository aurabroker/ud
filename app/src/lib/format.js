/** format.js — formatowanie liczb/kwot (bezpieczne dla przeglądarki). */

const nf = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 13464.96 -> "13 464,96 zł" | null -> "—" */
export function money(n) {
  if (n == null || n === '') return '—';
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return '—';
  return nf.format(v) + ' zł';
}

export function yesNo(b) {
  if (b === true) return 'Tak';
  if (b === false) return 'Nie';
  return '—';
}

/** Etykieta nagłówka kolumny (przedstawiciel Lloyd's). */
export function insurerLabel(t) {
  return { leadenhall: 'Leadenhall Insurance SA', ceu: 'CEU — LOI Premium' }[t] || t || '—';
}

/** Wartość w wierszu „Ubezpieczyciel" — zawsze Lloyd's (Leadenhall i CEU to coverholderzy Lloyd's). */
export function insurerRow() {
  return 'Lloyd’s';
}

export function dateP(s) {
  return s ? new Date(s).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}
