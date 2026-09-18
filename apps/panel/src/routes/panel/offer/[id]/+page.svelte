<script>
  import { enhance } from '$app/forms';
  import OfferComparison from '$lib/components/OfferComparison.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { dateP } from '$lib/format.js';
  let { data, form } = $props();
  let sending = $state(false);
  let copied = $state(false);
  let editing = $state(false);
  let adding = $state(false);
  let refreshing = $state(false);
  let addingFile = $state(false);

  // Usuwanie wariantu — własne okno potwierdzenia (bez confirm() przeglądarki)
  let delDoc = $state(null);
  let delForm = $state(null);
  let delBusy = $state(false);
  const docLabel = (d) => d?.source_filename || d?.offer_number || d?.insurer_type || 'wariant';

  const statusLabel = { draft: 'Szkic', sent: 'Wysłana', viewed: 'Otwarta', chosen: 'Wybrana', rejected: 'Rezygnacja' };
  const choice = data.offer.client_choice;

  // pola edycji
  let eClientId = $state(data.offer.client_id || '');
  let eName = $state(data.offer.name || '');
  let eOfferNumber = $state(data.offer.offer_number || '');
  let eClientName = $state(data.offer.client_name || '');
  let eClientEmail = $state(data.offer.client_email || '');
  let eClientPhone = $state(data.offer.client_phone || '');
  let eMessage = $state(data.offer.broker_message || '');
  let eTerms = $state(data.offer.additional_terms || '');
  let eCode = $state(data.offer.access_code || '');

  function onPickClient() {
    const c = data.clients.find((x) => x.id === eClientId);
    if (c) { eClientName = c.full_name || ''; eClientEmail = c.email || ''; eClientPhone = c.phone || ''; }
  }
  function copyLink() {
    navigator.clipboard.writeText(data.link).then(() => { copied = true; setTimeout(() => (copied = false), 2000); });
  }
</script>

<svelte:head><title>{data.offer.name} — Panel</title></svelte:head>

<a href="/panel" class="muted" style="text-decoration:none;">← Wróć do listy</a>

