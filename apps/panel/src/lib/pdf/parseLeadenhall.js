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
/**
 * Status pokrycia dla Pozycji A/B/C. Leadenhall drukuje etykietę w dwóch układach:
 *   „Pozycja C - Nie objęta ubezpieczeniem”  (etykieta PO oznaczeniu pozycji)
 *   „- Objęta ubezpieczeniemPozycja C”       (etykieta PRZED oznaczeniem pozycji)
 * @returns {boolean|null}
 */
function coveredForPosition(text, letter) {
  const after = firstMatch(text, new RegExp(`Pozycja\\s+${letter}\\s*-\\s*(Nie\\s+objęta|Objęta)`, 'i'));
  if (after != null) return isCovered(after);
  const before = firstMatch(text, new RegExp(`(Nie\\s+objęta|Objęta)\\s*ubezpieczeniem\\s*Pozycja\\s+${letter}\\b`, 'i'));
  return before != null ? isCovered(before) : null;
}

/**
 * Fragment tekstu należący do danej Pozycji — do początku następnej pozycji.
 * Dla Pozycji C kończymy przed „Łączne świadczenie…”, bo ta linia nie należy do Pozycji C.
 */
function sectionForPosition(text, letter, nextLetter) {
  const re = nextLetter
    ? new RegExp(`Pozycja\\s+${letter}([\\s\\S]*?)(?=Pozycja\\s+${nextLetter}|$)`, 'i')
    : new RegExp(`Pozycja\\s+${letter}([\\s\\S]*?)(?=Łączne\\s+świadczenie|\\n\\s*6\\.\\s|$)`, 'i');
  return firstMatch(text, re);
}

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
  o.death_covered = coveredForPosition(text, 'A');
  // Kwota z Pozycji A (brak kolumny w bazie → trzymamy w parsed_raw).
  const secA = sectionForPosition(text, 'A', 'B');
  const deathSum = secA ? matchAmount(secA, /([\d  ]+)\s*zł/) : null;

  // Pozycja B — Całkowita okresowa niezdolność do pracy
  o.temp_incapacity_covered = coveredForPosition(text, 'B');
  o.temp_monthly_benefit = matchAmount(text, /([\d  ]+)\s*zł,\s*nie\s+więcej\s+jednak\s+niż/i);
  o.temp_monthly_pct = matchInt(text, /nie\s+więcej\s+jednak\s+niż\s+(\d+)\s*%/i);
  o.indemnity_period = firstMatch(text, /Okres\s+odszkodowawczy\s+(\d+\s*miesi[a-ząćęłńóśźż]+)/i);
  o.wait_illness = matchInt(text, /Okres\s+wyczekiwania\s*\(choroba\)\s+(\d+)\s*dni/i);
  o.wait_accident = matchInt(text, /Okres\s+wyczekiwania\s*\(wypadek\)\s+(\d+)\s*dni/i);

  // Pozycja C — Całkowita trwała niezdolność do pracy.
  // Kwotę bierzemy WYŁĄCZNIE z sekcji Pozycji C. Linia „Łączne świadczenie w przypadku
  // Całkowitej trwałej niezdolności do pracy" jest celowo pomijana (nie jest sumą z Pozycji C).
  o.perm_incapacity_covered = coveredForPosition(text, 'C');
  const posC = sectionForPosition(text, 'C');
  o.perm_sum_insured = posC ? matchAmount(posC, /([\d  ]+)\s*zł/) : null;

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

  // Bazowy prefiks OWU (LW044 / LW046 / LW047).
  const owuBase = (o.owu_symbol && (o.owu_symbol.match(/LW0\d{2}/i) || [])[0]) || null;

  // HIV/WZW liczy się tylko gdy FAKTYCZNIE objęte — oferta stwierdza status wprost:
  //   objęte:    „…zakażenia wirusem HIV jest objęte ubezpieczeniem"
  //   nieobjęte: „…HIV i WZW nie są objęte ubezpieczeniem"
  // (uwaga: nie używamy \b wokół polskich liter, np. „są" — ą nie jest znakiem słowa w JS regex)
  const hivExcluded = /(?:HIV|WZW)[^.\n]{0,40}nie\s+(?:są|sa|jest)\s+objęt|(?:HIV|WZW)[^.\n]{0,40}nie\s+obejmuj|(?:HIV|WZW)[^.\n]{0,40}wyłączon/i.test(text);
  const hivCovered =
    /zakażeni\w*\s+wirus\w+\s+(?:HIV|WZW)\s+jest\s+objęt/i.test(text) ||
    /(?:HIV|WZW)[^.\n]{0,40}\bjest\s+objęt\w*\s+ubezpieczeni/i.test(text);
  const coversHivWzw = hivCovered && !hivExcluded;

  // Symbol warunków HIV/WZW faktycznie wskazany w ofercie (LW048 lub LW049 – wariant medyczny).
  const hivSymMatch =
    text.match(/wypadek\s+zakażeni\w*\s+wirus\w+\s+HIV\s+oraz\s+WZW[^.]{0,90}?(LW\d{3})/i) ||
    text.match(/zakażeni\w*\s+wirus\w+\s+HIV[^.]{0,90}?oznaczon\w+\s+symbolem\s+(LW\d{3})/i);
  const hivOwuSymbol = coversHivWzw && hivSymMatch ? hivSymMatch[1].toUpperCase() : null;

  o.parsed_raw = {
    base_premium,
    distribution_fee: o.distribution_fee,
    total_to_pay: o.premium_total,
    installments: o.installments,
    owu_base: owuBase ? owuBase.toUpperCase() : null,
    covers_hiv_wzw: coversHivWzw,
    hiv_owu_symbol: hivOwuSymbol,
    death_sum_insured: deathSum
  };

  return o;
}
