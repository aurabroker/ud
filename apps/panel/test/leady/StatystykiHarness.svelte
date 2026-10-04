<script>
  /** Strona /panel/statystyki z danymi, które `invalidateAll` (zaślepka) umie pobrać ponownie. */
  import Strona from '../../src/routes/panel/statystyki/+page.svelte';

  let { poczatkowe, pobierz } = $props();
  let data = $state(poczatkowe);
  window.__invalidateAll = async () => { data = await pobierz(); };
</script>

<Strona {data} />
