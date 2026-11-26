<script>
  /**
   * Odkladanie.svelte — druga kolumna karty kalkulatora na /kalkulator/:
   * obok składki od razu widać, ile trwa uzbieranie jednego i dwóch miesięcy
   * świadczenia, gdyby zamiast składki odkładać pieniądze (decyzja właściciela
   * z 23.10.2026: kalkulator na 2/3 strony, odkładanie obok, oprocentowanie
   * stałe 3% rocznie).
   *
   * Świadczenie przychodzi z kalkulatora. Kwota odkładana idzie za GÓRNĄ
   * granicą szacowanej składki — „gdybyś zamiast składki odkładał tyle samo" —
   * dopóki ktoś jej nie zmieni polem albo suwakiem. Górna, nie dolna: z nią
   * odkładanie wychodzi najkrócej, więc porównanie nie jest ustawione pod
   * polisę. Agent może podać kwotę w adresie (?odkladam=250) — czytane tylko
   * z adresu, nic nie zapisujemy w przeglądarce. Rachunek: lib/odkladanie.ts.
   */
  import { onMount, untrack } from 'svelte';
  import { zl } from '../lib/symulacja';
  import {
    ZAKRES_ODKLADANIA, OPROCENTOWANIE, PRZYKLAD,
    miesiaceDoKwoty, odlozone, rownowartoscSlownie, czasSlownie, wZakresie,
  } from '../lib/odkladanie';

  /** Miesięczne świadczenie i górna granica składki — z kalkulatora obok. */
  let { swiadczenie, skladka } = $props();

  const { min: MIN, max: MAX, krok: KROK } = ZAKRES_ODKLADANIA;
  const zeSkladki = (kwota) => wZakresie(Math.round(kwota / KROK) * KROK, MIN, MAX, 1, PRZYKLAD.odkladam);

  /**
   * `wartosc` idzie do rachunku i na suwak — zawsze w zakresie. `tekst` to,
   * co stoi w polu: w trakcie wpisywania bywa pusty albo spoza zakresu, a wtedy
   * rachunek i suwak trzymają ostatnią dobrą wartość. Po wyjściu z pola tekst
   * wraca do wartości, żeby pole i wynik mówiły to samo.
   */
  let wartosc = $state(untrack(() => zeSkladki(skladka)));
  let tekst = $state(untrack(() => zeSkladki(skladka)));
  /** Kwota wpisana albo przesunięta przez klienta — wtedy nie idzie już za składką. */
  let wlasna = $state(false);

  const ustaw = (v) => {
    wartosc = wZakresie(v, MIN, MAX, 1, wartosc);
    tekst = wartosc;
  };
  const wpisano = (e) => {
    if (e.currentTarget.value === '') return;
    wlasna = true;
    wartosc = wZakresie(e.currentTarget.value, MIN, MAX, 1, wartosc);
  };
  const przesunieto = (e) => {
    wlasna = true;
    ustaw(e.currentTarget.value);
  };
  const popraw = () => {
    tekst = wartosc;
  };
  const jakSkladka = () => {
    wlasna = false;
    ustaw(zeSkladki(skladka));
  };

  // Za składką, dopóki klient nie poda własnej kwoty.
  $effect(() => {
    const nowa = zeSkladki(skladka);
    if (!untrack(() => wlasna)) untrack(() => ustaw(nowa));
  });

  const naJeden = $derived(miesiaceDoKwoty(swiadczenie, wartosc, OPROCENTOWANIE));
  const naDwa = $derived(miesiaceDoKwoty(2 * swiadczenie, wartosc, OPROCENTOWANIE));
  const poRoku = $derived(odlozone(wartosc, 12, OPROCENTOWANIE));

  /**
   * Czytnik ekranu dostaje jedno zdanie podsumowania po chwili spokoju, nie
   * każdą zmianę liczby — suwak przesuwany strzałką dawałby komunikat na
   * każdy krok, a lista wyników bez etykiet nic by nie mówiła.
   */
  let komunikat = $state('');
  let pierwszy = true;
  $effect(() => {
    const zdanie = `Odkładając ${zl(wartosc)} miesięcznie: jeden miesiąc świadczenia — ${czasSlownie(naJeden)}, `
      + `dwa miesiące — ${czasSlownie(naDwa)}.`;
    if (pierwszy) {
      pierwszy = false;
      return;
    }
    const t = setTimeout(() => (komunikat = zdanie), 900);
    return () => clearTimeout(t);
  });

  onMount(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has('odkladam')) {
      wlasna = true;
      ustaw(q.get('odkladam'));
    }
  });
