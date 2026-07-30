/**
 * model.js — wspólny, znormalizowany model oferty (Leadenhall + CEU).
 * Pola mapują się 1:1 na kolumny tabeli ud_offer_documents.
 */

/**
 * @typedef {Object} NormalizedOffer
 * @property {'leadenhall'|'ceu'} insurer_type
 * @property {string|null} offer_number
 * @property {string|null} product_name
 * @property {string|null} insured_name
 * @property {string|null} insured_birthdate
 * @property {string|null} insured_city
 * @property {string|null} profession
 * @property {string|null} risk_class
 * @property {string|null} employment_type
 * @property {string|null} insurance_period
 * @property {boolean|null} death_covered
 * @property {boolean|null} temp_incapacity_covered
 * @property {number|null} temp_monthly_benefit
 * @property {number|null} temp_monthly_pct
 * @property {number|null} temp_sum_insured
 * @property {number|null} temp_daily_cap
 * @property {boolean|null} perm_incapacity_covered
 * @property {number|null} perm_sum_insured
 * @property {string|null} perm_wait
 * @property {string|null} indemnity_period
 * @property {number|null} wait_accident
 * @property {number|null} wait_illness
 * @property {string|null} max_benefit
 * @property {number|null} premium_total
 * @property {number|null} premium_monthly
 * @property {number|null} distribution_fee
 * @property {number|null} installments
 * @property {number|null} avg_monthly_income
 * @property {string|null} offer_valid_from
 * @property {string|null} offer_valid_to
 * @property {string|null} offer_date
 * @property {string|null} owu_symbol
 * @property {Object} parsed_raw
 */

/** Zwraca pusty, znormalizowany obiekt oferty z domyślnymi null. */
export function emptyOffer(insurer_type) {
  return {
    insurer_type,
    offer_number: null,
    product_name: null,
    insured_name: null,
    insured_birthdate: null,
    insured_city: null,
    profession: null,
    risk_class: null,
    employment_type: null,
    insurance_period: null,
    death_covered: null,
    temp_incapacity_covered: null,
    temp_monthly_benefit: null,
    temp_monthly_pct: null,
    temp_sum_insured: null,
    temp_daily_cap: null,
    perm_incapacity_covered: null,
    perm_sum_insured: null,
    perm_wait: null,
    indemnity_period: null,
    wait_accident: null,
    wait_illness: null,
    max_benefit: null,
    premium_total: null,
    premium_monthly: null,
    distribution_fee: null,
    installments: null,
    avg_monthly_income: null,
    offer_valid_from: null,
    offer_valid_to: null,
    offer_date: null,
    owu_symbol: null,
    parsed_raw: {}
  };
}
