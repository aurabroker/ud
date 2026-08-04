<script>
  import OfferView from '$lib/components/OfferView.svelte';
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
  <OfferView
    token={data.token}
    offer={data.offer}
    documents={data.documents}
    files={data.files}
    conditionsHtml={data.conditionsHtml}
    distributor={data.distributor}
  />
{/if}
