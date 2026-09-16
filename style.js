/* UtrataDochodu — style.js
   Wizard wielokrokowy, walidacja PESEL, wysyłka do Supabase
*/

/* ──────────────────────────────────────────
   WIZARD STATE
────────────────────────────────────────── */
let activeSteps    = ['step-1', 'step-2', 'step-risks', 'step-3', 'step-info', 'step-4'];
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

  /* Token Turnstile jest ważny ok. 5 minut, a wywiad medyczny w kreatorze trwa
     zwykle dłużej niż tyle. Widget renderuje się przy wczytaniu strony, więc do
     wysyłki wchodziłby token bliski wygaśnięcia. Odświeżamy go przy wejściu na
     ostatni krok, żeby przycisk Wyślij miał zawsze pełne okno ważności. */
  const turnstileWrapper = document.getElementById('turnstile-wrapper');
  if (turnstileWrapper) {
    const naOstatnimKroku = currentStepIndex === total - 1;
    const byloUkryte      = turnstileWrapper.classList.contains('hidden');
    turnstileWrapper.classList.toggle('hidden', !naOstatnimKroku);

    if (naOstatnimKroku && byloUkryte && window.turnstile) {
      const widget = turnstileWrapper.querySelector('.cf-turnstile');
      if (widget) {
        try { window.turnstile.reset(widget); } catch (e) { /* widget jeszcze się renderuje */ }
      }
    }
  }
}

/* „Okresowa niezdolność" jest ryzykiem podstawowym — Edge Function odrzuca
   wniosek z samą „Trwałą" błędem 400. Ta sama reguła musi działać w formularzu,
   inaczej klient dowiaduje się o niej dopiero po kliknięciu Wyślij, ze zużytym
   tokenem Turnstile w tle. Zwraca komunikat albo pusty string. */
function bladWyboruRyzyk(form) {
  const perm = form.querySelector('[name="riskPermIncapacity"]');
  const temp = form.querySelector('[name="riskTempIncapacity"]');
  if (!perm || !temp) return '';
  if (perm.checked && !temp.checked) {
    return 'Polisy nie da się zawrzeć bez „Okresowej niezdolności" — to ryzyko ' +
           'podstawowe. Zaznacz ją razem z „Trwałą niezdolnością".';
  }
  return '';
}

/* Zwraca false, gdy na stronie nie ma gdzie pokazać komunikatu — wtedy woła
   się zwykły modal błędu. Blokada, która zatrzymuje klienta bez słowa
   wyjaśnienia, to ten sam błąd co Turnstile 07.06.2026. */
function pokazBladRyzyk(form, komunikat) {
  const box = document.getElementById('risks-error');
  if (!box) return false;
  box.textContent = komunikat;
  box.classList.toggle('hidden', !komunikat);
  return true;
}

function initRisksValidation() {
  const form = document.getElementById('insurance-form');
  if (!form) return;
  ['riskPermIncapacity', 'riskTempIncapacity'].forEach(name => {
    const el = form.querySelector(`[name="${name}"]`);
    el?.addEventListener('change', () => pokazBladRyzyk(form, bladWyboruRyzyk(form)));
  });
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

  if (activeSteps[currentStepIndex] === 'step-risks') {
    const form = document.getElementById('insurance-form');
    const blad = form ? bladWyboruRyzyk(form) : '';
    if (blad) {
      if (pokazBladRyzyk(form, blad)) {
        document.getElementById('risks-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        showErrorModal(blad);
      }
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
      ? ['step-1', 'step-employer', 'step-2', 'step-risks', 'step-3', 'step-info', 'step-4']
      : ['step-1', 'step-2', 'step-risks', 'step-3', 'step-info', 'step-4'];
    updateWizardUI();
  });
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

/* Ankieta zdrowotna dla Edge Function: klucz w payloadzie ← pole formularza.
   Przy sumie trwałej niezdolności powyżej 1 000 000 zł funkcja wymaga pól
   hs_* i bez nich odrzuca wniosek błędem 400 z prośbą o „odświeżenie
   formularza" — czyli o coś, czego klient nie jest w stanie zrobić.
   Pytania są w kreatorze od zawsze (krok medyczny), więc wysyłamy odpowiedzi,
   których klient już udzielił, w formacie, którego oczekuje funkcja.
   Wartości: 'tak'/'nie'. Szczegóły idą w hsd_<klucz>. */
const ANKIETA_ZDROWOTNA = {
  weight_change:           { pole: 'weightChange' },
  takes_meds:              { pole: 'takesMeds' },
  pending_diagnosis:       { pole: 'pendingDiagnosis' },
  disability_congenital:   { pole: 'disabilityCongenital' },
  smoker:                  { pole: 'smoker' },
  event_hospitalization:   { pole: 'eventHospitalization' },
  event_sick_leave_30:     { pole: 'eventSickLeave30' },
  event_further_diagnosis: { pole: 'eventFurtherDiagnosis' },
  med_heart:               { pole: 'med_heart',    opis: 'med_heart_notes' },
  med_neuro:               { pole: 'med_neuro',    opis: 'med_neuro_notes' },
  med_stomach:             { pole: 'med_stomach',  opis: 'med_stomach_notes' },
  med_locomotor:           { pole: 'med_bones',    opis: 'med_bones_notes' },
  med_diabetes:            { pole: 'med_diabetes', opis: 'med_diabetes_notes' },
};

function dodajAnkieteZdrowotna(form, dataObj) {
  Object.entries(ANKIETA_ZDROWOTNA).forEach(([klucz, { pole, opis }]) => {
    const zaznaczony = form.querySelector(`[name="${pole}"]:checked`);
    if (!zaznaczony) return;
    const tak = String(zaznaczony.value).toLowerCase() === 'yes';
    dataObj['hs_' + klucz] = tak ? 'tak' : 'nie';
    if (tak && opis) {
      const szczegoly = form.querySelector(`[name="${opis}"]`);
      if (szczegoly && szczegoly.value.trim()) dataObj['hsd_' + klucz] = szczegoly.value.trim();
    }
  });
}

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

  dodajAnkieteZdrowotna(form, dataObj);

  return dataObj;
}

async function submitToSupabase(dataObj) {
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dataObj),
  });
  const dane = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, dane: dane };
}

