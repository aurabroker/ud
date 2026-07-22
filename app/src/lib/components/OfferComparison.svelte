<script>
  import { money, yesNo, insurerLabel } from '$lib/format.js';
  let { documents = [], selectable = false, onchoose = null, chosenId = null } = $props();

  const rows = [
    ['Ubezpieczyciel', (d) => insurerLabel(d.insurer_type)],
    ['Numer oferty', (d) => d.offer_number || '—'],
    ['Okres ubezpieczenia', (d) => d.insurance_period || '—'],
    ['Śmierć / inwalidztwo (NW)', (d) => yesNo(d.death_covered)],
    ['Okresowa niezdolność', (d) => yesNo(d.temp_incapacity_covered)],
    ['— świadczenie miesięczne', (d) => money(d.temp_monthly_benefit)],
    ['— suma ubezpieczenia', (d) => money(d.temp_sum_insured)],
    ['— limit dzienny', (d) => money(d.temp_daily_cap)],
    ['Trwała niezdolność', (d) => yesNo(d.perm_incapacity_covered)],
    ['— suma ubezpieczenia', (d) => money(d.perm_sum_insured)],
    ['Okres odszkodowawczy', (d) => d.indemnity_period || '—'],
    ['Wyczekiwanie (wypadek)', (d) => (d.wait_accident != null ? d.wait_accident + ' dni' : '—')],
    ['Wyczekiwanie (choroba)', (d) => (d.wait_illness != null ? d.wait_illness + ' dni' : '—')],
    ['Składka roczna (łącznie)', (d) => money(d.premium_total)],
    ['Rata miesięczna', (d) => money(d.premium_monthly)]
  ];
</script>

<div style="overflow-x:auto;">
  <table>
    <thead>
      <tr>
        <th style="min-width:200px;">Parametr</th>
        {#each documents as d}
          <th style="min-width:170px;">{insurerLabel(d.insurer_type)}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as [label, fn]}
        <tr>
          <td style="font-weight:600;color:var(--slate-600);">{label}</td>
          {#each documents as d}<td>{fn(d)}</td>{/each}
        </tr>
      {/each}
      {#if selectable}
        <tr>
          <td></td>
          {#each documents as d}
            <td>
              {#if chosenId === d.id}
                <span class="badge badge-chosen">✓ Wybrany</span>
              {:else}
                <button class="btn btn-primary" style="padding:.4rem .8rem;font-size:.82rem;" onclick={() => onchoose?.(d)}>Wybieram ten</button>
              {/if}
            </td>
          {/each}
        </tr>
      {/if}
    </tbody>
  </table>
</div>
