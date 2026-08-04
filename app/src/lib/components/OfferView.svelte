<script>
  import OfferComparison from '$lib/components/OfferComparison.svelte';

  let {
    token = '',
    offer,
    documents = [],
    files = [],
    conditionsHtml = '',
    distributorPdf = null,
    preview = false
  } = $props();

  const owuFiles = $derived(files.filter((f) => f.file_type === 'owu'));
  const offerPdfs = $derived(files.filter((f) => f.file_type === 'offer_pdf'));
  const summaryFile = $derived(files.find((f) => f.file_type === 'summary') || null);
  const dlHref = (f) => (preview ? '#' : `/offer/${token}/download/${f.id}`);
  const distHref = preview ? '#' : '/dystrybutor';

  // --- Akcje klienta ---
  let choice = $state(offer?.client_choice || null);
  let chosenDocId = $derived(choice && !choice.rejected ? choice.document_id : null);

  // pytanie
  let question = $state('');
  let qEmail = $state('');
  let qMsg = $state('');
  let qLoading = $state(false);
  async function sendQuestion() {
    if (preview) { qMsg = 'ok'; question = ''; return; }
    qMsg = ''; qLoading = true;
    try {
      const res = await fetch(`/offer/${token}/question`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, email: qEmail })
      });
      const j = await res.json();
      qMsg = j.ok ? 'ok' : (j.error || 'Błąd.');
      if (j.ok) question = '';
    } catch { qMsg = 'Błąd połączenia.'; }
    qLoading = false;
  }

  // wybór / rezygnacja
  let confirmDoc = $state(null);
  let confirmReject = $state(false);
  let exclAccepted = $state(false);
  let actionLoading = $state(false);
  let actionError = $state('');

  function openChoose(doc) { confirmDoc = doc; confirmReject = false; exclAccepted = false; actionError = ''; }
  function openReject() { confirmReject = true; confirmDoc = null; actionError = ''; }
  function closeConfirm() { confirmDoc = null; confirmReject = false; }

  async function submitChoice() {
    if (preview) {
      choice = confirmReject ? { rejected: true } : { document_id: confirmDoc.id };
      closeConfirm();
      return;
    }
    actionError = ''; actionLoading = true;
    try {
      const payload = confirmReject ? { action: 'reject' } : { action: 'choose', documentId: confirmDoc.id };
      const res = await fetch(`/offer/${token}/choice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (!j.ok) { actionError = j.error || 'Błąd.'; actionLoading = false; return; }
      choice = confirmReject ? { rejected: true } : { document_id: confirmDoc.id };
      closeConfirm();
    } catch { actionError = 'Błąd połączenia.'; }
    actionLoading = false;
  }
</script>

<main class="container" style="max-width:960px;">
  <!-- Nagłówek -->
  <div class="ov-top">
    <h1>Utworzone oferty</h1>
    <p class="muted">
      {#if offer.offer_number}<strong>{offer.offer_number}</strong> · {/if}
      Rekomendacja ofertowa{#if offer.client_name} dla: {offer.client_name}{/if}
    </p>
  </div>

  <!-- DOKUMENTY DO POBRANIA (pliki PDF na górze) -->
  <div class="card card-pad" style="margin-bottom:1rem;">
    <h2 class="ov-h2">Dokumenty do pobrania</h2>

    <!-- Pliki oferty (PDF) — na samej górze -->
    <h3 class="ov-h3">Oferty (pliki PDF)</h3>
    <p class="muted ov-note">🔒 Pliki mogą być zabezpieczone — otwórz je <strong>tym samym 4-cyfrowym hasłem</strong> z SMS-a.</p>
    <div class="ov-docs">
      {#each offerPdfs as f}
        <a class="btn btn-ghost ov-doc" href={dlHref(f)} target="_blank" rel="noopener">📄 {f.file_name}</a>
      {/each}
      {#if offerPdfs.length === 0}<p class="muted">Brak plików ofert.</p>{/if}
    </div>

    <!-- Porównanie ofert (PDF) -->
    {#if summaryFile}
      <h3 class="ov-h3">Porównanie ofert (PDF)</h3>
      <div class="ov-docs">
        <a class="btn btn-ghost ov-doc" href={dlHref(summaryFile)} target="_blank" rel="noopener">📊 {summaryFile.file_name || 'Porównanie ofert (rekomendacja).pdf'}</a>
      </div>
    {/if}

    <!-- Warunki ubezpieczenia i dokumenty -->
    <h3 class="ov-h3">Warunki ubezpieczenia i dokumenty</h3>
    <div class="ov-docs">
      {#each owuFiles as f}
        <a class="btn btn-ghost ov-doc" href={dlHref(f)} target="_blank" rel="noopener">📖 {f.file_name}</a>
      {/each}
      {#if owuFiles.length === 0}<p class="muted">Dokumenty (OWU, Karta produktowa) zostaną dołączone do oferty.</p>{/if}
    </div>

    <!-- Informacja o dystrybutorze (PDF) -->
    {#if distributorPdf}
      <h3 class="ov-h3">Informacja o dystrybutorze</h3>
      <div class="ov-docs">
        <a class="btn btn-ghost ov-doc" href={distHref} target="_blank" rel="noopener">🏢 {distributorPdf.name || 'Informacja o dystrybutorze.pdf'}</a>
      </div>
    {/if}
  </div>

  {#if offer.broker_message}
    <div class="card card-pad" style="margin-bottom:1rem;border-left:4px solid var(--blue-600);">
      <p style="margin:0;white-space:pre-wrap;">{offer.broker_message}</p>
    </div>
  {/if}

  {#if choice}
    <div class="ok-box" style="font-size:.95rem;">
      {#if choice.rejected}Dziękujemy za informację — zapisaliśmy Twoją rezygnację.{:else}Dziękujemy! Twój wybór został zapisany. Agent skontaktuje się z Tobą.{/if}
    </div>
  {/if}

  <!-- Porównanie (interaktywne) -->
  <div class="card card-pad" style="margin-bottom:1rem;">
    <h2 class="ov-h2">Porównanie ofert{documents.length > 1 ? ` (${documents.length})` : ''}</h2>
    <p class="muted" style="margin:0 0 1rem;font-size:.85rem;">Zestawienie przygotowanych dla Ciebie wariantów. Wybierz najlepszy lub zapytaj o szczegóły.</p>
    <OfferComparison {documents} selectable={!choice} onchoose={openChoose} chosenId={chosenDocId} />
  </div>

  <!-- Istotne informacje o warunkach oferty -->
  {#if conditionsHtml}
    <div class="card card-pad ov-conditions" style="margin-bottom:1rem;">
      {@html conditionsHtml}
    </div>
  {/if}

  <!-- Decyzja -->
  {#if !choice}
    <div class="card card-pad" style="margin-bottom:1rem;">
      <h2 class="ov-h2">Twoja decyzja</h2>
      <p class="muted" style="margin-bottom:1rem;">Wybierz wariant powyżej („Wybieram ten") lub zrezygnuj.</p>
      <button class="btn btn-ghost" onclick={openReject}>Rezygnuję z oferty</button>
    </div>
  {/if}

  <!-- Pytanie -->
  <div class="card card-pad">
    <h2 class="ov-h2">Masz pytanie?</h2>
    <p class="muted" style="margin-bottom:.75rem;">Napisz — agent odpowie mailowo.</p>
    {#if qMsg === 'ok'}<div class="ok-box">Pytanie wysłane. Dziękujemy!</div>
    {:else if qMsg}<div class="error-box">{qMsg}</div>{/if}
    <div class="field"><input class="input" placeholder="Twój email (do odpowiedzi)" bind:value={qEmail} type="email" /></div>
    <div class="field"><textarea class="input" rows="3" placeholder="Treść pytania…" bind:value={question}></textarea></div>
    <button class="btn btn-primary" onclick={sendQuestion} disabled={qLoading || question.trim().length < 3}>
      {qLoading ? 'Wysyłam…' : 'Wyślij pytanie'}
    </button>
  </div>
</main>

<!-- MODAL potwierdzenia -->
{#if confirmDoc || confirmReject}
  <div class="ov-modal">
    <div class="card card-pad" style="max-width:520px;width:100%;max-height:85vh;overflow:auto;">
      {#if confirmReject}
        <h3 style="font-size:1.15rem;margin-bottom:.75rem;">Potwierdź rezygnację</h3>
        <p class="muted" style="margin-bottom:1.25rem;">Czy na pewno chcesz zrezygnować z przedstawionych ofert?</p>
      {:else}
        <h3 style="font-size:1.15rem;margin-bottom:.75rem;">Potwierdź wybór</h3>
        <p style="margin-bottom:1rem;">Wybierasz wariant. Przed potwierdzeniem zapoznaj się z wyłączeniami odpowiedzialności (patrz „Istotne informacje o warunkach oferty").</p>
        <label style="display:flex;gap:.5rem;align-items:flex-start;font-size:.88rem;margin-bottom:1rem;cursor:pointer;">
          <input type="checkbox" bind:checked={exclAccepted} />
          <span>Zapoznałem/am się z wyłączeniami i akceptuję warunki.</span>
        </label>
      {/if}
      {#if actionError}<div class="error-box">{actionError}</div>{/if}
      <div style="display:flex;gap:.5rem;justify-content:flex-end;">
        <button class="btn btn-ghost" onclick={closeConfirm} disabled={actionLoading}>Anuluj</button>
        <button class="btn {confirmReject ? 'btn-danger' : 'btn-success'}" onclick={submitChoice}
          disabled={actionLoading || (!confirmReject && !exclAccepted)}>
          {actionLoading ? 'Zapisuję…' : (confirmReject ? 'Potwierdzam rezygnację' : 'Potwierdzam wybór')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ov-top { margin: .5rem 0 1.25rem; }
  .ov-top h1 { font-size: 1.7rem; margin: 0 0 .25rem; }
  .ov-h2 { font-size: 1.15rem; margin: 0 0 .5rem; }
  .ov-h3 { font-size: .98rem; margin: 1.1rem 0 .4rem; color: var(--slate-700); }
  .ov-note { margin: 0 0 .6rem; font-size: .82rem; }
  .ov-docs { display: flex; flex-direction: column; gap: .5rem; }
  .ov-doc { justify-content: flex-start; }
  .ov-modal { position: fixed; inset: 0; background: rgba(15,23,42,.6); display: flex; align-items: center; justify-content: center; padding: 1.5rem; z-index: 50; }
  /* Istotne informacje o warunkach oferty (ten sam blok co w PDF) */
  .ov-conditions :global(.oc h2) { font-size: 1.2rem; border-bottom: 2px solid var(--slate-800); padding-bottom: 4px; margin: 0 0 .75rem; }
  .ov-conditions :global(.oc h3) { font-size: 1rem; margin: 1rem 0 .4rem; }
  .ov-conditions :global(.oc ul) { margin: .35rem 0 .75rem; padding-left: 1.1rem; }
  .ov-conditions :global(.oc li) { margin-bottom: .25rem; font-size: .9rem; line-height: 1.45; }
  .ov-conditions :global(.oc-2col) { width: 100%; border-collapse: collapse; }
  .ov-conditions :global(.oc-2col td) { vertical-align: top; width: 50%; border: 1px solid var(--slate-200); padding: 10px 12px; }
  .ov-conditions :global(.oc-company) { margin-top: 1rem; font-size: .78rem; color: var(--slate-500); border-top: 1px solid var(--slate-200); padding-top: .6rem; }
  @media (max-width: 640px) {
    .ov-conditions :global(.oc-2col), .ov-conditions :global(.oc-2col tbody), .ov-conditions :global(.oc-2col tr), .ov-conditions :global(.oc-2col td) { display: block; width: 100%; }
  }
</style>
