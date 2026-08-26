<script>
  import { page } from '$app/stores';
</script>

<svelte:head><title>Błąd {$page.status}</title></svelte:head>

<div style="min-height:70vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1.75rem;">
    <div style="font-size:2rem;">⚠️</div>
    <h1 style="font-size:1.4rem;margin:.5rem 0;">Błąd {$page.status}</h1>
    <p style="color:#334155;margin:0 0 1rem;">{$page.error?.message || 'Wystąpił błąd.'}</p>
    {#if $page.error?.where}
      <p style="color:#64748b;font-size:.85rem;margin:0 0 1rem;">Trasa: <code>{$page.error.where}</code></p>
    {/if}
    <a href="/health" style="color:#2563eb;">Sprawdź /health →</a>
  </div>
</div>
