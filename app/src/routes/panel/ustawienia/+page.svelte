<script>
  import { enhance } from '$app/forms';
  let { data, form } = $props();
  const s = data.settings;
</script>

<svelte:head><title>Ustawienia — Panel</title></svelte:head>

<h1 style="font-size:1.5rem;margin-bottom:.25rem;">Ustawienia panelu</h1>
<p class="muted" style="margin-bottom:1.25rem;">Dane i treści widoczne dla klientów</p>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}
{#if form?.ok}<div class="ok-box">Zapisano.</div>{/if}

<!-- Logo -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <h3 style="font-size:1rem;margin-bottom:.75rem;">Logo (używane w PDF podsumowania i panelu)</h3>
  {#if s.logo_url}
    <div style="display:flex;align-items:center;gap:1.25rem;margin-bottom:1rem;flex-wrap:wrap;">
      <img src={s.logo_url} alt="Logo" style="height:64px;width:auto;border:1px solid var(--slate-200);border-radius:8px;padding:6px;background:#fff;" />
      <form method="POST" action="?/removeLogo" use:enhance
        onsubmit={(e) => { if (!confirm('Usunąć logo?')) e.preventDefault(); }}>
        <button class="btn btn-ghost" style="color:var(--red-600);">Usuń logo</button>
      </form>
    </div>
  {:else}
    <p class="muted" style="margin-bottom:.75rem;">Brak logo — w dokumencie użyty jest napis „UtrataDochodu".</p>
  {/if}
  <form method="POST" action="?/uploadLogo" enctype="multipart/form-data" use:enhance>
    <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
      <div class="field" style="margin:0;">
        <label class="label" for="logo">Wgraj logo (PNG/JPG/SVG/WEBP)</label>
        <input class="input" type="file" id="logo" name="logo" accept="image/*" required />
      </div>
      <button class="btn btn-primary" type="submit">Wgraj logo</button>
    </div>
    <p class="muted" style="margin-top:.5rem;font-size:.8rem;">Najlepiej kwadratowe logo na przezroczystym/białym tle.</p>
  </form>
</div>

<form method="POST" action="?/save" use:enhance>
  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:1rem;">Dane firmy</h3>
    <div class="field">
      <label class="label" for="company_name">Nazwa firmy</label>
      <input class="input" id="company_name" name="company_name" value={s.company_name || ''} />
    </div>
    <div class="field">
      <label class="label" for="company_full">Pełna nazwa i adres</label>
      <textarea class="input" id="company_full" name="company_full" rows="2">{s.company_full || ''}</textarea>
    </div>
  </div>

  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:1rem;">Treści dla klienta</h3>
    <div class="field">
      <label class="label" for="default_broker_message">Domyślna wiadomość do klienta (wstawiana w nowej ofercie)</label>
      <textarea class="input" id="default_broker_message" name="default_broker_message" rows="3">{s.default_broker_message || ''}</textarea>
    </div>
    <div class="field">
      <label class="label" for="exclusions_text">Tekst wyłączeń odpowiedzialności (widok klienta, przy wyborze)</label>
      <textarea class="input" id="exclusions_text" name="exclusions_text" rows="6">{s.exclusions_text || ''}</textarea>
    </div>
  </div>

  <button class="btn btn-primary btn-lg" type="submit">Zapisz ustawienia</button>
</form>
