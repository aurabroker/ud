/* UtrataDochodu — style.js
   Wizard wielokrokowy, walidacja PESEL, wysyłka do Supabase
*/

/* ──────────────────────────────────────────
   WIZARD STATE
────────────────────────────────────────── */
const BASE_STEPS = ['step-1', 'step-2', 'step-risks', 'step-3', 'step-info', 'step-4'];
let activeSteps    = [...BASE_STEPS];
let currentStepIndex = 0;

/* ──────────────────────────────────────────
   HEALTH SURVEY — spec zmiana_2 (perm_incapacity_sum > 1 000 000)
────────────────────────────────────────── */
const HEALTH_SURVEY_THRESHOLD = 1_000_000;
const HEALTH_SURVEY = [
  { grupa: 'Informacje ogólne', pytania: [
    { key: 'weight_change',         pytanie: 'Zmiana wagi ciała ponad 5 kg w ciągu ostatniego roku (niezwiązana z ciążą/porodem)', kolumna: 'weight_change' },
    { key: 'takes_meds',            pytanie: 'Przyjmowanie na stałe leków przepisanych przez lekarza', kolumna: 'takes_meds' },
    { key: 'pending_diagnosis',     pytanie: 'Aktualnie prowadzona jest diagnostyka, trwa oczekiwanie na wyniki badań, zabieg lub rozważane jest zasięgnięcie porady lekarskiej ze względu na aktualnie odczuwane objawy chorobowe', kolumna: 'pending_diagnosis' },
    { key: 'disability_congenital', pytanie: 'Czy występują u Pana/Pani trwałe ograniczenie sprawności lub wady wrodzone?', kolumna: 'disability_congenital' },
    { key: 'smoker',                pytanie: 'Czy pali Pan/Pani papierosy lub inne wyroby tytoniowe?', kolumna: 'smoker' },
  ]},
  { grupa: 'Zdarzenia medyczne', pytania: [
    { key: 'event_hospitalization',   pytanie: 'Miała miejsce hospitalizacja', kolumna: 'event_hospitalization' },
    { key: 'event_sick_leave_30',     pytanie: 'Otrzymano zwolnienie lekarskie dłuższe niż 30 dni', kolumna: 'event_sick_leave_30' },
    { key: 'event_further_diagnosis', pytanie: 'Odbyto konsultacje lub wykonano badania diagnostyczne, po przeprowadzeniu których lekarz zalecił dalszą diagnostykę lub leczenie', kolumna: 'event_further_diagnosis' },
  ]},
  { grupa: 'Choroby i układy', pytania: [
    { key: 'med_heart',              pytanie: 'Układ sercowo-naczyniowy', kolumna: 'med_heart' },
    { key: 'med_neuro',              pytanie: 'Układ nerwowy, wzrok, słuch', kolumna: 'med_neuro' },
    { key: 'med_thyroid',            pytanie: 'Tarczyca', kolumna: null },
    { key: 'med_urinary',            pytanie: 'Układ moczowy', kolumna: null },
    { key: 'med_stomach',            pytanie: 'Układ pokarmowy', kolumna: 'med_stomach' },
    { key: 'med_locomotor',          pytanie: 'Układ ruchu, dna moczanowa', kolumna: 'med_bones' },
    { key: 'med_respiratory',        pytanie: 'Układ oddechowy', kolumna: null },
    { key: 'med_oncology',           pytanie: 'Choroby onkologiczne, guzy, narośla', kolumna: null },
    { key: 'med_spine_degenerative', pytanie: 'Choroba zwyrodnieniowa kręgosłupa lub stawów, zapalenie stawów lub jakikolwiek inny proces zwyrodnieniowy dotyczący kręgosłupa, stawów, kości, mięśni, ścięgien lub wiązadeł. Objawy/dolegliwości bólowe ze strony kręgosłupa lub stawów', kolumna: null },
    { key: 'med_allergy',            pytanie: 'Alergia (inna niż katar sienny)', kolumna: null },
    { key: 'med_diabetes',           pytanie: 'Cukrzyca', kolumna: 'med_diabetes' },
    { key: 'med_other',              pytanie: 'Inna, niewymieniona wcześniej choroba', kolumna: null },
  ]},
];

