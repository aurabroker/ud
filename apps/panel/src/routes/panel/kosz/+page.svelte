<script>
  import { enhance } from '$app/forms';
  let { data, form } = $props();

  const statusLabel = { draft: 'Szkic', sent: 'Wysłana', viewed: 'Otwarta', chosen: 'Wybrana', bought: 'Kupiona', rejected: 'Rezygnacja' };

  function dt(s) {
    return s ? new Date(s).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }

  /** Ile pełnych dni zostało do usunięcia na dobre (0 = dziś w nocy). */
  function zostalo(s) {
    const ms = new Date(s).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 86400000));
  }

  let przywracam = $state('');
</script>

<svelte:head><title>Kosz — Panel</title></svelte:head>

<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;gap:1rem;flex-wrap:wrap;">
  <div>
    <h1 style="font-size:1.5rem;">Kosz ofert</h1>
    <p class="muted">
      Usunięte oferty leżą tu {data.dni} dni. Przywrócona oferta wraca w całości — z wariantami,
      plikami, historią wysyłek i <strong>tym samym linkiem dla klienta</strong>. Po {data.dni} dniach
      oferta i jej pliki znikają na dobre.
    </p>
  </div>
  <a class="btn btn-ghost" href="/panel">← Oferty</a>
</div>

{#if data.blad}<div class="error-box" style="margin-bottom:1rem;">{data.blad}</div>{/if}
{#if form?.error}<div class="error-box" style="margin-bottom:1rem;" role="alert">{form.error}</div>{/if}

<div class="card">
  {#if data.wpisy.length === 0}
    <div class="card-pad muted" style="text-align:center;padding:3rem 1rem;">Kosz jest pusty.</div>
  {:else}
    <table>
      <thead>
        <tr><th>Oferta nr</th><th>Klient</th><th>Status</th><th>Agent</th><th>Usunięta</th><th>Zostało</th><th></th></tr>
      </thead>
      <tbody>
        {#each data.wpisy as w (w.id)}
          <tr>
            <td style="font-weight:600;font-size:.82rem;">{w.offer_number || '—'}</td>
            <td>{w.client_name || '—'}<br /><span class="muted" style="font-size:.78rem;">{w.nazwa || ''} · wariantów: {w.wariantow}</span></td>
            <td><span class="badge badge-{w.status}">{statusLabel[w.status] || w.status || '—'}</span></td>
            <td class="muted" style="font-size:.82rem;">{w.wlasciciel || '—'}</td>
            <td class="muted" style="font-size:.82rem;">{dt(w.usunieto_at)}{#if w.usunieto_przez}<br />przez: {w.usunieto_przez}{/if}</td>
            <td style="font-size:.82rem;" title="Usunięcie na dobre: {dt(w.usuniecie_na_dobre)}">{zostalo(w.usuniecie_na_dobre)} dni</td>
            <td style="text-align:right;white-space:nowrap;">
              <form method="POST" action="?/przywroc"
                use:enhance={() => { przywracam = w.id; return async ({ update }) => { await update(); przywracam = ''; }; }}>
                <input type="hidden" name="id" value={w.id} />
                <button class="btn btn-primary" style="padding:.3rem .7rem;font-size:.8rem;" disabled={przywracam === w.id}>
                  {przywracam === w.id ? 'Przywracam…' : '↺ Przywróć'}
                </button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
