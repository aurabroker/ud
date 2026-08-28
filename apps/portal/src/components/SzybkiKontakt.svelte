<script>
  /**
   * SzybkiKontakt — formularz „oddzwonimy do Ciebie".
   *
   * Wysyła do funkcji brzegowej contact-submit, a nie prosto do PostgREST.
   * Poprzednia wersja strzelała do tabeli i dokładała do payloadu pole
   * `cf-turnstile-response`, którego w `udochodu_contacts` nie ma — PostgREST
   * odrzucał każdy INSERT błędem PGRST204, przez co formularz był martwy.
   * Funkcja brzegowa weryfikuje token po stronie serwera i zapisuje wyłącznie
   * te kolumny, które w tabeli istnieją.
   */
  let { urlFunkcji, kluczTurnstile, etykietaPrzycisku = 'Wyślij zgłoszenie' } = $props();

  let imie = $state('');
  let email = $state('');
  let telefon = $state('');
  let zgoda = $state(false);
  let stan = $state('gotowy'); // gotowy | wysylanie | wyslany | blad
  let komunikat = $state('');

  let kontener;
  let widget = $state(null);

  /**
   * api.js szuka elementów z klasą .cf-turnstile raz, przy wczytaniu skryptu.
   * Renderujemy jawnie, bo formularz bywa niżej na stronie i wyspa hydratuje
   * się dopiero, gdy wjedzie w pole widzenia — czyli zwykle po tamtym skanie.
   */
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

  const cyfry = (s) => (s.match(/\d/g) ?? []).length;

  const poprawny = $derived(
    imie.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim()) &&
    cyfry(telefon) >= 9 &&
    zgoda,
  );

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
          email: email.trim(),
          phone: telefon.trim(),
          rodo_consent: zgoda,
          'cf-turnstile-response': token,
        }),
      });
      const dane = await odpowiedz.json().catch(() => ({}));

      if (!odpowiedz.ok || dane.status !== 'success') {
        throw new Error(dane.message ?? 'Nie udało się wysłać zgłoszenia.');
      }

      stan = 'wyslany';
    } catch (blad) {
      stan = 'blad';
      komunikat = blad.message ?? 'Nie udało się wysłać zgłoszenia.';
      // Token jest jednorazowy — po nieudanej próbie trzeba go odświeżyć,
      // inaczej kolejna wysyłka poleci ze zużytym i znowu się nie uda.
      if (widget !== null) window.turnstile?.reset(widget);
      window.Awaria?.pokaz?.({ kod: 'KONTAKT', szczegoly: blad });
    }
  }
</script>

{#if stan === 'wyslany'}
  <div class="border-l-[3px] border-akcent bg-tlo-jasne p-7" role="status">
    <h3 class="text-[20px] font-semibold m-0 mb-2">Zgłoszenie przyjęte</h3>
    <p class="text-[15.5px] leading-relaxed text-tekst-drugi m-0">
      Oddzwonimy w ciągu jednego dnia roboczego. Jeśli sprawa jest pilna,
      zadzwoń od razu — numer masz obok.
    </p>
  </div>
{:else}
  <form onsubmit={wyslij} novalidate class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <label for="k-imie" class="font-semibold text-[14.5px]">Imię i nazwisko</label>
      <input id="k-imie" name="imie" type="text" autocomplete="name" required
             bind:value={imie}
             class="border border-linia-pole bg-tlo px-4 py-3 text-[16px] focus:border-akcent outline-none">
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="k-email" class="font-semibold text-[14.5px]">Adres e-mail</label>
      <input id="k-email" name="email" type="email" autocomplete="email" inputmode="email" required
             bind:value={email}
             class="border border-linia-pole bg-tlo px-4 py-3 text-[16px] focus:border-akcent outline-none">
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="k-telefon" class="font-semibold text-[14.5px]">Numer telefonu</label>
      <input id="k-telefon" name="telefon" type="tel" autocomplete="tel" inputmode="tel" required
             bind:value={telefon}
             class="border border-linia-pole bg-tlo px-4 py-3 text-[16px] focus:border-akcent outline-none">
    </div>

    <label class="flex gap-3 items-start text-[13.5px] leading-relaxed text-tekst-drugi cursor-pointer">
      <input type="checkbox" bind:checked={zgoda} required class="mt-1 shrink-0 accent-[var(--color-akcent-ciemny)]">
      <span>
        Zgadzam się na kontakt telefoniczny i e-mailowy w sprawie oferty ubezpieczenia.
        Zapoznałem się z <a href="/klauzula-informacyjna/" class="underline decoration-linia-mocna underline-offset-2">klauzulą informacyjną RODO</a>.
      </span>
    </label>

    {#if kluczTurnstile}
      <div bind:this={kontener} class="min-h-[65px]"></div>
    {/if}

    {#if stan === 'blad'}
      <p class="text-[14.5px] text-alarm m-0" role="alert">{komunikat}</p>
    {/if}

    <button type="submit" disabled={!poprawny || stan === 'wysylanie'}
            class="bg-akcent-ciemny text-white px-8 py-4 font-bold text-[15.5px] hover:bg-akcent-hover
                   disabled:opacity-40 disabled:cursor-not-allowed">
      {stan === 'wysylanie' ? 'Wysyłam…' : etykietaPrzycisku}
    </button>
  </form>
{/if}
