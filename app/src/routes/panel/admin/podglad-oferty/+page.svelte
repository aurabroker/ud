<script>
  import OfferView from '$lib/components/OfferView.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Podgląd oferty klienta — Admin</title></svelte:head>

<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem;">
  <div>
    <h1 style="font-size:1.4rem;">Podgląd widoku klienta (szablon)</h1>
    <p class="muted">Dane przykładowe — do dopracowania layoutu. Akcje są nieaktywne.</p>
  </div>
  <a class="btn btn-ghost" href="/panel/admin">← Panel Admina</a>
</div>

<div style="border:1px dashed var(--slate-300);border-radius:12px;padding:.5rem;background:var(--slate-50);">
  <OfferView
    preview
    offer={data.offer}
    documents={data.documents}
    files={data.files}
    conditionsHtml={data.conditionsHtml}
    distributor={data.distributor}
  />
</div>
