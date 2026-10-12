<script>
  /**
   * Lewy panel zwiniętych etapów. Kolejność = kolejność pipeline'u (nie kolejność
   * zwijania). Cała pozycja jest celem upuszczenia, więc lead można przenieść na
   * zwinięty etap bez rozwijania go. Napisy poziome — obrócony tekst jest trudny
   * do przeczytania i nie nadaje się na jedyną prezentację nazwy.
   */
  import { getContext } from 'svelte';

  let { etapy } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const filtr = $derived(stan.czyFiltrAktywny());
</script>

{#if etapy.length}
  <nav class="zwiniete" aria-label="Zwinięte etapy" data-zwiniete-panel>
    <div class="naglowek">
      <span class="tytul">Zwinięte etapy</span>
      <button type="button" class="rozwin-wszystkie" onclick={() => stan.rozwinWszystkie()}>Rozwiń wszystkie</button>
    </div>
    <ul>
      {#each etapy as etap (etap.id)}
        {@const l = stan.liczniki[etap.id]}
        {@const cel = ctx.cel?.etapId === etap.id ? ctx.cel : null}
        {@const numer = stan.etapy.findIndex((e) => e.id === etap.id) + 1}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="poz"
          class:cel-ok={cel?.ok}
          class:cel-blokada={cel && !cel.ok}
          class:podglad={stan.podglad === etap.id}
          data-cel-etap={etap.id}
          data-zwiniety
          data-zw-id={etap.id}
          data-naglowek-etapu={etap.id}
          oncontextmenu={(e) => ctx.kontekstEtapu(e, etap.id)}
        >
          <span class="nr" aria-hidden="true">{numer}</span>
          <span class="nazwa">{etap.nazwa}</span>
          <span class="licznik" data-licznik aria-label="{filtr ? `${l?.ile ?? 0} z ${l?.ileWszystkich ?? 0}` : (l?.ile ?? 0)} leadów">
            {filtr ? `${l?.ile ?? 0} z ${l?.ileWszystkich ?? 0}` : (l?.ile ?? 0)}
          </span>
          <button type="button" class="rozwin" aria-label="Rozwiń etap {etap.nazwa}" onclick={() => stan.zwinEtap(etap.id, false)}>Rozwiń</button>
          <button
            type="button"
            class="ikona"
            aria-label="Akcje etapu {etap.nazwa}"
            aria-haspopup="menu"
            aria-expanded={ctx.menuEtapuOtwarteDla === etap.id}
            onclick={(e) => ctx.otworzMenuEtapu(etap.id, e.currentTarget)}
          >…</button>
          {#if cel}
            <span class="cel-opis" aria-hidden="true">{cel.ok ? `Przenieś do: ${etap.nazwa}` : `Niedostępne: ${cel.powod}`}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </nav>
{/if}

<style>
  .zwiniete {
    flex: 0 0 11.25rem; width: 11.25rem; overflow-y: auto; background: var(--slate-200); border-radius: 12px; padding: .6rem; align-self: stretch;
  }
  .naglowek { display: flex; flex-direction: column; gap: .3rem; margin-bottom: .5rem; }
  .tytul { font-size: .72rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--slate-600); }
  .rozwin-wszystkie { align-self: flex-start; background: none; border: 0; padding: 0; font: inherit; font-size: .78rem; font-weight: 700; color: var(--blue-700); text-decoration: underline; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .4rem; }
  .poz {
    position: relative; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .15rem .4rem;
    background: #fff; border: 2px solid var(--slate-300); border-radius: 10px; padding: .45rem .5rem;
    transition: border-color .12s ease, background-color .12s ease;
  }
  .poz.cel-ok { border-color: var(--blue-600); background: #dbeafe; }
  .poz.cel-blokada { border-color: var(--red-600); background: #fee2e2; }
  .poz.podglad { border-color: var(--blue-600); }
  .nr { width: 1.3rem; height: 1.3rem; border-radius: 50%; background: var(--slate-700); color: #fff; font-size: .7rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
  .nazwa { font-size: .85rem; font-weight: 700; color: var(--slate-800); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .licznik { font-size: .76rem; font-weight: 700; color: var(--slate-700); background: var(--slate-100); border: 1px solid var(--slate-300); border-radius: 999px; padding: 0 .4rem; }
  .rozwin { grid-column: 1 / 3; justify-self: start; background: none; border: 0; padding: 0; font: inherit; font-size: .76rem; font-weight: 700; color: var(--blue-700); text-decoration: underline; cursor: pointer; }
  .ikona { grid-column: 3; justify-self: end; width: 1.6rem; height: 1.6rem; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--slate-600); font-size: 1rem; font-weight: 800; cursor: pointer; line-height: 1; }
  .ikona:hover, .ikona[aria-expanded='true'] { background: var(--slate-100); border-color: var(--slate-300); }
  .rozwin:focus-visible, .ikona:focus-visible, .rozwin-wszystkie:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 1px; }
  .cel-opis { grid-column: 1 / -1; font-size: .74rem; font-weight: 700; margin-top: .15rem; }
  .cel-ok .cel-opis { color: var(--blue-700); }
  .cel-blokada .cel-opis { color: #991b1b; }
  @media (prefers-reduced-motion: reduce) { .poz { transition: none; } }
</style>
