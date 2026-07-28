<script>
  import { dateP } from '$lib/format.js';
  let { data } = $props();
  const c = data.client;

  const statusLabel = { draft: 'Szkic', sent: 'Wysłana', viewed: 'Otwarta', chosen: 'Wybrana', rejected: 'Rezygnacja' };

  // Pomocnicze zestawy pól
  const podstawowe = [
    ['Email', c.email], ['Telefon', c.phone], ['PESEL', c.pesel],
    ['Zawód', c.profession], ['Forma zatrudnienia', c.employment_type],
    ['Wzrost', c.height], ['Waga', c.weight], ['Forma opodatkowania', c.tax_form],
    ['Źródło', c.source]
  ].filter(([, v]) => v);

  const ryzyka = [
    ['Śmierć / inwalidztwo', c.risk_death_invalidity],
    ['Przejściowa niezdolność', c.risk_temp_incapacity, c.temp_incapacity_sum],
    ['Trwała niezdolność', c.risk_perm_incapacity, c.perm_incapacity_sum]
  ].filter(([, v]) => v);

  const nw = [
    ['Suma NW (śmierć)', c.nw_death_sum], ['Zasiłek pogrzebowy', c.nw_funeral],
    ['Adaptacja mieszkania', c.nw_adaptation], ['Dzienna szpitalna', c.nw_hospital_daily],
    ['Koszty leczenia', c.nw_medical_costs], ['Tygodniowa nieprzytomność', c.nw_unconscious_weekly],
    ['Trwały uszczerbek', c.nw_permanent_damage]
  ].filter(([, v]) => v);

  const zdrowie = [
    ['Serce/krążenie', c.med_heart], ['Cukrzyca', c.med_diabetes], ['Kości/stawy', c.med_bones],
    ['Żołądek', c.med_stomach], ['Neurologia', c.med_neuro], ['Operacje', c.med_surgery],
    ['HIV/AIDS', c.med_aids], ['Pali', c.smoker], ['Bierze leki', c.takes_meds],
    ['Diagnostyka w toku', c.pending_diagnosis], ['Hospitalizacja', c.event_hospitalization],
    ['L4 > 30 dni', c.event_sick_leave_30]
  ].filter(([, v]) => v === true);

  const sporty = [
    ['Balon', c.risk_balloon], ['Żeglarstwo', c.risk_sailing], ['Narty', c.risk_skiing],
    ['Spadochron', c.risk_skydiving], ['Nurkowanie', c.risk_diving], ['Speleologia', c.risk_caving],
    ['Lotnictwo', c.risk_aviation], ['Wspinaczka', c.risk_climbing], ['Paralotnia', c.risk_paragliding],
    ['Konie', c.risk_horse], ['Quad', c.risk_quad], ['Myślistwo', c.risk_hunting]
  ].filter(([, v]) => v === true);
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
    <h3 style="font-size:1rem;margin-bottom:.75rem;">Dane podstawowe</h3>
    {#each podstawowe as [label, val]}
      <div style="display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--slate-100);font-size:.9rem;">
        <span class="muted">{label}</span><strong>{val}</strong>
      </div>
    {/each}
  </div>

  <!-- Parametry do oferty -->
  <div class="card card-pad">
    <h3 style="font-size:1rem;margin-bottom:.75rem;">📋 Parametry do oferty</h3>
    {#if ryzyka.length}
      <div style="font-size:.72rem;font-weight:700;color:var(--slate-400);text-transform:uppercase;margin:.25rem 0 .4rem;">Ryzyka</div>
      {#each ryzyka as [label, , sum]}
        <div style="display:flex;justify-content:space-between;padding:.3rem 0;font-size:.9rem;">
          <span>{label}</span><strong style="color:var(--blue-600);">{sum ? sum + ' zł' : '✓'}</strong>
        </div>
      {/each}
    {/if}
    {#if nw.length}
      <div style="font-size:.72rem;font-weight:700;color:var(--slate-400);text-transform:uppercase;margin:.75rem 0 .4rem;">Klauzule NW</div>
      {#each nw as [label, val]}
        <div style="display:flex;justify-content:space-between;padding:.3rem 0;font-size:.9rem;">
          <span>{label}</span><strong style="color:var(--blue-600);">{val === true ? '✓' : val}</strong>
        </div>
      {/each}
    {/if}
    {#if !ryzyka.length && !nw.length}<p class="muted">Brak wskazanych parametrów.</p>{/if}
  </div>

  <!-- Zdrowie -->
  {#if zdrowie.length || c.med_notes}
    <div class="card card-pad">
      <h3 style="font-size:1rem;margin-bottom:.75rem;">Zdrowie</h3>
      <div style="display:flex;flex-wrap:wrap;gap:.4rem;">
        {#each zdrowie as [label]}<span class="badge badge-viewed">{label}</span>{/each}
      </div>
      {#if c.med_notes}<p class="muted" style="margin-top:.6rem;font-size:.85rem;">{c.med_notes}</p>{/if}
    </div>
  {/if}

  <!-- Ryzyka aktywne -->
  {#if sporty.length}
    <div class="card card-pad">
      <h3 style="font-size:1rem;margin-bottom:.75rem;">Ryzyka aktywnego życia</h3>
      <div style="display:flex;flex-wrap:wrap;gap:.4rem;">
        {#each sporty as [label]}<span class="badge badge-rejected">{label}</span>{/each}
      </div>
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
