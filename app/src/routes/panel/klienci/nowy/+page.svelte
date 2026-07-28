<script>
  import { enhance } from '$app/forms';
  let { form } = $props();
  let saving = $state(false);
  const v = form?.values || {};
</script>

<svelte:head><title>Dodaj klienta — Panel</title></svelte:head>

<a href="/panel/klienci" class="muted" style="text-decoration:none;">← Wróć do listy klientów</a>
<h1 style="font-size:1.5rem;margin:.5rem 0 1.25rem;">Dodaj klienta</h1>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}

<form method="POST" use:enhance={() => { saving = true; return async ({ update }) => { await update(); saving = false; }; }}>
  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:1rem;">Dane osobowe / kontakt</h3>
    <div class="field">
      <label class="label" for="full_name">Imię i nazwisko *</label>
      <input class="input" id="full_name" name="full_name" required value={v.full_name || ''} />
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
      <div class="field"><label class="label" for="email">Email</label><input class="input" type="email" id="email" name="email" value={v.email || ''} /></div>
      <div class="field"><label class="label" for="phone">Telefon</label><input class="input" id="phone" name="phone" placeholder="48XXXXXXXXX" value={v.phone || ''} /></div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:1rem;">
      <div class="field"><label class="label" for="pesel">PESEL</label><input class="input" id="pesel" name="pesel" value={v.pesel || ''} /></div>
      <div class="field"><label class="label" for="height">Wzrost (cm)</label><input class="input" id="height" name="height" value={v.height || ''} /></div>
      <div class="field"><label class="label" for="weight">Waga (kg)</label><input class="input" id="weight" name="weight" value={v.weight || ''} /></div>
    </div>
    <label style="display:inline-flex;gap:.4rem;align-items:center;font-size:.9rem;"><input type="checkbox" name="smoker" /> Pali</label>
  </div>

  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:1rem;">Zatrudnienie</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
      <div class="field"><label class="label" for="profession">Zawód</label><input class="input" id="profession" name="profession" value={v.profession || ''} /></div>
      <div class="field">
        <label class="label" for="employment_type">Forma zatrudnienia</label>
        <select class="input" id="employment_type" name="employment_type">
          <option value="">—</option><option value="uop">Umowa o pracę</option>
          <option value="b2b">B2B / działalność</option><option value="uz">Umowa zlecenie</option>
          <option value="uod">Umowa o dzieło</option>
        </select>
      </div>
      <div class="field"><label class="label" for="tax_form">Forma opodatkowania</label><input class="input" id="tax_form" name="tax_form" value={v.tax_form || ''} /></div>
    </div>
  </div>

  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:1rem;">Parametry do oferty</h3>
    <label style="display:flex;gap:.4rem;align-items:center;font-size:.9rem;margin-bottom:.5rem;"><input type="checkbox" name="risk_death_invalidity" /> Śmierć / inwalidztwo (NW)</label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;align-items:end;">
      <label style="display:flex;gap:.4rem;align-items:center;font-size:.9rem;"><input type="checkbox" name="risk_temp_incapacity" /> Przejściowa niezdolność</label>
      <div class="field" style="margin:0;"><label class="label" for="temp_incapacity_sum">Suma — przejściowa (zł/mies.)</label><input class="input" id="temp_incapacity_sum" name="temp_incapacity_sum" value={v.temp_incapacity_sum || ''} /></div>
      <label style="display:flex;gap:.4rem;align-items:center;font-size:.9rem;"><input type="checkbox" name="risk_perm_incapacity" /> Trwała niezdolność</label>
      <div class="field" style="margin:0;"><label class="label" for="perm_incapacity_sum">Suma — trwała (zł)</label><input class="input" id="perm_incapacity_sum" name="perm_incapacity_sum" value={v.perm_incapacity_sum || ''} /></div>
    </div>
    <div class="field" style="margin-top:1rem;"><label class="label" for="nw_death_sum">Suma NW — śmierć (zł)</label><input class="input" id="nw_death_sum" name="nw_death_sum" value={v.nw_death_sum || ''} style="max-width:220px;" /></div>
    <div class="field"><label class="label" for="med_notes">Uwagi medyczne</label><textarea class="input" id="med_notes" name="med_notes" rows="3">{v.med_notes || ''}</textarea></div>
  </div>

  <button class="btn btn-primary btn-lg" type="submit" disabled={saving}>{saving ? 'Zapisuję…' : 'Dodaj klienta'}</button>
</form>
