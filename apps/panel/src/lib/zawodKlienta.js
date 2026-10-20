/**
 * Zawód na stronie oferty (v.0.73, 20.10.2026): ten, który klient wskazał
 * (`ud_clients.profession`), a obok — jeśli inny — zawód, pod jakim wycenił
 * go ubezpieczyciel (`ud_offer_documents.profession`, odczytany z PDF-u).
 *
 * To dwie różne rzeczy i obie są agentowi potrzebne: klientka pisze
 * „Stylistka paznokci", Leadenhall wycenia ją jako „Kosmetyczka". Pokazanie
 * tylko jednego z nich chowa rozjazd, o który klient może zapytać.
 */
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

/**
 * @param {string|null|undefined} zKartoteki  `ud_clients.profession` przypiętego klienta
 * @param {any[]} documents  warianty oferty
 * @returns {{ zawod: string|null, zOferty: boolean, wOfercie: string|null }}
 *   `zawod` — do pokazania; `zOferty` — true, gdy klient zawodu nie podał
 *   i pokazujemy zawód z dokumentu; `wOfercie` — zawód z dokumentów, gdy inny
 *   niż podany przez klienta (bez rozróżniania wielkości liter i odstępów).
 */
export function zawodKlienta(zKartoteki, documents) {
  const wlasny = norm(zKartoteki) || null;
  const zDokumentow = [];
  for (const d of documents || []) {
    const z = norm(d?.profession);
    if (z && !zDokumentow.some((x) => x.toLowerCase() === z.toLowerCase())) zDokumentow.push(z);
  }
  if (!wlasny) {
    return { zawod: zDokumentow.join(', ') || null, zOferty: zDokumentow.length > 0, wOfercie: null };
  }
  const inne = zDokumentow.filter((z) => z.toLowerCase() !== wlasny.toLowerCase());
  return { zawod: wlasny, zOferty: false, wOfercie: inne.join(', ') || null };
}