</script>

<h2 class="text-xl m-0 mb-1">Gdyby odkładać samodzielnie</h2>
<p class="text-[14px] leading-relaxed text-tekst-drugi mt-0 mb-6">
  Ile trwa uzbieranie równowartości świadczenia z polisy, jeśli zamiast składki odkładasz pieniądze.
</p>

<label for="od-kwota" class="block text-sm font-semibold mb-2">Ile możesz odkładać co miesiąc</label>
<div class="flex items-center gap-2 mb-2">
  <input id="od-kwota" type="number" inputmode="numeric" min={MIN} max={MAX}
         bind:value={tekst} oninput={wpisano} onblur={popraw}
         class="w-full border border-linia-pole px-3 py-2 font-mono text-lg">
  <span class="text-tekst-drugi">zł</span>
</div>
<input type="range" min={MIN} max={MAX} step={KROK}
       value={wartosc} oninput={przesunieto}
       aria-label="Kwota odkładana co miesiąc, w złotych"
       class="w-full accent-akcent-ciemny">
<p class="text-[13px] text-tekst-drugi mt-1 mb-0" data-podpowiedz>
  {#if wlasna}
    Twoja kwota. <button type="button" onclick={jakSkladka}
      class="underline underline-offset-2 text-akcent-tekst hover:text-akcent-hover bg-transparent border-0 p-0 cursor-pointer">Odkładaj tyle co składka</button>
  {:else}
    Tyle co górna granica szacowanej składki obok.
  {/if}
</p>

<!-- Kwota wpłaty stoi też w opisach wyników: w pliku .md pól nie ma, a bez
     niej wynik „3 lata i 4 miesiące" nie mówiłby, przy jakiej wpłacie. -->
<dl class="border-t border-linia mt-6 mb-0">
  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 border-b border-linia-lekka">
    <dt class="text-[15px] text-tekst-drugi">
      1 miesiąc świadczenia<span class="sr-only">:</span>
      <span class="block text-[13px]">{zl(swiadczenie)}, odkładając {zl(wartosc)} miesięcznie</span>
    </dt>
    <dd class="font-mono text-xl font-bold text-alarm m-0" data-wynik="jeden">{czasSlownie(naJeden)}</dd>
  </div>
  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 border-b border-linia-lekka">
    <dt class="text-[15px] text-tekst-drugi">
      2 miesiące świadczenia<span class="sr-only">:</span>
      <span class="block text-[13px]">{zl(2 * swiadczenie)}, odkładając {zl(wartosc)} miesięcznie</span>
    </dt>
    <dd class="font-mono text-xl font-bold text-alarm m-0" data-wynik="dwa">{czasSlownie(naDwa)}</dd>
  </div>
  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4">
    <dt class="text-[15px] text-tekst-drugi">
      Po roku odkładania masz<span class="sr-only">:</span>
      <span class="block text-[13px]" data-rownowartosc>równowartość {rownowartoscSlownie(poRoku, swiadczenie)} świadczenia</span>
    </dt>
    <dd class="font-mono text-xl font-bold m-0" data-wynik="rok">{zl(poRoku)}</dd>
  </div>
</dl>
<p class="sr-only" aria-live="polite">{komunikat}</p>

<p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-4 mb-0" data-uczciwie>
  Odłożone pieniądze zostają Twoje — składka nie wraca, jeśli nic się nie stanie. Świadczenie
  z polisy przysługuje po okresie wyczekiwania ustalonym w umowie i tylko przy niezdolności objętej
  umową (<a href="/wylaczenia/" class="underline underline-offset-2 hover:text-akcent-tekst">wyłączenia</a>).
  Przyjmujemy oprocentowanie oszczędności {OPROCENTOWANIE}% rocznie, wpłatę na koniec każdego
  miesiąca, bez inflacji. Symulacja, nie oferta.
</p>
