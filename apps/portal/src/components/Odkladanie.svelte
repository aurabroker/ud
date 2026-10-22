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
    miesiaceDoKwoty, odlozone, rownowartoscSlownie, czasSlownie, wZakresie,
  } from '../lib/odkladanie';
  import { liczebnik } from '@ud/zawody/liczebnik';

  /** Najwyższe świadczenie, jakie przyjmuje wniosek — z granice.ts, przez stronę. */
  let { maxSwiadczenie } = $props();

  /**
   * Jedna liczba z polem i suwakiem. `wartosc` idzie do rachunku i na suwak —
   * zawsze w zakresie. `tekst` to, co stoi w polu: w trakcie wpisywania bywa
   * pusty albo spoza zakresu, a wtedy rachunek i suwak trzymają ostatnią
   * dobrą wartość (zamiast skakać do wartości startowej). Po wyjściu z pola
   * tekst wraca do wartości, żeby pole i wynik mówiły to samo.
   */
  class Pole {
    wartosc = $state(0);
    tekst = $state(0);
    constructor(min, max, krok, start) {
      Object.assign(this, { min, max, krok });
      this.wartosc = start;
      this.tekst = start;
    }
    wpisano = (e) => {
      if (e.currentTarget.value === '') return;
      this.wartosc = wZakresie(e.currentTarget.value, this.min, this.max, this.krok, this.wartosc);
    };
    przesunieto = (e) => this.ustaw(e.currentTarget.value);
    popraw = () => {
      this.tekst = this.wartosc;
    };
    ustaw(v) {
      this.wartosc = wZakresie(v, this.min, this.max, this.krok, this.wartosc);
      this.tekst = this.wartosc;
    }
  }

  const kwota = new Pole(ZAKRES_ODKLADANIA.min, ZAKRES_ODKLADANIA.max, 1, PRZYKLAD.odkladam);
  const swiadczenie = new Pole(SWIADCZENIE_MIN, maxSwiadczenie, 1, PRZYKLAD.swiadczenie);
  const procent = new Pole(ZAKRES_PROCENTU.min, ZAKRES_PROCENTU.max, 0.1, 0);

  const o = $derived(kwota.wartosc);
  const s = $derived(swiadczenie.wartosc);
  const p = $derived(procent.wartosc);

  const naJeden = $derived(miesiaceDoKwoty(s, o, p));
  const naDwa = $derived(miesiaceDoKwoty(2 * s, o, p));
  const poRoku = $derived(odlozone(o, 12, p));
  const skladkaOd = $derived(Math.round(s * STAWKA.dol));
  const skladkaDo = $derived(Math.round(s * STAWKA.gora));

  const miesiecy = (n) => liczebnik(n, ['miesiąc', 'miesiące', 'miesięcy']);

  /**
   * Czytnik ekranu dostaje jedno zdanie podsumowania po chwili spokoju, nie
   * każdą zmianę liczby — suwak przesuwany strzałką dawałby komunikat na
   * każdy krok, a lista wyników bez etykiet nic by nie mówiła.
   */
  let komunikat = $state('');
  let pierwszy = true;
  $effect(() => {
    const tekst = `Odkładając ${zl(o)} miesięcznie: jeden miesiąc świadczenia — ${czasSlownie(naJeden)}, `
      + `dwa miesiące — ${czasSlownie(naDwa)}.`;
    if (pierwszy) {
      pierwszy = false;
      return;
    }
    const t = setTimeout(() => (komunikat = tekst), 900);
    return () => clearTimeout(t);
  });

  onMount(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has('odkladam')) kwota.ustaw(q.get('odkladam'));
    if (q.has('swiadczenie')) swiadczenie.ustaw(q.get('swiadczenie'));
  });

  const procentSlownie = (v) => `${String(v).replace('.', ',')}%`;
</script>

