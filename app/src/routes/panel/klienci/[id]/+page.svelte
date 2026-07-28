<script>
  import { dateP } from '$lib/format.js';
  let { data } = $props();
  const c = data.client;

  const statusLabel = { draft: 'Szkic', sent: 'Wysłana', viewed: 'Otwarta', chosen: 'Wybrana', rejected: 'Rezygnacja' };

  // Etykiety znanych pól (reszta pokaże się z surową nazwą)
  const LABELS = {
    email: 'Email', phone: 'Telefon', pesel: 'PESEL', profession: 'Zawód',
    employment_type: 'Forma zatrudnienia', employs_people: 'Zatrudnia pracowników',
    height: 'Wzrost', weight: 'Waga', weight_change: 'Zmiana wagi', handedness: 'Ręczność',
    tax_form: 'Forma opodatkowania', smoker: 'Pali', takes_meds: 'Bierze leki',
    pending_diagnosis: 'Diagnostyka w toku', disability_congenital: 'Wada wrodzona', source: 'Źródło',
    b2b_start_date: 'Start działalności', b2b_industry: 'Branża', b2b_character: 'Charakter działalności',
    b2b_area: 'Obszar', b2b_employees_2024: 'Zatrudnienie 2024', b2b_employees_2025: 'Zatrudnienie 2025',
    b2b_own_contribution: 'Wkład własny', b2b_description: 'Opis działalności',
    risk_death_invalidity: 'Śmierć / inwalidztwo', risk_temp_incapacity: 'Przejściowa niezdolność',
    risk_perm_incapacity: 'Trwała niezdolność', temp_incapacity_sum: 'Suma — przejściowa',
    perm_incapacity_sum: 'Suma — trwała', nw_death_sum: 'Suma NW (śmierć)', nw_funeral: 'Zasiłek pogrzebowy',
    nw_adaptation: 'Adaptacja mieszkania', nw_hospital_daily: 'Dzienna szpitalna', nw_medical_costs: 'Koszty leczenia',
    nw_unconscious_weekly: 'Tygodniowa nieprzytomność', nw_permanent_damage: 'Trwały uszczerbek',
    med_heart: 'Serce/krążenie', med_diabetes: 'Cukrzyca', med_bones: 'Kości/stawy', med_stomach: 'Żołądek',
    med_neuro: 'Neurologia', med_surgery: 'Operacje', med_aids: 'HIV/AIDS', med_notes: 'Uwagi medyczne',
    event_hospitalization: 'Hospitalizacja', event_sick_leave_30: 'L4 > 30 dni', event_further_diagnosis: 'Dalsza diagnostyka',
    informed_accepted: 'Klauzula informacyjna', exclusions_accepted: 'Akceptacja wyłączeń',
    affiliate_code_used: 'Kod afiliacyjny', full_name: 'Imię i nazwisko',
    risk_balloon: 'Balon', risk_sailing: 'Żeglarstwo', risk_skiing: 'Narty', risk_skydiving: 'Spadochron',
    risk_diving: 'Nurkowanie', risk_caving: 'Speleologia', risk_aviation: 'Lotnictwo',
    risk_extreme_bike_boat: 'Ekstremalny rower/łódź', risk_climbing: 'Wspinaczka', risk_paragliding: 'Paralotnia',
    risk_horse: 'Konie', risk_horse_jumping: 'Skoki konne', risk_gravity_bike: 'Gravity bike',
    risk_quad: 'Quad', risk_hunting: 'Myślistwo'
  };

  // Pola pomijane (techniczne)
  const SKIP = new Set(['id', 'created_at', 'referred_by', 'form_data', 'full_name']);

  function fmt(v) {
    if (v === true) return 'Tak';
    if (v === false) return 'Nie';
    return String(v);
  }
  function label(k) { return LABELS[k] || k; }

  // Wszystkie niepuste pola klienta (poza technicznymi)
  const allFields = $derived(
    Object.entries(c)
      .filter(([k, v]) => !SKIP.has(k) && v !== null && v !== '' && v !== undefined && !(typeof v === 'object'))
      .map(([k, v]) => [label(k), fmt(v)])
  );

  // form_data — pełny zrzut z formularza
  const formEntries = $derived(
    c.form_data && typeof c.form_data === 'object'
      ? Object.entries(c.form_data).map(([k, v]) => [
          label(k),
          v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : fmt(v)
        ])
      : []
  );
</script>

<svelte:head><title>{c.full_name} — Karta klienta</title></svelte:head>

<a href="/panel/klienci" class="muted" style="text-decoration:none;">← Wróć do listy klientów</a>

<div style="display:flex;align-items:center;justify-content:space-between;margin:.5rem 0 1.5rem;flex-wrap:wrap;gap:1rem;">
  <div>
    <h1 style="font-size:1.6rem;">{c.full_name || '—'}</h1>
    <p class="muted">
      {#if data.owner_name}Przypisany do: <strong>{data.owner_name}</strong>{:else}Rejestracja samodzielna{/if}
      · dodano {dateP(c.created_at)}
    </p>
  </div>
  <a class="btn btn-primary" href="/panel/new?client={c.id}">+ Utwórz ofertę dla klienta</a>
</div>

<!-- WSZYSTKIE pola z rekordu klienta -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <h3 style="font-size:1rem;margin-bottom:.75rem;">Dane klienta ({allFields.length} pól)</h3>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.15rem 1.5rem;">
    {#each allFields as [k, v]}
      <div style="display:flex;justify-content:space-between;gap:1rem;padding:.35rem 0;border-bottom:1px solid var(--slate-100);font-size:.88rem;">
        <span class="muted">{k}</span><strong style="text-align:right;">{v}</strong>
      </div>
    {/each}
  </div>
</div>

<!-- Pełne dane z formularza (form_data) -->
{#if formEntries.length}
  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:.25rem;">📝 Pełne dane z formularza</h3>
    <p class="muted" style="margin:0 0 .75rem;font-size:.82rem;">Kompletny zapis zgłoszenia z utratadochodu.pl</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.15rem 1.5rem;">
      {#each formEntries as [k, v]}
        <div style="display:flex;justify-content:space-between;gap:1rem;padding:.35rem 0;border-bottom:1px solid var(--slate-100);font-size:.88rem;">
          <span class="muted">{k}</span><strong style="text-align:right;word-break:break-word;">{v}</strong>
        </div>
      {/each}
    </div>
  </div>
{/if}

<!-- Oferty klienta -->
<div class="card card-pad">
  <h3 style="font-size:1rem;margin-bottom:.75rem;">Oferty klienta ({data.offers.length})</h3>
  {#if data.offers.length}
    <table>
      <thead><tr><th>Oferta</th><th>Status</th><th>Utworzona</th><th></th></tr></thead>
      <tbody>
        {#each data.offers as o}
          <tr>
            <td style="font-weight:600;">{o.name}</td>
            <td><span class="badge badge-{o.status}">{statusLabel[o.status] || o.status}</span></td>
            <td class="muted">{dateP(o.created_at)}</td>
            <td style="text-align:right;"><a href="/panel/offer/{o.id}">Otwórz →</a></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted">Brak ofert dla tego klienta.</p>
  {/if}
</div>
