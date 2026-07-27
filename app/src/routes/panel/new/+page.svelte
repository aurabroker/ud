<script>
  import { enhance } from '$app/forms';
  let { data, form } = $props();
  let loading = $state(false);
  let fileNames = $state([]);
  function onFiles(e) { fileNames = [...e.target.files].map((f) => f.name); }

  // Wybór istniejącego klienta
  let clientId = $state('');
  let clientName = $state('');
  let clientEmail = $state('');
  let clientPhone = $state('');

  function onPickClient(e) {
    clientId = e.target.value;
    const c = data.clients.find((x) => x.id === clientId);
    if (c) {
      clientName = c.full_name || '';
      clientEmail = c.email || '';
      clientPhone = c.phone || '';
    }
  }
  const picked = $derived(!!clientId);
</script>

<svelte:head><title>Nowa oferta — Panel</title></svelte:head>

<a href="/panel" class="muted" style="text-decoration:none;">← Wróć do listy</a>
<h1 style="font-size:1.5rem;margin:.5rem 0 1.5rem;">Nowa oferta z PDF</h1>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}

<form method="POST" enctype="multipart/form-data" use:enhance={() => { loading = true; return async ({ update }) => { await update(); loading = false; }; }}>
  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:1rem;">1. Pliki ofert (Leadenhall / CEU)</h3>
    <div class="field">
      <label class="label" for="pdfs">Wgraj PDF-y — aplikacja rozpozna ubezpieczyciela i odczyta parametry</label>
      <input class="input" type="file" id="pdfs" name="pdfs" accept="application/pdf" multiple required onchange={onFiles} />
    </div>
    {#if fileNames.length}
      <ul class="muted" style="margin:.5rem 0 0;padding-left:1.2rem;">
        {#each fileNames as n}<li>{n}</li>{/each}
      </ul>
    {/if}
  </div>

  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:1rem;">2. Klient</h3>

    <div class="field">
      <label class="label" for="clientPick">Wybierz istniejącego klienta (z bazy) lub wpisz nowego</label>
      <select class="input" id="clientPick" onchange={onPickClient}>
        <option value="">— nowy klient (wpisz ręcznie) —</option>
        {#each data.clients as c}
          <option value={c.id}>{c.full_name}{c.email ? ` · ${c.email}` : ''}{c.phone ? ` · ${c.phone}` : ''}</option>
        {/each}
      </select>
      {#if picked}
        <p class="muted" style="margin-top:.4rem;font-size:.8rem;">✓ Dane uzupełnione z bazy. Oferta zostanie powiązana z tym klientem. Możesz je nadpisać poniżej.</p>
      {/if}
    </div>

    <input type="hidden" name="clientId" value={clientId} />

    <div class="field">
      <label class="label" for="offerName">Nazwa oferty (wewnętrzna)</label>
      <input class="input" id="offerName" name="offerName" placeholder="np. Kowalski — utrata dochodu" />
    </div>
    <div class="field">
      <label class="label" for="clientName">Imię i nazwisko klienta</label>
      <input class="input" id="clientName" name="clientName" bind:value={clientName} />
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
      <div class="field">
        <label class="label" for="clientEmail">Email klienta</label>
        <input class="input" type="email" id="clientEmail" name="clientEmail" bind:value={clientEmail} placeholder="do wysłania linku" />
      </div>
      <div class="field">
        <label class="label" for="clientPhone">Telefon klienta</label>
        <input class="input" id="clientPhone" name="clientPhone" bind:value={clientPhone} placeholder="48XXXXXXXXX (PIN SMS)" />
      </div>
    </div>
    <div class="field">
      <label class="label" for="brokerMessage">Wiadomość dla klienta (opcjonalnie)</label>
      <textarea class="input" id="brokerMessage" name="brokerMessage" rows="3"></textarea>
    </div>
  </div>

  <button class="btn btn-primary btn-lg" type="submit" disabled={loading}>
    {loading ? 'Przetwarzam PDF-y…' : 'Utwórz ofertę →'}
  </button>
</form>
