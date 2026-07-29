<script>
  import { enhance } from '$app/forms';
  let { form } = $props();
  let saving = $state(false);
  const v = form?.values || {};

  const zdrowieChk = [
    ['med_heart', 'Serce/krążenie'], ['med_diabetes', 'Cukrzyca'], ['med_bones', 'Kości/stawy'],
    ['med_stomach', 'Żołądek'], ['med_neuro', 'Neurologia'], ['med_surgery', 'Operacje'], ['med_aids', 'HIV/AIDS'],
    ['takes_meds', 'Bierze leki'], ['pending_diagnosis', 'Diagnostyka w toku'], ['disability_congenital', 'Wada wrodzona'],
    ['event_hospitalization', 'Hospitalizacja'], ['event_sick_leave_30', 'L4 > 30 dni'], ['event_further_diagnosis', 'Dalsza diagnostyka']
  ];
  const sportyChk = [
    ['risk_balloon', 'Balon'], ['risk_sailing', 'Żeglarstwo'], ['risk_skiing', 'Narty'], ['risk_skydiving', 'Spadochron'],
    ['risk_diving', 'Nurkowanie'], ['risk_caving', 'Speleologia'], ['risk_aviation', 'Lotnictwo'],
    ['risk_extreme_bike_boat', 'Ekstremalny rower/łódź'], ['risk_climbing', 'Wspinaczka'], ['risk_paragliding', 'Paralotnia'],
    ['risk_horse', 'Konie'], ['risk_horse_jumping', 'Skoki konne'], ['risk_gravity_bike', 'Gravity bike'],
    ['risk_quad', 'Quad'], ['risk_hunting', 'Myślistwo']
  ];
  const nwTxt = [
    ['nw_death_sum', 'Suma NW — śmierć'], ['nw_funeral', 'Zasiłek pogrzebowy'], ['nw_adaptation', 'Adaptacja mieszkania'],
    ['nw_hospital_daily', 'Dzienna szpitalna'], ['nw_medical_costs', 'Koszty leczenia'], ['nw_unconscious_weekly', 'Tyg. nieprzytomność']
  ];
  const b2bTxt = [
    ['b2b_start_date', 'Start działalności'], ['b2b_industry', 'Branża'], ['b2b_character', 'Charakter'],
    ['b2b_area', 'Obszar'], ['b2b_employees_2024', 'Zatrudnienie 2024'], ['b2b_employees_2025', 'Zatrudnienie 2025'],
    ['b2b_own_contribution', 'Wkład własny']
  ];
</script>

<svelte:head><title>Dodaj klienta — Panel</title></svelte:head>

<a href="/panel/klienci" class="muted" style="text-decoration:none;">← Wróć do listy klientów</a>
<h1 style="font-size:1.4rem;margin:.4rem 0 1rem;">Dodaj klienta</h1>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}

