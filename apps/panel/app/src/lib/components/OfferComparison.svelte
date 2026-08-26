<script>
  import { money, yesNo, insurerLabel, insurerRow, offerNoDisplay } from '$lib/format.js';
  let { documents = [], selectable = false, onchoose = null, chosenId = null } = $props();

  // Gdy wszystkie porównywane oferty są od tego samego ubezpieczyciela,
  // nagłówek jest jeden, wspólny dla wszystkich kolumn.
  const sameInsurer = $derived(
    documents.length > 1 && documents.every((d) => d.insurer_type === documents[0].insurer_type)
  );

  // Okresowa niezdolność „z oferty": gdy pokrycie faktycznie jest — TAK na zielono zamiast „—".
  function tempIncap(d) {
    const covered = d.temp_incapacity_covered === true || d.temp_monthly_benefit != null || d.temp_sum_insured != null;
    if (covered) return { green: true, text: 'TAK' };
    return yesNo(d.temp_incapacity_covered);
  }

  const rows = [
    ['Ubezpieczyciel', () => insurerRow()],
    ['Numer oferty', (d) => offerNoDisplay(d.offer_number)],
    ['Okres ubezpieczenia', (d) => d.insurance_period || '—'],
    // Kwota z Pozycji A (parsed_raw); gdy ryzyko nieobjęte — Tak/Nie/—
    ['Śmierć / inwalidztwo (NW)', (d) => (d.parsed_raw?.death_sum_insured != null ? money(d.parsed_raw.death_sum_insured) : yesNo(d.death_covered))],
    ['Okresowa niezdolność do pracy', (d) => tempIncap(d)],
    ['— świadczenie miesięczne', (d) => money(d.temp_monthly_benefit)],
    // Kwota z Pozycji C; gdy oferta nie obejmuje tego ryzyka — Tak/Nie/—
    ['Trwała niezdolność do pracy', (d) => (d.perm_sum_insured != null ? money(d.perm_sum_insured) : yesNo(d.perm_incapacity_covered))],
    ['Okres odszkodowawczy', (d) => d.indemnity_period || '—'],
    ['Okres wyczekiwania (wypadek)', (d) => (d.wait_accident != null ? d.wait_accident + ' dni' : '—')],
    ['Okres wyczekiwania (choroba)', (d) => (d.wait_illness != null ? d.wait_illness + ' dni' : '—')]
  ];
</script>

<div class="cmp-wrap">
  <table class="cmp">
    <thead>
      <tr>
        <th class="lbl-col">przedstawiciel Lloyd's</th>
        {#if sameInsurer}
          <th colspan={documents.length}><div class="ins">{insurerLabel(documents[0].insurer_type)}</div></th>
        {:else}
          {#each documents as d}
            <th><div class="ins">{insurerLabel(d.insurer_type)}</div></th>
          {/each}
        {/if}
      </tr>
    </thead>
    <tbody>
      {#each rows as [label, fn]}
        <tr>
          <td class="lbl">{label}</td>
          {#each documents as d}
            {@const v = fn(d)}
            <td>{#if v && v.green}<span class="yes">{v.text}</span>{:else}{v}{/if}</td>
          {/each}
        </tr>
      {/each}
      <tr class="premium">
        <td class="lbl">Składka roczna (łącznie)</td>
        {#each documents as d}<td><strong>{money(d.premium_total)}</strong></td>{/each}
      </tr>
      <tr class="premium">
        <td class="lbl">Rata miesięczna</td>
        {#each documents as d}
          <td>{#if d.premium_monthly != null}<span class="mth">{money(d.premium_monthly)}</span>{:else}—{/if}</td>
        {/each}
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
  table.cmp th, table.cmp td { padding: 10px 14px; border-bottom: 1px solid var(--slate-300); border-right: 1px solid var(--slate-200); text-align: center; vertical-align: middle; }
  /* Kolumna etykiet do lewej; dane ofert wyśrodkowane. */
  table.cmp td.lbl, table.cmp th.lbl-col { text-align: left; }
  table.cmp thead th { background: var(--slate-800); color: #fff; border-bottom: none; min-width: 170px; }
  table.cmp thead th.lbl-col { background: var(--slate-900); min-width: 210px; }
  table.cmp .ins { font-weight: 700; font-size: 0.92rem; }
  td.lbl { font-weight: 600; color: var(--slate-600); background: var(--slate-50); }
  tbody tr:nth-child(even) td:not(.lbl) { background: #fbfcfe; }
  tr.premium td { font-size: 0.95rem; border-top: 2px solid var(--slate-200); }
  .yes { color: #15803d; font-weight: 700; }
  .mth { text-decoration: underline; text-underline-offset: 2px; font-weight: 700; }
</style>
