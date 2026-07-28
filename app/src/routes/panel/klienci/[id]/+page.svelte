<script>
  import { dateP } from '$lib/format.js';
  let { data } = $props();
  const c = data.client;
  const statusLabel = { draft: 'Szkic', sent: 'Wysłana', viewed: 'Otwarta', chosen: 'Wybrana', rejected: 'Rezygnacja' };

  const val = (v) => (v === true ? 'Tak' : v === false ? 'Nie' : v == null || v === '' ? '—' : String(v));
  const has = (v) => v !== null && v !== undefined && v !== '';

  // Definicje grup: [klucz, etykieta]
  const G_KONTAKT = [
    ['email', 'Email'], ['phone', 'Telefon'], ['pesel', 'PESEL'],
    ['height', 'Wzrost (cm)'], ['weight', 'Waga (kg)'], ['weight_change', 'Zmiana wagi'],
    ['handedness', 'Ręczność'], ['smoker', 'Pali']
  ];
  const G_PRACA = [
    ['profession', 'Zawód'], ['employment_type', 'Forma zatrudnienia'], ['employs_people', 'Zatrudnia pracowników'],
    ['tax_form', 'Forma opodatkowania'], ['b2b_start_date', 'Start działalności'], ['b2b_industry', 'Branża'],
    ['b2b_character', 'Charakter działalności'], ['b2b_area', 'Obszar'],
    ['b2b_employees_2024', 'Zatrudnienie 2024'], ['b2b_employees_2025', 'Zatrudnienie 2025'],
    ['b2b_own_contribution', 'Wkład własny'], ['b2b_description', 'Opis działalności']
  ];
  const G_UBEZP = [
    ['risk_death_invalidity', 'Śmierć / inwalidztwo'], ['risk_temp_incapacity', 'Przejściowa niezdolność'],
    ['temp_incapacity_sum', 'Suma — przejściowa (zł)'], ['risk_perm_incapacity', 'Trwała niezdolność'],
    ['perm_incapacity_sum', 'Suma — trwała (zł)'], ['nw_death_sum', 'Suma NW — śmierć (zł)'],
    ['nw_funeral', 'Zasiłek pogrzebowy'], ['nw_adaptation', 'Adaptacja mieszkania'],
    ['nw_hospital_daily', 'Dzienna szpitalna'], ['nw_medical_costs', 'Koszty leczenia'],
    ['nw_unconscious_weekly', 'Tygodniowa nieprzytomność'], ['nw_permanent_damage', 'Trwały uszczerbek']
  ];
  const G_ZDROWIE = [
    ['med_heart', 'Serce / krążenie'], ['med_diabetes', 'Cukrzyca'], ['med_bones', 'Kości / stawy'],
    ['med_stomach', 'Żołądek'], ['med_neuro', 'Neurologia'], ['med_surgery', 'Operacje'], ['med_aids', 'HIV / AIDS'],
    ['takes_meds', 'Przyjmuje leki'], ['pending_diagnosis', 'Diagnostyka w toku'],
    ['disability_congenital', 'Wada wrodzona'], ['event_hospitalization', 'Hospitalizacja'],
    ['event_sick_leave_30', 'L4 powyżej 30 dni'], ['event_further_diagnosis', 'Skierowanie na dalszą diagnostykę']
  ];
  const G_SPORTY = [
    ['risk_balloon', 'Balon'], ['risk_sailing', 'Żeglarstwo'], ['risk_skiing', 'Narciarstwo'],
    ['risk_skydiving', 'Spadochroniarstwo'], ['risk_diving', 'Nurkowanie'], ['risk_caving', 'Speleologia'],
    ['risk_aviation', 'Lotnictwo'], ['risk_extreme_bike_boat', 'Ekstremalny rower / motorówka'],
    ['risk_climbing', 'Wspinaczka'], ['risk_paragliding', 'Paralotniarstwo'], ['risk_horse', 'Jazda konna'],
    ['risk_horse_jumping', 'Skoki konne'], ['risk_gravity_bike', 'Gravity bike'], ['risk_quad', 'Quad'],
    ['risk_hunting', 'Myślistwo']
  ];
  const G_ZGODY = [
    ['informed_accepted', 'Klauzula informacyjna'], ['exclusions_accepted', 'Akceptacja wyłączeń'],
    ['source', 'Źródło zgłoszenia'], ['affiliate_code_used', 'Kod afiliacyjny']
  ];

  // Pola pokazane w grupach — do wyłapania "pozostałych"
  const shownKeys = new Set(
    [...G_KONTAKT, ...G_PRACA, ...G_UBEZP, ...G_ZDROWIE, ...G_SPORTY, ...G_ZGODY].map(([k]) => k)
  );
  const SKIP = new Set(['id', 'created_at', 'referred_by', 'form_data', 'full_name', 'med_notes', 'logo_path']);
  const pozostale = $derived(
    Object.entries(c)
      .filter(([k, v]) => !shownKeys.has(k) && !SKIP.has(k) && has(v) && typeof v !== 'object')
      .map(([k, v]) => [k, val(v)])
  );

  // Sekcja tylko z niepustymi wierszami (dla grup opisowych)
  const nonEmpty = (group) => group.filter(([k]) => has(c[k]));
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

