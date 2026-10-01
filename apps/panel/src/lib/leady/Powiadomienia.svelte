<script>
  /**
   * Komunikaty: dwa regiony dla czytników ekranu (grzeczny `status` dla wyników,
   * natychmiastowy `alert` dla błędów) i widoczny komunikat z opcjonalną akcją
   * („Cofnij", „Otwórz szczegóły", „Spróbuj ponownie"). Tekst widocznego
   * komunikatu jest aria-hidden — czytnik dostaje go z regionów, żeby nie
   * czytać dwa razy — ale przyciski zostają dostępne.
   */
  let { stan, onakcja } = $props();
</script>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-komunikat-status>{stan.status}</div>
<div class="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-komunikat-alert>{stan.alert}</div>

{#if stan.sesjaWygasla}
  <div class="baner" role="alert" data-baner-sesji>
    Sesja wygasła. <a href="/login">Zaloguj się ponownie</a> — niezapisane zmiany nie zostały wprowadzone.
  </div>
{/if}

{#if stan.toast}
  {#key stan.toast.id}
    <div class="toast" class:blad={stan.toast.typ === 'blad'} data-toast data-toast-typ={stan.toast.typ}>
      <span class="tekst" aria-hidden="true">{stan.toast.tekst}</span>
      {#if stan.toast.akcja}
        <button type="button" class="akcja" onclick={() => onakcja(stan.toast.akcja)} aria-label="{stan.toast.akcja.etykieta}: {stan.toast.tekst}">
          {stan.toast.akcja.etykieta}
        </button>
      {/if}
      <button type="button" class="zamknij" aria-label="Zamknij komunikat" onclick={() => stan.zamknijToast()}>✕</button>
    </div>
  {/key}
{/if}

<style>
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .toast {
    position: fixed; left: 50%; bottom: 1.25rem; transform: translateX(-50%); z-index: 1800;
    display: flex; align-items: center; gap: .75rem; max-width: min(40rem, calc(100vw - 2rem));
    background: var(--slate-800); color: #fff; border-radius: 10px; padding: .6rem .75rem .6rem 1rem;
    box-shadow: 0 10px 28px rgba(15, 23, 42, .35); font-size: .88rem;
  }
  .toast.blad { background: #7f1d1d; }
  .tekst { flex: 1; line-height: 1.35; }
  .akcja { border: 1px solid rgba(255, 255, 255, .55); background: transparent; color: #fff; border-radius: 7px; padding: .3rem .7rem; font: inherit; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .akcja:hover { background: rgba(255, 255, 255, .14); }
  .zamknij { border: 0; background: transparent; color: #fff; cursor: pointer; font-size: 1rem; padding: .2rem .4rem; border-radius: 6px; }
  .akcja:focus-visible, .zamknij:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .baner { background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; border-radius: 8px; padding: .55rem .8rem; margin-bottom: .6rem; font-size: .88rem; font-weight: 600; }
  .baner a { color: #92400e; }
</style>
