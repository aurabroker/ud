<script>
  /**
   * Wniosek.svelte — kreator wniosku (kroki: KROKI z @ud/wniosek).
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
    HEALTH_SURVEY_GROUPS, HEALTH_SURVEY_ITEMS, HEALTH_SURVEY_THRESHOLD,
    sprawdzKrok, ankietaRozszerzona, doWysylki, zLinkuAgenta, klauzuleDostepne, PROG_KLAUZUL_NW,
    ZGODA_KONTAKT,
  } from '@ud/wniosek';

  let { zawody = [], zawodPoczatkowy = '', urlFunkcji, urlSzkicu = '', kluczTurnstile } = $props();

  let krok = $state(0);
  let dane = $state({
    fullName: '', pesel: '', employmentType: 'b2b', profession: zawodPoczatkowy,
    weight: '', height: '', handedness: '', taxForm: '', employsPeople: false,
    emp_contribution_slider: 50,
    // Ryzyko podstawowe (okresowa niezdolność) startuje zaznaczone i nie da się
    // go odznaczyć — bez niego nie ma polisy. Dwa pozostałe to rozszerzenia.
    ...Object.fromEntries(RYZYKA.map((r) => [r.klucz, !!r.podstawowe])),
    ...Object.fromEntries(RYZYKA.map((r) => [r.poleSumy, ''])),
    ...Object.fromEntries(KLAUZULE_NW.map((k) => [k.klucz, 0])),
    // Pozycje ankiety rozszerzonej startują PUSTE, nie na „nie". Deklaracja
    // zdrowotna wstępnie odznaczona na „nie" to oświadczenie złożone za klienta
    // — walidacja wymaga świadomej odpowiedzi na każdą pozycję. Cztery klucze
    // wspólne z siódemką poniżej dostają jej domyślne „no”, bo to jedno pytanie.
    ...Object.fromEntries(HEALTH_SURVEY_ITEMS.map((i) => [i.key, ''])),
    ...Object.fromEntries(HEALTH_SURVEY_ITEMS.map((i) => [`${i.key}_notes`, ''])),
    ...Object.fromEntries(PYTANIA_MEDYCZNE.map((p) => [p.klucz, 'no'])),
    ...Object.fromEntries(PYTANIA_MEDYCZNE.map((p) => [`${p.klucz}_notes`, ''])),
    ...Object.fromEntries(AKTYWNOSCI_RYZYKOWNE.map((a) => [a.klucz, false])),
    email: '', phone: '', exclusions_accepted: false, informedAccepted: false,
    // Zgoda na kontakt w sprawie niedokończonego wniosku — opcjonalna, domyślnie
    // NIEZAZNACZONA. Dotyczy szkicu, nie wniosku, więc doWysylki() ją wycina.
    zgodaKontakt: false,
  });
  let bledy = $state({});
  let wysylanie = $state(false);
  let bladWysylki = $state('');

  /**
   * Identyfikator jednego złożonego wniosku — klucz deduplikacji konwersji.
   * `crypto.randomUUID` wymaga bezpiecznego kontekstu; zapasowy wariant jest
   * na wypadek starszej przeglądarki, bo brak identyfikatora znaczy tu brak
   * policzonej konwersji.
   */
  const identyfikatorWniosku = () =>
    crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  /**
   * Dwa widgety Turnstile, bo dwa różne tokeny do dwóch różnych celów:
   *   • krok „kontakt" — token na utworzenie szkicu (`wniosek-szkic`),
   *   • krok „zgody"   — token na wniosek (`form-submit`).
   * Token jest jednorazowy, więc jeden widget z `reset()` w środku kreatora
   * mógłby zostawić końcówkę bez świeżego tokenu. Osobne widgety nie wchodzą
   * sobie w drogę: ścieżka wysyłki (widget „zgody") jest dokładnie taka jak
   * przed dodaniem szkiców.
   */
  let widgetTurnstile = null;                 // krok „zgody"
  let kontenerTurnstile = $state(null);
  let widgetStart = null;                     // krok „kontakt"
  let kontenerStart = $state(null);

  const idKroku = $derived(KROKI[krok].id);
  const rozszerzona = $derived(ankietaRozszerzona(dane));

  /*
   * Pięć pozycji ankiety rozszerzonej pyta o to samo co podstawowa siódemka:
   * cztery pod tym samym kluczem (serce, cukrzyca, żołądek, neurologia), więc
   * `bind:group` trzyma je w jednym stanie i odpowiedź jest z definicji spójna.
   * Drugiego pola na opis dla nich nie renderujemy — byłoby związane z tą samą
   * zmienną co pole wyżej i klient przepisywałby sobie własny tekst.
   *
   * Piąty dubel — „Układ ruchu" (`med_locomotor`) wobec podstawowego
   * `med_bones` — ma inny klucz, więc tego mechanizmu nie łapie i opis zbiera
   * osobno. Funkcja brzegowa mapuje `med_locomotor` na kolumnę `med_bones`,
   * więc dane trafiają gdzie trzeba; to zdublowane pytanie jest kwestią
   * redakcji listy, nie zapisu, i nie zmieniam go po cichu przy okazji.
   */
  const KLUCZE_PODSTAWOWE = new Set(PYTANIA_MEDYCZNE.map((p) => p.klucz));
  const limit = $derived(LIMIT_DOCHODU[dane.employmentType] ?? 0.8);
  const klauzule = $derived(klauzuleDostepne(dane));

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
    // Szkic: wystrzel i zapomnij. Nic tu nie czeka na odpowiedź, a wyjątek nie
    // wyjdzie poza try — przejście do kolejnego kroku nie zależy od szkicu.
    try {
      if (idKroku === 'kontakt') szkicPoKontakcie();
      else szkicKrok(idKroku);
    } catch { /* szkic nigdy nie zatrzymuje wniosku */ }
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
   * Skrypt api.js szuka elementów .cf-turnstile raz, przy wczytaniu. Kontenery
   * kroków powstają później — dopiero gdy użytkownik do nich dojdzie — więc
   * automat nigdy by ich nie zobaczył i przycisk „Wyślij" byłby martwy.
   * Stąd render=explicit w adresie skryptu i wywołanie render() stąd.
   */
  function zamontuj(kontener, opcje = {}) {
    // Bez klucza witryny render() rzuca wyjątkiem i wywraca hydratację kroku,
    // przez co przycisk „Wyślij" przestaje reagować. Brak konfiguracji ma
    // pogorszyć ochronę przed botami, a nie zepsuć formularz.
    if (!kluczTurnstile || !kontener) return null;
    if (!window.turnstile?.render) return null;   // skrypt jeszcze nie doszedł
    return window.turnstile.render(kontener, { sitekey: kluczTurnstile, language: 'pl', ...opcje });
  }

  function usunWidget(uchwyt) {
    if (uchwyt === null) return;
    try { window.turnstile?.remove?.(uchwyt); } catch { /* już go nie ma */ }
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

  /**
   * Widget żyje dokładnie tak długo, jak jego kontener.
   *
   * Kontener siedzi w bloku {#if}, więc wyjście z kroku niszczy element, a powrót
   * (Wstecz, potem Dalej) tworzy NOWY, pusty. Wcześniej uchwyt zostawał w pamięci
   * i montowanie uznawało robotę za zrobioną: po powrocie do ostatniego kroku
   * kontener był pusty, a po wygaśnięciu starego tokenu (300 s) przycisk „Wyślij"
   * odpowiadał „Potwierdź, że nie jesteś robotem", choć nie było czego kliknąć.
   * Teraz posprzątanie w efekcie zdejmuje widget przy wyjściu z kroku.
   *
   * Krok „zgody" — token na wniosek. Ścieżka wysyłki jak przed szkicami.
   */
  $effect(() => {
    if (idKroku !== 'zgody' || !kontenerTurnstile || !kluczTurnstile) return;
    const kontener = kontenerTurnstile;
    widgetTurnstile = zamontuj(kontener);
    // Skrypt Cloudflare jest async — dokładamy się do jego kolejki onload.
    if (widgetTurnstile === null) {
      window.onloadTurnstileCallback = () => {
        if (kontener.isConnected && widgetTurnstile === null) widgetTurnstile = zamontuj(kontener);
      };
    }
    return () => { usunWidget(widgetTurnstile); widgetTurnstile = null; };
  });

  /**
   * Krok „kontakt" — token na utworzenie szkicu. `interaction-only`: widget jest
   * niewidoczny, dopóki Cloudflare nie zażąda kliknięcia, więc pierwszy ekran
   * nie dostaje CAPTCHA, której zwykle nikt by nie zauważył.
   */
  $effect(() => {
    if (idKroku !== 'kontakt' || !kontenerStart || !kluczTurnstile || !urlSzkicu) return;
    const kontener = kontenerStart;
    const opcje = { appearance: 'interaction-only' };
    widgetStart = zamontuj(kontener, opcje);
    if (widgetStart === null) {
      window.onloadTurnstileCallback = () => {
        if (kontener.isConnected && widgetStart === null) widgetStart = zamontuj(kontener, opcje);
      };
    }
    return () => { usunWidget(widgetStart); widgetStart = null; };
  });

  /* ── Szkic wniosku — „wystrzel i zapomnij" ─────────────────────────────────
   *
   * Po zaliczeniu kroku „kontakt" kreator zakłada szkic (lejek + kontakt za
   * zgodą), a po każdym kolejnym kroku przesuwa jego `ostatni_krok`.
   *
   * ŻADNE z tych wywołań nie może zablokować ani opóźnić wniosku: nikt na nie
   * nie czeka na ścieżce przejścia dalej, każde ma limit czasu, a błąd jest
   * połykany. Wniosek to jedyna ścieżka, którą wpływają pieniądze — szkic jest
   * dodatkiem i ma prawo się nie udać.
   *
   * Identyfikator szkicu trzymamy WYŁĄCZNIE w pamięci komponentu: kreator to
   * jedna strona, więc to wystarcza, a zapis w urządzeniu na potrzeby lejka
   * wymagałby zgody (art. 399 Prawa komunikacji elektronicznej). Przeładowanie
   * strony zaczyna nowy szkic.
   *
   * Do szkicu nigdy nie idzie PESEL ani odpowiedzi z ankiety medycznej —
   * wysyłamy wyłącznie krok, a przy zgodzie imię, e-mail i telefon.
   */
  const LIMIT_SZKICU_MS = 3000;
  let szkicId = null;        // Promise<string | null> — odpowiedź `start`
  let szkicIdGotowe = null;  // string — id po odpowiedzi, do zamknięcia szkicu przy wysyłce
  let kontaktWyslany = '';   // co ostatnio powiedzieliśmy szkicowi o zgodzie i kontakcie

  function szkic(cialo, { keepalive = false } = {}) {
    if (!urlSzkicu) return Promise.resolve(null);
    try {
      const kontroler = new AbortController();
      const licznik = setTimeout(() => kontroler.abort(), LIMIT_SZKICU_MS);
      return fetch(urlSzkicu, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cialo),
        signal: kontroler.signal,
        keepalive,
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .finally(() => clearTimeout(licznik));
    } catch {
      return Promise.resolve(null);
    }
  }

  /** Po kroku „kontakt": utwórz szkic, a po powrocie Wstecz — popraw zgodę i dane. */
  function szkicPoKontakcie() {
    const zgoda = dane.zgodaKontakt === true;
    const kontakt = { imie: dane.fullName.trim(), email: dane.email.trim(), phone: dane.phone.trim() };
    const zgodaCialo = { zgoda, zgoda_wersja: ZGODA_KONTAKT.wersja };
    const token = widgetStart !== null ? window.turnstile?.getResponse?.(widgetStart) : null;
    const opis = JSON.stringify([zgoda, zgoda ? kontakt : null]);

    if (szkicId === null) {
      // Bez tokenu funkcja i tak odrzuciłaby szkic, więc nie wołamy jej na darmo.
      if (!token) return;
      kontaktWyslany = opis;
      szkicId = szkic({
        akcja: 'start', 'cf-turnstile-response': token, ...zgodaCialo, ...(zgoda ? kontakt : {}),
      }).then((w) => {
        szkicIdGotowe = w?.id ?? null;
        if (!szkicIdGotowe) { szkicId = null; kontaktWyslany = ''; }  // kolejne wejście spróbuje jeszcze raz
        return szkicIdGotowe;
      });
      return;
    }

    if (opis === kontaktWyslany) return;   // po Wstecz nic się nie zmieniło
    kontaktWyslany = opis;
    szkicId.then((id) => {
      if (!id) return;
      if (zgoda && token) {
        void szkic({ akcja: 'kontakt', id, 'cf-turnstile-response': token, ...zgodaCialo, ...kontakt });
      } else {
        // Zgoda zmieniona albo cofnięta, a świeżego tokenu brak: bezpieczniej
        // wyczyścić dane kontaktowe szkicu, niż zostawić w nim stary adres.
        if (zgoda) kontaktWyslany = '';    // następne wejście spróbuje jeszcze raz
        void szkic({ akcja: 'kontakt', id, zgoda: false });
      }
    });
  }

  /** Po każdym kolejnym kroku: przesuń szkic do przodu. */
  function szkicKrok(zaliczony) {
    szkicId?.then((id) => { if (id) void szkic({ akcja: 'krok', id, krok: zaliczony }); });
  }

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
        // Link agenta (?agent=<kod>) przypisuje lead temu agentowi w panelu.
        body: JSON.stringify({ ...doWysylki(dane), ...zLinkuAgenta(window.location.search), 'cf-turnstile-response': token }),
      });
      const wynik = await res.json().catch(() => ({}));
      if (res.ok && wynik.status !== 'error') {
        // Znacznik złożonego wniosku dla konwersji Ads na stronie podziękowania.
        // Bez niego /podziekowanie/ nie zgłasza konwersji — powód opisany tam.
        // Wniosek jest już w bazie, więc awaria zapisu do sesji (tryb prywatny,
        // zablokowane dane witryn) nie może zatrzymać przekierowania.
        try {
          sessionStorage.setItem('ud:wniosek', identyfikatorWniosku());
        } catch { /* zostaje niepoliczona konwersja, nie zgubiony wniosek */ }
        // Szkic oznaczamy jako ukończony — NIGDY nie jest to warunek przekierowania.
        // `keepalive` pozwala żądaniu przeżyć przejście na inną stronę; gdyby mimo
        // to zginęło, bezpiecznik w cronie zamknie szkic po e-mailu z ud_clients.
        try {
          if (szkicIdGotowe) void szkic({ akcja: 'ukoncz', id: szkicIdGotowe }, { keepalive: true });
        } catch { /* j.w. */ }
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
  <ol class="grid grid-cols-2 sm:grid-cols-[repeat(var(--kroki),minmax(0,1fr))] gap-3 list-none m-0 p-0 mb-10"
      style="--kroki: {KROKI.length}">
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

    <!-- ── KROK: KONTAKT ─────────────────────────────────────────────── -->
    <!-- Pierwszy, bo kto odpadnie później, zostawia tu e-mail i telefon.
         Imię, e-mail i telefon są wymagane do wniosku; zgoda na kontakt w sprawie
         niedokończonego wniosku jest OPCJONALNA i niczego nie blokuje. -->
    {#if idKroku === 'kontakt'}
      <fieldset class="border-0 p-0 m-0">
        <legend class="sr-only">Kontakt</legend>

        <p class="text-[16px] leading-relaxed text-tekst-drugi mt-0 mb-6">
          Zaczynamy od kontaktu — na ten adres e-mail i numer telefonu odezwiemy się z ofertą.
        </p>

        <div class="grid gap-5 sm:grid-cols-2">
          <label class="block sm:col-span-2">
            <span class="block text-sm font-semibold mb-1.5">Imię i nazwisko</span>
            <input name="fullName" bind:value={dane.fullName} autocomplete="name"
                   aria-invalid={!!bledy.fullName} aria-describedby={bledy.fullName ? 'e-fullName' : undefined}
                   class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
            {#if bledy.fullName}<span id="e-fullName" class="block text-[13px] text-alarm mt-1.5">{bledy.fullName}</span>{/if}
          </label>
          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Adres e-mail</span>
            <input name="email" type="email" bind:value={dane.email} autocomplete="email"
                   aria-invalid={!!bledy.email} class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
            {#if bledy.email}<span class="block text-[13px] text-alarm mt-1.5">{bledy.email}</span>{/if}
          </label>
          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Telefon</span>
            <input name="phone" type="tel" bind:value={dane.phone} autocomplete="tel"
                   aria-invalid={!!bledy.phone} class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
            {#if bledy.phone}<span class="block text-[13px] text-alarm mt-1.5">{bledy.phone}</span>{/if}
          </label>
        </div>

        <label class="flex items-start gap-3.5 mt-7 border border-linia-mocna bg-tlo-jasne p-5 cursor-pointer">
          <input type="checkbox" name="zgodaKontakt" bind:checked={dane.zgodaKontakt}
                 class="w-5 h-5 mt-0.5 accent-akcent-ciemny shrink-0">
          <span>
            <span class="block text-[15px] leading-relaxed">{ZGODA_KONTAKT.tresc}</span>
            <span class="block text-[13px] text-tekst-trzeci mt-1.5">
              Zgoda jest dobrowolna — wniosek możesz złożyć bez niej.
            </span>
          </span>
        </label>

        <!-- Token na szkic. Niewidoczny, dopóki Cloudflare nie zażąda kliknięcia. -->
        {#if kluczTurnstile && urlSzkicu}
          <div bind:this={kontenerStart} class="mt-5"></div>
        {/if}
      </fieldset>
    {/if}

    <!-- ── KROK: DANE ────────────────────────────────────────────────── -->
    {#if idKroku === 'dane'}
      <fieldset class="border-0 p-0 m-0">
        <legend class="sr-only">Dane podstawowe</legend>

        <div class="grid gap-5 sm:grid-cols-2">
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
                    class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
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
                   class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
            <datalist id="lista-zawodow">
              {#each zawody as z}<option value={z}></option>{/each}
            </datalist>
            {#if bledy.profession}<span id="e-profession" class="block text-[13px] text-alarm mt-1.5">{bledy.profession}</span>{/if}
          </label>

          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Waga (kg)</span>
            <input name="weight" type="number" min="30" max="300" bind:value={dane.weight}
                   class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
          </label>

          <label class="block">
            <span class="block text-sm font-semibold mb-1.5">Wzrost (cm)</span>
            <input name="height" type="number" min="100" max="250" bind:value={dane.height}
                   class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
          </label>

          <label class="block sm:col-span-2">
            <span class="block text-sm font-semibold mb-1.5">Forma opodatkowania</span>
            <select name="taxForm" bind:value={dane.taxForm}
                    class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
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
                     class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
            </label>
            <label class="block">
              <span class="block text-sm font-semibold mb-1.5">Branża</span>
              <input name="emp_industry" bind:value={dane.emp_industry}
                     class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
            </label>
            <label class="block">
              <span class="block text-sm font-semibold mb-1.5">Pracownicy — rok ubiegły</span>
              <input name="emp_count_2024" type="number" min="0" bind:value={dane.emp_count_2024}
                     class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
            </label>
            <label class="block">
              <span class="block text-sm font-semibold mb-1.5">Pracownicy — obecnie</span>
              <input name="emp_count_current" type="number" min="0" bind:value={dane.emp_count_current}
                     class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
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

    <!-- ── KROK: ZAKRES ─────────────────────────────────────────────── -->
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
              <label class="flex items-start gap-3.5 {r.podstawowe ? 'cursor-default' : 'cursor-pointer'}">
                <input type="checkbox" name={r.klucz} bind:checked={dane[r.klucz]}
                       disabled={r.podstawowe}
                       class="w-5 h-5 mt-0.5 accent-akcent-ciemny shrink-0">
                <span>
                  <span class="block font-bold text-[16.5px]">{r.etykieta}</span>
                  <span class="block font-mono text-[12px] tracking-[0.08em] uppercase text-tekst-drugi font-semibold mt-1.5">{r.rodzaj}</span>
                  {#if r.podstawowe}
                    <span class="block text-[14px] text-tekst-drugi mt-1.5">
                      Ryzyko podstawowe — polisa zawsze je obejmuje. Pozostałe możesz dołożyć.
                    </span>
                  {/if}
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

        <!-- Klauzule dodatkowe rozszerzają ryzyko „śmierć / inwalidztwo", więc
             pokazują się dopiero, gdy jego suma przekroczy próg. Wcześniej
             ubezpieczyciel ich nie oferuje i zebranie wyboru byłoby obietnicą
             bez pokrycia w ofercie. -->
        {#if klauzule}
          <h3 class="text-xl mt-10 mb-4">Klauzule dodatkowe</h3>
          <div class="grid gap-4 sm:grid-cols-2">
            {#each KLAUZULE_NW as k}
              <label class="block">
                <span class="block text-sm font-semibold mb-1.5">{k.etykieta}</span>
                <select name={k.klucz} bind:value={dane[k.klucz]}
                        class="w-full border border-linia-pole p-3 bg-tlo focus:border-akcent">
                  {#each k.kwoty as kw}
                    <option value={kw}>
                      {kw === 0 ? 'Nie wybieram' : zl(kw) + (k.naDzien ? ' / dzień' : k.naTydzien ? ' / tydzień' : '')}
                    </option>
                  {/each}
                </select>
              </label>
            {/each}
          </div>
        {:else if dane.riskDeathInvalidity}
          <p class="border-l-2 border-linia-mocna bg-tlo-jasne p-4 mt-10 text-[15px] leading-relaxed text-tekst-drugi m-0">
            Klauzule dodatkowe — świadczenie pogrzebowe, dostosowanie do niepełnosprawności,
            świadczenie szpitalne — otwierają się przy sumie śmierci i inwalidztwa powyżej
            {zl(PROG_KLAUZUL_NW)}. Poniżej tej kwoty ubezpieczyciel ich nie oferuje.
          </p>
        {/if}
      </fieldset>
    {/if}

    <!-- ── KROK: ZDROWIE ────────────────────────────────────────────── -->
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
                    <div class="border border-linia p-4" data-pole={poz.key}
                         class:border-alarm={!!bledy[poz.key]}>
                      <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 justify-between">
                        <span class="text-[15px] leading-relaxed">{poz.label}</span>
                        <div class="flex gap-5 shrink-0">
                          {#each [['yes', 'Tak'], ['no', 'Nie']] as [w, e]}
                            <label class="flex items-center gap-2 cursor-pointer">
                              <input type="radio" name={`hs_${poz.key}`} value={w} bind:group={dane[poz.key]}
                                     class="w-4 h-4 accent-akcent-ciemny">
                              <span class="text-[15px]">{e}</span>
                            </label>
                          {/each}
                        </div>
                      </div>
                      {#if bledy[poz.key]}
                        <span class="block text-[13px] text-alarm mt-2">{bledy[poz.key]}</span>
                      {/if}
                      {#if dane[poz.key] === 'yes' && !KLUCZE_PODSTAWOWE.has(poz.key)}
                        <label class="block mt-4">
                          <span class="block text-sm font-semibold mb-1.5">Opisz krótko, czego dotyczy</span>
                          <textarea name={`hsd_${poz.key}`} rows="2" bind:value={dane[`${poz.key}_notes`]}
                                    aria-invalid={!!bledy[`${poz.key}_notes`]}
                                    class="w-full border border-linia p-3 bg-tlo resize-none focus:border-akcent"></textarea>
                          {#if bledy[`${poz.key}_notes`]}
                            <span class="block text-[13px] text-alarm mt-1.5">{bledy[`${poz.key}_notes`]}</span>
                          {/if}
                        </label>
                      {/if}
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

    <!-- ── KROK: ZGODY ───────────────────────────────────────────────── -->
    {#if idKroku === 'zgody'}
      <fieldset class="border-0 p-0 m-0">
        <legend class="sr-only">Zgody</legend>

        <div class="flex flex-col gap-4">
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

        {#if kluczTurnstile}
          <div bind:this={kontenerTurnstile} class="mt-7"></div>
        {/if}

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
