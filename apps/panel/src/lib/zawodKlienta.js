/**
 * Zawód na stronie oferty: ten, który klient wskazał (`ud_clients.profession`).
 * Gdy klient zawodu nie podał — zawód z oferty ubezpieczyciela
 * (`ud_offer_documents.profession`, odczytany z PDF-u), z dopiskiem skąd.
 *
 * Zawodu z oferty NIE pokazujemy obok podanego przez klienta (v.0.74,
 * decyzja właściciela z 21.10.2026). Ubezpieczyciel ma własną listę zawodów
 * i agent sam wybiera z niej pozycję: „Stylistka paznokci" to w Leadenhall
 * „Kosmetyczka" i to jest ten sam zawód, nie rozjazd do wyjaśniania.
 */
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

/**
 * @param {string|null|undefined} zKartoteki  `ud_clients.profession` przypiętego klienta
 * @param {any[]} documents  warianty oferty
 * @returns {{ zawod: string|null, zOferty: boolean }}
 *   `zawod` — do pokazania; `zOferty` — true, gdy klient zawodu nie podał
 *   i pokazujemy zawód z dokumentu.
 */
export function zawodKlienta(zKartoteki, documents) {
  const wlasny = norm(zKartoteki);
  if (wlasny) return { zawod: wlasny, zOferty: false };
  const zDokumentow = [];
  for (const d of documents || []) {
    const z = norm(d?.profession);
    if (z && !zDokumentow.some((x) => x.toLowerCase() === z.toLowerCase())) zDokumentow.push(z);
  }
  return { zawod: zDokumentow.join(', ') || null, zOferty: zDokumentow.length > 0 };
}
