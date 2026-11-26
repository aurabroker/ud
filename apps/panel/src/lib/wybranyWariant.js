/**
 * Wariant oferty wybrany przez klienta (`ud_offers.client_choice.document_id`)
 * — jeden opis dla strony oferty, karty klienta i maila do agenta.
 *
 * Do 20.10.2026 panel pokazywał samo „Wybrano: Utrata dochodu (Leadenhall)",
 * czyli nazwę produktu — wspólną dla wszystkich wariantów oferty. Klientka
 * wybrała jeden z czterech i nikt w panelu nie umiał powiedzieć który.
 * Warianty jednej oferty rozróżnia numer dokumentu, kwoty i okres
 * wyczekiwania, więc to one stoją w opisie — z tymi samymi etykietami
 * i formatami co tabela porównania (`comparisonRows.js`), żeby agent od razu
 * trafił w kolumnę oznaczoną „✓ Wybrany".
 */
import { money, yesNo, offerNoDisplay } from './format.js';

const dni = (v) => (v != null ? `${v} dni` : '—');

/**
 * Dokument wybrany przez klienta albo null (brak wyboru, rezygnacja albo
 * wariant usunięty z oferty po decyzji klienta).
 * @param {any} choice  `ud_offers.client_choice`
 * @param {any[]} documents  warianty oferty
 */
export function wybranyWariant(choice, documents) {
  if (!choice || choice.rejected || !choice.document_id) return null;
  return (documents || []).find((d) => d?.id === choice.document_id) ?? null;
}

/**
 * Pary [etykieta, wartość] do karty „Klient wybrał wariant".
 * @param {any} d  wiersz `ud_offer_documents`
 * @returns {Array<[string, string]>}
 */
export function opisWariantu(d) {
  return [
    ['Numer oferty', offerNoDisplay(d.offer_number)],
    ['Świadczenie miesięczne', money(d.temp_monthly_benefit)],
    ['Okres odszkodowawczy', d.indemnity_period || '—'],
    ['Okres wyczekiwania (wypadek / choroba)', `${dni(d.wait_accident)} / ${dni(d.wait_illness)}`],
    ['Trwała niezdolność do pracy', d.perm_sum_insured != null ? money(d.perm_sum_insured) : yesNo(d.perm_incapacity_covered)],
    ['Śmierć / inwalidztwo (NW)',
      d.parsed_raw?.death_sum_insured != null ? money(d.parsed_raw.death_sum_insured) : yesNo(d.death_covered)],
    ['Składka roczna (łącznie)', money(d.premium_total)],
    ['Rata miesięczna', d.premium_monthly != null ? money(d.premium_monthly) : '—']
  ];
}

/**
 * Jedna linijka — lista ofert na karcie klienta i treść maila do agenta.
 * @param {any} d  wiersz `ud_offer_documents`
 */
export function krotkiOpis(d) {
  return [
    `nr ${offerNoDisplay(d.offer_number)}`,
    `${money(d.temp_monthly_benefit)} / mies.`,
    d.indemnity_period || null,
    `wyczekiwanie ${dni(d.wait_accident)} / ${dni(d.wait_illness)}`,
    `składka ${money(d.premium_total)} / rok`
  ].filter(Boolean).join(' · ');
}
