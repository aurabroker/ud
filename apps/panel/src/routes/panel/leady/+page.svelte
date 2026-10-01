<script>
  /**
   * Leady — tablica Kanban. Cały interfejs w $lib/leady; ta strona tylko
   * podaje dane z load, klienta API i zapis filtrów/otwartego leada w adresie
   * (replaceState: odświeżenie i skopiowany link niosą ten sam widok, a historia
   * przeglądarki nie puchnie od każdego kliknięcia).
   */
  import { onMount } from 'svelte';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/stores';
  import { utworzApi } from '$lib/leady/api.js';
  import Tablica from '$lib/leady/Tablica.svelte';

  let { data } = $props();
  const api = utworzApi();

  function odUrl({ filtr, sort, lead }) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtr)) if (v) p.set(k, String(v));
    if (sort && sort !== 'dzialanie') p.set('sort', sort);
    const pipeline = $page.url.searchParams.get('pipeline');
    if (pipeline) p.set('pipeline', pipeline);
    if (lead) p.set('lead', lead);
    const q = p.toString();
    replaceState(q ? `?${q}` : $page.url.pathname, $page.state);
  }

  const zmienPipeline = (id) => goto(`?pipeline=${encodeURIComponent(id)}`);

  // Tablica potrzebuje pełnej szerokości — układ panelu ogranicza treść do 1100 px.
  onMount(() => {
    const main = document.querySelector('main.container');
    main?.classList.add('container-pelny');
    return () => main?.classList.remove('container-pelny');
  });
</script>

<svelte:head><title>Leady — Panel</title></svelte:head>

{#if data.tablica}
  {#key data.tablica.plan.pipeline.id}
    <Tablica dane={data.tablica} {api} {odUrl} {zmienPipeline} />
  {/key}
{:else}
  <div class="error-box" role="alert">{data.blad}</div>
{/if}
