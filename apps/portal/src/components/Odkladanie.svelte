<script>
  /**
   * Odkladanie.svelte — „wolę odkładać sam": ile trwa uzbieranie jednego
   * i dwóch miesięcy świadczenia (pomysł właściciela z 21.10.2026).
   *
   * Każdą liczbę można przesunąć suwakiem albo wpisać. Wartości startowe
   * można podać w adresie, żeby agent wysłał klientowi link z jego ofertą:
   * /kalkulator/?odkladam=250&swiadczenie=10000#odkladanie — czytane tylko
   * z adresu, nic nie zapisujemy w przeglądarce.
   *
   * Uczciwie wobec odkładania: przy wyniku stoi, że odłożone pieniądze
   * zostają u klienta, a składka nie wraca. Rachunek: lib/odkladanie.ts.
   */
  import { onMount } from 'svelte';
  import { zl, zlZakres, STAWKA, MIESIECY_MAX, MIESIECY_WYPLATY } from '../lib/symulacja';
  import {
    ZAKRES_ODKLADANIA, SWIADCZENIE_MIN, SWIADCZENIE_KROK, ZAKRES_PROCENTU, PRZYKLAD,
    miesiaceDoKwoty, odlozone, dniSwiadczenia, czasSlownie, wZakresie,
  } from '../lib/odkladanie';
  import { liczebnik } from '@ud/zawody/liczebnik';

  /** Najwyższe świadczenie, jakie przyjmuje wniosek — z granice.ts, przez stronę. */
  let { maxSwiadczenie } = $props();

  let odkladam = $state(PRZYKLAD.odkladam);
  let swiadczenie = $state(PRZYKLAD.swiadczenie);
  let procent = $state(0);

  // Do rachunku zawsze liczba z zakresu — także w trakcie wpisywania w pole.
  const o = $derived(wZakresie(odkladam, ZAKRES_ODKLADANIA.min, ZAKRES_ODKLADANIA.max, 1, PRZYKLAD.odkladam));
  const s = $derived(wZakresie(swiadczenie, SWIADCZENIE_MIN, maxSwiadczenie, 1, PRZYKLAD.swiadczenie));
  const p = $derived(wZakresie(procent, ZAKRES_PROCENTU.min, ZAKRES_PROCENTU.max, 0.1, 0));

  const naJeden = $derived(miesiaceDoKwoty(s, o, p));
  const naDwa = $derived(miesiaceDoKwoty(2 * s, o, p));
  const poRoku = $derived(odlozone(o, 12, p));
  const dni = $derived(dniSwiadczenia(poRoku, s));
  const skladkaOd = $derived(Math.round(s * STAWKA.dol));
  const skladkaDo = $derived(Math.round(s * STAWKA.gora));

  /** Po wyjściu z pola: wartość wraca do zakresu, żeby pole i wynik mówiły to samo. */
  const popraw = () => {
    odkladam = o;
    swiadczenie = s;
    procent = p;
  };

  onMount(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has('odkladam')) odkladam = wZakresie(q.get('odkladam'), ZAKRES_ODKLADANIA.min, ZAKRES_ODKLADANIA.max, 1, PRZYKLAD.odkladam);
    if (q.has('swiadczenie')) swiadczenie = wZakresie(q.get('swiadczenie'), SWIADCZENIE_MIN, maxSwiadczenie, 1, PRZYKLAD.swiadczenie);
  });

  const procentSlownie = (v) => `${String(v).replace('.', ',')}%`;
</script>

