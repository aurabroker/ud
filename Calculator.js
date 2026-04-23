/* UtrataDochodu — calculator.js
   Symulator luki dochodowej (Hero) + Kalkulator składki
*/

/* ──────────────────────────────────────────
   SYMULATOR HERO
────────────────────────────────────────── */
function updateHeroSimulation() {
  const incomeSlider = document.getElementById('sim-income-slider');
  const daysSlider   = document.getElementById('sim-days-slider');
  if (!incomeSlider || !daysSlider) return;

  const income = parseInt(incomeSlider.value);
  const days   = parseInt(daysSlider.value);

  const minZusMonthly   = 2800;
  const fixedCostsMonthly = 2000 + Math.round(income * 0.1);

  const minZusDaily    = minZusMonthly / 30;
  const fixedCostsDaily = fixedCostsMonthly / 30;
  const policyDailyPayout = (income * 0.8) / 30;

  const waitingPeriod  = 21;
  const payableDays    = Math.max(0, days - waitingPeriod);

  const totalZus         = Math.round(minZusDaily * days);
  const totalCosts       = Math.round(fixedCostsDaily * days);
  const totalPolicyPayout = Math.round(policyDailyPayout * payableDays);

  const zusNetto    = totalZus - totalCosts;
  const policyNetto = totalZus + totalPolicyPayout - totalCosts;

  document.getElementById('sim-income-display').innerText =
    income.toLocaleString('pl-PL') + ' zł';
  document.getElementById('sim-days-display').innerText =
    `${days} dni (~${Math.round((days / 30) * 10) / 10} m-ca)`;

  document.getElementById('sim-zus-payout').innerText  = `+${totalZus.toLocaleString('pl-PL')} zł`;
  document.getElementById('sim-zus-costs').innerText   = `-${totalCosts.toLocaleString('pl-PL')} zł`;

  const zusResultEl = document.getElementById('sim-zus-result');
  zusResultEl.innerText = (zusNetto > 0 ? '+' : '') + zusNetto.toLocaleString('pl-PL') + ' zł';
  zusResultEl.className = zusNetto < 0
    ? 'text-xl sm:text-2xl font-black text-red-600 leading-none block mt-1'
    : 'text-xl sm:text-2xl font-black text-slate-700 leading-none block mt-1';

  document.getElementById('sim-policy-zus').innerText    = `+${totalZus.toLocaleString('pl-PL')} zł`;
  document.getElementById('sim-policy-payout').innerText = `+${totalPolicyPayout.toLocaleString('pl-PL')} zł`;
  document.getElementById('sim-policy-costs').innerText  = `-${totalCosts.toLocaleString('pl-PL')} zł`;

  const policyResultEl = document.getElementById('sim-policy-result');
  policyResultEl.innerText = (policyNetto > 0 ? '+' : '') + policyNetto.toLocaleString('pl-PL') + ' zł';
}

function initHeroSimulator() {
  const simIncomeSlider = document.getElementById('sim-income-slider');
  const simDaysSlider   = document.getElementById('sim-days-slider');
  if (!simIncomeSlider || !simDaysSlider) return;

  simIncomeSlider.addEventListener('input', updateHeroSimulation);
  simDaysSlider.addEventListener('input',   updateHeroSimulation);
  updateHeroSimulation();
}

/* ──────────────────────────────────────────
   KALKULATOR SKŁADKI
────────────────────────────────────────── */
function calculatePremium() {
  const calcIncomeSlider = document.getElementById('calc-income-slider');
  if (!calcIncomeSlider) return;

  const inc  = parseInt(calcIncomeSlider.value);
  const sum  = Math.round(inc * 0.8);
  let   rate = document.getElementById('calc-hiv').checked ? 0.018 : 0.015;

  let is24 = false;
  document.querySelectorAll('.calc-period-btn').forEach(b => {
    if (b.classList.contains('text-blue-600') && b.dataset.val === '24') is24 = true;
  });
  if (is24) rate *= 1.1;

  document.getElementById('calc-income-display').textContent = inc.toLocaleString('pl-PL') + ' zł';
  document.getElementById('calc-result').innerText    = Math.round(sum * rate);
  document.getElementById('calc-sum-insured').textContent = sum.toLocaleString('pl-PL') + ' zł';
  document.getElementById('calc-daily').textContent   = Math.round(sum / 30) + ' zł';
}

function initCalculator() {
  const calcIncomeSlider = document.getElementById('calc-income-slider');
  if (!calcIncomeSlider) return;

  calcIncomeSlider.addEventListener('input', calculatePremium);
  document.getElementById('calc-hiv').addEventListener('change', calculatePremium);

  document.querySelectorAll('.calc-period-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.calc-period-btn').forEach(b => {
        b.classList.remove('bg-white', 'text-blue-600', 'shadow-sm');
        b.classList.add('text-slate-500');
      });
      btn.classList.add('bg-white', 'text-blue-600', 'shadow-sm');
      btn.classList.remove('text-slate-500');
      calculatePremium();
    });
  });

  calculatePremium();
}

/* ──────────────────────────────────────────
   INIT
────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initHeroSimulator();
  initCalculator();
});
