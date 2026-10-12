/**
 * Stawka prowizji agenta: % składki rocznej (bez opłaty dystrybucyjnej), 0–100,
 * do dwóch miejsc po przecinku (decyzja właściciela z 04.10.2026: „prowizja
 * Centrali to 20%, … przy dodawaniu agentów będziemy to definiować").
 * Pusto = nieustawiona — statystyki mówią wtedy „stawka nieustawiona" i nie
 * liczą prowizji. `undefined` = błędny wpis.
 */
export function stawkaZFormularza(v) {
  const t = String(v ?? '').trim().replace('%', '').replace(',', '.').trim();
  if (!t) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return n <= 100 ? n : undefined;
}
