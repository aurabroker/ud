<script>
  /**
   * Kalkulator.svelte — symulacja składki.
   *
   * Kwoty: suma = dochód × limit, składka = suma × stawka. Stawka jest
   * policzona na ofertach, które naprawdę wystawiliśmy — patrz MODEL-SKLADKI.md.
   * Dlatego składka jest przedziałem, a nie jedną liczbą: rozrzut między
   * najniższą a najwyższą stawką bierze się z wieku, klasy ryzyka i okresu
   * wyczekiwania, o które kalkulator nie pyta.
   *
   * To jest SYMULACJA, nie oferta i nie stawka z tabeli ubezpieczyciela. Realną
   * składkę wylicza system ubezpieczyciela po ocenie ryzyka. Zastrzeżenie stoi
   * przy każdej kwocie i nie jest ozdobą — przedstawianie szacunku jak oferty
   * to spór z ustawą o dystrybucji ubezpieczeń.
   *
   * Tylko B2B / JDG (decyzja właściciela z 21.10.2026). Przełącznik „Umowa
   * o pracę" pokazywał obok etatu zasiłek przedsiębiorcy — na etacie zasiłek
   * zależy od pensji, więc jednej kwoty do pokazania nie ma. Etat dostaje
   * zdanie opisu, bez kwot.
   *
   * `zOdkladaniem` (tylko /kalkulator/, decyzja właściciela z 23.10.2026):
   * karta w dwóch kolumnach — obok składki od razu wynik odkładania
   * (Odkladanie.svelte) dla tego samego świadczenia. Strona może wtedy podać
   * dochód w adresie: ?dochod=30000, a dawne linki ?swiadczenie=14400 dają
   * dochód, z którego wychodzi to świadczenie.
   *
   * ── Dwa języki, jeden kalkulator ─────────────────────────────────────────
   *
   * Napisy stoją w `NAPISY` poniżej, po jednym zestawie na język; układ i cała
   * arytmetyka są wspólne. Osobny komponent ukraiński byłby kopią, a kopia
   * rozjeżdża się przy pierwszej zmianie, której ktoś nie powtórzy w dwóch
   * miejscach — tutaj oznaczałoby to dwie różne składki dla tego samego
   * dochodu. Zmieniasz zdanie po polsku — zmień jego odpowiednik niżej
   * (`test/uk.spec.js` pilnuje, że oba zestawy mają te same klucze).
   * Kwoty zostają w złotych w obu wersjach: polisa i dochód są w złotych.
   * Odkładanie (`zOdkladaniem`) istnieje tylko po polsku, na /kalkulator/.
   */
  import { onMount } from 'svelte';
  import { symuluj, zl, zlZakres, LIMIT, MIESIECY_WYPLATY, MIESIECY_MAX, OKRESY, OPIS_KALIBRACJI, ZAKRES_DOCHODU }
    from '../lib/symulacja';
  import { ZUS_TEKST, ZASILEK_JDG } from '../lib/zus';
  import { ZUS_TEKST_UK, OPIS_KALIBRACJI_UK } from '../lib/uk';
  import { wZakresie } from '../lib/odkladanie';
  import Odkladanie from './Odkladanie.svelte';

  let { dochodPoczatkowy = 18000, zawod = '', kompaktowy = false, zOdkladaniem = false, jezyk = 'pl' } = $props();

  let dochod = $state(dochodPoczatkowy);
  let hivWzw = $state(false);

  const { min: MIN, max: MAX, krok: KROK } = ZAKRES_DOCHODU;

  const wynik = $derived(symuluj({ dochod, hivWzw }));
  const procent = $derived(Math.round(((dochod - MIN) / (MAX - MIN)) * 100));
  const limitProcent = Math.round(LIMIT.b2b * 100);

  /** „24, 36, 48 albo 60" — bez przecinka przed ostatnim. */
  const okresy = (lacznik) => OKRESY.slice(0, -1).join(', ') + ` ${lacznik} ` + OKRESY.at(-1);

  const NAPISY = {
    pl: {
      naglowek: (z) => `Symulacja składki${z ? ` dla ${z}` : ''}`,
      wstep: 'Przesuń suwak, żeby zobaczyć, jak zmienia się świadczenie i szacowana składka.',
      dochod: 'Miesięczny dochód netto z działalności lub B2B',
      dochodAria: 'Miesięczny dochód netto z działalności lub kontraktu B2B, w złotych',
      suwak: (p) => `Suwak ustawiony na ${p}% zakresu.`,
      limit: (p) => `Polisa obejmuje do ${p}% udokumentowanego dochodu z działalności lub kontraktu B2B.`,
      etat: ZUS_TEKST.etat,
      klauzula: 'Klauzula HIV / WZW',
      swiadczenie: 'Świadczenie z polisy',
      swiadczenieOpis: `wypłacane co miesiąc, najdłużej przez ${MIESIECY_MAX} miesięcy`,
      zus: 'Zasiłek chorobowy z ZUS',
      zusOpis: `duży ZUS z chorobowym (${ZUS_TEKST.dopiski})`,
      skladka: 'Szacowana składka miesięczna',
      skladkaOpis: `wariant z wypłatą do ${MIESIECY_WYPLATY} miesięcy, razem z opłatą dystrybucyjną; `
        + 'przedział z ostatnio wystawionych ofert',
      przycisk: 'Przejdź do wniosku',
      wniosek: (z) => (z ? `/wniosek/?zawod=${encodeURIComponent(z)}` : '/wniosek/'),
      odkladanie: 'Wolisz odkładać samodzielnie? Policz, ile to potrwa',
      zastrzezenie: 'To jest symulacja, nie oferta. Realną składkę wylicza system ubezpieczyciela po ocenie '
        + `ryzyka — może różnić się od tej kwoty. Zasiłek ZUS to ${ZUS_TEKST.wzor}, `
        + `${ZUS_TEKST.scenariusz}. ${ZUS_TEKST.brutto}`,
      skad: `Przedział składki policzyliśmy ${OPIS_KALIBRACJI} — od najtańszej do najdroższej stawki, `
        + 'jaka w nich wystąpiła, razem z opłatą dystrybucyjną, którą płaci się w racie. '
        + 'Na Twoją składkę wpłyną wiek, klasa ryzyka Twojego zawodu, długość okresu wyczekiwania, '
        + 'o które ten kalkulator nie pyta.',
      okres: `Świadczenie wypłacane jest najdłużej przez ${okresy('albo')} miesięcy — okres wybierasz przy `
        + `zawarciu umowy. Powyższa składka dotyczy wariantu najkrótszego, ${MIESIECY_WYPLATY}-miesięcznego; `
        + 'dłuższy okres wypłaty podnosi składkę.',
    },
    uk: {
      naglowek: (z) => `Симуляція внеску${z ? ` для ${z}` : ''}`,
      wstep: 'Пересуньте повзунок, щоб побачити, як змінюються виплата й орієнтовний внесок.',
      dochod: 'Місячний дохід нетто від підприємницької діяльності або B2B',
      dochodAria: 'Місячний дохід нетто від підприємницької діяльності або контракту B2B, у злотих',
      suwak: (p) => `Повзунок встановлено на ${p}% діапазону.`,
      limit: (p) => `Поліс покриває до ${p}% підтвердженого документами доходу від підприємницької `
        + 'діяльності або контракту B2B.',
      etat: ZUS_TEKST_UK.etat,
      klauzula: 'Клаузула ВІЛ / вірусні гепатити (HIV / WZW)',
      swiadczenie: 'Виплата за полісом',
      swiadczenieOpis: `щомісяця, щонайдовше протягом ${MIESIECY_MAX} місяців`,
      zus: 'Допомога по хворобі від ZUS',
      zusOpis: `duży ZUS зі страхуванням на випадок хвороби (${ZUS_TEKST_UK.dopiski})`,
      skladka: 'Орієнтовний місячний внесок',
      skladkaOpis: `варіант із виплатою до ${MIESIECY_WYPLATY} місяців, разом із дистрибуційною оплатою; `
        + 'діапазон з останніх виставлених пропозицій',
      przycisk: 'Як подати заявку',
      // Formularz jest po polsku, więc przycisk prowadzi do przewodnika po nim,
      // a nie wprost do kreatora (patrz src/pages/uk/wniosek/).
      wniosek: () => '/uk/wniosek/',
      odkladanie: 'Волієте відкладати самостійно? Порахуйте, скільки це триватиме (польською)',
      zastrzezenie: 'Це симуляція, а не пропозиція. Реальний внесок розраховує система страховика після '
        + `оцінки ризику — він може відрізнятися від цієї суми. Допомога ZUS — це ${ZUS_TEKST_UK.wzor}, `
        + `${ZUS_TEKST_UK.scenariusz}. ${ZUS_TEKST_UK.brutto}`,
      skad: `Діапазон внеску ми порахували ${OPIS_KALIBRACJI_UK} — від найдешевшої до найдорожчої `
        + 'ставки, що в них траплялася, разом із дистрибуційною оплатою, яку сплачують у складі '
        + 'частини внеску. На ваш внесок вплинуть вік, клас ризику вашої професії та тривалість '
        + 'періоду очікування (okres wyczekiwania), про які цей калькулятор не питає.',
      okres: `Виплата триває щонайдовше ${okresy('або')} місяців — період ви обираєте під час `
        + `укладення договору. Наведений внесок стосується найкоротшого, ${MIESIECY_WYPLATY}-місячного `
        + 'варіанта; довший період виплати підвищує внесок.',
    },
  };

  const t = $derived(NAPISY[jezyk] ?? NAPISY.pl);

  onMount(() => {
    if (!zOdkladaniem) return;
    const q = new URLSearchParams(window.location.search);
    if (q.has('dochod')) dochod = wZakresie(q.get('dochod'), MIN, MAX, KROK, dochod);
    else if (q.has('swiadczenie')) {
      const s = wZakresie(q.get('swiadczenie'), 0, Infinity, 1, NaN);
      if (Number.isFinite(s)) dochod = wZakresie(s / LIMIT.b2b, MIN, MAX, KROK, dochod);
    }
  });
