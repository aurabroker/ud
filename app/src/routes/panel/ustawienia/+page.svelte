<script>
  import { enhance } from '$app/forms';
  let { data, form } = $props();
  const s = data.settings;
  let testing = $state(false);
  let testingSms = $state(false);
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
    <div class="hz-grid">
      {#each data.health.checks as c}
        <div class="hz-item">
          <span title={label[c.status]} class="hz-dot" style="background:{dot[c.status]};box-shadow:0 0 0 3px {dot[c.status]}22;"></span>
          <div class="hz-body">
            <div class="hz-label">{c.label}</div>
            <div class="hz-detail" style="color:{c.status === 'error' ? 'var(--red-700)' : c.status === 'warn' ? '#92400e' : 'var(--slate-500)'};">
              {c.detail || (c.status === 'ok' ? '✓' : '')}
            </div>
          </div>
        </div>
      {/each}
    </div>
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
    <p class="muted" style="margin-top:.5rem;font-size:.8rem;">
      Najlepiej kwadratowe logo na przezroczystym/białym tle.
      <strong>Rozmiar pliku ma znaczenie:</strong> logo jest osadzane w każdym PDF-cie, więc plik do ~300 KB
      (ok. 600×600 px) daje dokument ~50 KB. Logo ważące 2 MB powiększy każdy PDF do ok. 2 MB.
    </p>
  </form>
</div>

<!-- Test wysyłki e-mail -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <h3 style="font-size:1rem;margin-bottom:.5rem;">Test wysyłki e-mail</h3>
  <p class="muted" style="margin:0 0 .75rem;font-size:.82rem;">
    Wysyła wiadomość próbną i pokazuje dokładną odpowiedź Resend. Wynik trafia też do zakładki <a href="/panel/logi">Wysyłki</a>.
  </p>
  <form method="POST" action="?/testEmail" use:enhance={() => { testing = true; return async ({ update }) => { await update({ reset: false }); testing = false; }; }}>
    <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
      <div class="field" style="margin:0;flex:1;min-width:240px;">
        <label class="label" for="testTo">Adres e-mail (domyślnie Twój)</label>
        <input class="input" id="testTo" name="testTo" type="email" placeholder="np. biuro@utratadochodu.com" />
      </div>
      <button class="btn btn-primary" type="submit" disabled={testing}>{testing ? 'Wysyłam…' : 'Wyślij próbny e-mail'}</button>
    </div>
  </form>

  {#if form?.testResult}
    {@const r = form.testResult}
    <div class="{r.sent ? 'ok-box' : 'error-box'}" style="margin-top:.75rem;">
      {#if r.sent}
        ✓ Wysłano na <strong>{r.to}</strong>{#if r.id} · ID Resend: <code>{r.id}</code>{/if}
      {:else if r.stub}
        ⚠ <strong>Nic nie wysłano — brak klucza RESEND_API_KEY</strong> w zmiennych środowiskowych Cloudflare.
        Dlatego w panelu Resend nie ma żadnych wpisów.
      {:else}
        ✗ <strong>Resend odrzucił wysyłkę:</strong> {r.error}
      {/if}
      <div class="muted" style="margin-top:.4rem;font-size:.8rem;">
        Klucz: {r.hasKey ? `jest (${r.keyHint})` : 'BRAK'} · Nadawca: <code>{r.from}</code>
        {#if r.fromIsDefault}<br />Używany jest domyślny nadawca <code>onboarding@resend.dev</code> — Resend pozwala nim wysyłać wyłącznie na adres właściciela konta. Aby wysyłać do klientów, ustaw <code>RESEND_FROM</code> na adres w zweryfikowanej domenie.{/if}
      </div>
    </div>
  {/if}
</div>

<!-- Test wysyłki SMS -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <h3 style="font-size:1rem;margin-bottom:.5rem;">Test wysyłki SMS</h3>
  <p class="muted" style="margin:0 0 .75rem;font-size:.82rem;">
    Wysyła wiadomość próbną i pokazuje dokładną odpowiedź SMSPlanet. Wynik trafia też do zakładki <a href="/panel/logi">Wysyłki</a>.
  </p>
  <form method="POST" action="?/testSms" use:enhance={() => { testingSms = true; return async ({ update }) => { await update({ reset: false }); testingSms = false; }; }}>
    <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
      <div class="field" style="margin:0;flex:1;min-width:240px;">
        <label class="label" for="testPhone">Numer telefonu (z numerem kierunkowym)</label>
        <input class="input" id="testPhone" name="testPhone" inputmode="numeric" placeholder="48601234567" />
      </div>
      <button class="btn btn-primary" type="submit" disabled={testingSms}>{testingSms ? 'Wysyłam…' : 'Wyślij próbny SMS'}</button>
    </div>
  </form>

  {#if form?.smsResult}
    {@const r = form.smsResult}
    <div class="{r.sent ? 'ok-box' : 'error-box'}" style="margin-top:.75rem;">
      {#if r.sent}
        ✓ Wysłano na <strong>{r.to}</strong>{#if r.id} · ID wiadomości: <code>{r.id}</code>{/if}
        {#if r.testMode}<br />⚠ Tryb próbny SMSPlanet jest włączony (SMSPLANET_TEST=1) — wiadomość nie dotarła realnie.{/if}
      {:else if r.stub}
        ⚠ <strong>Nic nie wysłano — brak SMSPLANET_TOKEN</strong> w zmiennych środowiskowych Cloudflare.
      {:else}
        ✗ <strong>SMSPlanet odrzucił wysyłkę:</strong> {r.error}
      {/if}
      <div class="muted" style="margin-top:.4rem;font-size:.8rem;">
        Uwierzytelnianie: <code>{r.authMode}</code> {r.hasToken ? `(${r.tokenHint})` : '— BRAK poświadczeń'} · Nadawca: <code>{r.sender}</code>{#if r.testMode} · tryb próbny: WŁĄCZONY{/if}
        <br />Adres wyjściowy tego żądania: {#if r.outIp}{#if r.outIpv6}IPv6 <code>{r.outIpv6}</code>{/if}{#if r.outIpv4}{#if r.outIpv6} · {/if}IPv4 <code>{r.outIpv4}</code>{/if} — te adresy podaj dostawcy przy zgłoszeniu blokady. Uwaga: Cloudflare korzysta z puli, więc kolejne żądania mogą wychodzić z innych adresów.{:else}<span style="color:var(--red-700);">nie udało się ustalić {r.outIpError}</span>{/if}
        {#if r.senderIsDefault}<br />Używany jest domyślny nadawca <code>Info</code> — SMSPlanet odrzuca pola nadawcy niezatwierdzone na koncie. Ustaw <code>SMSPLANET_SENDER</code> na zatwierdzoną nazwę.{/if}
      </div>
    </div>
  {/if}
</div>

<!-- Informacja o dystrybutorze (PDF) -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <h3 style="font-size:1rem;margin-bottom:.75rem;">Informacja o dystrybutorze (PDF)</h3>
  {#if s.distributor_pdf_path}
    <div style="display:flex;align-items:center;gap:1.25rem;margin-bottom:1rem;flex-wrap:wrap;">
      <a class="btn btn-ghost" href="/dystrybutor" target="_blank" rel="noopener">📄 {s.distributor_pdf_name || 'Informacja o dystrybutorze.pdf'}</a>
      <form method="POST" action="?/removeDistributor" use:enhance
        onsubmit={(e) => { if (!confirm('Usunąć plik informacji o dystrybutorze?')) e.preventDefault(); }}>
        <button class="btn btn-ghost" style="color:var(--red-600);">Usuń plik</button>
      </form>
    </div>
  {:else}
    <p class="muted" style="margin-bottom:.75rem;">Brak pliku — klient nie zobaczy pozycji „Informacja o dystrybutorze".</p>
  {/if}
  <form method="POST" action="?/uploadDistributor" enctype="multipart/form-data" use:enhance>
    <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
      <div class="field" style="margin:0;">
        <label class="label" for="distributor">Wgraj plik PDF</label>
        <input class="input" type="file" id="distributor" name="distributor" accept="application/pdf" required />
      </div>
      <button class="btn btn-primary" type="submit">Wgraj PDF</button>
    </div>
    <p class="muted" style="margin-top:.5rem;font-size:.8rem;">Dokument globalny — dołączany do każdego widoku oferty klienta.</p>
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

<style>
  .hz-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .3rem .9rem; margin-top: .75rem; }
  .hz-item { display: flex; gap: .5rem; align-items: flex-start; padding: .35rem 0; border-top: 1px solid var(--slate-100); }
  .hz-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; margin-top: .32rem; }
  .hz-body { min-width: 0; }
  .hz-label { font-weight: 600; font-size: .84rem; line-height: 1.25; }
  .hz-detail { font-size: .78rem; line-height: 1.3; overflow-wrap: anywhere; }
  @media (max-width: 720px) { .hz-grid { grid-template-columns: 1fr; } }
</style>
