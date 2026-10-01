<script>
  import { insurerLabel } from '$lib/format.js';
  import { comparisonRows, extraNotes } from '$lib/comparisonRows.js';
  let { documents = [], selectable = false, onchoose = null, chosenId = null } = $props();

  // Gdy wszystkie porównywane oferty są od tego samego ubezpieczyciela,
  // nagłówek jest jeden, wspólny dla wszystkich kolumn.
  const sameInsurer = $derived(
    documents.length > 1 && documents.every((d) => d.insurer_type === documents[0].insurer_type)
  );

  // Wiersze (bazowe + postanowienia dodatkowe + składki) liczy wspólny moduł,
  // ten sam, z którego korzysta PDF rekomendacji.
  const rows = $derived(comparisonRows(documents));

  // Klauzule, których treść musi stać pod tabelą (np. LW144).
  const notes = $derived(extraNotes(documents));
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
      {#each rows as row (row.key)}
        {#if row.kind === 'section'}
          <tr class="sec">
            <td class="lbl sec-lbl" colspan={documents.length + 1}>{row.label}</td>
          </tr>
        {:else}
          <tr class={row.premium ? 'premium' : ''}>
            <td class="lbl">{row.label}</td>
            {#each row.cells as c}
              <td>
                {#if c.green}<span class="yes">{c.text}</span>
                {:else if c.underline}<span class="mth">{c.text}</span>
                {:else if c.bold}<strong>{c.text}</strong>
                {:else}{c.text}{/if}
              </td>
            {/each}
          </tr>
        {/if}
      {/each}
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

{#each notes as n (n.key)}
  <div class="cmp-note">
    <p class="cmp-note-title">{n.title}</p>
    <p class="cmp-note-text">{n.text}</p>
  </div>
{/each}

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
  /* Nagłówek sekcji „Postanowienia dodatkowe" — renderowany tylko, gdy sekcja ma wiersze. */
  tr.sec td.sec-lbl { background: var(--slate-100); color: var(--slate-700); font-size: .78rem;
    text-transform: uppercase; letter-spacing: .04em; padding: 6px 14px; }
  .mth { text-decoration: underline; text-underline-offset: 2px; font-weight: 700; }
  /* Treść klauzuli spod tabeli — np. ograniczenie z tytułu zwyrodnień (LW144). */
  .cmp-note { margin-top: .75rem; padding: .7rem .9rem; border-left: 3px solid var(--slate-400);
    background: var(--slate-50); border-radius: 0 8px 8px 0; }
  .cmp-note-title { margin: 0 0 .25rem; font-weight: 700; font-size: .85rem; color: var(--slate-800); }
  .cmp-note-text { margin: 0; font-size: .82rem; line-height: 1.5; color: var(--slate-700); }
</style>