</script>

<div class="border border-linia bg-tlo p-7 {kompaktowy ? '' : 'shadow-[0_18px_46px_-16px_rgba(15,46,64,0.18)]'}
            {zOdkladaniem ? 'md:grid md:grid-cols-2 md:gap-x-8' : ''}">
<div>
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

  <div class="mb-5 text-[13px] leading-relaxed text-tekst-drugi">
    <p class="m-0">{t.limit(limitProcent)}</p>
    <p class="mt-1.5 mb-0" data-etat>{t.etat}</p>
  </div>

  <div class="mb-6">
    <label class="flex items-center gap-3 cursor-pointer text-[15px]">
      <input type="checkbox" bind:checked={hivWzw} class="w-4.5 h-4.5 accent-akcent-ciemny">
      {t.klauzula}
    </label>
  </div>

  <dl class="border-t border-linia m-0">
    <div class="flex items-baseline justify-between gap-4 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">
        {t.swiadczenie}<span class="sr-only">:</span>
        <span class="block text-[13px]">{t.swiadczenieOpis}</span>
      </dt>
      <dd class="font-mono text-2xl font-semibold text-akcent-ciemny m-0 whitespace-nowrap">{zl(wynik.swiadczenie)}</dd>
    </div>
    <div class="flex items-baseline justify-between gap-4 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">
        {t.zus}<span class="sr-only">:</span>
        <span class="block text-[13px]">{t.zusOpis}</span>
      </dt>
      <dd class="font-mono text-lg font-semibold text-alarm m-0 whitespace-nowrap">{zl(ZASILEK_JDG.duzy)}</dd>
    </div>
    <div class="flex items-baseline justify-between gap-4 py-4">
      <dt class="text-[15px] font-semibold">
        {t.skladka}<span class="sr-only">:</span>
        <span class="block text-[13px] font-normal text-tekst-drugi">{t.skladkaOpis}</span>
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
  {#if !zOdkladaniem}
    <!-- Odkładanie liczy tylko polska strona /kalkulator/ — z wersji ukraińskiej
         odnośnik mówi to wprost i niesie hreflang. -->
    <a href={`/kalkulator/?dochod=${dochod}#odkladanie`} data-odkladanie
       hreflang={jezyk === 'pl' ? undefined : 'pl'}
       class="block text-center text-[14px] text-akcent-tekst underline underline-offset-2 mt-3 hover:text-akcent-hover">
      {t.odkladanie}
    </a>
  {/if}
</div>
{#if zOdkladaniem}
  <div id="odkladanie" class="border-t border-linia mt-8 pt-7 md:border-t-0 md:mt-0 md:pt-0 md:border-l md:pl-8">
    <Odkladanie swiadczenie={wynik.swiadczenie} skladka={wynik.skladkaDo} />
  </div>
{/if}
<!-- Przypisy pod obiema kolumnami: na telefonie odkładanie stoi zaraz pod
     przyciskiem wniosku, a nie pod trzema akapitami drobnego druku. -->
<div class={zOdkladaniem ? 'md:col-span-2 border-t border-linia mt-8 pt-2' : ''}>
  <p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-4 mb-0">{t.zastrzezenie}</p>
  <p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-2.5 mb-0">{t.skad}</p>
  <p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-2.5 mb-0">{t.okres}</p>
</div>
</div>
