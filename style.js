/* UtrataDochodu — form.js
   Wizard wielokrokowy, walidacja PESEL, wysyłka do Supabase + Web3Forms
*/

/* ──────────────────────────────────────────
   WIZARD STATE
────────────────────────────────────────── */
let activeSteps    = ['step-1', 'step-2', 'step-3', 'step-4'];
let currentStepIndex = 0;

function updateWizardUI() {
  document.querySelectorAll('.step-container').forEach(el => el.classList.add('hidden'));
  document.getElementById(activeSteps[currentStepIndex]).classList.remove('hidden');

  const stepNum = currentStepIndex + 1;
  const total   = activeSteps.length;
  const percent = Math.round((stepNum / total) * 100);

  document.getElementById('step-indicator').textContent = `Krok ${stepNum} z ${total}`;
  document.getElementById('step-percent').textContent   = `${percent}%`;
  document.getElementById('progress-bar-fill').style.width = `${percent}%`;

  document.getElementById('prev-btn').classList.toggle('hidden', currentStepIndex === 0);
  document.getElementById('next-btn').classList.toggle('hidden', currentStepIndex === total - 1);
  document.getElementById('submit-btn').classList.toggle('hidden', currentStepIndex !== total - 1);
}

function goNext() {
  const currentStepEl = document.getElementById(activeSteps[currentStepIndex]);
  const inputs = currentStepEl.querySelectorAll('input, select, textarea');

  for (const input of inputs) {
    if (!input.checkValidity()) {
      input.reportValidity();
      return;
    }
  }

  if (currentStepIndex < activeSteps.length - 1) {
    currentStepIndex++;
    updateWizardUI();
  }
}

function goPrev() {
  if (currentStepIndex > 0) {
    currentStepIndex--;
    updateWizardUI();
  }
}

/* ──────────────────────────────────────────
   KROK PRACODAWCY — toggle na checkbox
────────────────────────────────────────── */
function initEmployerToggle() {
  const checkbox = document.getElementById('employsPeople');
  if (!checkbox) return;

  checkbox.addEventListener('change', e => {
    activeSteps = e.target.checked
      ? ['step-1', 'step-employer', 'step-2', 'step-3', 'step-4']
      : ['step-1', 'step-2', 'step-3', 'step-4'];
    updateWizardUI();
  });
}

/* ──────────────────────────────────────────
   WALIDACJA PESEL
────────────────────────────────────────── */
function validatePesel(pesel) {
  if (pesel.length !== 11) return 'PESEL musi składać się dokładnie z 11 cyfr.';

  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(pesel.charAt(i)) * weights[i];
  }
  const control = (10 - (sum % 10)) % 10;
  if (control !== parseInt(pesel.charAt(10))) {
    return 'Nieprawidłowy numer PESEL (błąd sumy kontrolnej).';
  }
  return '';
}

function initPeselValidation() {
  const peselInput = document.querySelector('input[name="pesel"]');
  if (!peselInput) return;

  peselInput.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').substring(0, 11);
    const error = validatePesel(this.value);
    this.setCustomValidity(error);
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

function showSuccessModal(form) {
  document.getElementById('success-modal').classList.remove('hidden');
  form.reset();
  currentStepIndex = 0;
  updateWizardUI();
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

    const btn     = document.getElementById('submit-btn');
    const origTxt = btn.innerText;
    btn.innerText = 'Wysyłanie…';
    btn.disabled  = true;

    try {
      const dataObj = collectFormData(form);
      const mainRes = await submitToSupabase(dataObj);

      if (mainRes.status === 'success') {
        console.log('Supabase:', mainRes.supabase, '| GetResponse:', mainRes.getresponse);
        showSuccessModal(form);
      } else {
        console.error('Błąd:', mainRes.message);
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
function closeSuccessModal() {
  document.getElementById('success-modal').classList.add('hidden');
}

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
  initEmployerToggle();
  initPeselValidation();
  initFormSubmit();
  updateWizardUI();

  document.getElementById('prev-btn')?.addEventListener('click', goPrev);
  document.getElementById('next-btn')?.addEventListener('click', goNext);

  document.getElementById('calc-to-form-btn')
    ?.addEventListener('click', () =>
      document.getElementById('wniosek')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  document.getElementById('exclusions-trigger-btn')
    ?.addEventListener('click', toggleExclusionsModal);
  document.getElementById('exclusions-modal-backdrop')
    ?.addEventListener('click', toggleExclusionsModal);
  document.getElementById('exclusions-close-btn')
    ?.addEventListener('click', toggleExclusionsModal);
  document.getElementById('success-modal-close')
    ?.addEventListener('click', closeSuccessModal);
  document.getElementById('error-modal-close')
    ?.addEventListener('click', closeErrorModal);
});
