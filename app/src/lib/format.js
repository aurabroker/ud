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

export function insurerLabel(t) {
  return { leadenhall: 'Leadenhall (Lloyd’s)', ceu: 'CEU — LOI Premium' }[t] || t || '—';
}

export function dateP(s) {
  return s ? new Date(s).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}
