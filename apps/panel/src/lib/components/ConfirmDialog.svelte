<script>
  /**
   * ConfirmDialog — okno potwierdzenia w stylu aplikacji (zamiast confirm() przeglądarki).
   * Zamknięcie: Esc, kliknięcie tła, przycisk „Anuluj”.
   */
  let {
    open = false,
    title = 'Potwierdź',
    message = '',
    detail = '',
    confirmLabel = 'Potwierdź',
    cancelLabel = 'Anuluj',
    busyLabel = 'Pracuję…',
    danger = false,
    busy = false,
    onconfirm,
    oncancel
  } = $props();

  let confirmBtn = $state(null);
  $effect(() => { if (open && confirmBtn) confirmBtn.focus(); });

  function onKeydown(e) {
    if (!open) return;
    if (e.key === 'Escape' && !busy) oncancel?.();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="cd-backdrop" role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget && !busy) oncancel?.(); }}>
    <div class="cd" role="alertdialog" aria-modal="true" aria-labelledby="cd-title">
      <h3 id="cd-title" class="cd-title">{title}</h3>
      {#if message}<p class="cd-msg">{message}</p>{/if}
      {#if detail}<p class="cd-detail">{detail}</p>{/if}
      <div class="cd-actions">
        <button type="button" class="btn btn-ghost" onclick={() => oncancel?.()} disabled={busy}>{cancelLabel}</button>
        <button type="button" bind:this={confirmBtn} class="btn {danger ? 'btn-danger' : 'btn-primary'}"
          onclick={() => onconfirm?.()} disabled={busy}>{busy ? busyLabel : confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cd-backdrop {
    position: fixed; inset: 0; z-index: 60;
    background: rgba(15, 23, 42, .55);
    display: flex; align-items: center; justify-content: center; padding: 1.25rem;
  }
  .cd {
    background: #fff; border: 1px solid var(--slate-200); border-radius: 12px;
    box-shadow: 0 18px 40px rgba(15, 23, 42, .22);
    width: 100%; max-width: 420px; padding: 1.1rem 1.2rem;
  }
  .cd-title { font-size: 1.02rem; font-weight: 700; margin: 0 0 .4rem; }
  .cd-msg { margin: 0; font-size: .88rem; color: var(--slate-600); line-height: 1.45; }
  .cd-detail {
    margin: .55rem 0 0; font-size: .82rem; font-weight: 600; color: var(--slate-800);
    background: var(--slate-50); border: 1px solid var(--slate-200); border-radius: 8px; padding: .45rem .6rem;
    overflow-wrap: anywhere;
  }
  .cd-actions { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
</style>
