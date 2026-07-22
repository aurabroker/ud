<script>
  let { data } = $props();
  const statusLabel = { draft: 'Szkic', sent: 'Wysłana', viewed: 'Otwarta', chosen: 'Wybrana', rejected: 'Rezygnacja' };
  function fmtDate(s) { return s ? new Date(s).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; }
</script>

<svelte:head><title>Oferty — Panel</title></svelte:head>

<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
  <div>
    <h1 style="font-size:1.5rem;">Oferty z PDF</h1>
    <p class="muted">Wgraj PDF Leadenhall/CEU, wyślij link klientowi</p>
  </div>
  <a class="btn btn-primary" href="/panel/new">+ Nowa oferta</a>
</div>

<div class="card">
  {#if data.offers.length === 0}
    <div class="card-pad muted" style="text-align:center;padding:3rem 1rem;">
      Brak ofert. Kliknij <strong>„+ Nowa oferta"</strong>, aby wgrać pierwsze PDF-y.
    </div>
  {:else}
    <table>
      <thead><tr><th>Oferta</th><th>Klient</th><th>Status</th><th>Utworzona</th><th></th></tr></thead>
      <tbody>
        {#each data.offers as o}
          <tr>
            <td style="font-weight:600;">{o.name}</td>
            <td>{o.client_name || '—'}</td>
            <td><span class="badge badge-{o.status}">{statusLabel[o.status] || o.status}</span></td>
            <td class="muted">{fmtDate(o.created_at)}</td>
            <td style="text-align:right;"><a href="/panel/offer/{o.id}">Otwórz →</a></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
