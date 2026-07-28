<script>
  import { enhance } from '$app/forms';
  import OfferComparison from '$lib/components/OfferComparison.svelte';
  import { dateP } from '$lib/format.js';
  let { data, form } = $props();
  let sending = $state(false);
  let copied = $state(false);

  const statusLabel = { draft: 'Szkic', sent: 'Wysłana', viewed: 'Otwarta', chosen: 'Wybrana', rejected: 'Rezygnacja' };
  const choice = data.offer.client_choice;

  function copyLink() {
    navigator.clipboard.writeText(data.link).then(() => { copied = true; setTimeout(() => (copied = false), 2000); });
  }
</script>

<svelte:head><title>{data.offer.name} — Panel</title></svelte:head>

<a href="/panel" class="muted" style="text-decoration:none;">← Wróć do listy</a>

<div style="display:flex;align-items:center;justify-content:space-between;margin:.5rem 0 1.5rem;flex-wrap:wrap;gap:1rem;">
  <div>
    <h1 style="font-size:1.5rem;">{data.offer.name}</h1>
    <p class="muted">{data.offer.client_name || 'Bez nazwiska'} · <span class="badge badge-{data.offer.status}">{statusLabel[data.offer.status]}</span></p>
  </div>
</div>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}
{#if form?.sent}
  <div class="ok-box">
    Oferta wysłana.
    {#if form.sms?.sent}SMS z kodem dostarczony.{:else if form.sms?.stub}SMS — tryb testowy (brak SMSPlanet).{/if}
    {#if form.email?.sent}Email wysłany.{:else if form.email?.stub}Email — tryb testowy (brak Resend).{/if}
    {#if form.pinDev}<br /><strong>PIN testowy: {form.pinDev}</strong> (widoczny tylko bez realnej wysyłki).{/if}
  </div>
{/if}

<!-- Link + wysyłka -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <h3 style="font-size:1rem;margin-bottom:.75rem;">Link dla klienta</h3>
  <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
    <input class="input" style="flex:1;min-width:240px;" readonly value={data.link} />
    <button class="btn btn-ghost" onclick={copyLink}>{copied ? '✓ Skopiowano' : 'Kopiuj'}</button>
    <form method="POST" action="?/send" use:enhance={() => { sending = true; return async ({ update }) => { await update(); sending = false; }; }}>
      <button class="btn btn-primary" type="submit" disabled={sending}>
        {sending ? 'Wysyłam…' : (data.offer.status === 'draft' ? 'Wyślij klientowi (PIN + email)' : 'Wyślij ponownie')}
      </button>
    </form>
  </div>
  {#if data.offer.access_code}
    <p style="margin-top:.6rem;font-size:.9rem;">
      🔑 Kod dostępu klienta: <strong style="letter-spacing:.1em;font-size:1.05rem;">{data.offer.access_code}</strong>
      <span class="muted"> — odblokowuje link i otwiera pobrane pliki PDF (wysyłany SMS-em).</span>
    </p>
  {/if}
  {#if data.pin}
    <p class="muted" style="margin-top:.3rem;">Kod aktywny do {dateP(data.pin.expires_at)} · próby: {data.pin.attempts}/3{#if data.pin.verified_at} · zweryfikowany ✓{/if}</p>
  {/if}
</div>

<!-- Porównanie wariantów -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <h3 style="font-size:1rem;margin-bottom:1rem;">Warianty ({data.documents.length})</h3>
  {#if data.documents.length}
    <OfferComparison documents={data.documents} />
  {:else}
    <p class="muted">Brak sparsowanych wariantów.</p>
  {/if}
</div>

<!-- Wybór klienta -->
{#if choice}
  <div class="card card-pad" style="margin-bottom:1.25rem;border-left:4px solid var(--green-600);">
    <h3 style="font-size:1rem;margin-bottom:.5rem;">Decyzja klienta</h3>
    {#if choice.rejected}
      <p style="color:var(--red-700);font-weight:600;">Klient zrezygnował{choice.rejected_at ? ` (${dateP(choice.rejected_at)})` : ''}.</p>
    {:else}
      <p style="font-weight:600;">Wybrano: {choice.insurer_name || choice.insurer_type} {choice.chosen_at ? `· ${dateP(choice.chosen_at)}` : ''}</p>
    {/if}
  </div>
{/if}

<!-- Pliki -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <h3 style="font-size:1rem;margin-bottom:.75rem;">Pliki ({data.files.length})</h3>
  <ul class="muted" style="margin:0;padding-left:1.2rem;">
    {#each data.files as f}<li>{f.file_type === 'owu' ? '📖' : '📄'} {f.file_name} <span style="opacity:.6;">({f.file_type})</span></li>{/each}
  </ul>
</div>

<!-- Pytania klienta -->
{#if data.questions.length}
  <div class="card card-pad">
    <h3 style="font-size:1rem;margin-bottom:.75rem;">Pytania klienta ({data.questions.length})</h3>
    {#each data.questions as q}
      <div style="border-bottom:1px solid var(--slate-200);padding:.6rem 0;">
        <p style="margin:0;">{q.question}</p>
        <p class="muted" style="margin:.25rem 0 0;">{dateP(q.asked_at)}{q.client_email ? ` · ${q.client_email}` : ''}{q.notified_agent ? ' · powiadomiono agenta ✓' : ''}</p>
      </div>
    {/each}
  </div>
{/if}