<div class="border border-linia bg-tlo p-7">
  <div class="grid gap-6 md:grid-cols-3">
    <div>
      <label for="od-kwota" class="block text-sm font-semibold mb-2">Ile możesz odkładać co miesiąc</label>
      <div class="flex items-center gap-2 mb-2">
        <input id="od-kwota" type="number" inputmode="numeric" min={kwota.min} max={kwota.max}
               bind:value={kwota.tekst} oninput={kwota.wpisano} onblur={kwota.popraw}
               class="w-full border border-linia-pole px-3 py-2 font-mono text-lg">
        <span class="text-tekst-drugi">zł</span>
      </div>
      <input type="range" min={kwota.min} max={kwota.max} step={ZAKRES_ODKLADANIA.krok}
             value={kwota.wartosc} oninput={kwota.przesunieto}
             aria-label="Kwota odkładana co miesiąc, w złotych"
             class="w-full accent-akcent-ciemny">
    </div>

    <div>
      <label for="od-swiadczenie" class="block text-sm font-semibold mb-2">Miesięczne świadczenie z polisy</label>
      <div class="flex items-center gap-2 mb-2">
        <input id="od-swiadczenie" type="number" inputmode="numeric" min={swiadczenie.min} max={swiadczenie.max}
               bind:value={swiadczenie.tekst} oninput={swiadczenie.wpisano} onblur={swiadczenie.popraw}
               class="w-full border border-linia-pole px-3 py-2 font-mono text-lg">
        <span class="text-tekst-drugi">zł</span>
      </div>
      <input type="range" min={swiadczenie.min} max={swiadczenie.max} step={SWIADCZENIE_KROK}
             value={swiadczenie.wartosc} oninput={swiadczenie.przesunieto}
             aria-label="Miesięczne świadczenie z polisy, w złotych"
             class="w-full accent-akcent-ciemny">
    </div>

    <div>
      <label for="od-procent" class="block text-sm font-semibold mb-2">Oprocentowanie oszczędności</label>
      <div class="flex items-center gap-2 mb-2">
        <input id="od-procent" type="number" inputmode="decimal" min={procent.min} max={procent.max}
               step={ZAKRES_PROCENTU.krok} bind:value={procent.tekst} oninput={procent.wpisano}
               onblur={procent.popraw}
               class="w-full border border-linia-pole px-3 py-2 font-mono text-lg">
        <span class="text-tekst-drugi">%</span>
      </div>
      <input type="range" min={procent.min} max={procent.max} step={ZAKRES_PROCENTU.krok}
             value={procent.wartosc} oninput={procent.przesunieto}
             aria-label="Oprocentowanie oszczędności rocznie, po podatku, w procentach"
             class="w-full accent-akcent-ciemny">
      <span class="block text-[13px] text-tekst-drugi mt-1">rocznie, po podatku</span>
    </div>
  </div>

  <!-- Kwoty z pól stoją też w opisach wyników: w pliku .md pól nie ma, a bez
       nich wynik „3 lata i 4 miesiące" nie mówiłby, przy jakiej wpłacie. -->
  <dl class="border-t border-linia mt-7 mb-0">
    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">
        Żeby odłożyć 1 miesiąc świadczenia<span class="sr-only">:</span>
        <span class="block text-[13px]">{zl(s)}, odkładając {zl(o)} miesięcznie</span>
      </dt>
      <dd class="font-mono text-xl font-bold text-alarm m-0" data-wynik="jeden">{czasSlownie(naJeden)}</dd>
    </div>
    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">
        Żeby odłożyć 2 miesiące świadczenia<span class="sr-only">:</span>
        <span class="block text-[13px]">{zl(2 * s)}, odkładając {zl(o)} miesięcznie</span>
      </dt>
      <dd class="font-mono text-xl font-bold text-alarm m-0" data-wynik="dwa">{czasSlownie(naDwa)}</dd>
    </div>
    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
      <dt class="text-[15px] text-tekst-drugi">
        Po roku odkładania {zl(o)} miesięcznie masz<span class="sr-only">:</span>
        <span class="block text-[13px]" data-rownowartosc>równowartość {rownowartoscSlownie(poRoku, s)} świadczenia</span>
      </dt>
      <dd class="font-mono text-xl font-bold m-0" data-wynik="rok">{zl(poRoku)}</dd>
    </div>
  </dl>
  <p class="sr-only" aria-live="polite">{komunikat}</p>

  <p class="text-[15px] leading-relaxed text-tekst-drugi mt-3 mb-0" data-skladka>
    Polisa z takim świadczeniem kosztuje szacunkowo <strong class="text-tekst whitespace-nowrap">{zlZakres(skladkaOd, skladkaDo)}</strong>
    miesięcznie, razem z opłatą dystrybucyjną, w wariancie z wypłatą najdłużej przez {miesiecy(MIESIECY_WYPLATY)}.
    Świadczenie {zl(s)} przychodzi co miesiąc po okresie wyczekiwania, dopóki trwa niezdolność objęta umową;
    dłuższy okres wypłaty, do {miesiecy(MIESIECY_MAX)}, podnosi składkę.
  </p>
  <p class="text-[13px] leading-relaxed text-tekst-drugi mt-3 mb-0" data-uczciwie>
    Odłożone pieniądze zostają Twoje — składka nie wraca, jeśli nic się nie stanie. Świadczenie
    przysługuje po okresie wyczekiwania ustalonym w umowie i tylko przy niezdolności objętej
    umową (<a href="/wylaczenia/" class="underline underline-offset-2 hover:text-akcent-tekst">wyłączenia</a>).
    Symulacja, nie oferta: wpłata na koniec każdego miesiąca, odsetki {procentSlownie(p)} rocznie,
    bez inflacji, a składka to przedział z ostatnio wystawionych ofert.
  </p>
</div>
