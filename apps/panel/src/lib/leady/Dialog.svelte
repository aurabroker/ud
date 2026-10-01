<script>
  /**
   * Okno modalne na natywnym <dialog>: pułapka fokusu, Esc i obsługa ::backdrop
   * dostajemy od przeglądarki. Treść jest renderowana tylko przy otwarciu, więc
   * każde otwarcie zaczyna od czystego formularza, a `autofocus` działa.
   */
  let { otwarty = false, tytul, id, onzamknij, szerokosc = '30rem', children, stopka } = $props();
  let el = $state(null);

  $effect(() => {
    if (!el) return;
    if (otwarty && !el.open) el.showModal();
    else if (!otwarty && el.open) el.close();
  });
</script>

<dialog
  bind:this={el}
  class="dialog"
  aria-labelledby="{id}-tytul"
  style:max-width={szerokosc}
  oncancel={(e) => { e.preventDefault(); onzamknij?.(); }}
  onclick={(e) => { if (e.target === el) onzamknij?.(); }}
>
  {#if otwarty}
    <div class="tresc">
      <h2 id="{id}-tytul" class="tytul">{tytul}</h2>
      {@render children?.()}
      {#if stopka}<div class="stopka">{@render stopka()}</div>{/if}
    </div>
  {/if}
</dialog>

<style>
  .dialog {
    border: 1px solid var(--slate-200); border-radius: 12px; padding: 0;
    width: calc(100% - 2rem); box-shadow: 0 18px 40px rgba(15, 23, 42, .28);
    color: var(--slate-800); background: #fff;
  }
  .dialog::backdrop { background: rgba(15, 23, 42, .55); }
  .tresc { padding: 1.1rem 1.25rem 1.1rem; }
  .tytul { font-size: 1.05rem; font-weight: 700; margin: 0 0 .75rem; }
  .stopka { display: flex; justify-content: flex-end; gap: .5rem; margin-top: 1rem; flex-wrap: wrap; }
</style>
