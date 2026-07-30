<script>
  import { money, yesNo, insurerLabel } from '$lib/format.js';
  let { documents = [], selectable = false, onchoose = null, chosenId = null } = $props();

  const rows = [
    ['Ubezpieczyciel', (d) => insurerLabel(d.insurer_type)],
    ['Numer oferty', (d) => d.offer_number || '—'],
    ['Okres ubezpieczenia', (d) => d.insurance_period || '—'],
    ['Śmierć / inwalidztwo (NW)', (d) => yesNo(d.death_covered)],
    ['Okresowa niezdolność do pracy', (d) => yesNo(d.temp_incapacity_covered)],
    ['— świadczenie miesięczne', (d) => money(d.temp_monthly_benefit)],
    ['— limit (% przychodu)', (d) => (d.temp_monthly_pct != null ? d.temp_monthly_pct + '%' : '—')],
    ['— suma ubezpieczenia', (d) => money(d.temp_sum_insured)],
    ['— limit dzienny', (d) => money(d.temp_daily_cap)],
    ['Trwała niezdolność do pracy', (d) => yesNo(d.perm_incapacity_covered)],
    ['— suma ubezpieczenia', (d) => money(d.perm_sum_insured)],
    ['Okres odszkodowawczy', (d) => d.indemnity_period || '—'],
    ['Wyczekiwanie (wypadek)', (d) => (d.wait_accident != null ? d.wait_accident + ' dni' : '—')],
    ['Wyczekiwanie (choroba)', (d) => (d.wait_illness != null ? d.wait_illness + ' dni' : '—')]
  ];
</script>

<div class="cmp-wrap">
  <table class="cmp">
    <thead>
      <tr>
        <th class="lbl-col">Parametr</th>
        {#each documents as d}
          <th><div class="ins">{insurerLabel(d.insurer_type)}</div></th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as [label, fn]}
        <tr>
          <td class="lbl">{label}</td>
          {#each documents as d}<td>{fn(d)}</td>{/each}
        </tr>
      {/each}
      <tr class="premium">
        <td class="lbl">Składka roczna (łącznie)</td>
        {#each documents as d}<td><strong>{money(d.premium_total)}</strong></td>{/each}
      </tr>
      <tr class="premium">
        <td class="lbl">Rata miesięczna</td>
        {#each documents as d}<td>{money(d.premium_monthly)}</td>{/each}
      </tr>
      {#if selectable}
        <tr>
          <td></td>
          {#each documents as d}
            <td style="text-align:center;padding:12px 8px;">
              {#if chosenId === d.id}
                <span class="badge badge-chosen">✓ Wybrany</span>
              {:else}
                <button class="btn btn-primary" style="padding:.5rem 1rem;font-size:.85rem;" onclick={() => onchoose?.(d)}>Wybieram ten</button>
              {/if}
            </td>
          {/each}
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .cmp-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid var(--slate-400); }
  table.cmp { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  table.cmp th, table.cmp td { padding: 10px 14px; border-bottom: 1px solid var(--slate-300); border-right: 1px solid var(--slate-200); text-align: left; vertical-align: middle; }
  table.cmp thead th { background: var(--slate-800); color: #fff; border-bottom: none; min-width: 170px; }
  table.cmp thead th.lbl-col { background: var(--slate-900); min-width: 210px; }
  table.cmp .ins { font-weight: 700; font-size: 0.92rem; }
  td.lbl { font-weight: 600; color: var(--slate-600); background: var(--slate-50); }
  tbody tr:nth-child(even) td:not(.lbl) { background: #fbfcfe; }
  tr.premium td { font-size: 0.95rem; border-top: 2px solid var(--slate-200); }
</style>
