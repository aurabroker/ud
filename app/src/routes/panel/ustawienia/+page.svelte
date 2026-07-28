<script>
  import { enhance } from '$app/forms';
  let { data, form } = $props();
  const s = data.settings;
</script>

<svelte:head><title>Ustawienia — Panel</title></svelte:head>

<h1 style="font-size:1.5rem;margin-bottom:.25rem;">Ustawienia panelu</h1>
<p class="muted" style="margin-bottom:1.25rem;">Dane i treści widoczne dla klientów</p>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}
{#if form?.ok}<div class="ok-box">Ustawienia zapisane.</div>{/if}

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
