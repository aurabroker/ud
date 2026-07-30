/**
 * parseCEU.js — parser oferty CEU (LOI PREMIUM).
 * Kotwiczy się na etykietach z pozycji 1-13 oferty (strony 1-2).
 */
import { emptyOffer } from './model.js';
import {
  firstMatch, matchInt, matchAmount, isCovered, parseDateISO
} from './helpers.js';

/**
 * Wytnij fragment tekstu między dwoma kotwicami (start włącznie, end wyłącznie).
 */
function section(text, startRe, endRe) {
  const s = text.search(startRe);
  if (s < 0) return '';
  const rest = text.slice(s);
  const e = endRe ? rest.search(endRe) : -1;
  return e < 0 ? rest : rest.slice(0, e);
}

/**
 * @param {string} text - pełny tekst PDF (z unpdf)
 * @returns {import('./model.js').NormalizedOffer}
 */
export function parseCEU(text) {
  const o = emptyOffer('ceu');

  o.offer_number = firstMatch(text, /Oferta\s+nr\s+(LOIP\/\S+)/i);
  o.product_name = firstMatch(text, /UBEZPIECZENIE\s+(LOI\s+\w+)/i);
  o.offer_valid_from = parseDateISO(firstMatch(text, /z\s+dnia\s+(\d{2}-\d{2}-\d{4})/i));
  o.offer_valid_to = parseDateISO(firstMatch(text, /ważna\s+do\s+(\d{2}-\d{2}-\d{4})/i));

  // --- Ubezpieczony ---
  o.insured_name = firstMatch(text, /polisie\s+([A-ZŁŚŻŹĆŃ][a-ząćęłńóśźż]+)/);
  o.insured_birthdate = parseDateISO(firstMatch(text, /Data\s+urodzenia:\s*(\d{2}-\d{2}-\d{4})/i));
  o.profession = firstMatch(text, /Zawód:\s*([^\n]+)/i);
  o.employment_type = firstMatch(text, /Rodzaj\s+zatrudnienia:\s*([\s\S]+?)\n\s*\d+\.\s/i);
  if (o.employment_type) o.employment_type = o.employment_type.replace(/\s*\n\s*/g, ' ').trim();
  o.insurance_period = firstMatch(text, /Okres\s+Ubezpieczenia\s+(\d+\s*miesi[a-ząćęłńóśźż]+)/i);

  // --- Świadczenia: Czasowa (temp) ---
  const tempSec = section(
    text,
    /Czasowa\s+całkowita\s+niezdolność/i,
    /Trwała\s+całkowita\s+niezdolność/i
  );
  o.temp_incapacity_covered = isCovered(firstMatch(tempSec, /(Nie\s+objęt\w+|Objęt\w+)\s+ubezpieczeniem/i));
  o.temp_monthly_benefit = matchAmount(tempSec, /Maksymalne\s+świadczenie\s+miesięczne\s+([\d  ]+,\d{2})\s*zł/i);
  o.temp_monthly_pct = matchInt(tempSec, /nie\s+może\s+przekroczyć\s+(\d+)\s*%/i);
  o.temp_daily_cap = matchAmount(tempSec, /oraz\s+([\d  ]+)\s*PLN\/dzień/i);
  o.temp_sum_insured = matchAmount(tempSec, /Suma\s+ubezpieczenia\s+([\d  ]+,\d{2})\s*zł/i);
  o.indemnity_period = firstMatch(tempSec, /Okres\s+świadczeń\s+(\d+\s*miesi[a-ząćęłńóśźż]+)/i);
  const waitM = tempSec.match(/(\d+)\s*\(wypadek\)\s*\/\s*(\d+)\s*\(choroba\)/i);
  if (waitM) {
    o.wait_accident = parseInt(waitM[1], 10);
    o.wait_illness = parseInt(waitM[2], 10);
  }

  // --- Świadczenia: Trwała (perm) ---
  const permSec = section(
    text,
    /Trwała\s+całkowita\s+niezdolność/i,
    /Klauzule\s+opcjonalne|Ryzyka\s+aktywnego/i
  );
  o.perm_incapacity_covered = isCovered(firstMatch(permSec, /(Nie\s+objęt\w+|Objęt\w+)\s+ubezpieczeniem/i));
  o.perm_sum_insured = matchAmount(permSec, /Suma\s+ubezpieczenia\s+([\d  ]+,\d{2})\s*zł/i);
  o.perm_wait = firstMatch(permSec, /Okres\s+oczekiwania\s+(\d+\s*miesi[a-ząćęłńóśźż]+)/i);
  o.max_benefit = /(\d+)-\s*krotności/i.test(permSec) ? '10-krotność przychodu rocznego' : null;

  // --- Klauzule opcjonalne ---
  const hospital = isCovered(firstMatch(
    text,
    /Dzienne\s+świadczenie\s+z\s+tytułu\s+pobytu\s+w\s+szpitalu\s+(Nie\s+objęt\w+|Objęt\w+)/i
  ));

  // --- Śmierć: brak w CEU LOI PREMIUM ---
  o.death_covered = false;

  // --- Składka (pozycja 9) ---
  o.premium_total = matchAmount(text, /Łączna\s+składka\s+roczna\s+([\d  ]+,\d{2})\s*zł/i);
  const monthlyM = text.match(/Składka\s+miesięczna,\s*(\d+)\s*rat\s+po\s+([\d  ]+,\d{2})\s*zł/i);
  if (monthlyM) {
    o.installments = parseInt(monthlyM[1], 10);
    o.premium_monthly = matchAmount(text, /Składka\s+miesięczna,\s*\d+\s*rat\s+po\s+([\d  ]+,\d{2})\s*zł/i);
  }

  // --- OWU / przychód / data ---
  o.owu_symbol = firstMatch(text, /Ogólne\s+Warunki\s+Ubezpieczenia\s+"([^"]+)"/i);
  o.avg_monthly_income = matchAmount(text, /wynoszą\s+([\d  ]+,?\d*)\s*PLN/i);
  o.offer_date = parseDateISO(firstMatch(text, /Warszawa,\s*(\d{2}-\d{2}-\d{4})/i));

  o.parsed_raw = {
    opt_hospital_daily_covered: hospital,
    premium_annual: o.premium_total,
    premium_monthly: o.premium_monthly,
    installments: o.installments,
    avg_monthly_income: o.avg_monthly_income
  };

  return o;
}
