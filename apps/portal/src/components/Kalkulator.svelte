<script>
  /**
   * Kalkulator.svelte — symulacja składki.
   *
   * Kwoty: suma = dochód × limit, składka = suma × stawka. Stawka jest
   * policzona na ofertach, które naprawdę wystawiliśmy — patrz MODEL-SKLADKI.md.
   * Dlatego składka jest przedziałem, a nie jedną liczbą: rozrzut między
   * najtańszą a najdroższą ofertą bierze się z wieku, klasy ryzyka i karencji,
   * o które kalkulator nie pyta.
   *
   * To jest SYMULACJA, nie oferta i nie stawka z tabeli ubezpieczyciela. Realną
   * składkę wylicza system ubezpieczyciela po ocenie ryzyka. Zastrzeżenie stoi
   * przy każdej kwocie i nie jest ozdobą — przedstawianie szacunku jak oferty
   * to spór z ustawą o dystrybucji ubezpieczeń.
   *
   * ── Dwa języki, jeden kalkulator ─────────────────────────────────────────
   *
   * Napisy stoją w `NAPISY` poniżej, po jednym zestawie na język; układ i cała
   * arytmetyka są wspólne. Osobny komponent ukraiński byłby kopią, a kopia
   * rozjeżdża się przy pierwszej zmianie, której ktoś nie powtórzy w dwóch
   * miejscach — tutaj oznaczałoby to dwie różne składki dla tego samego
   * dochodu. Zmieniasz zdanie po polsku — zmień jego odpowiednik niżej.
   * Kwoty zostają w złotych w obu wersjach: polisa i dochód są w złotych.
   */
  import { symuluj, zl, zlZakres, ZUS_MIESIECZNIE, LIMIT, MIESIECY_WYPLATY, OKRESY }
    from '../lib/symulacja';

  let { dochodPoczatkowy = 18000, zawod = '', kompaktowy = false, jezyk = 'pl' } = $props();

  let dochod = $state(dochodPoczatkowy);
  let zatrudnienie = $state('b2b');
  let hivWzw = $state(false);

  const MIN = 3000;
  const MAX = 60000;
  const KROK = 500;

  const wynik = $derived(symuluj({ dochod, zatrudnienie, hivWzw }));
  const procent = $derived(Math.round(((dochod - MIN) / (MAX - MIN)) * 100));
  const limitProcent = $derived(Math.round(LIMIT[zatrudnienie] * 100));

  /** „24, 36, 48 albo 60" — bez przecinka przed ostatnim. */
  const okresy = (lacznik) => OKRESY.slice(0, -1).join(', ') + ` ${lacznik} ` + OKRESY.at(-1);

  const NAPISY = {
    pl: {
      naglowek: (z) => `Symulacja składki${z ? ` dla ${z}` : ''}`,
      wstep: 'Przesuń suwak, żeby zobaczyć, jak zmienia się świadczenie i szacowana składka.',
      dochod: 'Miesięczny dochód netto',
      dochodAria: 'Miesięczny dochód netto w złotych',
      suwak: (p) => `Suwak ustawiony na ${p}% zakresu.`,
      forma: 'Forma zatrudnienia',
      formy: [['b2b', 'B2B / JDG'], ['etat', 'Umowa o pracę']],
      limit: (p) => `Polisa obejmuje do ${p}% udokumentowanego dochodu przy tej formie zatrudnienia.`,
      klauzula: 'Klauzula HIV / WZW',
      swiadczenie: 'Świadczenie z polisy',
      swiadczenieOpis: `wypłacane co miesiąc, minimum przez ${MIESIECY_WYPLATY} miesiące`,
      zus: 'Zasiłek ZUS przy najniższej podstawie',
      skladka: 'Szacowana składka miesięczna',
      skladkaOpis: 'przedział z ostatnio wystawionych ofert',
      przycisk: 'Przejdź do wniosku',
      wniosek: (z) => (z ? `/wniosek/?zawod=${encodeURIComponent(z)}` : '/wniosek/'),
      zastrzezenie: `To jest symulacja, nie oferta. Realną składkę wylicza system ubezpieczyciela po ocenie
    ryzyka — może różnić się od tej kwoty. Zasiłek ZUS policzony od podstawy ${zl(ZUS_MIESIECZNIE)}.`,
      skad: `Przedział składki policzyliśmy ze wszystkich wariantów we wszystkich ofertach, które
    naprawdę wystawiliśmy — od najtańszej do najdroższej stawki, jaka w nich wystąpiła.
    Na Twoją składkę wpłyną wiek, klasa ryzyka Twojego zawodu, długość okresu wyczekiwania,
    o które ten kalkulator nie pyta.`,
      okres: `Świadczenie wypłacane jest przez ${okresy('albo')} miesięcy — okres wybierasz przy zawarciu
    umowy. Powyższa składka dotyczy wariantu najkrótszego, ${MIESIECY_WYPLATY}-miesięcznego;
    dłuższy okres wypłaty podnosi składkę.`,
    },
    uk: {
      naglowek: (z) => `Симуляція внеску${z ? ` для ${z}` : ''}`,
      wstep: 'Пересуньте повзунок, щоб побачити, як змінюються виплата й орієнтовний внесок.',
      dochod: 'Місячний дохід нетто',
      dochodAria: 'Місячний дохід нетто у злотих',
      suwak: (p) => `Повзунок встановлено на ${p}% діапазону.`,
      forma: 'Форма зайнятості',
      formy: [['b2b', 'B2B / JDG'], ['etat', 'Трудовий договір']],
      limit: (p) => `Поліс покриває до ${p}% підтвердженого документами доходу за цієї форми зайнятості.`,
      klauzula: 'Клаузула ВІЛ / вірусні гепатити (HIV / WZW)',
      swiadczenie: 'Виплата за полісом',
      swiadczenieOpis: `щомісяця, щонайменше протягом ${MIESIECY_WYPLATY} місяців`,
      zus: 'Допомога по хворобі від ZUS за найнижчої бази',
      skladka: 'Орієнтовний місячний внесок',
      skladkaOpis: 'діапазон з останніх виставлених пропозицій',
      przycisk: 'Як подати заявку',
      // Formularz jest po polsku, więc przycisk prowadzi do przewodnika po nim,
      // a nie wprost do kreatora (patrz src/pages/uk/wniosek/).
      wniosek: () => '/uk/wniosek/',
      zastrzezenie: `Це симуляція, а не пропозиція. Реальний внесок розраховує система страховика
    після оцінки ризику — він може відрізнятися від цієї суми. Допомогу ZUS пораховано
    від бази ${zl(ZUS_MIESIECZNIE)}.`,
      skad: `Діапазон внеску ми порахували з усіх варіантів у всіх пропозиціях, які справді
    виставили, — від найдешевшої до найдорожчої ставки, що в них траплялася. На ваш внесок
    вплинуть вік, клас ризику вашої професії та тривалість періоду очікування (okres
    wyczekiwania), про які цей калькулятор не питає.`,
      okres: `Виплата триває ${okresy('або')} місяців — період ви обираєте під час укладення
    договору. Наведений внесок стосується найкоротшого, ${MIESIECY_WYPLATY}-місячного варіанта;
    довший період виплати підвищує внесок.`,
    },
  };

  const t = $derived(NAPISY[jezyk] ?? NAPISY.pl);