<div style="display:flex;align-items:center;justify-content:space-between;margin:.5rem 0 1.5rem;flex-wrap:wrap;gap:1rem;">
  <div>
    <h1 style="font-size:1.5rem;">{data.offer.name}</h1>
    <p class="muted">
      {#if data.offer.offer_number}<strong>{data.offer.offer_number}</strong> · {/if}{data.offer.client_name || 'Bez nazwiska'} · <span class="badge badge-{data.offer.status}">{statusLabel[data.offer.status]}</span>
    </p>
  </div>
  <div style="display:flex;gap:.5rem;">
    <button class="btn btn-ghost" onclick={() => (editing = !editing)}>{editing ? 'Zamknij edycję' : '✎ Edytuj'}</button>
    <form method="POST" action="?/delete" use:enhance={() => ({ update }) => update()}
      onsubmit={(e) => { if (!confirm('Usunąć całą ofertę? Tej operacji nie można cofnąć.')) e.preventDefault(); }}>
      <button class="btn btn-ghost" style="color:var(--red-600);">🗑 Usuń ofertę</button>
    </form>
  </div>
</div>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}
{#if form?.saved && !form?.refreshed && !form?.filesAdded}<div class="ok-box">Zapisano.</div>{/if}
{#if form?.filesAdded}<div class="ok-box">Dodano plików do oferty: {form.filesAdded}.</div>{/if}
{#if form?.refreshed}
  <div class="{form.refreshed.errors?.length ? 'error-box' : 'ok-box'}">
    Odświeżono: przeczytano ponownie {form.refreshed.reparsed}/{form.refreshed.docs} plików PDF,
    podpięto OWU: {form.refreshed.addedOwu}.
    {#if form.refreshed.errors?.length}
      <br /><strong>Problemy:</strong>
      <ul style="margin:.3rem 0 0;padding-left:1.1rem;">
        {#each form.refreshed.errors as e}<li>{e}</li>{/each}
      </ul>
    {/if}
  </div>
{/if}

<!-- Edycja oferty -->
{#if editing}
  <div class="card card-pad" style="margin-bottom:1.25rem;border-left:4px solid var(--blue-600);">
    <h3 style="font-size:1rem;margin-bottom:1.25rem;">Edycja oferty</h3>
    <form method="POST" action="?/save" use:enhance={() => async ({ update }) => { await update({ reset: false }); editing = false; }}>

      <div class="field">
        <label class="label" for="e_client">Klient z bazy</label>
        <select class="input" id="e_client" name="clientId" bind:value={eClientId} onchange={onPickClient}>
          <option value="">— brak powiązania / dane ręczne —</option>
          {#each data.clients as c}<option value={c.id}>{c.full_name}{c.email ? ` · ${c.email}` : ''}</option>{/each}
        </select>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0 1.25rem;">
        <div class="field">
          <label class="label" for="e_name">Nazwa oferty (wewnętrzna)</label>
          <input class="input" id="e_name" name="name" bind:value={eName} />
        </div>
        <div class="field">
          <label class="label" for="e_num">Oferta nr (system; można dodać nazwisko)</label>
          <input class="input" id="e_num" name="offerNumber" bind:value={eOfferNumber} />
        </div>
        <div class="field">
          <label class="label" for="e_cn">Imię i nazwisko klienta</label>
          <input class="input" id="e_cn" name="clientName" bind:value={eClientName} />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 1.25rem;">
        <div class="field">
          <label class="label" for="e_ce">Email klienta</label>
          <input class="input" id="e_ce" name="clientEmail" bind:value={eClientEmail} />
        </div>
        <div class="field">
          <label class="label" for="e_cp">Telefon klienta</label>
          <input class="input" id="e_cp" name="clientPhone" bind:value={eClientPhone} />
        </div>
        <div class="field">
          <label class="label" for="e_code">Kod dostępu (4 ostatnie cyfry PESEL)</label>
          <input class="input" id="e_code" name="accessCode" bind:value={eCode} />
        </div>
      </div>

      <div class="field">
        <label class="label" for="e_msg">Wiadomość dla klienta</label>
        <textarea class="input" id="e_msg" name="brokerMessage" rows="3" bind:value={eMessage}></textarea>
      </div>

      <div class="field">
        <label class="label" for="e_terms">Postanowienia dodatkowe (warunki, zastrzeżenia)</label>
        <textarea class="input" id="e_terms" name="additionalTerms" rows="4" bind:value={eTerms}></textarea>
        <p class="muted" style="font-size:.8rem;margin:.3rem 0 0;">
          Trafiają do PDF-a rekomendacji jako osobna sekcja — niezależnie od wiadomości dla klienta.
          Każdy wiersz zaczynający się od myślnika staje się punktem listy.
        </p>
      </div>

      <div style="display:flex;gap:.5rem;">
        <button class="btn btn-primary" type="submit">Zapisz zmiany</button>
        <button class="btn btn-ghost" type="button" onclick={() => (editing = false)}>Anuluj</button>
      </div>
    </form>
  </div>
{/if}
{#if form?.sent}
  <div class="{form.email?.sent ? 'ok-box' : 'error-box'}">
    {form.email?.sent ? `Oferta wysłana — wersja ${form.wersja || 1}.` : 'Nie udało się wysłać — oferta NIE została oznaczona jako wysłana.'}
    <ul style="margin:.35rem 0 0;padding-left:1.1rem;">
      <li>
        Email:
        {#if form.email?.sent}wysłany ✓{#if form.email.id} <span class="muted">(ID: {form.email.id})</span>{/if}
        {:else if form.email?.stub}tryb testowy (brak konfiguracji Resend)
        {:else if form.email?.error}<span style="color:var(--red-700);">błąd — {form.email.error}</span>
        {:else}brak adresu email klienta{/if}
      </li>
    </ul>
    {#if form.pinDev}<strong>PIN testowy: {form.pinDev}</strong> (widoczny tylko bez realnej wysyłki).<br />{/if}
    <a href="/panel/logi">Historia wysyłek →</a>
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
        {sending ? 'Wysyłam…' : (data.offer.status === 'draft' ? 'Wyślij klientowi e-mailem' : 'Wyślij ponownie')}
      </button>
    </form>
    <a class="btn btn-ghost" href="/panel/offer/{data.offer.id}/summary" target="_blank" rel="noopener">⬇ Pobierz PDF</a>
  </div>
  {#if data.offer.access_code}
    <p style="margin-top:.6rem;font-size:.9rem;">
      🔑 Kod dostępu klienta: <strong style="letter-spacing:.1em;font-size:1.05rem;">{data.offer.access_code}</strong>
      <span class="muted"> — cztery ostatnie cyfry PESEL-u klienta. Odblokowuje link i otwiera pobrane pliki PDF; nie wysyłamy go, klient zna go z dowodu.</span>
    </p>
  {/if}
  {#if data.pin}
    <p class="muted" style="margin-top:.3rem;">Kod aktywny do {dateP(data.pin.expires_at)} · próby: {data.pin.attempts}/3{#if data.pin.verified_at} · zweryfikowany ✓{/if}</p>
  {/if}
</div>

<!-- Decyzja klienta, archiwum i historia wysyłek -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
    <h3 style="font-size:1rem;margin:0;">
      Wersja {data.offer.wersja || 1}
      {#if data.offer.archived_at}<span class="muted" style="font-weight:400;"> · w archiwum</span>{/if}
    </h3>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
      <form method="POST" action="?/kupiona" use:enhance={() => ({ update }) => update()}>
        <input type="hidden" name="kupiona" value={data.offer.status === 'bought' ? 'nie' : 'tak'} />
        <button class="btn {data.offer.status === 'bought' ? 'btn-ghost' : 'btn-primary'}" type="submit">
          {data.offer.status === 'bought' ? 'Cofnij: jednak nie kupił' : '✓ Klient kupił polisę'}
        </button>
      </form>
      <form method="POST" action="?/archiwum" use:enhance={() => ({ update }) => update()}>
        <input type="hidden" name="archiwum" value={data.offer.archived_at ? 'nie' : 'tak'} />
        <button class="btn btn-ghost" type="submit">
          {data.offer.archived_at ? '↩ Przywróć z archiwum' : '📥 Archiwizuj'}
        </button>
      </form>
    </div>
  </div>

  {#if data.offer.status === 'bought'}
    <p class="muted" style="margin:.6rem 0 0;">
      Polisa sprzedana{#if data.offer.decided_at} — odnotowano {dateP(data.offer.decided_at)}{/if}.
    </p>
  {/if}

  <!-- Historia wysyłek. Dokładanie dokumentów nie podbija wersji; podbija ją
       dopiero wysyłka, bo liczy się to, co klient faktycznie zobaczył. -->
  <h4 style="font-size:.9rem;margin:1.25rem 0 .5rem;">Co i kiedy poszło do klienta</h4>
  {#if data.wysylki.length === 0}
    <p class="muted" style="margin:0;">Jeszcze nic nie wysłano.</p>
  {:else}
    <table>
      <thead><tr><th>Wersja</th><th>Kanał</th><th>Odbiorca</th><th>Kiedy</th><th>Wynik</th></tr></thead>
      <tbody>
        {#each data.wysylki as w}
          <tr>
            <td style="font-weight:600;">v{w.wersja || 1}</td>
            <td>{w.channel === 'email' ? '✉ Email' : w.channel}</td>
            <td class="muted">{w.recipient || '—'}</td>
            <td class="muted">{dateP(w.created_at)}</td>
            <td>
              {#if w.status === 'sent'}wysłana ✓
              {:else if w.status === 'stub'}tryb testowy
              {:else}<span style="color:var(--red-700);">błąd{#if w.error} — {w.error}{/if}</span>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<!-- Porównanie wariantów -->
<div class="card card-pad" style="margin-bottom:1.25rem;">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
    <h3 style="font-size:1rem;margin:0;">Warianty do porównania ({data.documents.length})</h3>
    <form method="POST" action="?/refreshOwu" use:enhance={() => { refreshing = true; return async ({ update }) => { await update(); refreshing = false; }; }}>
      <button class="btn btn-ghost" type="submit" disabled={refreshing} title="Ponownie czyta PDF-y i podpina właściwe OWU / Kartę produktową">
        {refreshing ? 'Odświeżam…' : '↻ Odśwież OWU/dane'}
      </button>
    </form>
  </div>
  {#if data.documents.length}
    <OfferComparison documents={data.documents} />
    {#if editing}
      <div style="margin-top:1rem;display:flex;flex-direction:column;gap:.4rem;">
        {#each data.documents as d}
          <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;font-size:.85rem;border-top:1px solid var(--slate-100);padding-top:.4rem;">
            <span>{docLabel(d)}</span>
            <button type="button" class="btn btn-ghost" style="padding:.25rem .6rem;font-size:.78rem;color:var(--red-600);"
              onclick={() => (delDoc = d)}>Usuń wariant</button>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="muted">Brak sparsowanych wariantów.</p>
  {/if}

  <!-- Dodawanie wariantów -->
  <div style="margin-top:1.25rem;border-top:1px dashed var(--slate-200);padding-top:1rem;">
    <h4 style="font-size:.92rem;margin-bottom:.6rem;">➕ Dodaj wariant(y) — wgraj kolejne PDF-y</h4>
    <form method="POST" action="?/addDocs" enctype="multipart/form-data"
      use:enhance={() => { adding = true; return async ({ update }) => { await update({ reset: true }); adding = false; }; }}>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end;">
        <div class="field" style="margin:0;flex:1;min-width:240px;">
          <label class="label" for="addPdfs">Pliki ofert (Leadenhall / CEU) — można kilka naraz</label>
          <input class="input" type="file" id="addPdfs" name="pdfs" accept="application/pdf" multiple required />
        </div>
        <div class="field" style="margin:0;max-width:170px;">
          <label class="label" for="addPass">Hasło PDF (jeśli jest)</label>
          <input class="input" id="addPass" name="pdfPassword" inputmode="numeric" maxlength="12" autocomplete="off" />
        </div>
        <button class="btn btn-primary" type="submit" disabled={adding}>{adding ? 'Wczytuję…' : 'Dodaj do porównania'}</button>
      </div>
    </form>
  </div>
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
    {#each data.files as f}
      <li>
        {f.file_type === 'owu' ? '📖' : f.file_type === 'attachment' ? '📎' : '📄'} {f.file_name}
        <span style="opacity:.6;">({f.file_type})</span>
      </li>
    {/each}
  </ul>

  <!-- Dodatkowy plik do oferty (bez parsowania) -->
  <div style="margin-top:1rem;border-top:1px dashed var(--slate-200);padding-top:1rem;">
    <h4 style="font-size:.92rem;margin-bottom:.6rem;">📎 Dodaj plik do oferty</h4>
    <p class="muted" style="margin:0 0 .6rem;font-size:.8rem;">
      Dowolny PDF (np. dodatkowe warunki, pismo, wyliczenie). Nie jest parsowany jako wariant — trafia do dokumentów klienta.
    </p>
    <form method="POST" action="?/addFiles" enctype="multipart/form-data"
      use:enhance={() => { addingFile = true; return async ({ update }) => { await update({ reset: true }); addingFile = false; }; }}>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end;">
        <div class="field" style="margin:0;flex:1;min-width:240px;">
          <label class="label" for="extraFiles">Plik(i) PDF — można kilka naraz</label>
          <input class="input" type="file" id="extraFiles" name="files" accept="application/pdf" multiple required />
        </div>
        <button class="btn btn-primary" type="submit" disabled={addingFile}>{addingFile ? 'Wgrywam…' : 'Dodaj plik'}</button>
      </div>
    </form>
  </div>
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

<!-- Usuwanie wariantu: ukryty formularz + własne okno potwierdzenia -->
<form method="POST" action="?/deleteDoc" bind:this={delForm} style="display:none;"
  use:enhance={() => { delBusy = true; return async ({ update }) => { await update(); delBusy = false; delDoc = null; }; }}>
  <input type="hidden" name="documentId" value={delDoc?.id ?? ''} />
</form>

<ConfirmDialog
  open={!!delDoc}
  danger
  title="Usunąć ten wariant?"
  message="Wariant zostanie usunięty z porównania wraz z jego plikiem oferty. Tej operacji nie można cofnąć."
  detail={delDoc ? docLabel(delDoc) : ''}
  confirmLabel="Usuń wariant"
  busyLabel="Usuwam…"
  busy={delBusy}
  onconfirm={() => delForm?.requestSubmit()}
  oncancel={() => (delDoc = null)}
/>
