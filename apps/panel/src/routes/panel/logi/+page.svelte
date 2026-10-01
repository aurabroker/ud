<script>
  let { data } = $props();

  const statusLabel = { sent: 'Wysłano', error: 'Błąd', stub: 'Tryb testowy' };
  const channelLabel = { email: '✉ Email', sms: '✆ SMS' };

  function dt(s) {
    return s ? new Date(s).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }

  const counts = $derived({
    sent: data.logs.filter((l) => l.status === 'sent').length,
    error: data.logs.filter((l) => l.status === 'error').length,
    stub: data.logs.filter((l) => l.status === 'stub').length
  });
</script>

<svelte:head><title>Wysyłki — Panel</title></svelte:head>

<div style="margin-bottom:1rem;">
  <h1 style="font-size:1.5rem;">Wysyłki do klientów</h1>
  <p class="muted">
    Każda próba wysłania SMS-a i e-maila — także nieudana.
    {#if data.logs.length}
      Wysłane: <strong>{counts.sent}</strong> · Błędy: <strong style="color:var(--red-600);">{counts.error}</strong> · Tryb testowy: <strong>{counts.stub}</strong>
    {/if}
  </p>
</div>

{#if data.loadError}<div class="error-box">Nie udało się wczytać logów: {data.loadError}</div>{/if}

<!-- Filtry -->
<div class="card card-pad" style="margin-bottom:1rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
  <span class="muted" style="font-size:.82rem;">Filtr:</span>
  <a class="btn btn-ghost btn-f" href="/panel/logi" class:active={!data.filters.channel && !data.filters.status}>Wszystko</a>
  <a class="btn btn-ghost btn-f" href="/panel/logi?kanal=email" class:active={data.filters.channel === 'email'}>Email</a>
  <a class="btn btn-ghost btn-f" href="/panel/logi?kanal=sms" class:active={data.filters.channel === 'sms'}>SMS</a>
  <a class="btn btn-ghost btn-f" href="/panel/logi?status=error" class:active={data.filters.status === 'error'}>Tylko błędy</a>
  <a class="btn btn-ghost btn-f" href="/panel/logi?status=stub" class:active={data.filters.status === 'stub'}>Tryb testowy</a>
</div>

<div class="card">
  {#if data.logs.length === 0}
    <div class="card-pad muted" style="text-align:center;padding:2.5rem 1rem;">
      Brak zapisanych wysyłek. Wpisy pojawią się po użyciu „Wyślij klientowi" na ofercie.
    </div>
  {:else}
    <table>
      <thead>
        <tr><th>Data</th><th>Kanał</th><th>Oferta</th><th>Odbiorca</th><th>Status</th><th>Szczegóły</th></tr>
      </thead>
      <tbody>
        {#each data.logs as l}
          <tr>
            <td class="muted" style="white-space:nowrap;font-size:.82rem;">{dt(l.created_at)}</td>
            <td style="white-space:nowrap;">{channelLabel[l.channel] || l.channel}</td>
            <td style="font-size:.82rem;">
              {#if l.offer_id}
                <a href="/panel/offer/{l.offer_id}">{l.ud_offers?.offer_number || 'oferta'}</a>
                {#if l.ud_offers?.client_name}<br /><span class="muted">{l.ud_offers.client_name}</span>{/if}
              {:else}—{/if}
            </td>
            <td style="font-size:.82rem;">{l.recipient || '—'}</td>
            <td style="white-space:nowrap;">
              <span class="st st-{l.status}">{statusLabel[l.status] || l.status}</span>
            </td>
            <td style="font-size:.8rem;max-width:380px;">
              {#if l.error}<span style="color:var(--red-700);">{l.error}</span>
              {:else if l.status === 'stub'}<span class="muted">Brak konfiguracji dostawcy — nic nie wysłano</span>
              {:else if l.provider_id}<span class="muted">ID: {l.provider_id}</span>
              {:else}—{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .btn-f { padding: .28rem .7rem; font-size: .82rem; text-decoration: none; }
  .btn-f.active { background: var(--slate-800); color: #fff; }
  .st { display: inline-block; padding: .12rem .5rem; border-radius: 999px; font-size: .75rem; font-weight: 700; }
  .st-sent { background: #dcfce7; color: #15803d; }
  .st-error { background: #fee2e2; color: #b91c1c; }
  .st-stub { background: #fef3c7; color: #92400e; }
</style>
