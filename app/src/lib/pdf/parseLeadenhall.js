/**
 * parseLeadenhall.js — parser oferty Leadenhall (Lloyd's).
 * Kotwiczy się na etykietach z pozycji 1-14 oferty (strony 1-4).
 */
import { emptyOffer } from './model.js';
import {
  firstMatch, matchInt, matchAmount, parseAmount, isCovered, parseDateISO
} from './helpers.js';

/**
 * @param {string} text - pełny tekst PDF (z unpdf)
 * @returns {import('./model.js').NormalizedOffer}
 */
export function parseLeadenhall(text) {
  const o = emptyOffer('leadenhall');

  o.offer_number = firstMatch(text, /Oferta\s+nr\s+(LHQ\S+)/i);
  o.product_name = 'Utrata dochodu (Leadenhall)';

  // --- Ubezpieczony ---
  o.insured_name = firstMatch(text, /na\s+polisie\s+([A-ZŁŚŻŹĆŃ][a-ząćęłńóśźż]+)/);
  o.insured_city = firstMatch(text, /(\d{2}-\d{3}\s+[A-ZŁ][^\n,]+)/);
  o.profession = firstMatch(text, /Zawód:\s*([^\n(]+?)\s*(?:\n|\()/);
  o.risk_class = firstMatch(text, /\(\s*([IVX]+)\s+Klasa\s+ryzyka/i);
  o.insurance_period = firstMatch(text, /ubezpieczenia\)\s*(\d+\s*miesi[a-ząćęłńóśźż]+)/i)
    || firstMatch(text, /Okres\s+ubezpieczenia\s+(\d+\s*miesi[a-ząćęłńóśźż]+)/i);

  // --- Świadczenia ---
  // Pozycja A — Śmierć i Inwalidztwo
  o.death_covered = isCovered(firstMatch(text, /Pozycja\s+A\s*-\s*(Nie\s+objęta|Objęta)/i));

  // Pozycja B — Całkowita okresowa niezdolność do pracy
  o.temp_incapacity_covered = isCovered(firstMatch(text, /Pozycja\s+B\s*-\s*(Nie\s+objęta|Objęta)/i));
  o.temp_monthly_benefit = matchAmount(text, /([\d  ]+)\s*zł,\s*nie\s+więcej\s+jednak\s+niż/i);
  o.indemnity_period = firstMatch(text, /Okres\s+odszkodowawczy\s+(\d+\s*miesi[a-ząćęłńóśźż]+)/i);
  o.wait_illness = matchInt(text, /Okres\s+wyczekiwania\s*\(choroba\)\s+(\d+)\s*dni/i);
  o.wait_accident = matchInt(text, /Okres\s+wyczekiwania\s*\(wypadek\)\s+(\d+)\s*dni/i);

  // Pozycja C — Całkowita trwała niezdolność do pracy
  o.perm_incapacity_covered = isCovered(firstMatch(text, /Pozycja\s+C\s*-\s*(Nie\s+objęta|Objęta)/i));
  o.perm_sum_insured = matchAmount(text, /Całkowitej\s+trwałej\s+niezdolności\s+do\s+pracy\s*-\s*([\d  ]+)\s*zł/i);

  // Maksymalna suma świadczeń
  o.max_benefit = /(\d+)-\s*krotności\s+Przychodu\s+rocznego/i.test(text)
    ? '10-krotność Przychodu rocznego'
    : null;

  // --- Płatność (pozycja 10) ---
  const base_premium = matchAmount(text, /\bSkładka\s+([\d  ]+)\s*zł/i);            // 2 760
  o.distribution_fee = matchAmount(text, /Opłata\s+dystrybucyjna\s+([\d  ]+)\s*zł/i); // 276
  const totalM = text.match(/([\d  ]+)\s*zł\s+płatne\s+w\s+(\d+)\s*ratach/i);        // 3 036 / 12
  const total_to_pay = totalM ? parseAmount(totalM[1]) : null;
  o.premium_total = total_to_pay
    ?? (base_premium != null && o.distribution_fee != null ? base_premium + o.distribution_fee : base_premium);
  o.installments = totalM ? parseInt(totalM[2], 10) : null;
  o.premium_monthly = (o.premium_total != null && o.installments)
    ? Math.round((o.premium_total / o.installments) * 100) / 100
    : null;

  // --- OWU / data ---
  o.owu_symbol = firstMatch(text, /Warunki\s+ubezpieczenia\s+(LW\S+?)\./i)
    || firstMatch(text, /(LW044\/\S+)/);
  o.offer_date = parseDateISO(firstMatch(text, /Warszawa,\s*(\d{1,2}\s+[a-ząćęłńóśźż]+\s+\d{4})/i));

  o.parsed_raw = {
    base_premium,
    distribution_fee: o.distribution_fee,
    total_to_pay: o.premium_total,
    installments: o.installments
  };

  return o;
}
