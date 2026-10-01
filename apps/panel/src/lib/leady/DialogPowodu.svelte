<script>
  /**
   * Powód utraty — dane zbieramy PRZED zapisem, więc anulowanie nie zmienia etapu
   * (K11). Walidacja po stronie klienta jest tylko wygodą; ta sama reguła
   * (min. 3 znaki) stoi w ud_lead_zmien.
   */
  import { getContext } from 'svelte';
  import Dialog from './Dialog.svelte';

  let { dialog, onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const karta = $derived(stan.znajdz(dialog.leadId)?.karta ?? null);
  const etap = $derived(stan.etap(dialog.etapId));

  let powod = $state('');
  let blad = $state('');

  function zapisz(e) {
    e.preventDefault();
    const tresc = powod.trim();
    if (tresc.length < 3) { blad = 'Podaj powód utraty (co najmniej 3 znaki).'; return; }
    const { leadId, etapId } = dialog;   // przed zamknięciem — potem `dialog` jest null
    onzamknij({ przywroc: false });
    stan.przenies(leadId, etapId, { dane: { powod_utraty: tresc } });
  }
</script>

<Dialog otwarty id="dlg-powod" tytul="Powód utraty" onzamknij={() => onzamknij({ przywroc: true })}>
  <form onsubmit={zapisz} id="dlg-powod-form">
    <p class="opis">{karta?.nazwa ?? 'Lead'} → <strong>{etap?.nazwa}</strong>. Zanim przeniesiesz lead do tego etapu, podaj powód — bez niego etap się nie zmieni.</p>
    <label for="dlg-powod-pole" class="et">Powód utraty</label>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      id="dlg-powod-pole"
      class="pole"
      rows="3"
      maxlength="300"
      autofocus
      bind:value={powod}
      aria-invalid={blad ? 'true' : undefined}
      aria-describedby={blad ? 'dlg-powod-blad' : undefined}
    ></textarea>
    {#if blad}<p id="dlg-powod-blad" class="blad" role="alert">{blad}</p>{/if}
  </form>
  {#snippet stopka()}
    <button type="button" class="btn btn-ghost" onclick={() => onzamknij({ przywroc: true })}>Anuluj</button>
    <button type="submit" form="dlg-powod-form" class="btn btn-primary">Przenieś do „{etap?.nazwa}"</button>
  {/snippet}
</Dialog>

<style>
  .opis { margin: 0 0 .7rem; font-size: .88rem; color: var(--slate-600); line-height: 1.45; }
  .et { display: block; font-size: .8rem; font-weight: 700; color: var(--slate-600); margin-bottom: .3rem; }
  .pole { width: 100%; padding: .5rem .65rem; border: 1px solid var(--slate-300); border-radius: 8px; font: inherit; font-size: .9rem; resize: vertical; }
  .pole:focus-visible { outline: 2px solid var(--blue-600); border-color: transparent; }
  .pole[aria-invalid='true'] { border-color: var(--red-600); }
  .blad { margin: .35rem 0 0; font-size: .8rem; font-weight: 600; color: #991b1b; }
</style>
