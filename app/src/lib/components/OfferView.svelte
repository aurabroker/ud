<script>
  import OfferComparison from '$lib/components/OfferComparison.svelte';
  import { money } from '$lib/format.js';

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
  const attachments = $derived(files.filter((f) => f.file_type === 'attachment'));
  const dlHref = (f) => (preview ? '#' : `/offer/${token}/download/${f.id}`);
  const distHref = preview ? '#' : '/dystrybutor';

  const emplLabel = (c) =>
    ({ uop: 'Umowa o pracę', b2b: 'B2B / działalność gospodarcza', uz: 'Umowa zlecenie', uod: 'Umowa o dzieło' }[
      String(c || '').toLowerCase()
    ] || c || '—');

  // Dane Klienta z pierwszego wariantu (ubezpieczony wspólny dla ofert).
  const d0 = $derived(documents[0] || {});
  const clientRows = $derived(
    [
      ['Imię i nazwisko', offer.client_name || d0.insured_name],
      ['Nr oferty', offer.offer_number],
      ['Data urodzenia', d0.insured_birthdate],
      ['Miejscowość', d0.insured_city],
      ['Zawód', d0.profession],
      ['Klasa ryzyka', d0.risk_class],
      ['Forma zatrudnienia', d0.employment_type ? emplLabel(d0.employment_type) : null],
      ['Śr. miesięczny przychód', d0.avg_monthly_income != null ? money(d0.avg_monthly_income) : null],
      ['Okres ubezpieczenia', d0.insurance_period]
    ].filter(([, v]) => v != null && v !== '')
  );

  // --- Akcje klienta ---
  let choice = $state(offer?.client_choice || null);
  let chosenDocId = $derived(choice && !choice.rejected ? choice.document_id : null);

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

  let confirmDoc = $state(null);
  let confirmReject = $state(false);
  let exclAccepted = $state(false);
  let actionLoading = $state(false);
  let actionError = $state('');

  function openChoose(doc) { confirmDoc = doc; confirmReject = false; exclAccepted = false; actionError = ''; }
  function openReject() { confirmReject = true; confirmDoc = null; actionError = ''; }
  function closeConfirm() { confirmDoc = null; confirmReject = false; }

  async function submitChoice() {
    if (preview) { choice = confirmReject ? { rejected: true } : { document_id: confirmDoc.id }; closeConfirm(); return; }
    actionError = ''; actionLoading = true;
    try {
      const payload = confirmReject ? { action: 'reject' } : { action: 'choose', documentId: confirmDoc.id };
      const res = await fetch(`/offer/${token}/choice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (!j.ok) { actionError = j.error || 'Błąd.'; actionLoading = false; return; }
      choice = confirmReject ? { rejected: true } : { document_id: confirmDoc.id };
      closeConfirm();
    } catch { actionError = 'Błąd połączenia.'; }
    actionLoading = false;
  }
</script>

<main class="ov">
  <h1 class="ov-title">Utworzone oferty{#if offer.offer_number} · <span class="ov-num">{offer.offer_number}</span>{/if}</h1>

  <!-- 2 KOLUMNY: dane Klienta | dokumenty PDF — na samej górze -->
  <div class="ov-grid2">
    <section class="ov-card">
      <h2 class="ov-h2">Dane Klienta</h2>
      <dl class="ov-dl">
        {#each clientRows as [k, v]}
          <dt>{k}</dt><dd>{v}</dd>
        {/each}
      </dl>
    </section>

    <section class="ov-card">
      <h2 class="ov-h2">Dokumenty do pobrania</h2>

      <div class="ov-group">
        <span class="ov-gl">Oferty (PDF)</span>
        {#each offerPdfs as f}<a class="ov-doc" href={dlHref(f)} target="_blank" rel="noopener">📄 {f.file_name}</a>{/each}
        {#if offerPdfs.length === 0}<span class="ov-empty">—</span>{/if}
      </div>

      {#if summaryFile}
        <div class="ov-group">
          <span class="ov-gl">Porównanie ofert (PDF)</span>
          <a class="ov-doc" href={dlHref(summaryFile)} target="_blank" rel="noopener">📊 {summaryFile.file_name}</a>
        </div>
      {/if}

      {#if owuFiles.length}
        <div class="ov-group">
          <span class="ov-gl">Warunki ubezpieczenia i dokumenty</span>
          {#each owuFiles as f}<a class="ov-doc" href={dlHref(f)} target="_blank" rel="noopener">📖 {f.file_name}</a>{/each}
        </div>
      {/if}

      {#if attachments.length}
        <div class="ov-group">
          <span class="ov-gl">Dokumenty dodatkowe</span>
          {#each attachments as f}<a class="ov-doc" href={dlHref(f)} target="_blank" rel="noopener">📎 {f.file_name}</a>{/each}
        </div>
      {/if}

      {#if distributorPdf}
        <div class="ov-group">
          <span class="ov-gl">Informacja o dystrybutorze</span>
          <a class="ov-doc" href={distHref} target="_blank" rel="noopener">🏢 {distributorPdf.name}</a>
        </div>
      {/if}
    </section>
  </div>

  <!-- PORÓWNANIE OFERT -->
  <section class="ov-card">
    <h2 class="ov-h2">Porównanie ofert{documents.length > 1 ? ` (${documents.length})` : ''}</h2>
    <OfferComparison {documents} selectable={!choice} onchoose={openChoose} chosenId={chosenDocId} />
  </section>

  {#if offer.broker_message}
    <section class="ov-card ov-msg"><p>{offer.broker_message}</p></section>
  {/if}

  {#if choice}
    <div class="ok-box ov-choice">
      {#if choice.rejected}Dziękujemy — zapisaliśmy Twoją rezygnację.{:else}Dziękujemy! Twój wybór został zapisany. Agent skontaktuje się z Tobą.{/if}
    </div>
  {/if}

  {#if conditionsHtml}
    <section class="ov-card ov-conditions">{@html conditionsHtml}</section>
  {/if}

  {#if !choice}
    <section class="ov-card">
      <h2 class="ov-h2">Twoja decyzja</h2>
      <p class="ov-sub">Wybierz wariant w tabeli („Wybieram ten") lub zrezygnuj.</p>
      <button class="btn btn-ghost btn-sm" onclick={openReject}>Rezygnuję z oferty</button>
    </section>
  {/if}

  <section class="ov-card">
    <h2 class="ov-h2">Masz pytanie?</h2>
    {#if qMsg === 'ok'}<div class="ok-box">Pytanie wysłane. Dziękujemy!</div>
    {:else if qMsg}<div class="error-box">{qMsg}</div>{/if}
    <div class="ov-qrow">
      <input class="input input-sm" placeholder="Twój email (do odpowiedzi)" bind:value={qEmail} type="email" />
      <textarea class="input input-sm" rows="2" placeholder="Treść pytania…" bind:value={question}></textarea>
    </div>
    <button class="btn btn-primary btn-sm" onclick={sendQuestion} disabled={qLoading || question.trim().length < 3}>
      {qLoading ? 'Wysyłam…' : 'Wyślij pytanie'}
    </button>
  </section>
</main>

{#if confirmDoc || confirmReject}
  <div class="ov-modal">
    <div class="ov-card" style="max-width:500px;width:100%;max-height:85vh;overflow:auto;">
      {#if confirmReject}
        <h3 class="ov-h2">Potwierdź rezygnację</h3>
        <p class="ov-sub">Czy na pewno chcesz zrezygnować z przedstawionych ofert?</p>
      {:else}
        <h3 class="ov-h2">Potwierdź wybór</h3>
        <p class="ov-sub">Przed potwierdzeniem zapoznaj się z wyłączeniami („Istotne informacje o warunkach oferty").</p>
        <label class="ov-check"><input type="checkbox" bind:checked={exclAccepted} /><span>Zapoznałem/am się z wyłączeniami i akceptuję warunki.</span></label>
      {/if}
      {#if actionError}<div class="error-box">{actionError}</div>{/if}
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.5rem;">
        <button class="btn btn-ghost btn-sm" onclick={closeConfirm} disabled={actionLoading}>Anuluj</button>
        <button class="btn {confirmReject ? 'btn-danger' : 'btn-success'} btn-sm" onclick={submitChoice}
          disabled={actionLoading || (!confirmReject && !exclAccepted)}>
          {actionLoading ? 'Zapisuję…' : (confirmReject ? 'Potwierdzam rezygnację' : 'Potwierdzam wybór')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ov { max-width: 1000px; margin: 0 auto; padding: 1rem; font-size: 0.8rem; }
  .ov-title { font-size: 1.15rem; font-weight: 800; margin: 0 0 .75rem; }
  .ov-num { color: var(--blue-600); }
  .ov-card { background: #fff; border: 1px solid var(--slate-200); border-radius: 10px; padding: .8rem .9rem; margin-bottom: .75rem; }
  .ov-h2 { font-size: .92rem; font-weight: 700; margin: 0 0 .5rem; }
  .ov-sub { color: var(--slate-500); margin: 0 0 .6rem; font-size: .78rem; }

  .ov-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
  .ov-grid2 .ov-card { margin-bottom: 0; }

  /* Dane Klienta — zwarta lista etykieta/wartość */
  .ov-dl { display: grid; grid-template-columns: auto 1fr; gap: .2rem .6rem; margin: 0; }
  .ov-dl dt { color: var(--slate-500); font-weight: 600; }
  .ov-dl dd { margin: 0; font-weight: 600; color: var(--slate-800); }

  /* Dokumenty */
  .ov-group { margin-bottom: .55rem; }
  .ov-group:last-child { margin-bottom: 0; }
  .ov-gl { display: block; font-size: .7rem; text-transform: uppercase; letter-spacing: .03em; color: var(--slate-400); font-weight: 700; margin-bottom: .2rem; }
  .ov-doc { display: block; padding: .3rem .45rem; border: 1px solid var(--slate-200); border-radius: 6px; margin-bottom: .25rem; color: var(--slate-800); text-decoration: none; font-weight: 600; }
  .ov-doc:hover { background: var(--slate-50); border-color: var(--slate-300); }
  .ov-empty { color: var(--slate-400); font-size: .78rem; }

  .ov-msg p { margin: 0; white-space: pre-wrap; }
  .ov-msg { border-left: 3px solid var(--blue-600); }
  .ov-choice { font-size: .85rem; }

  .ov-qrow { display: flex; flex-direction: column; gap: .4rem; margin-bottom: .5rem; }
  .input-sm { font-size: .8rem; padding: .4rem .5rem; }
  .btn-sm { padding: .35rem .7rem; font-size: .8rem; }
  .ov-check { display: flex; gap: .5rem; align-items: flex-start; font-size: .8rem; margin: .3rem 0 .5rem; cursor: pointer; }
  .ov-modal { position: fixed; inset: 0; background: rgba(15,23,42,.6); display: flex; align-items: center; justify-content: center; padding: 1.25rem; z-index: 50; }

  /* Istotne informacje o warunkach oferty — kompaktowo */
  .ov-conditions { font-size: .78rem; }
  .ov-conditions :global(.oc h2) { font-size: .95rem; border-bottom: 1px solid var(--slate-300); padding-bottom: 3px; margin: 0 0 .5rem; }
  .ov-conditions :global(.oc h3) { font-size: .82rem; margin: .7rem 0 .3rem; }
  .ov-conditions :global(.oc ul) { margin: .25rem 0 .5rem; padding-left: 1rem; }
  .ov-conditions :global(.oc li) { margin-bottom: .15rem; line-height: 1.35; }
  .ov-conditions :global(.oc-2col) { width: 100%; border-collapse: collapse; }
  .ov-conditions :global(.oc-2col td) { vertical-align: top; width: 50%; border: 1px solid var(--slate-200); padding: 7px 9px; }
  .ov-conditions :global(.oc-company) { margin-top: .7rem; font-size: .72rem; color: var(--slate-500); border-top: 1px solid var(--slate-200); padding-top: .5rem; }

  @media (max-width: 720px) {
    .ov-grid2 { grid-template-columns: 1fr; }
    .ov-conditions :global(.oc-2col), .ov-conditions :global(.oc-2col tbody), .ov-conditions :global(.oc-2col tr), .ov-conditions :global(.oc-2col td) { display: block; width: 100%; }
  }
</style>