<div class="border border-linia bg-tlo p-7">
  <div class="grid gap-6 md:grid-cols-3">
    <div>
      <label for="od-kwota" class="block text-sm font-semibold mb-2">Ile możesz odkładać co miesiąc</label>
      <div class="flex items-center gap-2 mb-2">
        <input id="od-kwota" type="number" inputmode="numeric" min={ZAKRES_ODKLADANIA.min} max={ZAKRES_ODKLADANIA.max}
               bind:value={odkladam} onblur={popraw}
               class="w-full border border-linia-pole px-3 py-2 font-mono text-lg">
        <span class="text-tekst-drugi">zł</span>
      </div>
      <input type="range" min={ZAKRES_ODKLADANIA.min} max={ZAKRES_ODKLADANIA.max} step={ZAKRES_ODKLADANIA.krok}
             bind:value={odkladam} aria-label="Kwota odkładana co miesiąc, w złotych"
             class="w-full accent-akcent-ciemny">
    </div>

    <div>
      <label for="od-swiadczenie" class="block text-sm font-semibold mb-2">Miesięczne świadczenie z polisy</label>
      <div class="flex items-center gap-2 mb-2">
        <input id="od-swiadczenie" type="number" inputmode="numeric" min={SWIADCZENIE_MIN} max={maxSwiadczenie}
               bind:value={swiadczenie} onblur={popraw}
               class="w-full border border-linia-pole px-3 py-2 font-mono text-lg">
        <span class="text-tekst-drugi">zł</span>
      </div>
      <input type="range" min={SWIADCZENIE_MIN} max={maxSwiadczenie} step={SWIADCZENIE_KROK}
             bind:value={swiadczenie} aria-label="Miesięczne świadczenie z polisy, w złotych"
             class="w-full accent-akcent-ciemny">
    </div>

    <div>
      <label for="od-procent" class="block text-sm font-semibold mb-2">Oprocentowanie oszczędności</label>
      <div class="flex items-center gap-2 mb-2">
        <input id="od-procent" type="number" inputmode="decimal" min={ZAKRES_PROCENTU.min} max={ZAKRES_PROCENTU.max}
               step={ZAKRES_PROCENTU.krok} bind:value={procent} onblur={popraw}
               class="w-full border border-linia-pole px-3 py-2 font-mono text-lg">
        <span class="text-tekst-drugi">%</span>
      </div>
      <input type="range" min={ZAKRES_PROCENTU.min} max={ZAKRES_PROCENTU.max} step={ZAKRES_PROCENTU.krok}
             bind:value={procent} aria-label="Oprocentowanie oszczędności rocznie, po podatku, w procentach"
             class="w-full accent-akcent-ciemny">
      <span class="block text-[13px] text-tekst-drugi mt-1">rocznie, po podatku</span>
    </div>
  </div>

  <dl class="border-t border-linia mt-7 mb-0" aria-live="polite">
    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">
        Żeby odłożyć 1 miesiąc świadczenia<span class="sr-only">:</span>
        <span class="block text-[13px]">{zl(s)}</span>
      </dt>
      <dd class="font-mono text-xl font-semibold text-alarm m-0" data-wynik="jeden">{czasSlownie(naJeden)}</dd>
    </div>
    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">
        Żeby odłożyć 2 miesiące świadczenia<span class="sr-only">:</span>
        <span class="block text-[13px]">{zl(2 * s)}</span>
      </dt>
      <dd class="font-mono text-xl font-semibold text-alarm m-0" data-wynik="dwa">{czasSlownie(naDwa)}</dd>
    </div>
    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
      <dt class="text-[15px] text-tekst-drugi">
        Po roku odkładania masz<span class="sr-only">:</span>
        <span class="block text-[13px]">równowartość {liczebnik(dni, ['dnia', 'dni', 'dni'])} świadczenia</span>
      </dt>
      <dd class="font-mono text-xl font-semibold m-0" data-wynik="rok">{zl(poRoku)}</dd>
    </div>
  </dl>

  <p class="text-[15px] leading-relaxed text-tekst-drugi mt-3 mb-0">
    Polisa z takim świadczeniem kosztuje szacunkowo <strong class="text-tekst whitespace-nowrap">{zlZakres(skladkaOd, skladkaDo)}</strong>
    miesięcznie (razem z opłatą dystrybucyjną, wariant z wypłatą do {MIESIECY_WYPLATY} miesięcy) i wypłaca
    {zl(s)} za każdy miesiąc niezdolności, najdłużej przez {MIESIECY_MAX} miesięcy — zależnie od wariantu.
  </p>
  <p class="text-[13px] leading-relaxed text-tekst-drugi mt-3 mb-0" data-uczciwie>
    Odłożone pieniądze zostają Twoje — składka nie wraca, jeśli nic się nie stanie. Świadczenie
    przysługuje po okresie wyczekiwania ustalonym w umowie i tylko przy niezdolności objętej
    umową (<a href="/wylaczenia/" class="underline underline-offset-2 hover:text-akcent-ciemny">wyłączenia</a>).
    Symulacja: wpłata na koniec każdego miesiąca, odsetki {procentSlownie(p)} rocznie, bez inflacji.
    Składka to przedział z ostatnio wystawionych ofert, nie oferta.
  </p>
</div>
