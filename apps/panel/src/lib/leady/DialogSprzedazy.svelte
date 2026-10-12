<script>
  /**
   * Dane sprzedaży — przy wejściu do „Wygrany" (dialog.etapId) albo jako
   * uzupełnienie / poprawka leada, który już tam jest (bez etapId).
   *
   * Żadna oferta nie ma zapisanego wyboru klienta, więc to agent mówi, który
   * wariant sprzedał: wybór wariantu wypełnia pola, a każde pole da się
   * poprawić albo wpisać od zera. Klient bez ofert w panelu dostaje wybór:
   * „Wgraj polisę" (PDF zapisany przy leadzie; kwoty z pliku, gdy czytnik je
   * rozpozna) albo „Dodaj ręcznie". Składka roczna jest wymagana (ta sama
   * reguła stoi w ud_lead_zmien); 0 w pozostałych polach = brak tego ryzyka.
   * Anulowanie przy przenoszeniu nie zmienia etapu (wgrana polisa zostaje).
   *
   * Polisa wgrana wcześniej przy leadzie: „Odczytaj dane z polisy" czyta ją
   * ponownie (składka bez opłaty dystrybucyjnej — decyzja z 04.10.2026).
   * Z pliku przychodzą też numer polisy i okres ochrony (05.10.2026) — wpisują
   * się w pola tak samo jak kwoty: do sprawdzenia, zapis dopiero przyciskiem.
   */
  import { getContext, onMount, tick } from 'svelte';
  import Dialog from './Dialog.svelte';
  import { POLA_SPRZEDAZY, daneSprzedazyZFormularza, formatKwota } from './model.js';
  import { danePolisyZFormularza } from '$lib/polisy/model.js';
  import PolaPolisy from './PolaPolisy.svelte';

  let { dialog, onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const karta = $derived(stan.znajdz(dialog.leadId)?.karta ?? stan.otwarty?.lead ?? null);
  const etap = $derived(dialog.etapId ? stan.etap(dialog.etapId) : null);
  const przenoszenie = Boolean(dialog.etapId);
  const MAX_BAJTOW = 10 * 1024 * 1024;

  const nowyKlucz = () => (globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const naTekst = (n) => (n == null ? '' : String(n).replace('.', ','));

  const poczatkowe = stan.znajdz(dialog.leadId)?.karta?.sprzedaz ?? stan.otwarty?.lead?.sprzedaz ?? null;
  let pola = $state(Object.fromEntries(POLA_SPRZEDAZY.map((p) => [p.id, naTekst(poczatkowe?.[p.id])])));
  let wariantId = $state(poczatkowe?.wariant_id ?? '');
  // Numer polisy i okres ochrony (część 6, wykaz polis).
  let numer = $state(poczatkowe?.polisa_numer ?? '');
  let ochronaOd = $state(poczatkowe?.ochrona_od ?? '');
  let ochronaDo = $state(poczatkowe?.ochrona_do ?? '');
  let warianty = $state(null);
  // 'wybor' (klient bez ofert: polisa albo ręcznie) | 'warianty' | 'reczne'
  let tryb = $state(poczatkowe?.skladka_roczna != null ? 'reczne' : null);
  let bledy = $state({});
  let blad = $state('');
  let trwa = $state(false);
  let klucz = $state(nowyKlucz());

  let inputPliku = $state(null);
  let wgrywanie = $state(false);
  let polisa = $state(null);
  let komunikatPolisy = $state('');
  let bladPolisy = $state('');
  let wgrane = $state([]);
  let odczytywanie = $state(false);

  const polaWidoczne = $derived(tryb === 'warianty' || tryb === 'reczne');

  onMount(async () => {
    const w = await stan.warianty(dialog.leadId);
    wgrane = w.polisy;
    warianty = w.warianty;
    if (warianty.length) tryb = 'warianty';
    else if (!tryb) tryb = 'wybor';
  });

  function wpiszKwoty(kwoty) {
    wariantId = '';
    for (const p of POLA_SPRZEDAZY) pola[p.id] = naTekst(kwoty[p.id]);
    bledy = {};
  }

  /** Numer i okres ochrony z pliku — tylko to, co czytnik znalazł. */
  function wpiszPolise(p) {
    if (!p) return;
    if (p.polisa_numer) numer = p.polisa_numer;
    if (p.ochrona_od && p.ochrona_do) { ochronaOd = p.ochrona_od; ochronaDo = p.ochrona_do; }
  }

  async function odczytajWgrana(f) {
    bladPolisy = '';
    komunikatPolisy = '';
    odczytywanie = true;
    const r = await stan.odczytajPolise(dialog.leadId, f.id);
    odczytywanie = false;
    if (!r.ok) { bladPolisy = r.komunikat; return; }
    komunikatPolisy = r.komunikat;
    if (r.kwoty) wpiszKwoty(r.kwoty);
    wpiszPolise(r.polisa);
    if (tryb === 'wybor' || tryb === null) tryb = 'reczne';
    await tick();
    document.getElementById('dlg-sp-skladka_roczna')?.focus();
  }

  function wybierzWariant(w) {
    wariantId = w?.id ?? '';
    if (!w) return;
    for (const p of POLA_SPRZEDAZY) pola[p.id] = naTekst(w[p.id]);
    bledy = {};
  }

  async function dodajRecznie() {
    tryb = 'reczne';
    wariantId = '';
    await tick();
    document.getElementById('dlg-sp-skladka_roczna')?.focus();
  }

  async function wgraj(e) {
    const plik = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!plik) return;
    bladPolisy = '';
    komunikatPolisy = '';
    if (plik.size > MAX_BAJTOW) { bladPolisy = 'Plik jest za duży — limit to 10 MB.'; return; }
    wgrywanie = true;
    const r = await stan.wgrajPolise(dialog.leadId, plik);
    wgrywanie = false;
    if (!r.ok) { bladPolisy = r.komunikat; return; }
    polisa = r.plik;
    wgrane = [r.plik, ...wgrane.filter((f) => f.id !== r.plik.id)];
    komunikatPolisy = r.komunikat;
    if (r.kwoty) {
      wariantId = '';
      for (const p of POLA_SPRZEDAZY) if (r.kwoty[p.id] != null) pola[p.id] = naTekst(r.kwoty[p.id]);
      bledy = {};
    }
    wpiszPolise(r.polisa);
    if (tryb === 'wybor') tryb = 'reczne';
    await tick();
    document.getElementById('dlg-sp-skladka_roczna')?.focus();
  }

  // Numer dokumentu ubezpieczyciela i składki — nazwa produktu nic tu nie mówi.
  const opisWariantu = (w) =>
    [w.numer,
     w.skladka_roczna != null ? `${formatKwota(w.skladka_roczna)} / rok` : 'bez składki rocznej',
     w.skladka_mies != null ? `${formatKwota(w.skladka_mies)} / mies.` : null]
      .filter(Boolean).join(' — ');

  async function zapisz(e) {
    e.preventDefault();
    if (tryb === 'wybor' || tryb === null) tryb = 'reczne';
    const { sprzedaz: kwoty, bledne } = daneSprzedazyZFormularza(pola, wariantId || null);
    const { polisa, bledy: bledyPolisy } = danePolisyZFormularza({ numer, od: ochronaOd, do: ochronaDo });
    const sprzedaz = { ...kwoty, ...polisa };
    bledy = Object.fromEntries(bledne.map((id) => [id, 'Wpisz kwotę cyframi, np. 3 036 albo 3036,50 — albo 0, jeśli tego ryzyka nie ma.']));
    if (!sprzedaz.skladka_roczna && !bledy.skladka_roczna) bledy.skladka_roczna = 'Składka roczna jest wymagana.';
    bledy = { ...bledy, ...bledyPolisy };
    if (Object.keys(bledy).length) {
      blad = 'Popraw zaznaczone pola.';
      await tick();
      document.getElementById(`dlg-sp-${Object.keys(bledy)[0]}`)?.focus();
      return;
    }
    blad = '';

    if (przenoszenie) {
      const { leadId, etapId } = dialog;   // przed zamknięciem — potem `dialog` jest null
      onzamknij({ przywroc: false });
      stan.przenies(leadId, etapId, { dane: { sprzedaz } });
      return;
    }

    trwa = true;
    const r = await stan.zapiszSprzedaz(dialog.leadId, sprzedaz, klucz);
    trwa = false;
    if (r.ok) { onzamknij({ przywroc: true }); return; }
    if (['konflikt', 'brak_leada', 'sesja'].includes(r.status)) { onzamknij({ przywroc: false }); return; }
    blad = r.komunikat ?? 'Nie udało się zapisać.';
    if (r.status !== 'niepewny') klucz = nowyKlucz();
  }
</script>

<Dialog otwarty id="dlg-sprzedaz" tytul="Dane sprzedaży" szerokosc="36rem" onzamknij={() => onzamknij({ przywroc: true })}>
  <form onsubmit={zapisz} id="dlg-sprzedaz-form" novalidate>
    <p class="opis">
      {karta?.nazwa ?? 'Lead'}{#if etap} → <strong>{etap.nazwa}</strong>{/if}.
      Składka roczna jest wymagana{przenoszenie ? ' — bez niej etap się nie zmieni' : ''}.
    </p>

    <fieldset class="warianty">
      <legend class="et">Sprzedany wariant</legend>
      {#if warianty === null}
        <p class="mala" role="status">Wczytuję warianty z ofert…</p>
      {:else if warianty.length}
        {#each warianty as w (w.id)}
          <label class="wariant">
            <input type="radio" name="dlg-sp-wariant" value={w.id} checked={wariantId === w.id} onchange={() => wybierzWariant(w)} />
            <span>{opisWariantu(w)}</span>
          </label>
        {/each}
        <label class="wariant">
          <input type="radio" name="dlg-sp-wariant" value="" checked={!wariantId} onchange={() => wybierzWariant(null)} />
          <span>Inny — wpiszę kwoty ręcznie</span>
        </label>
      {:else}
        <p class="mala" data-brak-ofert>Ten klient nie ma ofert w panelu.</p>
      {/if}
    </fieldset>

    <div class="polisa">
      {#if tryb === 'wybor'}
        <div class="wybor" role="group" aria-label="Skąd wziąć kwoty">
          <button type="button" class="btn btn-ghost" disabled={wgrywanie} onclick={() => inputPliku?.click()}>Wgraj polisę (PDF)</button>
          <button type="button" class="btn btn-ghost" onclick={dodajRecznie}>Dodaj ręcznie</button>
        </div>
      {:else if tryb !== null}
        <button type="button" class="link" disabled={wgrywanie} onclick={() => inputPliku?.click()}>
          {polisa ? 'Wgraj inną polisę (PDF)…' : 'Wgraj polisę (PDF)…'}
        </button>
      {/if}
      <input bind:this={inputPliku} type="file" accept="application/pdf,.pdf" hidden onchange={wgraj} data-plik-polisy />
      {#if wgrywanie}<p class="mala" role="status">Wgrywam polisę…</p>{/if}
      {#if polisa}
        <p class="mala" data-polisa-wgrana>Polisa: <a href="/panel/leady/api/plik/{polisa.id}" target="_blank" rel="noopener">{polisa.nazwa}</a></p>
      {:else if wgrane.length}
        <ul class="wgrane" data-polisy-leada>
          {#each wgrane as f (f.id)}
            <li>
              <a href="/panel/leady/api/plik/{f.id}" target="_blank" rel="noopener">{f.nazwa}</a>
              <button type="button" class="link" disabled={odczytywanie || wgrywanie} onclick={() => odczytajWgrana(f)}>Odczytaj dane z polisy</button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if odczytywanie}<p class="mala" role="status">Czytam polisę…</p>{/if}
      {#if komunikatPolisy}<p class="mala" role="status" data-komunikat-polisy>{komunikatPolisy}</p>{/if}
      {#if bladPolisy}<p class="blad-pola" role="alert">{bladPolisy}</p>{/if}
    </div>

    {#if polaWidoczne}
      <p class="mala zero">Kwota 0 albo puste pole = tego ryzyka nie ma (np. sprzedana sama okresowa niezdolność).</p>
      <div class="pola">
        {#each POLA_SPRZEDAZY as p (p.id)}
          <div class="pole-wiersz">
            <label for="dlg-sp-{p.id}" class="et">{p.nazwa}{p.wymagane ? ' *' : ''}</label>
            <div class="z-jednostka">
              <input
                id="dlg-sp-{p.id}"
                class="pole"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                bind:value={pola[p.id]}
                aria-required={p.wymagane ? 'true' : undefined}
                aria-invalid={bledy[p.id] ? 'true' : undefined}
                aria-describedby={bledy[p.id] ? `dlg-sp-${p.id}-blad` : undefined}
              />
              <span class="jednostka" aria-hidden="true">{p.jednostka}</span>
            </div>
            {#if bledy[p.id]}<p id="dlg-sp-{p.id}-blad" class="blad-pola">{bledy[p.id]}</p>{/if}
          </div>
        {/each}
      </div>
      <PolaPolisy bind:numer bind:od={ochronaOd} bind:do={ochronaDo} {bledy} prefiks="dlg-sp" />
    {/if}
    {#if blad}<p class="blad" role="alert">{blad}</p>{/if}
  </form>
  {#snippet stopka()}
    <button type="button" class="btn btn-ghost" onclick={() => onzamknij({ przywroc: true })}>Anuluj</button>
    <button type="submit" form="dlg-sprzedaz-form" class="btn btn-primary" disabled={trwa || wgrywanie || odczytywanie}>
      {przenoszenie ? `Przenieś do „${etap?.nazwa ?? 'Wygrany'}"` : trwa ? 'Zapisuję…' : 'Zapisz'}
    </button>
  {/snippet}
</Dialog>

<style>
  .opis { margin: 0 0 .7rem; font-size: .88rem; color: var(--slate-600); line-height: 1.45; }
  .et { display: block; font-size: .8rem; font-weight: 700; color: var(--slate-600); margin-bottom: .3rem; }
  .warianty { border: 0; margin: 0 0 .6rem; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
  .wariant { display: flex; gap: .5rem; align-items: flex-start; font-size: .86rem; color: var(--slate-800); cursor: pointer; font-variant-numeric: tabular-nums; }
  .wariant input { margin-top: .2rem; }
  .mala { font-size: .78rem; color: var(--slate-600); margin: .2rem 0; }
  .polisa { margin: 0 0 .8rem; }
  .wybor { display: flex; gap: .6rem; flex-wrap: wrap; }
  .link { background: none; border: 0; padding: 0; font: inherit; font-size: .82rem; font-weight: 700; color: var(--blue-700); text-decoration: underline; cursor: pointer; }
  .link:disabled { color: var(--slate-600); cursor: default; }
  .link:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
  .zero { margin: 0 0 .5rem; }
  .wgrane { list-style: none; margin: .35rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; }
  .wgrane li { display: flex; gap: .6rem; flex-wrap: wrap; align-items: baseline; }
  .pola { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .6rem .9rem; }
  .z-jednostka { display: flex; align-items: center; gap: .4rem; }
  .pole { flex: 1; min-width: 0; padding: .45rem .6rem; border: 1px solid var(--slate-300); border-radius: 8px; font: inherit; font-size: .9rem; }
  .pole:focus-visible { outline: 2px solid var(--blue-600); border-color: transparent; }
  .pole[aria-invalid='true'] { border-color: var(--red-600); }
  .jednostka { flex: none; font-size: .78rem; color: var(--slate-600); white-space: nowrap; }
  .blad-pola { margin: .25rem 0 0; font-size: .76rem; font-weight: 600; color: #991b1b; }
  .blad { margin: .6rem 0 0; font-size: .8rem; font-weight: 600; color: #991b1b; }
  a { color: var(--blue-700); }
</style>
