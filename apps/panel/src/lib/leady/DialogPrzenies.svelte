<script>
  /** „Przenieś do…" — prosty wybór etapu (alternatywa dla przeciągania, WCAG 2.5.7). */
  import { getContext } from 'svelte';
  import Dialog from './Dialog.svelte';

  let { dialog, onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const karta = $derived(stan.znajdz(dialog.leadId)?.karta ?? stan.otwarty?.lead ?? null);
  let q = $state('');
  const widoczne = $derived(stan.etapy.filter((e) => e.nazwa.toLowerCase().includes(q.trim().toLowerCase())));
  const pierwszyMozliwy = $derived(widoczne.find((e) => e.id !== karta?.etap_id));

  function wybierz(e) {
    // Wartości czytamy PRZED zamknięciem: `dialog` to getter na stan rodzica i po zamknięciu jest null.
    const { leadId, fokusPo } = dialog;
    onzamknij({ przywroc: false });
    ctx.przeniesZUi(leadId, e.id, fokusPo);
  }
</script>

<Dialog otwarty id="dlg-przenies" tytul="Przenieś do…" onzamknij={() => onzamknij({ przywroc: true })} szerokosc="24rem">
  {#if karta}
    <p class="opis">{karta.nazwa}</p>
    {#if stan.etapy.length > 8}
      <label class="sr-only" for="dlg-przenies-q">Szukaj etapu</label>
      <input id="dlg-przenies-q" class="pole" type="search" placeholder="Szukaj etapu…" bind:value={q} />
    {/if}
    <ul class="wybor">
      {#each widoczne as e (e.id)}
        {@const biezacy = e.id === karta.etap_id}
        <li>
          <!-- svelte-ignore a11y_autofocus -->
          <button
            type="button"
            class="opcja"
            data-etap-opcja={e.klucz}
            aria-current={biezacy ? 'true' : undefined}
            aria-disabled={biezacy ? 'true' : undefined}
            autofocus={e.id === pierwszyMozliwy?.id ? true : undefined}
            onclick={() => { if (!biezacy) wybierz(e); }}
          >
            <span>{e.nazwa}</span>
            {#if biezacy}<span class="biezacy">bieżący etap</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet stopka()}
    <button type="button" class="btn btn-ghost" onclick={() => onzamknij({ przywroc: true })}>Anuluj</button>
  {/snippet}
</Dialog>

<style>
  .opis { margin: 0 0 .6rem; font-size: .86rem; color: var(--slate-600); }
  .wybor { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
  .opcja {
    width: 100%; display: flex; justify-content: space-between; align-items: center; gap: .5rem; text-align: left;
    border: 1px solid var(--slate-300); border-radius: 8px; background: #fff; padding: .6rem .75rem; font: inherit; font-weight: 600; cursor: pointer;
  }
  .opcja:hover:not([aria-disabled='true']) { background: var(--slate-50); border-color: var(--slate-400); }
  .opcja:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 1px; }
  .opcja[aria-disabled='true'] { background: var(--slate-100); color: var(--slate-500); cursor: not-allowed; }
  .biezacy { font-size: .74rem; font-weight: 700; color: var(--slate-500); }
  .pole { width: 100%; padding: .45rem .6rem; border: 1px solid var(--slate-300); border-radius: 8px; font: inherit; margin-bottom: .5rem; }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