</script>

<div class="border border-linia bg-tlo p-7 {kompaktowy ? '' : 'shadow-[0_18px_46px_-16px_rgba(15,46,64,0.18)]'}">
  <h2 class="text-xl m-0 mb-1">{t.naglowek(zawod)}</h2>
  <p class="text-[14px] leading-relaxed text-tekst-drugi mt-0 mb-6">
    {t.wstep}
  </p>

  <label class="block mb-6">
    <span class="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
      <span class="text-sm font-semibold">{t.dochod}</span>
      <output class="font-mono text-lg font-semibold text-akcent-ciemny">{zl(dochod)}</output>
    </span>
    <input type="range" min={MIN} max={MAX} step={KROK} bind:value={dochod}
           aria-label={t.dochodAria}
           class="w-full accent-akcent-ciemny">
    <span class="flex justify-between font-mono text-[11px] text-tekst-trzeci mt-1.5">
      <span>{zl(MIN)}</span><span>{zl(MAX)}</span>
    </span>
    <span class="sr-only">{t.suwak(procent)}</span>
  </label>

  <fieldset class="border-0 p-0 m-0 mb-5">
    <legend class="text-sm font-semibold mb-2">{t.forma}</legend>
    <div class="grid grid-cols-2 gap-2">
      {#each t.formy as [w, e]}
        <label class="flex items-center justify-center gap-2 border p-3 cursor-pointer text-[15px] text-center
                      {zatrudnienie === w ? 'border-akcent bg-tlo-jasne font-semibold' : 'border-linia'}">
          <input type="radio" name="zatrudnienie" value={w} bind:group={zatrudnienie} class="sr-only">
          {e}
        </label>
      {/each}
    </div>
    <p class="text-[13px] leading-relaxed text-tekst-trzeci mt-2 mb-0">
      {t.limit(limitProcent)}
    </p>
  </fieldset>

  <div class="mb-6">
    <label class="flex items-center gap-3 cursor-pointer text-[15px]">
      <input type="checkbox" bind:checked={hivWzw} class="w-4.5 h-4.5 accent-akcent-ciemny shrink-0">
      {t.klauzula}
    </label>
  </div>

  <dl class="border-t border-linia m-0">
    <div class="flex items-baseline justify-between gap-4 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">
        {t.swiadczenie}
        <span class="block text-[13px]">{t.swiadczenieOpis}</span>
      </dt>
      <dd class="font-mono text-2xl font-semibold text-akcent-ciemny m-0 whitespace-nowrap">{zl(wynik.swiadczenie)}</dd>
    </div>
    <div class="flex items-baseline justify-between gap-4 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">{t.zus}</dt>
      <dd class="font-mono text-lg font-semibold text-alarm m-0 whitespace-nowrap">{zl(wynik.zus)}</dd>
    </div>
    <div class="flex items-baseline justify-between gap-4 py-4">
      <dt class="text-[15px] font-semibold">
        {t.skladka}
        <span class="block text-[13px] font-normal text-tekst-drugi">
          {t.skladkaOpis}
        </span>
      </dt>
      <dd class="font-mono text-2xl font-semibold m-0 whitespace-nowrap">
        {zlZakres(wynik.skladkaOd, wynik.skladkaDo)}
      </dd>
    </div>
  </dl>

  <a href={t.wniosek(zawod)}
     class="block text-center bg-akcent-ciemny text-white py-4 font-bold mt-2 hover:bg-akcent-hover">
    {t.przycisk}
  </a>

  <p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-4 mb-0">
    {t.zastrzezenie}
  </p>
  <p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-2.5 mb-0">
    {t.skad}
  </p>
  <p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-2.5 mb-0">
    {t.okres}
  </p>
</div>
