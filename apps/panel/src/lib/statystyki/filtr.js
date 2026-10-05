/**
 * Adres z filtrami Statystyk / wykazu polis: zmiana jednego zostawia drugi.
 * `stan` = { okres, agent } (agent tylko u administratora).
 */
export function adresFiltra(stan, zmiana = {}) {
  const q = new URLSearchParams();
  const okres = zmiana.okres ?? stan?.okres ?? 'wszystko';
  const agent = 'agent' in zmiana ? zmiana.agent : stan?.agent ?? null;
  if (okres && okres !== 'wszystko') q.set('okres', okres);
  if (agent) q.set('agent', agent);
  return `?${q}`;
}
