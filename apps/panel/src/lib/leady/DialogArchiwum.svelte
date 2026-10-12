<script>
  /** Archiwizacja z potwierdzeniem i nazwą leada. Nie kasuje niczego z kartoteki. */
  import { getContext } from 'svelte';
  import Dialog from './Dialog.svelte';

  let { dialog, onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const karta = $derived(stan.znajdz(dialog.leadId)?.karta ?? stan.otwarty?.lead ?? null);

  const nowyKlucz = () => (globalThis.crypto?.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let blad = $state('');
  let trwa = $state(false);
  let klucz = $state(nowyKlucz());

  async function zatwierdz() {
    trwa = true;
    blad = '';
    const r = await stan.archiwizuj(dialog.leadId, klucz);
    trwa = false;
    if (r.ok || ['konflikt', 'brak_leada', 'sesja'].includes(r.status)) { onzamknij({ przywroc: false }); return; }
    blad = r.komunikat ?? 'Nie udało się zarchiwizować.';
    if (r.status !== 'niepewny') klucz = nowyKlucz();
  }
</script>

<Dialog otwarty id="dlg-archiwum" tytul="Archiwizować lead?" onzamknij={() => onzamknij({ przywroc: true })} szerokosc="26rem">
  <p class="tekst">Lead <strong>„{karta?.nazwa}"</strong> zniknie z tablicy.</p>
  {#if karta?.rodzaj === 'szkic'}
    <p class="mala">To porzucony wniosek: jego dane kontaktowe i tak zostaną usunięte automatycznie w terminie, niezależnie od archiwizacji.</p>
  {:else}
    <p class="mala">Dane klienta zostają w kartotece, a historia zmian w bazie.</p>
  {/if}
  {#if blad}<p class="blad" role="alert">{blad}</p>{/if}
  {#snippet stopka()}
    <!-- svelte-ignore a11y_autofocus -->
    <button type="button" class="btn btn-ghost" onclick={() => onzamknij({ przywroc: true })} disabled={trwa} autofocus>Anuluj</button>
    <button type="button" class="btn btn-danger" onclick={zatwierdz} disabled={trwa}>{trwa ? 'Archiwizuję…' : 'Archiwizuj'}</button>
  {/snippet}
</Dialog>

<style>
  .tekst { margin: 0 0 .4rem; font-size: .92rem; }
  .mala { margin: 0; font-size: .82rem; color: var(--slate-600); line-height: 1.4; }
  .blad { margin: .5rem 0 0; font-size: .8rem; font-weight: 600; color: #991b1b; }
</style>
