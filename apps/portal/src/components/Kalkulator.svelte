<script>
  /**
   * Kalkulator.svelte — symulacja składki.
   *
   * Kwoty liczone są wzorem z Calculator.js starego serwisu, przeniesionym bez
   * zmian: suma = dochód × limit, składka = suma × 1,5% (1,8% z klauzulą HIV/WZW,
   * ×1,1 przy wariancie 24-miesięcznym).
   *
   * To jest SYMULACJA, nie oferta i nie stawka z tabeli ubezpieczyciela. Realną
   * składkę wylicza system ubezpieczyciela po ocenie ryzyka. Zastrzeżenie stoi
   * przy każdej kwocie i nie jest ozdobą — przedstawianie szacunku jak oferty
   * to spór z ustawą o dystrybucji ubezpieczeń.
   */
  import { symuluj, zl, ZUS_MIESIECZNIE, LIMIT } from '../lib/symulacja';

  let { dochodPoczatkowy = 18000, zawod = '', kompaktowy = false } = $props();

  let dochod = $state(dochodPoczatkowy);
  let zatrudnienie = $state('b2b');
  let hivWzw = $state(false);
  let miesiecy = $state(12);

  const MIN = 3000;
  const MAX = 60000;
  const KROK = 500;

  const wynik = $derived(symuluj({ dochod, zatrudnienie, hivWzw, miesiecy }));
  const procent = $derived(Math.round(((dochod - MIN) / (MAX - MIN)) * 100));
  const limitProcent = $derived(Math.round(LIMIT[zatrudnienie] * 100));
</script>

<div class="border border-linia bg-tlo p-7 {kompaktowy ? '' : 'shadow-[0_18px_46px_-16px_rgba(15,46,64,0.18)]'}">
  <h2 class="text-xl m-0 mb-1">Symulacja składki{zawod ? ` dla ${zawod}` : ''}</h2>
  <p class="text-[14px] leading-relaxed text-tekst-drugi mt-0 mb-6">
    Przesuń suwak, żeby zobaczyć, jak zmienia się świadczenie i szacowana składka.
  </p>

  <label class="block mb-6">
    <span class="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
      <span class="text-sm font-semibold">Miesięczny dochód netto</span>
      <output class="font-mono text-lg font-semibold text-akcent-ciemny">{zl(dochod)}</output>
    </span>
    <input type="range" min={MIN} max={MAX} step={KROK} bind:value={dochod}
           aria-label="Miesięczny dochód netto w złotych"
           class="w-full accent-akcent-ciemny">
    <span class="flex justify-between font-mono text-[11px] text-tekst-trzeci mt-1.5">
      <span>{zl(MIN)}</span><span>{zl(MAX)}</span>
    </span>
    <span class="sr-only">Suwak ustawiony na {procent}% zakresu.</span>
  </label>

  <fieldset class="border-0 p-0 m-0 mb-5">
    <legend class="text-sm font-semibold mb-2">Forma zatrudnienia</legend>
    <div class="grid grid-cols-2 gap-2">
      {#each [['b2b', 'B2B / JDG'], ['etat', 'Umowa o pracę']] as [w, e]}
        <label class="flex items-center justify-center gap-2 border p-3 cursor-pointer text-[15px]
                      {zatrudnienie === w ? 'border-akcent bg-tlo-jasne font-semibold' : 'border-linia'}">
          <input type="radio" name="zatrudnienie" value={w} bind:group={zatrudnienie} class="sr-only">
          {e}
        </label>
      {/each}
    </div>
    <p class="text-[13px] leading-relaxed text-tekst-trzeci mt-2 mb-0">
      Polisa obejmuje do {limitProcent}% udokumentowanego dochodu przy tej formie zatrudnienia.
    </p>
  </fieldset>

  <div class="flex flex-col gap-2.5 mb-6">
    <label class="flex items-center gap-3 cursor-pointer text-[15px]">
      <input type="checkbox" bind:checked={hivWzw} class="w-4.5 h-4.5 accent-akcent-ciemny">
      Klauzula HIV / WZW
    </label>
    <label class="flex items-center gap-3 cursor-pointer text-[15px]">
      <input type="checkbox" checked={miesiecy === 24}
             onchange={(e) => (miesiecy = e.currentTarget.checked ? 24 : 12)}
             class="w-4.5 h-4.5 accent-akcent-ciemny">
      Wypłata przez 24 miesiące zamiast 12
    </label>
  </div>

  <dl class="border-t border-linia m-0">
    <div class="flex items-baseline justify-between gap-4 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">Świadczenie z polisy</dt>
      <dd class="font-mono text-2xl font-semibold text-akcent-ciemny m-0">{zl(wynik.swiadczenie)}</dd>
    </div>
    <div class="flex items-baseline justify-between gap-4 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">Zasiłek ZUS przy najniższej podstawie</dt>
      <dd class="font-mono text-lg font-semibold text-alarm m-0">{zl(wynik.zus)}</dd>
    </div>
    <div class="flex items-baseline justify-between gap-4 py-4">
      <dt class="text-[15px] font-semibold">Szacowana składka miesięczna</dt>
      <dd class="font-mono text-2xl font-semibold m-0">{zl(wynik.skladka)}</dd>
    </div>
  </dl>

  <a href={zawod ? `/wniosek/?zawod=${encodeURIComponent(zawod)}` : '/wniosek/'}
     class="block text-center bg-akcent-ciemny text-white py-4 font-bold mt-2 hover:bg-akcent-hover">
    Przejdź do wniosku
  </a>

  <p class="text-[12.5px] leading-relaxed text-tekst-trzeci mt-4 mb-0">
    To jest symulacja, nie oferta. Realną składkę wylicza system ubezpieczyciela po ocenie
    ryzyka — może różnić się od tej kwoty. Zasiłek ZUS policzony od podstawy {zl(ZUS_MIESIECZNIE)}.
  </p>
</div>
