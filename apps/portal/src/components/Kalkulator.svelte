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
   */
  import { symuluj, zl, zlZakres, LIMIT, MIESIECY_WYPLATY, MIESIECY_MAX, OKRESY, OPIS_KALIBRACJI, ZAKRES_DOCHODU }
    from '../lib/symulacja';
  import { ZUS_TEKST, ZASILEK_JDG } from '../lib/zus';

  let { dochodPoczatkowy = 18000, zawod = '', kompaktowy = false } = $props();

  let dochod = $state(dochodPoczatkowy);
  let hivWzw = $state(false);

  const { min: MIN, max: MAX, krok: KROK } = ZAKRES_DOCHODU;

  const wynik = $derived(symuluj({ dochod, hivWzw }));
  const procent = $derived(Math.round(((dochod - MIN) / (MAX - MIN)) * 100));
  const limitProcent = Math.round(LIMIT.b2b * 100);

  /** „24, 36, 48 albo 60" — bez przecinka przed ostatnim. */
  const okresy = OKRESY.slice(0, -1).join(', ') + ' albo ' + OKRESY.at(-1);
</script>

<div class="border border-linia bg-tlo p-7 {kompaktowy ? '' : 'shadow-[0_18px_46px_-16px_rgba(15,46,64,0.18)]'}">
  <h2 class="text-xl m-0 mb-1">Symulacja składki{zawod ? ` dla ${zawod}` : ''}</h2>
  <p class="text-[14px] leading-relaxed text-tekst-drugi mt-0 mb-6">
    Przesuń suwak, żeby zobaczyć, jak zmienia się świadczenie i szacowana składka.
  </p>

  <label class="block mb-6">
    <span class="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
      <span class="text-sm font-semibold">Miesięczny dochód netto z działalności lub B2B</span>
      <output class="font-mono text-lg font-semibold text-akcent-ciemny">{zl(dochod)}</output>
    </span>
    <input type="range" min={MIN} max={MAX} step={KROK} bind:value={dochod}
           aria-label="Miesięczny dochód netto z działalności lub kontraktu B2B, w złotych"
           class="w-full accent-akcent-ciemny">
    <span class="flex justify-between font-mono text-[11px] text-tekst-trzeci mt-1.5">
      <span>{zl(MIN)}</span><span>{zl(MAX)}</span>
    </span>
    <span class="sr-only">Suwak ustawiony na {procent}% zakresu.</span>
  </label>

  <div class="mb-5 text-[13px] leading-relaxed text-tekst-drugi">
    <p class="m-0">
      Polisa obejmuje do {limitProcent}% udokumentowanego dochodu z działalności
      lub kontraktu B2B.
    </p>
    <p class="mt-1.5 mb-0" data-etat>{ZUS_TEKST.etat}</p>
  </div>

  <div class="mb-6">
    <label class="flex items-center gap-3 cursor-pointer text-[15px]">
      <input type="checkbox" bind:checked={hivWzw} class="w-4.5 h-4.5 accent-akcent-ciemny">
      Klauzula HIV / WZW
    </label>
  </div>

  <dl class="border-t border-linia m-0">
    <div class="flex items-baseline justify-between gap-4 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">
        Świadczenie z polisy
        <span class="block text-[13px]">wypłacane co miesiąc, najdłużej przez {MIESIECY_MAX} miesięcy</span>
      </dt>
      <dd class="font-mono text-2xl font-semibold text-akcent-ciemny m-0">{zl(wynik.swiadczenie)}</dd>
    </div>
    <div class="flex items-baseline justify-between gap-4 py-4 border-b border-linia-lekka">
      <dt class="text-[15px] text-tekst-drugi">
        Zasiłek chorobowy z ZUS
        <span class="block text-[13px]">duży ZUS z chorobowym; {ZUS_TEKST.dopiski}</span>
      </dt>
      <dd class="font-mono text-lg font-semibold text-alarm m-0 whitespace-nowrap">{zl(ZASILEK_JDG.duzy)}</dd>
    </div>
    <div class="flex items-baseline justify-between gap-4 py-4">
      <dt class="text-[15px] font-semibold">
        Szacowana składka miesięczna
        <span class="block text-[13px] font-normal text-tekst-drugi">
          wariant z wypłatą do {MIESIECY_WYPLATY} miesięcy, razem z opłatą dystrybucyjną;
          przedział z ostatnio wystawionych ofert
        </span>
      </dt>
      <dd class="font-mono text-2xl font-semibold m-0 whitespace-nowrap">
        {zlZakres(wynik.skladkaOd, wynik.skladkaDo)}
      </dd>
    </div>
  </dl>

  <a href={zawod ? `/wniosek/?zawod=${encodeURIComponent(zawod)}` : '/wniosek/'}
     class="block text-center bg-akcent-ciemny text-white py-4 font-bold mt-2 hover:bg-akcent-hover">
    Przejdź do wniosku
  </a>

  <p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-4 mb-0">
    To jest symulacja, nie oferta. Realną składkę wylicza system ubezpieczyciela po ocenie
    ryzyka — może różnić się od tej kwoty. Zasiłek ZUS to {ZUS_TEKST.wzor},
    {ZUS_TEKST.scenariusz}. {ZUS_TEKST.brutto}
  </p>
  <p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-2.5 mb-0">
    Przedział składki policzyliśmy {OPIS_KALIBRACJI} — od najtańszej do najdroższej stawki,
    jaka w nich wystąpiła, razem z opłatą dystrybucyjną, którą płaci się w racie.
    Na Twoją składkę wpłyną wiek, klasa ryzyka Twojego zawodu, długość okresu wyczekiwania,
    o które ten kalkulator nie pyta.
  </p>
  <p class="text-[12.5px] leading-relaxed text-tekst-drugi mt-2.5 mb-0">
    Świadczenie wypłacane jest najdłużej przez {okresy} miesięcy — okres wybierasz przy
    zawarciu umowy. Powyższa składka dotyczy wariantu najkrótszego, {MIESIECY_WYPLATY}-miesięcznego;
    dłuższy okres wypłaty podnosi składkę.
  </p>
</div>