<form method="POST" use:enhance={() => { saving = true; return async ({ update }) => { await update(); saving = false; }; }} class="addcli">

  <!-- Dane osobowe -->
  <div class="card card-pad">
    <h3>Dane osobowe / kontakt</h3>
    <div class="grid">
      <label>Imię i nazwisko *<input class="input" name="full_name" required value={v.full_name || ''} /></label>
      <label>Email<input class="input" type="email" name="email" value={v.email || ''} /></label>
      <label>Telefon<input class="input" name="phone" placeholder="48XXXXXXXXX" value={v.phone || ''} /></label>
      <label>PESEL<input class="input" name="pesel" value={v.pesel || ''} /></label>
      <label>Wzrost (cm)<input class="input" name="height" value={v.height || ''} /></label>
      <label>Waga (kg)<input class="input" name="weight" value={v.weight || ''} /></label>
      <label>Ręczność<select class="input" name="handedness"><option value="">—</option><option value="prawy">prawy</option><option value="lewy">lewy</option></select></label>
    </div>
    <div class="chips">
      <label><input type="checkbox" name="smoker" /> Pali</label>
      <label><input type="checkbox" name="weight_change" /> Zmiana wagi</label>
    </div>
  </div>

  <!-- Zatrudnienie -->
  <div class="card card-pad">
    <h3>Zatrudnienie / działalność</h3>
    <div class="grid">
      <label>Zawód<input class="input" name="profession" value={v.profession || ''} /></label>
      <label>Forma zatrudnienia
        <select class="input" name="employment_type">
          <option value="">—</option><option value="uop">Umowa o pracę</option><option value="b2b">B2B / działalność</option>
          <option value="uz">Umowa zlecenie</option><option value="uod">Umowa o dzieło</option>
        </select>
      </label>
      <label>Forma opodatkowania<input class="input" name="tax_form" value={v.tax_form || ''} /></label>
      {#each b2bTxt as [name, label]}<label>{label}<input class="input" {name} value={v[name] || ''} /></label>{/each}
    </div>
    <div class="chips"><label><input type="checkbox" name="employs_people" /> Zatrudnia pracowników</label></div>
    <label style="display:block;margin-top:.5rem;">Opis działalności<textarea class="input" name="b2b_description" rows="2">{v.b2b_description || ''}</textarea></label>
  </div>

  <!-- Parametry do oferty -->
  <div class="card card-pad">
    <h3>Parametry do oferty</h3>
    <div class="chips">
      <label><input type="checkbox" name="risk_death_invalidity" /> Śmierć / inwalidztwo</label>
      <label><input type="checkbox" name="risk_temp_incapacity" /> Przejściowa niezdolność</label>
      <label><input type="checkbox" name="risk_perm_incapacity" /> Trwała niezdolność</label>
      <label><input type="checkbox" name="nw_permanent_damage" /> Trwały uszczerbek</label>
    </div>
    <div class="grid" style="margin-top:.5rem;">
      <label>Suma — przejściowa (zł/mies.)<input class="input" name="temp_incapacity_sum" value={v.temp_incapacity_sum || ''} /></label>
      <label>Suma — trwała (zł)<input class="input" name="perm_incapacity_sum" value={v.perm_incapacity_sum || ''} /></label>
      {#each nwTxt as [name, label]}<label>{label}<input class="input" {name} value={v[name] || ''} /></label>{/each}
    </div>
  </div>

  <!-- Zdrowie -->
  <div class="card card-pad">
    <h3>Dane zdrowotne</h3>
    <div class="chips">
      {#each zdrowieChk as [name, label]}<label><input type="checkbox" {name} /> {label}</label>{/each}
    </div>
    <label style="display:block;margin-top:.5rem;">Uwagi medyczne<textarea class="input" name="med_notes" rows="2">{v.med_notes || ''}</textarea></label>
  </div>

  <!-- Aktywności wysokiego ryzyka -->
  <div class="card card-pad">
    <h3>Aktywności wysokiego ryzyka</h3>
    <div class="chips">
      {#each sportyChk as [name, label]}<label><input type="checkbox" {name} /> {label}</label>{/each}
    </div>
  </div>

  <!-- Zgody -->
  <div class="card card-pad">
    <h3>Zgody</h3>
    <div class="chips">
      <label><input type="checkbox" name="informed_accepted" /> Klauzula informacyjna</label>
      <label><input type="checkbox" name="exclusions_accepted" /> Akceptacja wyłączeń</label>
    </div>
  </div>

  <button class="btn btn-primary btn-lg" type="submit" disabled={saving}>{saving ? 'Zapisuję…' : 'Dodaj klienta'}</button>
</form>

<style>
  .addcli { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; align-items: start; }
  .addcli > button { grid-column: 1 / -1; justify-self: start; }
  @media (max-width: 720px) { .addcli { grid-template-columns: 1fr; } }
  .addcli :global(.card) { padding: 0.7rem 0.9rem !important; }
  .addcli :global(h3) { font-size: 0.9rem; margin: 0 0 0.5rem; border-bottom: 2px solid var(--slate-200); padding-bottom: 0.35rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.4rem 0.6rem; }
  .grid label, .addcli > .card > label { display: flex; flex-direction: column; font-size: 0.75rem; font-weight: 600; color: var(--slate-600); gap: 0.15rem; }
  .grid :global(.input), .addcli :global(textarea.input) { padding: 0.35rem 0.5rem; font-size: 0.85rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem 0.9rem; margin-top: 0.4rem; }
  .chips label { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; font-weight: 500; color: var(--slate-700); }
</style>
