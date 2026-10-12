<script>
  /** Strona panelu (Statystyki albo Wykaz polis) z danymi, które `invalidateAll` (zaślepka) umie pobrać ponownie. */
  let { Strona, poczatkowe, pobierz } = $props();
  let data = $state(poczatkowe);
  window.__invalidateAll = async () => { data = await pobierz(); };
</script>

<Strona {data} />
