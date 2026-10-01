<script>
  /** Zaplanowanie (albo usunięcie) następnego działania: rodzaj, termin, opis. */
  import { getContext } from 'svelte';
  import Dialog from './Dialog.svelte';
  import { DZIALANIA } from './model.js';

  let { dialog, onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const karta = $derived(stan.znajdz(dialog.leadId)?.karta ?? stan.otwarty?.lead ?? null);

  const doPola = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const jutro = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; };

  const poczatkowe = karta?.dzialanie;
  let typ = $state(poczatkowe?.typ ?? 'telefon');
  let termin = $state(poczatkowe?.termin ? doPola(new Date(poczatkowe.termin)) : doPola(jutro()));
  let opis = $state(poczatkowe?.opis ?? '');
  let blad = $state('');
  let trwa = $state(false);
  let klucz = $state(globalThis.crypto?.randomUUID?.() ?? `d-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const nowyKlucz = () => (globalThis.crypto?.randomUUID?.() ?? `d-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  async function wyslij(tresc) {
    trwa = true;
    blad = '';
    const r = await stan.zaplanujDzialanie(dialog.leadId, tresc, klucz);
    trwa = false;
    if (r.ok) { onzamknij({ przywroc: true }); return; }
    if (['konflikt', 'brak_leada', 'sesja'].includes(r.status)) { onzamknij({ przywroc: false }); return; }
    blad = r.komunikat ?? 'Nie udało się zapisać.';
    // Błąd sieci → ten sam klucz przy ponowieniu; odmowa serwera → nowa intencja.
    if (r.status !== 'niepewny') klucz = nowyKlucz();
  }

  function zapisz(e) {
    e.preventDefault();
    const d = new Date(termin);
    if (!termin || Number.isNaN(d.getTime())) { blad = 'Podaj termin działania.'; return; }
    if (opis.length > 200) { blad = 'Opis może mieć najwyżej 200 znaków.'; return; }
    wyslij({ typ, termin: d.toISOString(), opis: opis.trim() || null });
  }
</script>

<Dialog otwarty id="dlg-dzialanie" tytul="Zaplanuj działanie" onzamknij={() => onzamknij({ przywroc: true })}>
  <form onsubmit={zapisz} id="dlg-dzialanie-form">
    <p class="opis">{karta?.nazwa}</p>
    <div class="pole-grupa">
      <label for="dlg-dz-typ" class="et">Rodzaj</label>
      <!-- svelte-ignore a11y_autofocus -->
      <select id="dlg-dz-typ" class="pole" bind:value={typ} autofocus>
        {#each Object.entries(DZIALANIA) as [k, n] (k)}<option value={k}>{n}</option>{/each}
      </select>
    </div>
    <div class="pole-grupa">
      <label for="dlg-dz-termin" class="et">Termin</label>
      <input id="dlg-dz-termin" class="pole" type="datetime-local" bind:value={termin} required />
    </div>
    <div class="pole-grupa">
      <label for="dlg-dz-opis" class="et">Opis (opcjonalnie)</label>
      <input id="dlg-dz-opis" class="pole" type="text" maxlength="200" bind:value={opis} />
    </div>
    {#if blad}<p class="blad" role="alert">{blad}</p>{/if}
  </form>
  {#snippet stopka()}
    {#if karta?.dzialanie}
      <button type="button" class="btn btn-ghost" disabled={trwa} onclick={() => wyslij({ typ: null })}>Usuń zaplanowane</button>
    {/if}
    <button type="button" class="btn btn-ghost" onclick={() => onzamknij({ przywroc: true })} disabled={trwa}>Anuluj</button>
    <button type="submit" form="dlg-dzialanie-form" class="btn btn-primary" disabled={trwa}>{trwa ? 'Zapisuję…' : 'Zapisz'}</button>
  {/snippet}
</Dialog>

<style>
  .opis { margin: 0 0 .7rem; font-size: .88rem; color: var(--slate-600); }
  .pole-grupa { margin-bottom: .7rem; }
  .et { display: block; font-size: .8rem; font-weight: 700; color: var(--slate-600); margin-bottom: .3rem; }
  .pole { width: 100%; padding: .5rem .65rem; border: 1px solid var(--slate-300); border-radius: 8px; font: inherit; font-size: .9rem; background: #fff; }
  .pole:focus-visible { outline: 2px solid var(--blue-600); border-color: transparent; }
  .blad { margin: .2rem 0 0; font-size: .8rem; font-weight: 600; color: #991b1b; }
</style>