<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;align-items:start;">
  <!-- Dane podstawowe -->
  <div class="card card-pad">
    <h3 style="font-size:1rem;margin-bottom:.75rem;">Dane osobowe / kontakt</h3>
    <table>
      <tbody>
        {#each nonEmpty(G_KONTAKT) as [k, label]}
          <tr><td class="muted">{label}</td><td style="text-align:right;font-weight:600;">{val(c[k])}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Zatrudnienie -->
  <div class="card card-pad">
    <h3 style="font-size:1rem;margin-bottom:.75rem;">Zatrudnienie / działalność</h3>
    <table>
      <tbody>
        {#each nonEmpty(G_PRACA) as [k, label]}
          <tr><td class="muted">{label}</td><td style="text-align:right;font-weight:600;word-break:break-word;">{val(c[k])}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Parametry ubezpieczenia -->
  <div class="card card-pad" style="grid-column:1 / -1;">
    <h3 style="font-size:1rem;margin-bottom:.75rem;">📋 Parametry do oferty</h3>
    <table>
      <tbody>
        {#each nonEmpty(G_UBEZP) as [k, label]}
          <tr><td class="muted">{label}</td><td style="text-align:right;font-weight:600;color:var(--blue-600);">{val(c[k])}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- DANE ZDROWOTNE — osobna tabela -->
  <div class="card card-pad">
    <h3 style="font-size:1rem;margin-bottom:.75rem;">🩺 Dane zdrowotne</h3>
    <table>
      <tbody>
        {#each G_ZDROWIE as [k, label]}
          <tr>
            <td class="muted">{label}</td>
            <td style="text-align:right;font-weight:600;color:{c[k] === true ? 'var(--red-600)' : 'var(--slate-500)'};">{val(c[k])}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if c.med_notes}
      <p style="margin-top:.6rem;font-size:.85rem;"><span class="muted">Uwagi medyczne:</span> {c.med_notes}</p>
    {/if}
  </div>

  <!-- AKTYWNOŚCI WYSOKIEGO RYZYKA — osobna tabela -->
  <div class="card card-pad">
    <h3 style="font-size:1rem;margin-bottom:.75rem;">🏔️ Aktywności wysokiego ryzyka</h3>
    <table>
      <tbody>
        {#each G_SPORTY as [k, label]}
          <tr>
            <td class="muted">{label}</td>
            <td style="text-align:right;font-weight:600;color:{c[k] === true ? 'var(--red-600)' : 'var(--slate-500)'};">{val(c[k])}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Zgody / źródło -->
  <div class="card card-pad">
    <h3 style="font-size:1rem;margin-bottom:.75rem;">Zgody / meta</h3>
    <table>
      <tbody>
        {#each nonEmpty(G_ZGODY) as [k, label]}
          <tr><td class="muted">{label}</td><td style="text-align:right;font-weight:600;">{val(c[k])}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Pozostałe (gdyby doszły nowe kolumny) -->
  {#if pozostale.length}
    <div class="card card-pad">
      <h3 style="font-size:1rem;margin-bottom:.75rem;">Pozostałe pola</h3>
      <table>
        <tbody>
          {#each pozostale as [k, v]}
            <tr><td class="muted">{k}</td><td style="text-align:right;font-weight:600;">{v}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Oferty klienta -->
<div class="card card-pad" style="margin-top:1.25rem;">
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