/* Kwoty w PLN — spec zmiana_2.parsowanie. Usuwa spacje (także NBPS),
   „zł"/„PLN"; „,"→„."; pierwsza liczba. Zwraca number lub NaN. */
function parseAmount(raw) {
  if (raw == null) return NaN;
  const cleaned = String(raw)
    .replace(/[\s ]/g, '')
    .replace(/z[łl]/gi, '')
    .replace(/pln/gi, '')
    .replace(',', '.');
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

function isHealthSurveyRequired() {
  const permOn = document.getElementById('riskPermIncapacity')?.checked;
  if (!permOn) return false;
  const raw = document.getElementById('permIncapacitySum')?.value;
  const amount = parseAmount(raw);
  return Number.isFinite(amount) && amount > HEALTH_SURVEY_THRESHOLD;
}

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

  const turnstileWrapper = document.getElementById('turnstile-wrapper');
  if (turnstileWrapper) {
    turnstileWrapper.classList.toggle('hidden', currentStepIndex !== total - 1);
  }
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
   KROKI WARUNKOWE — pracodawca + ankieta zdrowotna
────────────────────────────────────────── */
function recomputeActiveSteps() {
  const withEmployer = document.getElementById('employsPeople')?.checked;
  const withSurvey   = isHealthSurveyRequired();

  const steps = ['step-1'];
  if (withEmployer) steps.push('step-employer');
  steps.push('step-2', 'step-risks');
  if (withSurvey) steps.push('step-health-survey');
  steps.push('step-3', 'step-info', 'step-4');
  activeSteps = steps;

  applyHealthSurveyDuplicateHide(withSurvey);

  if (currentStepIndex >= activeSteps.length) currentStepIndex = activeSteps.length - 1;
  updateWizardUI();
}

function applyHealthSurveyDuplicateHide(active) {
  document.querySelectorAll('[data-hs-covered]').forEach(el => {
    el.classList.toggle('hidden', !!active);
  });
}

function initEmployerToggle() {
  const checkbox = document.getElementById('employsPeople');
  if (!checkbox) return;
  checkbox.addEventListener('change', recomputeActiveSteps);
}

/* ──────────────────────────────────────────
   ANKIETA ZDROWOTNA — render + guard na sumę > 1M
────────────────────────────────────────── */
function renderHealthSurvey() {
  const container = document.getElementById('health-survey-questions');
  if (!container || container.dataset.rendered === '1') return;
  container.dataset.rendered = '1';

  container.innerHTML = HEALTH_SURVEY.map(group => `
    <fieldset class="border border-slate-200 rounded-xl p-4 space-y-3">
      <legend class="text-sm font-bold text-slate-800 px-2">${group.grupa}</legend>
      ${group.pytania.map(q => `
        <div class="bg-white border border-slate-200 rounded-lg p-3 hover:border-blue-300 transition-colors" data-hs-question="${q.key}">
          <p class="text-sm font-medium text-slate-700 mb-2">${q.pytanie}</p>
          <div class="flex gap-6">
            <label class="flex items-center cursor-pointer"><input type="radio" name="hs_${q.key}" value="tak" class="mr-2 h-4 w-4 text-blue-600">Tak</label>
            <label class="flex items-center cursor-pointer"><input type="radio" name="hs_${q.key}" value="nie" class="mr-2 h-4 w-4 text-blue-600">Nie</label>
          </div>
          <div class="hs-details hidden mt-2">
            <textarea name="hsd_${q.key}" rows="2" placeholder="Podaj szczegóły…" class="block w-full rounded-md border-slate-300 border shadow-sm p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"></textarea>
          </div>
        </div>
      `).join('')}
    </fieldset>
  `).join('');

  container.querySelectorAll('[data-hs-question]').forEach(block => {
    const key = block.getAttribute('data-hs-question');
    block.querySelectorAll(`input[name="hs_${key}"]`).forEach(radio => {
      radio.addEventListener('change', () => {
        const details  = block.querySelector('.hs-details');
        const textarea = details.querySelector('textarea');
        const isYes    = block.querySelector(`input[name="hs_${key}"][value="tak"]`).checked;
        details.classList.toggle('hidden', !isYes);
        if (isYes) {
          textarea.setAttribute('required', 'required');
        } else {
          textarea.removeAttribute('required');
          textarea.value = '';
        }
      });
    });
  });
}

function initHealthSurveyGuard() {
  const permCb  = document.getElementById('riskPermIncapacity');
  const permSum = document.getElementById('permIncapacitySum');
  if (!permCb || !permSum) return;
  const handler = () => {
    if (isHealthSurveyRequired()) renderHealthSurvey();
    recomputeActiveSteps();
  };
  permCb.addEventListener('change', handler);
  permSum.addEventListener('input', handler);
  permSum.addEventListener('change', handler);
}

/* ──────────────────────────────────────────
   SPRZĘŻENIE RYZYK — okresowa jest podstawowa (spec zmiana_1)
   Zaznaczenie „Trwałej" auto-zaznacza „Okresową".
   Nie da się odznaczyć „Okresowej" gdy „Trwała" jest włączona.
────────────────────────────────────────── */
function initRiskCoupling() {
  const tempCb = document.getElementById('riskTempIncapacity');
  const permCb = document.getElementById('riskPermIncapacity');
  const hint   = document.getElementById('risk-basic-hint');
  if (!tempCb || !permCb) return;

  const flashHint = () => {
    if (!hint) return;
    hint.classList.remove('text-slate-500', 'bg-slate-50', 'border-slate-200');
    hint.classList.add('text-blue-800', 'bg-blue-50', 'border-blue-200');
    setTimeout(() => {
      hint.classList.remove('text-blue-800', 'bg-blue-50', 'border-blue-200');
      hint.classList.add('text-slate-500', 'bg-slate-50', 'border-slate-200');
    }, 1500);
  };

  const enforceCoupling = () => {
    if (permCb.checked && !tempCb.checked) {
      tempCb.checked = true;
      tempCb.dispatchEvent(new Event('change', { bubbles: true }));
      flashHint();
    }
  };
  permCb.addEventListener('change', enforceCoupling);
  tempCb.addEventListener('change', enforceCoupling);
}

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
  /* istniejące medyczne */
  'med_heart','med_diabetes','med_bones','med_stomach','med_neuro','med_surgery','med_aids',
  /* istniejące sport */
  'risk_caving','risk_climbing','risk_extreme_bike_boat','risk_diving','risk_sailing',
  'risk_horse','risk_skiing','risk_hunting','risk_quad','risk_aviation_non_comm',
  'risk_balloon','risk_skydiving','risk_paragliding','risk_horse_jumping',
  'risk_gravity_bike','risk_motorcycle','risk_aviation',
  /* istniejące zgody */
  'exclusions_accepted','employsPeople',
  /* nowe — pytania zdrowotne */
  'weightChange','takesMeds','pendingDiagnosis','disabilityCongenital','smoker',
  /* nowe — zdarzenia medyczne */
  'eventHospitalization','eventSickLeave30','eventFurtherDiagnosis',
  /* nowe — ryzyka */
  'riskDeathInvalidity','riskTempIncapacity','riskPermIncapacity',
  /* nowe — klauzule NW */
  'nwPermanentDamage',
  /* nowe — klauzula informacyjna */
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

function showSuccessModal(form) {
  window.location.href = '/thankyou.html';
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

    // Spec zmiana_1: nie da się zawrzeć polisy z samą "Trwałą" bez "Okresowej".
    const permCb = document.getElementById('riskPermIncapacity');
    const tempCb = document.getElementById('riskTempIncapacity');
    if (permCb?.checked && !tempCb?.checked) {
      showErrorModal('Nie można wybrać wyłącznie „Trwałej niezdolności". Polisy nie da się zawrzeć bez „Okresowej niezdolności" — to ryzyko podstawowe.');
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
        showSuccessModal(form);
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
  initNwToggle();
  initPeselValidation();
  initRiskCoupling();
  initHealthSurveyGuard();
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