/* Token Turnstile jest jednorazowy — po nieudanej wysyłce trzeba zresetować
   widget, inaczej druga próba poleci zużytym tokenem i funkcja odbije ją
   komunikatem o weryfikacji bezpieczeństwa. Reset po elemencie, bo na
   index.html są dwa widgety (szybki kontakt i wniosek). */
function resetujTurnstile(form) {
  const widget = form.querySelector('.cf-turnstile');
  if (widget && window.turnstile) {
    try { window.turnstile.reset(widget); } catch (e) { /* widget jeszcze się renderuje */ }
  }
}

function showSuccessModal(form) {
  window.location.href = '/thankyou.html';
}

function showErrorModal(message) {
  document.getElementById('error-message').textContent =
    message || 'Nie udało się wysłać formularza. Spróbuj ponownie później.';
  document.getElementById('error-modal').classList.remove('hidden');
}

/* Nieudana wysyłka wniosku = stracony klient — pokazujemy modal awarii
   z prośbą o telefon. Gdy awaria.js się nie wczytał, zostaje stary modal. */
function showAwariaModal(kod, message, szczegoly) {
  if (window.Awaria) {
    window.Awaria.pokaz({
      kod: kod,
      opis: message || undefined,
      szczegoly: szczegoly,
    });
  } else {
    showErrorModal(message);
  }
}

function initFormSubmit() {
  const form = document.getElementById('insurance-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    /* Rozróżniamy dwa przypadki, bo mają różnych winnych:
       - widgetu nie ma w DOM  → awaria konfiguracji strony, zgłaszamy do ud_errors,
       - widget jest nierozwiązany → użytkownik ma co kliknąć, zwykły komunikat.
       Bez tego rozróżnienia wysyłka przerywała się po cichu i brak leadów wyszedł
       dopiero z raportu Google Ads po trzech miesiącach. */
    if (!form.querySelector('.cf-turnstile')) {
      showAwariaModal('TURNSTILE_BRAK_WIDGETU',
        'Formularz jest chwilowo niedostępny.',
        'Brak elementu .cf-turnstile w formularzu ' + (form.id || '(bez id)'));
      return;
    }

    const turnstileToken = form.querySelector('[name="cf-turnstile-response"]')?.value;
    if (!turnstileToken) {
      showErrorModal('Proszę potwierdzić, że nie jesteś robotem.');
      return;
    }

    /* Reguła biznesowa z Edge Function — lepiej zatrzymać wniosek tutaj niż
       spalić token na pewnym 400. Element #risks-error jest na obu stronach
       korzystających z tego pliku (index.html i formularz.html). */
    const bladRyzyk = bladWyboruRyzyk(form);
    if (bladRyzyk) {
      pokazBladRyzyk(form, bladRyzyk);
      showErrorModal(bladRyzyk);
      return;
    }

    const btn     = document.getElementById('submit-btn');
    const origTxt = btn.innerText;
    btn.innerText = 'Wysyłanie…';
    btn.disabled  = true;

    try {
      const dataObj = collectFormData(form);
      dataObj['cf-turnstile-response'] = turnstileToken;
      const odp = await submitToSupabase(dataObj);

      if (odp.dane.status === 'success') {
        showSuccessModal(form);
      } else {
        /* Token przepadł przy każdej nieudanej próbie — bez resetu kolejna
           wysyłka wywali się na weryfikacji, a klient nie ma jak tego obejść. */
        resetujTurnstile(form);

        /* 400 to odpowiedź walidacyjna (PESEL, reguły ryzyk, ankieta) — klient
           ma co poprawić, więc dostaje zwykły komunikat. Awarię (modal z prośbą
           o telefon) zostawiamy dla tego, czego poprawić nie może. */
        if (odp.status === 400 && odp.dane.message) {
          showErrorModal(odp.dane.message);
        } else {
          showAwariaModal('WNIOSEK_ODRZUCONY', odp.dane.message, odp.dane);
        }
      }
    } catch (err) {
      console.error('Błąd sieci:', err);
      resetujTurnstile(form);
      showAwariaModal('WNIOSEK_SIEC', null, err);
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
  initRisksValidation();
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
