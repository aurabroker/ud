<script>
  /**
   * Formularz opinii. Ocena jest grupą radio, a nie zestawem <div>-ów
   * z obsługą kliknięcia — dzięki temu działa z klawiatury i czytnikiem
   * ekranu bez dopisywania ról ARIA.
   */
  let { urlFunkcji, kluczTurnstile } = $props();

  let imie = $state('');
  let miasto = $state('');
  let zawod = $state('');
  let ocena = $state(0);
  let komentarz = $state('');
  let stan = $state('gotowy');
  let komunikat = $state('');

  let kontener;
  let widget = $state(null);

  function zamontuj() {
    if (!kontener || widget !== null || !window.turnstile?.render) return;
    widget = window.turnstile.render(kontener, { sitekey: kluczTurnstile, language: 'pl' });
  }

  $effect(() => {
    if (!kontener || !kluczTurnstile) return;
    zamontuj();
    if (widget !== null) return;
    window.onloadTurnstileCallback = () => zamontuj();
  });

  const poprawny = $derived(imie.trim().length >= 2 && miasto.trim().length >= 2 && ocena >= 1);

  async function wyslij(zdarzenie) {
    zdarzenie.preventDefault();
    if (!poprawny || stan === 'wysylanie') return;

    stan = 'wysylanie';
    komunikat = '';

    const token = kluczTurnstile && widget !== null
      ? (window.turnstile?.getResponse(widget) ?? '')
      : '';

    try {
      const odpowiedz = await fetch(urlFunkcji, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: imie.trim(),
          city: miasto.trim(),
          zawod: zawod.trim() || null,
          rating: ocena,
          comment: komentarz.trim() || null,
          'cf-turnstile-response': token,
        }),
      });
      const dane = await odpowiedz.json().catch(() => ({}));
      if (!odpowiedz.ok || dane.status !== 'success') {
        throw new Error(dane.message ?? 'Nie udało się wysłać opinii.');
      }
      stan = 'wyslany';
    } catch (blad) {
      stan = 'blad';
      komunikat = blad.message ?? 'Nie udało się wysłać opinii.';
      if (widget !== null) window.turnstile?.reset(widget);
      window.Awaria?.pokaz?.({ kod: 'OPINIA', szczegoly: blad });
    }
  }
</script>

{#if stan === 'wyslany'}
  <div class="border-l-[3px] border-akcent bg-tlo-jasne p-7" role="status">
    <h3 class="text-[20px] font-semibold m-0 mb-2">Dziękujemy</h3>
    <p class="text-[15.5px] leading-relaxed text-tekst-drugi m-0">
      Opinia trafiła do nas i pojawi się na stronie po weryfikacji.
    </p>
  </div>
{:else}
  <form onsubmit={wyslij} novalidate class="flex flex-col gap-4">
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="flex flex-col gap-1.5">
        <label for="o-imie" class="font-semibold text-[14.5px]">Imię</label>
        <input id="o-imie" type="text" autocomplete="given-name" required bind:value={imie}
               class="border border-linia-mocna bg-tlo px-4 py-3 text-[16px] focus:border-akcent outline-none">
      </div>
      <div class="flex flex-col gap-1.5">
        <label for="o-miasto" class="font-semibold text-[14.5px]">Miasto</label>
        <input id="o-miasto" type="text" autocomplete="address-level2" required bind:value={miasto}
               class="border border-linia-mocna bg-tlo px-4 py-3 text-[16px] focus:border-akcent outline-none">
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="o-zawod" class="font-semibold text-[14.5px]">Zawód <span class="font-normal text-tekst-trzeci">(opcjonalnie)</span></label>
      <input id="o-zawod" type="text" bind:value={zawod}
             class="border border-linia-mocna bg-tlo px-4 py-3 text-[16px] focus:border-akcent outline-none">
    </div>

    <fieldset class="border-0 p-0 m-0">
      <legend class="font-semibold text-[14.5px] mb-2">Ocena</legend>
      <div class="flex gap-1">
        {#each [1, 2, 3, 4, 5] as gwiazdka}
          <label class="cursor-pointer" title={`${gwiazdka} z 5`}>
            <input type="radio" name="ocena" value={gwiazdka} bind:group={ocena} class="sr-only">
            <span aria-hidden="true"
                  class="text-[2rem] leading-none {gwiazdka <= ocena ? 'text-akcent' : 'text-linia-mocna'}">★</span>
            <span class="sr-only">{gwiazdka} {gwiazdka === 1 ? 'gwiazdka' : 'gwiazdki'} z 5</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <div class="flex flex-col gap-1.5">
      <label for="o-komentarz" class="font-semibold text-[14.5px]">Komentarz <span class="font-normal text-tekst-trzeci">(opcjonalnie)</span></label>
      <textarea id="o-komentarz" rows="4" maxlength="2000" bind:value={komentarz}
                class="border border-linia-mocna bg-tlo px-4 py-3 text-[16px] focus:border-akcent outline-none resize-y"></textarea>
    </div>

    {#if kluczTurnstile}
      <div bind:this={kontener} class="min-h-[65px]"></div>
    {/if}

    {#if stan === 'blad'}
      <p class="text-[14.5px] text-alarm m-0" role="alert">{komunikat}</p>
    {/if}

    <button type="submit" disabled={!poprawny || stan === 'wysylanie'}
            class="bg-akcent-ciemny text-white px-8 py-4 font-bold text-[15.5px] hover:bg-akcent-hover
                   disabled:opacity-40 disabled:cursor-not-allowed self-start">
      {stan === 'wysylanie' ? 'Wysyłam…' : 'Wyślij opinię'}
    </button>
  </form>
{/if}
