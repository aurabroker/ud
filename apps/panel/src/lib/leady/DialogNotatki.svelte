<script>
  /** Dodanie notatki z menu. Ten sam klucz idempotencji przy ponowieniu po błędzie sieci. */
  import { getContext } from 'svelte';
  import Dialog from './Dialog.svelte';

  let { dialog, onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const karta = $derived(stan.znajdz(dialog.leadId)?.karta ?? stan.otwarty?.lead ?? null);

  const nowyKlucz = () => (globalThis.crypto?.randomUUID?.() ?? `n-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let tresc = $state('');
  let blad = $state('');
  let trwa = $state(false);
  let klucz = $state(nowyKlucz());

  async function zapisz(e) {
    e.preventDefault();
    if (!tresc.trim()) { blad = 'Wpisz treść notatki.'; return; }
    trwa = true;
    blad = '';
    const r = await stan.dodajNotatke(dialog.leadId, tresc.trim(), klucz);
    trwa = false;
    if (r.ok) { onzamknij({ przywroc: true }); return; }
    if (['brak_leada', 'sesja'].includes(r.status)) { onzamknij({ przywroc: false }); return; }
    blad = r.komunikat;
    if (r.status !== 'siec') klucz = nowyKlucz();
  }
</script>

<Dialog otwarty id="dlg-notatka" tytul="Dodaj notatkę" onzamknij={() => onzamknij({ przywroc: true })}>
  <form onsubmit={zapisz} id="dlg-notatka-form">
    <p class="opis">{karta?.nazwa}</p>
    <label for="dlg-notatka-pole" class="et">Notatka</label>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea id="dlg-notatka-pole" class="pole" rows="5" maxlength="2000" autofocus bind:value={tresc} disabled={trwa}></textarea>
    {#if blad}<p class="blad" role="alert">{blad}</p>{/if}
  </form>
  {#snippet stopka()}
    <button type="button" class="btn btn-ghost" onclick={() => onzamknij({ przywroc: true })} disabled={trwa}>Anuluj</button>
    <button type="submit" form="dlg-notatka-form" class="btn btn-primary" disabled={trwa}>{trwa ? 'Zapisuję…' : 'Dodaj notatkę'}</button>
  {/snippet}
</Dialog>

<style>
  .opis { margin: 0 0 .7rem; font-size: .88rem; color: var(--slate-600); }
  .et { display: block; font-size: .8rem; font-weight: 700; color: var(--slate-600); margin-bottom: .3rem; }
  .pole { width: 100%; padding: .5rem .65rem; border: 1px solid var(--slate-300); border-radius: 8px; font: inherit; font-size: .9rem; resize: vertical; }
  .pole:focus-visible { outline: 2px solid var(--blue-600); border-color: transparent; }
  .blad { margin: .35rem 0 0; font-size: .8rem; font-weight: 600; color: #991b1b; }
</style>
