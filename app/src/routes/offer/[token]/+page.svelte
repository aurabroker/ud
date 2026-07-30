<script>
  import OfferComparison from '$lib/components/OfferComparison.svelte';
  let { data } = $props();

  // --- PIN ---
  let pin = $state('');
  let pinError = $state('');
  let pinLoading = $state(false);

  async function submitPin(e) {
    e.preventDefault();
    pinError = '';
    pinLoading = true;
    try {
      const res = await fetch(`/offer/${data.token}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const j = await res.json();
      if (j.ok) { location.reload(); return; }
      pinError = j.error || 'Błędne hasło.';
    } catch { pinError = 'Błąd połączenia.'; }
    pinLoading = false;
  }

  // --- Akcje klienta (tylko po weryfikacji) ---
  let choice = $state(data.offer?.client_choice || null);
  let chosenDocId = $derived(choice && !choice.rejected ? choice.document_id : null);

  // pytanie
  let question = $state('');
  let qEmail = $state('');
  let qMsg = $state('');
  let qLoading = $state(false);
  async function sendQuestion() {
    qMsg = ''; qLoading = true;
    try {
      const res = await fetch(`/offer/${data.token}/question`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, email: qEmail })
      });
      const j = await res.json();
      qMsg = j.ok ? 'ok' : (j.error || 'Błąd.');
      if (j.ok) question = '';
    } catch { qMsg = 'Błąd połączenia.'; }
    qLoading = false;
  }

  // wybór / rezygnacja z akceptacją wyłączeń
  let confirmDoc = $state(null);      // dokument do potwierdzenia
  let confirmReject = $state(false);
  let exclAccepted = $state(false);
  let actionLoading = $state(false);
  let actionError = $state('');

  function openChoose(doc) { confirmDoc = doc; confirmReject = false; exclAccepted = false; actionError = ''; }
  function openReject() { confirmReject = true; confirmDoc = null; actionError = ''; }
  function closeConfirm() { confirmDoc = null; confirmReject = false; }

  async function submitChoice() {
    actionError = ''; actionLoading = true;
    try {
      const payload = confirmReject
        ? { action: 'reject' }
        : { action: 'choose', documentId: confirmDoc.id };
      const res = await fetch(`/offer/${data.token}/choice`, {
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

<svelte:head><title>Twoja oferta — UtrataDochodu</title></svelte:head>

<header class="header" style="justify-content:center;">
  <div class="logo">Utrata<span>Dochodu</span></div>
</header>

{#if data.requiresPin}
  <!-- BRAMKA PIN -->
  <div style="min-height:70vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;">
    <div class="card card-pad" style="width:100%;max-width:380px;text-align:center;">
      <div style="font-size:2rem;margin-bottom:.5rem;">🔒</div>
      <h1 style="font-size:1.25rem;margin-bottom:.4rem;">Dostęp do oferty</h1>
      <p class="muted" style="margin-bottom:1.25rem;">
        {#if data.clientName}Witaj, {data.clientName.split(' ')[0]}!<br />{/if}
        Wpisz 4-cyfrowe hasło, które otrzymałeś/aś SMS-em.
      </p>
      {#if pinError}<div class="error-box">{pinError}</div>{/if}
      <form onsubmit={submitPin} novalidate>
        <input class="input" style="text-align:center;font-size:1.6rem;letter-spacing:.5rem;font-weight:700;"
          inputmode="numeric" maxlength="4" placeholder="••••"
          bind:value={pin} oninput={(e) => (pin = e.currentTarget.value.replace(/\D/g, '').slice(0, 4))}
          autocomplete="one-time-code" />
        <button class="btn btn-primary btn-full btn-lg" style="margin-top:1rem;" type="submit" disabled={pinLoading || pin.length !== 4}>
          {pinLoading ? 'Sprawdzam…' : 'Odblokuj ofertę'}
        </button>
      </form>
    </div>
  </div>
{:else}
  <!-- WIDOK OFERTY -->
  <main class="container" style="max-width:900px;">
    <div style="margin-bottom:1.5rem;">
      <h1 style="font-size:1.6rem;">Rekomendacja ofertowa</h1>
      {#if data.offer.client_name}<p class="muted">Przygotowana dla: {data.offer.client_name}</p>{/if}
    </div>

    {#if data.offer.broker_message}
      <div class="card card-pad" style="margin-bottom:1.25rem;border-left:4px solid var(--blue-600);">
        <p style="margin:0;white-space:pre-wrap;">{data.offer.broker_message}</p>
      </div>
    {/if}

    <!-- Decyzja już podjęta -->
    {#if choice}
      <div class="ok-box" style="font-size:.95rem;">
        {#if choice.rejected}Dziękujemy za informację — zapisaliśmy Twoją rezygnację.{:else}Dziękujemy! Twój wybór został zapisany. Agent skontaktuje się z Tobą.{/if}
      </div>
    {/if}

    <!-- Porównanie -->
    <div class="card card-pad" style="margin-bottom:1.25rem;">
      <h2 style="font-size:1.15rem;margin-bottom:.35rem;">Porównanie ofert{data.documents.length > 1 ? ` (${data.documents.length})` : ''}</h2>
      <p class="muted" style="margin:0 0 1rem;font-size:.85rem;">Zestawienie przygotowanych dla Ciebie wariantów. Wybierz najlepszy lub zapytaj o szczegóły.</p>
      <OfferComparison documents={data.documents} selectable={!choice} onchoose={openChoose} chosenId={chosenDocId} />
    </div>

    <!-- Pliki -->
    <div class="card card-pad" style="margin-bottom:1.25rem;">
      <h2 style="font-size:1.1rem;margin-bottom:.35rem;">Dokumenty do pobrania</h2>
      <p class="muted" style="margin:0 0 .75rem;font-size:.82rem;">🔒 Pliki oferty mogą być zabezpieczone — otwórz je <strong>tym samym 4-cyfrowym hasłem</strong>, które otrzymałeś/aś SMS-em.</p>
      <div style="display:flex;flex-direction:column;gap:.5rem;">
        {#each data.files as f}
          <a class="btn btn-ghost" style="justify-content:flex-start;" href="/offer/{data.token}/download/{f.id}" target="_blank" rel="noopener">
            {f.file_type === 'owu' ? '📖' : '📄'} {f.file_name}
          </a>
        {/each}
        {#if data.files.length === 0}<p class="muted">Brak plików.</p>{/if}
      </div>
    </div>

    <!-- Akcje decyzji -->
    {#if !choice}
      <div class="card card-pad" style="margin-bottom:1.25rem;">
        <h2 style="font-size:1.1rem;margin-bottom:.5rem;">Twoja decyzja</h2>
        <p class="muted" style="margin-bottom:1rem;">Wybierz wariant powyżej („Wybieram ten") lub zrezygnuj.</p>
        <button class="btn btn-ghost" onclick={openReject}>Rezygnuję z oferty</button>
      </div>
    {/if}

    <!-- Pytanie -->
    <div class="card card-pad">
      <h2 style="font-size:1.1rem;margin-bottom:.5rem;">Masz pytanie?</h2>
      <p class="muted" style="margin-bottom:.75rem;">Napisz — agent odpowie mailowo.</p>
      {#if qMsg === 'ok'}<div class="ok-box">Pytanie wysłane. Dziękujemy!</div>
      {:else if qMsg}<div class="error-box">{qMsg}</div>{/if}
      <div class="field">
        <input class="input" placeholder="Twój email (do odpowiedzi)" bind:value={qEmail} type="email" />
      </div>
      <div class="field">
        <textarea class="input" rows="3" placeholder="Treść pytania…" bind:value={question}></textarea>
      </div>
      <button class="btn btn-primary" onclick={sendQuestion} disabled={qLoading || question.trim().length < 3}>
        {qLoading ? 'Wysyłam…' : 'Wyślij pytanie'}
      </button>
    </div>
  </main>

  <!-- MODAL potwierdzenia decyzji -->
  {#if confirmDoc || confirmReject}
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;padding:1.5rem;z-index:50;">
      <div class="card card-pad" style="max-width:520px;width:100%;max-height:85vh;overflow:auto;">
        {#if confirmReject}
          <h3 style="font-size:1.15rem;margin-bottom:.75rem;">Potwierdź rezygnację</h3>
          <p class="muted" style="margin-bottom:1.25rem;">Czy na pewno chcesz zrezygnować z przedstawionych ofert?</p>
        {:else}
          <h3 style="font-size:1.15rem;margin-bottom:.75rem;">Potwierdź wybór</h3>
          <p style="margin-bottom:1rem;">Wybierasz wariant. Przed potwierdzeniem zapoznaj się z wyłączeniami odpowiedzialności.</p>
          <div style="background:var(--slate-50);border:1px solid var(--slate-200);border-radius:8px;padding:1rem;font-size:.82rem;color:var(--slate-600);line-height:1.6;max-height:220px;overflow:auto;margin-bottom:1rem;">
            <strong>Ważne wyłączenia odpowiedzialności:</strong>
            {#if data.exclusionsText}
              <p style="margin:.5rem 0 0;white-space:pre-wrap;">{data.exclusionsText}</p>
            {:else}
              <ul style="padding-left:1.2rem;margin:.5rem 0 0;">
                <li>Choroby leczone/konsultowane w okresie 24 miesięcy przed polisą.</li>
                <li>Zwyrodnienia kręgosłupa i stawów leczone w ostatnich 24 miesiącach.</li>
                <li>Celowe samookaleczenie, działanie pod wpływem alkoholu/środków odurzających.</li>
                <li>Zawodowe uprawianie sportu, strefy wojny/sankcji.</li>
              </ul>
            {/if}
            <p style="margin:.6rem 0 0;">Pełna lista w OWU i Karcie Produktu (do pobrania powyżej).</p>
          </div>
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
{/if}
