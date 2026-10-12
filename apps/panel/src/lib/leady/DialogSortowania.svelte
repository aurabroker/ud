<script>
  /** Sortowanie jednej kolumny (menu etapu → „Sortowanie…"). Pozycja karty wynika z wyboru, nie z ręcznego wstawienia. */
  import { getContext } from 'svelte';
  import Dialog from './Dialog.svelte';
  import { SORTOWANIA } from './model.js';

  let { dialog, onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const etap = $derived(stan.etap(dialog.etapId));

  function wybierz(id) {
    stan.ustawSortKolumny(dialog.etapId, id);
    onzamknij({ przywroc: true });
  }
</script>

<Dialog otwarty id="dlg-sort" tytul={`Sortowanie etapu „${etap?.nazwa}”`} onzamknij={() => onzamknij({ przywroc: true })} szerokosc="24rem">
  <ul class="wybor">
    {#each SORTOWANIA as s (s.id)}
      <li>
        <!-- svelte-ignore a11y_autofocus -->
        <button type="button" class="opcja" data-sort-opcja={s.id} aria-pressed={stan.sortDla(dialog.etapId) === s.id} onclick={() => wybierz(s.id)} autofocus={stan.sortDla(dialog.etapId) === s.id ? true : undefined}>
          {s.nazwa}
          {#if stan.sortDla(dialog.etapId) === s.id}<span class="biezacy">aktualne</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
  {#snippet stopka()}
    <button type="button" class="btn btn-ghost" onclick={() => onzamknij({ przywroc: true })}>Zamknij</button>
  {/snippet}
</Dialog>

<style>
  .wybor { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
  .opcja { width: 100%; display: flex; justify-content: space-between; text-align: left; border: 1px solid var(--slate-300); border-radius: 8px; background: #fff; padding: .6rem .75rem; font: inherit; font-weight: 600; cursor: pointer; }
  .opcja[aria-pressed='true'] { border-color: var(--blue-600); background: #eff6ff; }
  .opcja:hover { background: var(--slate-50); }
  .opcja:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 1px; }
  .biezacy { font-size: .74rem; font-weight: 700; color: var(--blue-700); }
</style>
