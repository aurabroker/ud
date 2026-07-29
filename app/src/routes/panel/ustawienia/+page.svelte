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

<!-- HEALTH -->
{#if data.health}
  {@const dot = { ok: '#16a34a', warn: '#f59e0b', error: '#dc2626' }}
  {@const label = { ok: 'OK', warn: 'Ostrzeżenie', error: 'Błąd' }}
  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
      <h3 style="font-size:1rem;margin:0;border:0;padding:0;">Stan aplikacji (Health)</h3>
      <span style="display:inline-flex;align-items:center;gap:.4rem;font-size:.85rem;font-weight:700;">
        <span style="width:12px;height:12px;border-radius:50%;background:{dot[data.health.summary]};display:inline-block;"></span>
        {label[data.health.summary]} · {data.health.version}
      </span>
    </div>
    <table style="margin-top:.75rem;">
      <tbody>
        {#each data.health.checks as c}
          <tr>
            <td style="width:20px;">
              <span title={label[c.status]} style="width:12px;height:12px;border-radius:50%;background:{dot[c.status]};display:inline-block;box-shadow:0 0 0 3px {dot[c.status]}22;"></span>
            </td>
            <td style="font-weight:600;">{c.label}</td>
            <td style="text-align:right;color:{c.status === 'error' ? 'var(--red-700)' : c.status === 'warn' ? '#92400e' : 'var(--slate-500)'};font-size:.83rem;">
              {c.detail || (c.status === 'ok' ? '✓' : '')}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="muted" style="margin-top:.6rem;font-size:.78rem;">🟢 OK · 🟠 ostrzeżenie/konflikt (funkcja może nie działać) · 🔴 błąd (do naprawy)</p>
  </div>
{/if}

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
    <div class="field">
      <label class="label" for="pdf_footer">Stopka PDF podsumowania</label>
      <textarea class="input" id="pdf_footer" name="pdf_footer" rows="2" placeholder="np. nota prawna, dane firmy, kontakt">{s.pdf_footer || ''}</textarea>
      <p class="muted" style="margin-top:.35rem;font-size:.78rem;">Puste = domyślna nota. Widoczna na dole generowanego PDF-a.</p>
    </div>
    {#if s.sample_pdf_url}
      <a class="btn btn-ghost" href={s.sample_pdf_url} target="_blank" rel="noopener">📄 Podgląd wzorca PDF (aktualne ustawienia)</a>
      <p class="muted" style="margin-top:.35rem;font-size:.78rem;">Wzorzec odświeża się automatycznie po każdym zapisie ustawień / zmianie logo.</p>
    {/if}
  </div>

  <button class="btn btn-primary btn-lg" type="submit">Zapisz ustawienia</button>
</form>
