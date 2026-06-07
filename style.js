/* UtrataDochodu — style.js
   Wizard wielokrokowy (Alpine.js), walidacja PESEL, wysyłka do Supabase
*/

/* ──────────────────────────────────────────
   ALPINE — WIZARD STATE
────────────────────────────────────────── */
document.addEventListener('alpine:init', () => {
  Alpine.data('formWizard', () => ({
    _all: ['step-1', 'step-employer', 'step-2', 'step-risks', 'step-3', 'step-info', 'step-4'],
    current: 0,
    employsPeople: false,

    get steps()   { return this._all.filter(s => s !== 'step-employer' || this.employsPeople); },
    get total()   { return this.steps.length; },
    get stepNum() { return this.current + 1; },
    get percent() { return Math.round((this.stepNum / this.total) * 100); },
    get currentId() { return this.steps[this.current]; },
    get isFirst() { return this.current === 0; },
    get isLast()  { return this.current === this.total - 1; },

    isActive(id) { return this.currentId === id; },

    next() {
      const el = document.getElementById(this.currentId);
      for (const input of el.querySelectorAll('input, select, textarea')) {
        if (!input.checkValidity()) { input.reportValidity(); return; }
      }
      if (!this.isLast) { this.current++; window.scrollTo(0, 0); }
    },

    prev() {
      if (!this.isFirst) { this.current--; window.scrollTo(0, 0); }
    },

    toggleEmployer(checked) {
      this.employsPeople = checked;
      if (this.current >= this.steps.length) this.current = this.steps.length - 1;
    },
  }));
});

/* ──────────────────────────────────────────
   KLAUZULE NW — toggle warunkowy
────────────────────────────────────────── */
function initNwToggle() {
  const deathCheckbox  = document.getElementById('riskDeathInvalidity');
  const clausesSection = document.getElementById('nw-clauses-section');
  if (!deathCheckbox || !clausesSection) return;

  deathCheckbox.addEventListener('change', e => {
    if (!e.target.checked) clausesSection.classList.add('hidden');
  });

  const sumInput = document.getElementById('nwDeathSum');
  if (sumInput) {
    sumInput.addEventListener('change', e => {
      const val = parseInt(e.target.value, 10);
      clausesSection.classList.toggle('hidden', !deathCheckbox.checked || val < 300000);
    });
  }
}

/* ──────────────────────────────────────────
   WALIDACJA PESEL
────────────────────────────────────────── */
function validatePesel(pesel) {
  if (pesel.length !== 11) return 'PESEL musi składać się dokładnie z 11 cyfr.';
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(pesel.charAt(i)) * weights[i];
  const control = (10 - (sum % 10)) % 10;
  if (control !== parseInt(pesel.charAt(10))) return 'Nieprawidłowy numer PESEL (błąd sumy kontrolnej).';
  return '';
}

function initPeselValidation() {
  const peselInput = document.querySelector('input[name="pesel"]');
  if (!peselInput) return;
  peselInput.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').substring(0, 11);
    this.setCustomValidity(validatePesel(this.value));
  });
}

/* ──────────────────────────────────────────
   WYSYŁKA FORMULARZA
────────────────────────────────────────── */
const EDGE_FN_URL = 'https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/form-submit';

const BOOL_FIELDS = [
  'med_heart','med_diabetes','med_bones','med_stomach','med_neuro','med_surgery','med_aids',
  'risk_caving','risk_climbing','risk_extreme_bike_boat','risk_diving','risk_sailing',
  'risk_horse','risk_skiing','risk_hunting','risk_quad','risk_aviation_non_comm',
  'risk_balloon','risk_skydiving','risk_paragliding','risk_horse_jumping',
  'risk_gravity_bike','risk_motorcycle','risk_aviation',
  'exclusions_accepted','employsPeople',
  'weightChange','takesMeds','pendingDiagnosis','disabilityCongenital','smoker',
  'eventHospitalization','eventSickLeave30','eventFurtherDiagnosis',
  'riskDeathInvalidity','riskTempIncapacity','riskPermIncapacity',
  'nwPermanentDamage',
  'informedAccepted',
];

function collectFormData(form) {
  const dataObj = Object.fromEntries(new FormData(form).entries());
  BOOL_FIELDS.forEach(f => {
    const el = form.querySelector(`[name="${f}"]`);
    if (!el) return;
    if (el.type === 'checkbox') {
      dataObj[f] = el.checked ? 'Yes' : 'No';
    } else if (el.type === 'radio') {
      dataObj[f] = form.querySelector(`[name="${f}"]:checked`)?.value || 'No';
    }
  });
  if (dataObj.employsPeople === 'Yes') {
    const slider = document.getElementById('emp_slider');
    if (slider) dataObj.emp_contribution = slider.value + '%';
  }
  return dataObj;
}

async function submitToSupabase(dataObj) {
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dataObj),
  });
  return res.json();
}

function showErrorModal(message) {
  document.getElementById('error-message').textContent =
    message || 'Nie udało się wysłać formularza. Spróbuj ponownie później.';
  document.getElementById('error-modal').classList.remove('hidden');
}

function initFormSubmit() {
  const form = document.getElementById('insurance-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const turnstileToken = form.querySelector('[name="cf-turnstile-response"]')?.value;
    if (!turnstileToken) {
      showErrorModal('Proszę potwierdzić, że nie jesteś robotem.');
      return;
    }

    const btn     = document.getElementById('submit-btn');
    const origTxt = btn.innerText;
    btn.innerText = 'Wysyłanie…';
    btn.disabled  = true;

    try {
      const dataObj = collectFormData(form);
      dataObj['cf-turnstile-response'] = turnstileToken;
      const mainRes = await submitToSupabase(dataObj);
      if (mainRes.status === 'success') {
        window.location.href = '/thankyou.html';
      } else {
        showErrorModal(mainRes.message);
      }
    } catch (err) {
      console.error('Błąd sieci:', err);
      showErrorModal();
    } finally {
      btn.innerText = origTxt;
      btn.disabled  = false;
    }
  });
}

/* ──────────────────────────────────────────
   MODALS
────────────────────────────────────────── */
function closeErrorModal() {
  document.getElementById('error-modal').classList.add('hidden');
}

function toggleExclusionsModal() {
  document.getElementById('exclusions-modal').classList.toggle('hidden');
}

/* ──────────────────────────────────────────
   INIT
────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initNwToggle();
  initPeselValidation();
  initFormSubmit();

  document.getElementById('calc-to-form-btn')
    ?.addEventListener('click', () =>
      document.getElementById('wniosek')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  document.getElementById('exclusions-trigger-btn')
    ?.addEventListener('click', toggleExclusionsModal);
  document.getElementById('exclusions-modal-backdrop')
    ?.addEventListener('click', toggleExclusionsModal);
  document.getElementById('exclusions-close-btn')
    ?.addEventListener('click', toggleExclusionsModal);
  document.getElementById('error-modal-close')
    ?.addEventListener('click', closeErrorModal);
});
