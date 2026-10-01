<script>
  /**
   * Zmiana opiekuna. Administrator wybiera kogokolwiek; agent może przejąć lead
   * bez opiekuna albo zwolnić własny. To tylko podpowiedź — decyzję podejmuje SQL.
   */
  import { getContext } from 'svelte';
  import Dialog from './Dialog.svelte';
  import { mozeZmienicOpiekuna, opcjeOpiekuna } from './model.js';

  let { dialog, onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const karta = $derived(stan.znajdz(dialog.leadId)?.karta ?? stan.otwarty?.lead ?? null);
  const opcje = $derived(karta ? opcjeOpiekuna(stan.plan, karta) : []);
  const zezwolenie = $derived(karta ? mozeZmienicOpiekuna(stan.plan, karta) : { ok: false });

  const nowyKlucz = () => (globalThis.crypto?.randomUUID?.() ?? `o-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let wybrany = $state(karta?.opiekun_id ?? null);
  let blad = $state('');
  let trwa = $state(false);
  let klucz = $state(nowyKlucz());

  async function zapisz(e) {
    e.preventDefault();
    trwa = true;
    blad = '';
    const r = await stan.zmienOpiekuna(dialog.leadId, wybrany, klucz);
    trwa = false;
    if (r.ok) { onzamknij({ przywroc: true }); return; }
    if (['konflikt', 'brak_leada', 'sesja'].includes(r.status)) { onzamknij({ przywroc: false }); return; }
    blad = r.komunikat ?? 'Nie udało się zapisać.';
    if (r.status !== 'niepewny') klucz = nowyKlucz();
  }
</script>

<Dialog otwarty id="dlg-opiekun" tytul="Zmień opiekuna" onzamknij={() => onzamknij({ przywroc: true })} szerokosc="26rem">
  <form onsubmit={zapisz} id="dlg-opiekun-form">
    <p class="opis">{karta?.nazwa}</p>
    {#if !zezwolenie.ok}
      <p class="uwaga" role="status">{zezwolenie.powod}</p>
    {:else}
      <fieldset class="grupa">
        <legend>Opiekun</legend>
        {#each opcje as o, i (o.id ?? 'brak')}
          <label class="opcja">
            <!-- svelte-ignore a11y_autofocus -->
            <input type="radio" name="opiekun" value={o.id} checked={wybrany === o.id} onchange={() => (wybrany = o.id)} autofocus={i === 0 ? true : undefined} />
            {o.nazwa}
          </label>
        {/each}
      </fieldset>
      {#if stan.plan.rola !== 'admin'}
        <p class="mala">Możesz przejąć lead bez opiekuna albo zwolnić własny. Przypisać go innej osobie może administrator.</p>
      {/if}
    {/if}
    {#if blad}<p class="blad" role="alert">{blad}</p>{/if}
  </form>
  {#snippet stopka()}
    <button type="button" class="btn btn-ghost" onclick={() => onzamknij({ przywroc: true })} disabled={trwa}>Anuluj</button>
    {#if zezwolenie.ok}
      <button type="submit" form="dlg-opiekun-form" class="btn btn-primary" disabled={trwa || wybrany === (karta?.opiekun_id ?? null)}>{trwa ? 'Zapisuję…' : 'Zapisz'}</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .opis { margin: 0 0 .7rem; font-size: .88rem; color: var(--slate-600); }
  .grupa { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .4rem; }
  legend { font-size: .8rem; font-weight: 700; color: var(--slate-600); margin-bottom: .35rem; padding: 0; }
  .opcja { display: flex; align-items: center; gap: .5rem; padding: .45rem .6rem; border: 1px solid var(--slate-300); border-radius: 8px; cursor: pointer; font-size: .9rem; }
  .opcja:has(input:checked) { border-color: var(--blue-600); background: #eff6ff; }
  .mala { margin: .6rem 0 0; font-size: .78rem; color: var(--slate-500); }
  .uwaga { margin: 0; padding: .55rem .7rem; border-radius: 8px; background: #fef3c7; color: #92400e; font-size: .86rem; font-weight: 600; }
  .blad { margin: .4rem 0 0; font-size: .8rem; font-weight: 600; color: #991b1b; }
</style>
