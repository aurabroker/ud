<script>
  import { dateP } from '$lib/format.js';
  let { data } = $props();
  let q = $state('');

  const filtered = $derived(
    data.clients.filter((c) => {
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      return [c.full_name, c.email, c.phone, c.akcja?.etykieta].some((v) => (v || '').toLowerCase().includes(s));
    })
  );
</script>

<svelte:head><title>Klienci — Panel</title></svelte:head>

<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:1rem;">
  <div>
    <h1 style="font-size:1.5rem;">Klienci</h1>
    <p class="muted">{data.clients.length} klientów · kliknij, aby otworzyć kartę</p>
  </div>
  <div style="display:flex;gap:.5rem;align-items:center;">
    <input class="input" style="max-width:280px;" placeholder="Szukaj: nazwisko, email, telefon, akcja…" bind:value={q} />
    <a class="btn btn-primary" href="/panel/klienci/nowy" style="white-space:nowrap;">+ Dodaj klienta</a>
  </div>
</div>

<div class="card">
  {#if filtered.length === 0}
    <div class="card-pad muted" style="text-align:center;padding:2.5rem 1rem;">Brak klientów.</div>
  {:else}
    <table>
      <thead><tr><th>Klient</th><th>Kontakt</th><th>Akcja</th><th>Przypisany do</th><th>Dodano</th></tr></thead>
      <tbody>
        {#each filtered as c}
          <tr>
            <td style="font-weight:600;"><a href="/panel/klienci/{c.id}">{c.full_name || '—'}</a></td>
            <td class="muted" style="font-size:.82rem;">{c.email || '—'}<br />{c.phone || ''}</td>
            <td data-akcja={c.akcja.id}>
              {#if c.akcja.link}
                <a class="badge {c.akcja.klasa} akcja" href={c.akcja.link} title={c.akcja.tytul ?? 'Otwórz lead na tablicy'}>{c.akcja.etykieta}</a>
              {:else if c.akcja.klasa}
                <span class="badge {c.akcja.klasa}" title={c.akcja.tytul ?? undefined}>{c.akcja.etykieta}</span>
              {:else}
                <span class="muted">—</span>
              {/if}
              {#if c.akcja.archiwum}<span class="muted archiwum">archiwum</span>{/if}
            </td>
            <td>
              {#if c.owner_name}
                <span class="badge badge-sent">{c.owner_name}</span>
              {:else}
                <span class="badge badge-draft">samodzielnie</span>
              {/if}
            </td>
            <td class="muted">{dateP(c.created_at)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .akcja { text-decoration: none; white-space: nowrap; }
  .akcja:hover { text-decoration: underline; }
  .akcja:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
  .archiwum { display: block; font-size: .72rem; margin-top: .15rem; }
</style>
