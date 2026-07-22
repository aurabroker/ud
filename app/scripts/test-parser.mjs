/**
 * test-parser.mjs — test parsera na 2 realnych PDF-ach.
 * Uruchom: node scripts/test-parser.mjs <leadenhall.pdf> <ceu.pdf>
 */
import { readFile } from 'node:fs/promises';
import { parseOfferPdf } from '../src/lib/pdf/index.js';

const LH = process.argv[2];
const CEU = process.argv[3];

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(26)} = ${JSON.stringify(actual)}${ok ? '' : `  (oczekiwano ${JSON.stringify(expected)})`}`);
}

// ---------- Leadenhall ----------
{
  console.log('\n=== LEADENHALL ===');
  const { offer, insurer_type, totalPages } = await parseOfferPdf(new Uint8Array(await readFile(LH)));
  console.log(`  typ=${insurer_type}  stron=${totalPages}`);
  check('offer_number', offer.offer_number, 'LHQ3177434/1');
  check('insured_name', offer.insured_name, 'Przemysław');
  check('insured_city', offer.insured_city, '61-609 Poznań');
  check('profession', offer.profession, 'Przedstawiciel handlowy');
  check('risk_class', offer.risk_class, 'II');
  check('insurance_period', offer.insurance_period, '12 miesięcy');
  check('death_covered', offer.death_covered, false);
  check('temp_incapacity_covered', offer.temp_incapacity_covered, true);
  check('temp_monthly_benefit', offer.temp_monthly_benefit, 10000);
  check('indemnity_period', offer.indemnity_period, '24 miesiące');
  check('wait_illness', offer.wait_illness, 21);
  check('wait_accident', offer.wait_accident, 14);
  check('perm_incapacity_covered', offer.perm_incapacity_covered, false);
  check('perm_sum_insured', offer.perm_sum_insured, 240000);
  check('premium_total', offer.premium_total, 3036);
  check('distribution_fee', offer.distribution_fee, 276);
  check('installments', offer.installments, 12);
  check('premium_monthly', offer.premium_monthly, 253);
  check('owu_symbol', offer.owu_symbol, 'LW044/AD_D_TTD_PTD/PL/3');
  check('offer_date', offer.offer_date, '2026-05-28');
  console.log('  base_premium(raw):', offer.parsed_raw.base_premium);
}

// ---------- CEU ----------
{
  console.log('\n=== CEU ===');
  const { offer, insurer_type, totalPages } = await parseOfferPdf(new Uint8Array(await readFile(CEU)));
  console.log(`  typ=${insurer_type}  stron=${totalPages}`);
  check('offer_number', offer.offer_number, 'LOIP/2026/000276');
  check('product_name', offer.product_name, 'LOI PREMIUM');
  check('offer_valid_from', offer.offer_valid_from, '2026-06-01');
  check('offer_valid_to', offer.offer_valid_to, '2026-06-30');
  check('insured_name', offer.insured_name, 'Bartosz');
  check('insured_birthdate', offer.insured_birthdate, '1980-04-21');
  check('profession', offer.profession, 'Project manager');
  check('employment_type', offer.employment_type, 'Samozatrudnienie, umowa cywilnoprawna, działalność gospodarcza, kontrakt menadżerski');
  check('insurance_period', offer.insurance_period, '12 miesięcy');
  check('temp_incapacity_covered', offer.temp_incapacity_covered, true);
  check('temp_monthly_benefit', offer.temp_monthly_benefit, 16700);
  check('temp_daily_cap', offer.temp_daily_cap, 5000);
  check('temp_sum_insured', offer.temp_sum_insured, 392450);
  check('indemnity_period', offer.indemnity_period, '24 miesiące');
  check('wait_accident', offer.wait_accident, 14);
  check('wait_illness', offer.wait_illness, 21);
  check('perm_incapacity_covered', offer.perm_incapacity_covered, true);
  check('perm_sum_insured', offer.perm_sum_insured, 2400000);
  check('perm_wait', offer.perm_wait, '24 miesiące');
  check('premium_total', offer.premium_total, 13464.96);
  check('premium_monthly', offer.premium_monthly, 1122.08);
  check('installments', offer.installments, 12);
  check('owu_symbol', offer.owu_symbol, 'LOI PREMIUM');
  check('avg_monthly_income', offer.avg_monthly_income, 20908);
  check('offer_date', offer.offer_date, '2026-06-01');
  console.log('  opt_hospital_daily_covered(raw):', offer.parsed_raw.opt_hospital_daily_covered);
}

console.log(`\n${failures === 0 ? '✅ WSZYSTKIE ASERCJE OK' : `❌ ${failures} ASERCJI NIE PRZESZŁO`}`);
process.exit(failures === 0 ? 0 : 1);
