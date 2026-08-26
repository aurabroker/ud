<script>
  /**
   * Wniosek.svelte — kreator w czterech krokach.
   *
   * Wyspa: strona jest statyczna, ta jedna wysepka jest interaktywna. Ładuje się
   * dopiero, gdy wejdzie w pole widzenia (client:visible), więc nie kosztuje
   * niczego przy pierwszym renderze i nie psuje LCP.
   *
   * Cała logika, co jest wymagane i kiedy, siedzi w @ud/wniosek — panel czyta
   * ten sam plik. Ten komponent odpowiada wyłącznie za wyświetlenie i za to,
   * żeby wysyłka nie zgubiła klienta przy błędzie sieci.
   */
  import { tick } from 'svelte';
  import {
    KROKI, RYZYKA, KLAUZULE_NW, PYTANIA_MEDYCZNE, AKTYWNOSCI_RYZYKOWNE,
    FORMY_ZATRUDNIENIA, FORMY_OPODATKOWANIA, LIMIT_DOCHODU,
    HEALTH_SURVEY_GROUPS, HEALTH_SURVEY_THRESHOLD,
    sprawdzKrok, ankietaRozszerzona, doWysylki,
  } from '@ud/wniosek';

  let { zawody = [], zawodPoczatkowy = '', urlFunkcji, kluczTurnstile } = $props();

  let krok = $state(0);
  let dane = $state({
    fullName: '', pesel: '', employmentType: 'b2b', profession: zawodPoczatkowy,
    weight: '', height: '', handedness: '', taxForm: '', employsPeople: false,
    emp_contribution_slider: 50,
    ...Object.fromEntries(RYZYKA.map((r) => [r.klucz, false])),
    ...Object.fromEntries(RYZYKA.map((r) => [r.poleSumy, ''])),
    ...Object.fromEntries(KLAUZULE_NW.map((k) => [k.klucz, 0])),
    ...Object.fromEntries(PYTANIA_MEDYCZNE.map((p) => [p.klucz, 'no'])),
    ...Object.fromEntries(PYTANIA_MEDYCZNE.map((p) => [`${p.klucz}_notes`, ''])),
    ...Object.fromEntries(AKTYWNOSCI_RYZYKOWNE.map((a) => [a.klucz, false])),
    email: '', phone: '', exclusions_accepted: false, informedAccepted: false,
  });
  let bledy = $state({});
  let wysylanie = $state(false);
  let bladWysylki = $state('');

  /** Uchwyt widgetu Turnstile — potrzebny do reset() po nieudanej wysyłce. */
  let widgetTurnstile = null;
  let kontenerTurnstile = $state(null);

  const idKroku = $derived(KROKI[krok].id);
  const rozszerzona = $derived(ankietaRozszerzona(dane));
  const limit = $derived(LIMIT_DOCHODU[dane.employmentType] ?? 0.8);

  /** Pierwsze pole z błędem — do przewinięcia i ustawienia fokusu. */
  function pokazPierwszyBlad() {
    const pole = Object.keys(bledy)[0];
    if (!pole) return;
    const el = document.querySelector(`[name="${pole}"], [data-pole="${pole}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus?.({ preventScroll: true });
  }

  function dalej() {
    bledy = sprawdzKrok(idKroku, dane);
    if (Object.keys(bledy).length > 0) { pokazPierwszyBlad(); return; }
    if (krok < KROKI.length - 1) {
      krok += 1;
      document.getElementById('wniosek-gora')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function wstecz() {
    bledy = {};
    if (krok > 0) krok -= 1;
    document.getElementById('wniosek-gora')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function zl(n) {
    return new Intl.NumberFormat('pl-PL').format(n) + ' zł';
  }

  /**
   * Turnstile renderujemy JAWNIE, a nie przez automatyczne skanowanie DOM.
   *
   * Skrypt api.js szuka elementów .cf-turnstile raz, przy wczytaniu. Kontener
   * z ostatniego kroku powstaje później — dopiero gdy użytkownik do niego dojdzie
   * — więc automat nigdy by go nie zobaczył i przycisk „Wyślij" byłby martwy.
   * Stąd render=explicit w adresie skryptu i wywołanie render() stąd.
   */
  function zamontujTurnstile() {
    if (!kontenerTurnstile || widgetTurnstile !== null) return;
    if (!window.turnstile?.render) return;   // skrypt jeszcze nie doszedł
    widgetTurnstile = window.turnstile.render(kontenerTurnstile, {
      sitekey: kluczTurnstile,
      language: 'pl',
    });
  }

  /**
   * Token jest jednorazowy. Po nieudanej próbie trzeba go odświeżyć, bo inaczej
   * kolejne kliknięcie „Wyślij" leci ze zużytym tokenem i dostaje odmowę
   * weryfikacji — dokładnie tak formularz kontaktowy stał martwy 74 dni.
   */
  function odswiezTurnstile() {
    if (widgetTurnstile !== null) {
      try { window.turnstile.reset(widgetTurnstile); } catch { /* widget zniknął */ }
    }
  }

  /** Montujemy widget, gdy kontener pojawi się w DOM-ie. */
  $effect(() => {
    if (idKroku !== 'zgody' || !kontenerTurnstile) return;
    zamontujTurnstile();
    if (widgetTurnstile !== null) return;
    // Skrypt Cloudflare jest async — dokładamy się do jego kolejki onload.
    window.onloadTurnstileCallback = () => zamontujTurnstile();
  });

  async function wyslij(e) {
    e.preventDefault();
    bledy = sprawdzKrok('zgody', dane);
    if (Object.keys(bledy).length > 0) { pokazPierwszyBlad(); return; }

    const token = widgetTurnstile !== null
      ? window.turnstile?.getResponse(widgetTurnstile)
      : null;
    if (!token) {
      bladWysylki = 'Potwierdź, że nie jesteś robotem.';
      return;
    }

    wysylanie = true;
    bladWysylki = '';
    try {
      const res = await fetch(urlFunkcji, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...doWysylki(dane), 'cf-turnstile-response': token }),
      });
      const wynik = await res.json().catch(() => ({}));
      if (res.ok && wynik.status !== 'error') {
        window.location.href = '/podziekowanie/';
        return;
      }
      throw new Error(wynik.message || `HTTP ${res.status}`);
    } catch (err) {
      // Nieudany wniosek to stracony klient, więc zamiast suchego komunikatu
      // dajemy telefon — modal awarii, jeśli się wczytał, robi to samo ładniej.
      bladWysylki = String(err?.message ?? err);
      odswiezTurnstile();
      window.Awaria?.pokaz({ kod: 'WNIOSEK_WYSYLKA', szczegoly: err });
    } finally {
      wysylanie = false;
    }
  }
</script>

<div id="wniosek-gora" class="scroll-mt-6">
  <!-- Pasek kroków. aria-current mówi czytnikowi, gdzie stoimy. -->
  <ol class="grid grid-cols-2 sm:grid-cols-4 gap-3 list-none m-0 p-0 mb-10">
    {#each KROKI as k, i}
      <li class="border-t-2 pt-3
                 {i < krok ? 'border-akcent' : i === krok ? 'border-akcent-ciemny' : 'border-linia'}">
        <span class="font-mono text-[11px] tracking-[0.12em] uppercase
                     {i <= krok ? 'text-akcent-ciemny' : 'text-tekst-trzeci'}">
          Krok {i + 1} z {KROKI.length}
        </span>
        <span class="block mt-1 text-[15.5px] {i === krok ? 'font-bold' : 'font-medium text-tekst-drugi'}"
              aria-current={i === krok ? 'step' : undefined}>{k.tytul}</span>
      </li>
    {/each}
  </ol>

  <form onsubmit={wyslij} novalidate>

    <!-- ── KROK 1 ────────────────────────────────────────────────────── -->
    {#if idKroku === 'dane'}
      <fieldset class="border-0 p-0 m-0">
        <legend class="sr-only">Dane podstawowe</legend>

        <div class="grid gap-5 sm:grid-cols-2">
          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Imię i nazwisko</span>
            <input name="fullName" bind:value={dane.fullName} autocomplete="name"
                   aria-invalid={!!bledy.fullName} aria-describedby={bledy.fullName ? 'e-fullName' : undefined}
                   class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
            {#if bledy.fullName}<span id="e-fullName" class="block text-[13px] text-alarm mt-1.5">{bledy.fullName}</span>{/if}
          </label>

          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">PESEL</span>
            <input name="pesel" bind:value={dane.pesel} inputmode="numeric" maxlength="11" autocomplete="off"
                   aria-invalid={!!bledy.pesel} aria-describedby={bledy.pesel ? 'e-pesel' : undefined}
                   class="w-full border border-linia p-3 bg-tlo font-mono focus:border-akcent">
            {#if bledy.pesel}<span id="e-pesel" class="block text-[13px] text-alarm mt-1.5">{bledy.pesel}</span>{/if}
          </label>

          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Forma zatrudnienia</span>
            <select name="employmentType" bind:value={dane.employmentType}
                    class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
              {#each FORMY_ZATRUDNIENIA as f}<option value={f.wartosc}>{f.etykieta}</option>{/each}
            </select>
            <span class="block text-[13px] text-tekst-trzeci mt-1.5">
              Świadczenie obejmie do {Math.round(limit * 100)}% udokumentowanego dochodu.
            </span>
          </label>

          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Zawód</span>
            <input name="profession" bind:value={dane.profession} list="lista-zawodow" autocomplete="off"
                   placeholder="Wpisz lub wybierz z listy"
                   aria-invalid={!!bledy.profession} aria-describedby={bledy.profession ? 'e-profession' : undefined}
                   class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
            <datalist id="lista-zawodow">
              {#each zawody as z}<option value={z}></option>{/each}
            </datalist>
            {#if bledy.profession}<span id="e-profession" class="block text-[13px] text-alarm mt-1.5">{bledy.profession}</span>{/if}
          </label>

          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Waga (kg)</span>
            <input name="weight" type="number" min="30" max="300" bind:value={dane.weight}
                   class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
          </label>

          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Wzrost (cm)</span>
            <input name="height" type="number" min="100" max="250" bind:value={dane.height}
                   class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
          </label>

          <label class="block sm:col-span-2">
            <span class="block text-sm font-semibold mb-1.5">Forma opodatkowania</span>
            <select name="taxForm" bind:value={dane.taxForm}
                    class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
              <option value="">— wybierz —</option>
              {#each FORMY_OPODATKOWANIA as f}<option value={f.wartosc}>{f.etykieta}</option>{/each}
            </select>
          </label>
        </div>

        <fieldset class="border-0 p-0 mt-6">
          <legend class="text-sm font-semibold mb-2">Ręczność</legend>
          <div class="flex gap-8">
            {#each [['prawy', 'Praworęczny/a'], ['lewy', 'Leworęczny/a']] as [w, e]}
              <label class="flex items-center gap-2.5 cursor-pointer">
                <input type="radio" name="handedness" value={w} bind:group={dane.handedness} class="w-4 h-4 accent-akcent-ciemny">
                <span class="text-[15px]">{e}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <label class="flex items-start gap-3.5 mt-7 border border-linia-mocna bg-tlo-jasne p-5 cursor-pointer">
          <input type="checkbox" name="employsPeople" bind:checked={dane.employsPeople}
                 class="w-5 h-5 mt-0.5 accent-akcent-ciemny shrink-0">
          <span>
            <span class="block font-bold">Prowadzę działalność i zatrudniam pracowników</span>
            <span class="block text-[14px] text-tekst-drugi mt-1">
              Ubezpieczyciel liczy wtedy Twój wkład w przychód firmy osobno — dojdzie kilka pól.
            </span>
          </span>
        </label>

        {#if dane.employsPeople}
          <div class="border border-linia p-6 mt-4 grid gap-5 sm:grid-cols-2">
            <label class="block">
              <span class="block text-sm font-semibold mb-1.5">Data rozpoczęcia działalności</span>
              <input name="emp_startDate" type="date" bind:value={dane.emp_startDate}
                     class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
            </label>
            <label class="block">
              <span class="block text-sm font-semibold mb-1.5">Branża</span>
              <input name="emp_industry" bind:value={dane.emp_industry}
                     class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
            </label>
            <label class="block">
              <span class="block text-sm font-semibold mb-1.5">Pracownicy — rok ubiegły</span>
              <input name="emp_count_2024" type="number" min="0" bind:value={dane.emp_count_2024}
                     class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
            </label>
            <label class="block">
              <span class="block text-sm font-semibold mb-1.5">Pracownicy — obecnie</span>
              <input name="emp_count_current" type="number" min="0" bind:value={dane.emp_count_current}
                     class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
            </label>
            <label class="block sm:col-span-2">
              <span class="block text-sm font-semibold mb-1.5">
                Mój wkład w przychód firmy: <strong class="text-akcent-ciemny">{dane.emp_contribution_slider}%</strong>
              </span>
              <input name="emp_contribution_slider" type="range" min="0" max="100"
                     bind:value={dane.emp_contribution_slider} class="w-full accent-akcent-ciemny">
            </label>
            <label class="block sm:col-span-2">
              <span class="block text-sm font-semibold mb-1.5">Opis roli (opcjonalnie)</span>
              <textarea name="emp_description" rows="2" bind:value={dane.emp_description}
                        placeholder="Np. ja wykonuję zabiegi, pracownicy zajmują się recepcją."
                        class="w-full border border-linia p-3 bg-tlo resize-none focus:border-akcent"></textarea>
            </label>
          </div>
        {/if}
      </fieldset>
    {/if}

    <!-- ── KROK 2 ────────────────────────────────────────────────────── -->
    {#if idKroku === 'zakres'}
      <fieldset class="border-0 p-0 m-0">
        <legend class="sr-only">Zakres ochrony</legend>

        {#if bledy.ryzyka}
          <p role="alert" data-pole="ryzyka" tabindex="-1"
             class="border border-alarm bg-tlo p-4 text-[15px] text-alarm m-0 mb-5">{bledy.ryzyka}</p>
        {/if}

        <div class="flex flex-col gap-4">
          {#each RYZYKA as r}
            <div class="border p-5 {dane[r.klucz] ? 'border-akcent bg-tlo-jasne' : 'border-linia'}">
              <label class="flex items-start gap-3.5 cursor-pointer">
                <input type="checkbox" name={r.klucz} bind:checked={dane[r.klucz]}
                       class="w-5 h-5 mt-0.5 accent-akcent-ciemny shrink-0">
                <span>
                  <span class="block font-bold text-[16.5px]">{r.etykieta}</span>
                  <span class="block font-mono text-[11px] tracking-[0.1em] uppercase text-tekst-trzeci mt-1">{r.rodzaj}</span>
                </span>
              </label>

              {#if dane[r.klucz]}
                <label class="block mt-4 pl-8.5">
                  <span class="block text-sm font-semibold mb-1.5">
                    {r.rodzaj === 'Miesięczne świadczenie' ? 'Kwota miesięczna (zł)' : 'Suma ubezpieczenia (zł)'}
                  </span>
                  <input name={r.poleSumy} type="number" min="0" step="1000" bind:value={dane[r.poleSumy]}
                         aria-invalid={!!bledy[r.poleSumy]}
                         class="w-full max-w-xs border border-linia p-3 bg-tlo font-mono focus:border-akcent">
                  <span class="block text-[13px] text-tekst-trzeci mt-1.5">
                    {r.podpowiedz.replace('{limit}', String(Math.round(limit * 100)))}
                  </span>
                  {#if bledy[r.poleSumy]}<span class="block text-[13px] text-alarm mt-1.5">{bledy[r.poleSumy]}</span>{/if}
                </label>
              {/if}
            </div>
          {/each}
        </div>

        {#if rozszerzona}
          <p class="border-l-2 border-akcent bg-tlo-jasne p-4 mt-5 text-[15px] leading-relaxed text-tekst-drugi m-0">
            Suma trwałej niezdolności przekracza {zl(HEALTH_SURVEY_THRESHOLD)}, więc w następnym kroku
            ubezpieczyciel wymaga rozszerzonej ankiety zdrowotnej. To dłuższa lista pytań, ale nadal
            tylko „tak" albo „nie" — opis potrzebny jest wyłącznie przy odpowiedzi twierdzącej.
          </p>
        {/if}

        <h3 class="text-xl mt-10 mb-4">Klauzule dodatkowe</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          {#each KLAUZULE_NW as k}
            <label class="block">
              <span class="block text-sm font-semibold mb-1.5">{k.etykieta}</span>
              <select name={k.klucz} bind:value={dane[k.klucz]}
                      class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
                {#each k.kwoty as kw}
                  <option value={kw}>
                    {kw === 0 ? 'Nie wybieram' : zl(kw) + (k.naDzien ? ' / dzień' : k.naTydzien ? ' / tydzień' : '')}
                  </option>
                {/each}
              </select>
            </label>
          {/each}
        </div>
      </fieldset>
    {/if}

    <!-- ── KROK 3 ────────────────────────────────────────────────────── -->
    {#if idKroku === 'zdrowie'}
      <fieldset class="border-0 p-0 m-0">
        <legend class="sr-only">Stan zdrowia</legend>
        <p class="text-[16px] leading-relaxed text-tekst-drugi mt-0 mb-6">
          Odpowiadaj szczerze. Zatajenie choroby nie oszczędza składki — pozwala ubezpieczycielowi
          odmówić wypłaty w momencie, w którym będzie potrzebna najbardziej.
        </p>

        <div class="flex flex-col gap-3">
          {#each PYTANIA_MEDYCZNE as p, i}
            <div class="border border-linia p-4">
              <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 justify-between">
                <span class="text-[15.5px]"><span class="text-tekst-trzeci">{i + 1}.</span> {p.etykieta}</span>
                <div class="flex gap-5 shrink-0">
                  {#each [['yes', 'Tak'], ['no', 'Nie']] as [w, e]}
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name={p.klucz} value={w} bind:group={dane[p.klucz]}
                             class="w-4 h-4 accent-akcent-ciemny">
                      <span class="text-[15px]">{e}</span>
                    </label>
                  {/each}
                </div>
              </div>
              {#if dane[p.klucz] === 'yes'}
                <label class="block mt-4">
                  <span class="block text-sm font-semibold mb-1.5">Opisz krótko, czego dotyczy</span>
                  <textarea name={`${p.klucz}_notes`} rows="2" bind:value={dane[`${p.klucz}_notes`]}
                            aria-invalid={!!bledy[`${p.klucz}_notes`]}
                            class="w-full border border-linia p-3 bg-tlo resize-none focus:border-akcent"></textarea>
                  {#if bledy[`${p.klucz}_notes`]}
                    <span class="block text-[13px] text-alarm mt-1.5">{bledy[`${p.klucz}_notes`]}</span>
                  {/if}
                </label>
              {/if}
            </div>
          {/each}
        </div>

        {#if rozszerzona}
          <div class="mt-10">
            <h3 class="text-xl mb-2">Ankieta rozszerzona</h3>
            <p class="text-[15px] leading-relaxed text-tekst-drugi mt-0 mb-5">
              Wymagana, bo suma trwałej niezdolności przekracza {zl(HEALTH_SURVEY_THRESHOLD)}.
            </p>
            {#each HEALTH_SURVEY_GROUPS as grupa}
              <fieldset class="border-0 p-0 mb-7">
                <legend class="font-mono text-[11px] tracking-[0.12em] uppercase text-akcent-ciemny font-semibold mb-3">
                  {grupa.title}
                </legend>
                <div class="flex flex-col gap-2.5">
                  {#each grupa.items as poz}
                    <div class="border border-linia p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 justify-between">
                      <span class="text-[15px] leading-relaxed">{poz.label}</span>
                      <div class="flex gap-5 shrink-0">
                        {#each [['yes', 'Tak'], ['no', 'Nie']] as [w, e]}
                          <label class="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name={poz.key} value={w} bind:group={dane[poz.key]}
                                   class="w-4 h-4 accent-akcent-ciemny">
                            <span class="text-[15px]">{e}</span>
                          </label>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              </fieldset>
            {/each}
          </div>
        {/if}

        <fieldset class="border-0 p-0 mt-10">
          <legend class="text-xl mb-2" style="font-family: var(--font-naglowek);">Aktywności podwyższonego ryzyka</legend>
          <p class="text-[15px] leading-relaxed text-tekst-drugi mt-0 mb-5">
            Zaznacz, co uprawiasz regularnie. Nie wyklucza to z ochrony — wpływa na ocenę ryzyka.
          </p>
          <div class="grid gap-2.5 sm:grid-cols-2">
            {#each AKTYWNOSCI_RYZYKOWNE as a}
              <label class="flex items-center gap-3 border border-linia p-3.5 cursor-pointer
                            {dane[a.klucz] ? 'border-akcent bg-tlo-jasne' : ''}">
                <input type="checkbox" name={a.klucz} bind:checked={dane[a.klucz]}
                       class="w-4.5 h-4.5 accent-akcent-ciemny shrink-0">
                <span class="text-[15px]">{a.etykieta}</span>
              </label>
            {/each}
          </div>
        </fieldset>
      </fieldset>
    {/if}

    <!-- ── KROK 4 ────────────────────────────────────────────────────── -->
    {#if idKroku === 'zgody'}
      <fieldset class="border-0 p-0 m-0">
        <legend class="sr-only">Zgody i kontakt</legend>

        <div class="grid gap-5 sm:grid-cols-2">
          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Adres e-mail</span>
            <input name="email" type="email" bind:value={dane.email} autocomplete="email"
                   aria-invalid={!!bledy.email} class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
            {#if bledy.email}<span class="block text-[13px] text-alarm mt-1.5">{bledy.email}</span>{/if}
          </label>
          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Telefon</span>
            <input name="phone" type="tel" bind:value={dane.phone} autocomplete="tel"
                   aria-invalid={!!bledy.phone} class="w-full border border-linia p-3 bg-tlo focus:border-akcent">
            {#if bledy.phone}<span class="block text-[13px] text-alarm mt-1.5">{bledy.phone}</span>{/if}
          </label>
        </div>

        <div class="flex flex-col gap-4 mt-7">
          <label class="flex items-start gap-3.5 cursor-pointer">
            <input type="checkbox" name="exclusions_accepted" bind:checked={dane.exclusions_accepted}
                   aria-invalid={!!bledy.exclusions_accepted} class="w-5 h-5 mt-0.5 accent-akcent-ciemny shrink-0">
            <span class="text-[15px] leading-relaxed">
              Zapoznałem/am się z <a href="/wylaczenia/" class="text-akcent-ciemny underline underline-offset-2">głównymi wyłączeniami odpowiedzialności</a>.
            </span>
          </label>
          {#if bledy.exclusions_accepted}<span class="text-[13px] text-alarm -mt-2 pl-8.5">{bledy.exclusions_accepted}</span>{/if}

          <label class="flex items-start gap-3.5 cursor-pointer">
            <input type="checkbox" name="informedAccepted" bind:checked={dane.informedAccepted}
                   aria-invalid={!!bledy.informedAccepted} class="w-5 h-5 mt-0.5 accent-akcent-ciemny shrink-0">
            <span class="text-[15px] leading-relaxed">
              Zapoznałem/am się z <a href="/klauzula-informacyjna/" class="text-akcent-ciemny underline underline-offset-2">klauzulą informacyjną</a>,
              <a href="/regulamin/" class="text-akcent-ciemny underline underline-offset-2">regulaminem</a> i
              <a href="/polityka-prywatnosci/" class="text-akcent-ciemny underline underline-offset-2">polityką prywatności</a>.
            </span>
          </label>
          {#if bledy.informedAccepted}<span class="text-[13px] text-alarm -mt-2 pl-8.5">{bledy.informedAccepted}</span>{/if}
        </div>

        <div bind:this={kontenerTurnstile} class="mt-7"></div>

        {#if bladWysylki}
          <div role="alert" class="border border-alarm bg-tlo p-5 mt-6">
            <p class="font-bold text-alarm m-0 mb-1.5">Nie udało się wysłać wniosku</p>
            <p class="text-[15px] leading-relaxed text-tekst-drugi m-0 mb-2">
              Zadzwońcie na <a href="tel:+48504400901" class="font-bold text-tekst">504 400 901</a> —
              przejdziemy przez wniosek telefonicznie, żeby nie robić tego drugi raz.
            </p>
            <p class="font-mono text-[12px] text-tekst-trzeci m-0">{bladWysylki}</p>
          </div>
        {/if}
      </fieldset>
    {/if}

    <!-- ── Nawigacja ─────────────────────────────────────────────────── -->
    <div class="flex flex-wrap gap-3 justify-between items-center mt-10 pt-7 border-t border-linia">
      {#if krok > 0}
        <button type="button" onclick={wstecz}
                class="border-[1.5px] border-akcent text-akcent-ciemny bg-tlo px-7 py-3.5 font-semibold hover:bg-tlo-jasne">
          Wstecz
        </button>
      {:else}
        <span></span>
      {/if}

      {#if krok < KROKI.length - 1}
        <button type="button" onclick={dalej}
                class="bg-akcent-ciemny text-white px-8 py-4 font-bold hover:bg-akcent-hover">
          Dalej
        </button>
      {:else}
        <button type="submit" disabled={wysylanie}
                class="bg-akcent-ciemny text-white px-8 py-4 font-bold hover:bg-akcent-hover disabled:opacity-60 disabled:cursor-wait">
          {wysylanie ? 'Wysyłam…' : 'Wyślij wniosek'}
        </button>
      {/if}
    </div>
  </form>
</div>
