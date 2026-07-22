<script>
  import { enhance } from '$app/forms';
  let { form } = $props();
  let loading = $state(false);
</script>

<svelte:head><title>Logowanie — UtrataDochodu</title></svelte:head>

<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;">
  <div class="card card-pad" style="width:100%;max-width:380px;">
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="font-size:1.4rem;font-weight:800;">Utrata<span style="color:var(--sky-400);">Dochodu</span></div>
      <p class="muted">Panel Ofertowania — zaloguj się</p>
    </div>

    {#if form?.error}<div class="error-box">{form.error}</div>{/if}

    <form method="POST" use:enhance={() => { loading = true; return async ({ update }) => { await update(); loading = false; }; }}>
      <div class="field">
        <label class="label" for="email">Email</label>
        <input class="input" type="email" id="email" name="email" required value={form?.email || ''} autocomplete="email" />
      </div>
      <div class="field">
        <label class="label" for="password">Hasło</label>
        <input class="input" type="password" id="password" name="password" required autocomplete="current-password" />
      </div>
      <button class="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
        {loading ? 'Logowanie…' : 'Zaloguj się'}
      </button>
    </form>
    <p class="muted" style="text-align:center;margin-top:1.25rem;font-size:.72rem;">Aura Expert sp. z o.o. · Panel wewnętrzny</p>
  </div>
</div>
