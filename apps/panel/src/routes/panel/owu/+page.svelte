<script>
  import { enhance } from '$app/forms';
  import { insurerLabel } from '$lib/format.js';
  let { data, form } = $props();
  let uploading = $state(false);

  const groups = $derived.by(() => {
    const g = { leadenhall: [], ceu: [] };
    for (const o of data.owu) (g[o.insurer_type] ||= []).push(o);
    return g;
  });
  function fmtSize(b) { return b ? (b / 1024 / 1024).toFixed(2) + ' MB' : '—'; }
</script>

<svelte:head><title>Biblioteka OWU — Panel</title></svelte:head>

<a href="/panel" class="muted" style="text-decoration:none;">← Wróć do listy</a>
<div style="display:flex;align-items:center;justify-content:space-between;margin:.5rem 0 1.5rem;">
  <div>
    <h1 style="font-size:1.5rem;">Biblioteka OWU</h1>
    <p class="muted">Wgraj OWU raz — dopasują się do ofert po symbolu (Leadenhall: 3, CEU: 2)</p>
  </div>
</div>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}
{#if form?.ok}<div class="ok-box">Zapisano.</div>{/if}

<!-- Upload -->
<div class="card card-pad" style="margin-bottom:1.5rem;">
  <h3 style="font-size:1rem;margin-bottom:1rem;">Dodaj OWU</h3>
  <form method="POST" action="?/upload" enctype="multipart/form-data"
    use:enhance={() => { uploading = true; return async ({ update }) => { await update(); uploading = false; }; }}>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
      <div class="field">
        <label class="label" for="insurer_type">Ubezpieczyciel</label>
        <select class="input" id="insurer_type" name="insurer_type" required>
          <option value="">— wybierz —</option>
          <option value="leadenhall">Leadenhall (Lloyd’s)</option>
          <option value="ceu">CEU — LOI</option>
        </select>
      </div>
      <div class="field">
        <label class="label" for="symbol">Symbol (klucz dopasowania)</label>
        <input class="input" id="symbol" name="symbol" required placeholder="np. LW044/AD_D_TTD_PTD/PL/3 lub LOI PREMIUM" />
      </div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:1rem;">
      <div class="field">
        <label class="label" for="title">Tytuł (widoczny dla klienta)</label>
        <input class="input" id="title" name="title" required placeholder="np. OWU Utrata Dochodu LW044" />
      </div>
      <div class="field">
        <label class="label" for="version">Wersja (opcjonalnie)</label>
        <input class="input" id="version" name="version" placeholder="np. wersja 1.2" />
      </div>
    </div>
    <div class="field">
      <label class="label" for="file">Plik OWU (PDF)</label>
      <input class="input" type="file" id="file" name="file" accept="application/pdf" required />
    </div>
    <button class="btn btn-primary" type="submit" disabled={uploading}>{uploading ? 'Wgrywam…' : 'Dodaj OWU'}</button>
  </form>
  <p class="muted" style="margin-top:.75rem;font-size:.8rem;">
    💡 <strong>Symbol</strong> to klucz dopasowania — musi odpowiadać temu, co pojawia się w ofercie
    (np. Leadenhall: <code>LW044/AD_D_TTD_PTD/PL/3</code>, CEU: <code>LOI PREMIUM</code>).
  </p>
</div>

<!-- Lista -->
{#each ['leadenhall', 'ceu'] as type}
  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:.75rem;">{insurerLabel(type)} ({groups[type]?.length || 0})</h3>
    {#if groups[type]?.length}
      <table>
        <thead><tr><th>Symbol</th><th>Tytuł</th><th>Wersja</th><th>Rozmiar</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {#each groups[type] as o}
            <tr style={o.active ? '' : 'opacity:.5;'}>
              <td><code style="font-size:.8rem;">{o.symbol || '—'}</code></td>
              <td>{o.title}</td>
              <td class="muted">{o.version || '—'}</td>
              <td class="muted">{fmtSize(o.size_bytes)}</td>
              <td>{#if o.active}<span class="badge badge-chosen">aktywne</span>{:else}<span class="badge badge-draft">wyłączone</span>{/if}</td>
              <td style="text-align:right;white-space:nowrap;">
                <form method="POST" action="?/toggle" use:enhance style="display:inline;">
                  <input type="hidden" name="id" value={o.id} /><input type="hidden" name="active" value={o.active} />
                  <button class="btn btn-ghost" style="padding:.3rem .6rem;font-size:.78rem;">{o.active ? 'Wyłącz' : 'Włącz'}</button>
                </form>
                <form method="POST" action="?/delete" use:enhance={() => ({ update }) => update()} style="display:inline;"
                  onsubmit={(e) => { if (!confirm('Usunąć OWU?')) e.preventDefault(); }}>
                  <input type="hidden" name="id" value={o.id} />
                  <button class="btn btn-ghost" style="padding:.3rem .6rem;font-size:.78rem;color:var(--red-600);">Usuń</button>
                </form>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="muted">Brak OWU. Dodaj wariant(y) powyżej.</p>
    {/if}
  </div>
{/each}
