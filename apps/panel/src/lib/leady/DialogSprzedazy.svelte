<script>
  /**
   * Dane sprzedaży — przy wejściu do „Wygrany" (dialog.etapId) albo jako
   * uzupełnienie / poprawka leada, który już tam jest (bez etapId).
   *
   * Żadna oferta nie ma zapisanego wyboru klienta, więc to agent mówi, który
   * wariant sprzedał: wybór wariantu wypełnia pola, a każde pole da się
   * poprawić albo wpisać od zera. Składka roczna jest wymagana (ta sama reguła
   * stoi w ud_lead_zmien); anulowanie przy przenoszeniu nie zmienia etapu.
   */
  import { getContext, onMount } from 'svelte';
  import Dialog from './Dialog.svelte';
  import { POLA_SPRZEDAZY, daneSprzedazyZFormularza, formatKwota } from './model.js';

  let { dialog, onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;
  const karta = $derived(stan.znajdz(dialog.leadId)?.karta ?? stan.otwarty?.lead ?? null);
  const etap = $derived(dialog.etapId ? stan.etap(dialog.etapId) : null);
  const przenoszenie = Boolean(dialog.etapId);

  const nowyKlucz = () => (globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const naTekst = (n) => (n == null ? '' : String(n).replace('.', ','));

  const poczatkowe = stan.znajdz(dialog.leadId)?.karta?.sprzedaz ?? stan.otwarty?.lead?.sprzedaz ?? null;
  let pola = $state(Object.fromEntries(POLA_SPRZEDAZY.map((p) => [p.id, naTekst(poczatkowe?.[p.id])])));
  let wariantId = $state(poczatkowe?.wariant_id ?? '');
  let warianty = $state(null);
  let bledy = $state({});
  let blad = $state('');
  let trwa = $state(false);
  let klucz = $state(nowyKlucz());

  onMount(async () => {
    warianty = await stan.warianty(dialog.leadId);
  });

  function wybierzWariant(w) {
    wariantId = w?.id ?? '';
    if (!w) return;
    for (const p of POLA_SPRZEDAZY) pola[p.id] = naTekst(w[p.id]);
    bledy = {};
  }

  const opisWariantu = (w) =>
    [`${w.ubezpieczyciel}${w.numer ? ` · ${w.numer}` : ''}`,
     w.skladka_roczna != null ? `${formatKwota(w.skladka_roczna)} / rok` : 'bez składki rocznej',
     w.skladka_mies != null ? `${formatKwota(w.skladka_mies)} / mies.` : null]
      .filter(Boolean).join(' — ');

  async function zapisz(e) {
    e.preventDefault();
    const { sprzedaz, bledne } = daneSprzedazyZFormularza(pola, wariantId || null);
    bledy = Object.fromEntries(bledne.map((id) => [id, 'Wpisz kwotę, np. 3 036 albo 3036,50.']));
    if (!sprzedaz.skladka_roczna && !bledy.skladka_roczna) bledy.skladka_roczna = 'Składka roczna jest wymagana.';
    if (Object.keys(bledy).length) {
      blad = 'Popraw zaznaczone pola.';
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
      Wybierz sprzedany wariant z ofert klienta albo wpisz kwoty. Składka roczna jest wymagana{przenoszenie ? ' — bez niej etap się nie zmieni' : ''}.
    </p>

    <fieldset class="warianty">
      <legend class="et">Sprzedany wariant</legend>
      {#if warianty === null}
        <p class="mala" role="status">Wczytuję warianty z ofert…</p>
      {:else}
        {#each warianty as w (w.id)}
          <label class="wariant">
            <input type="radio" name="dlg-sp-wariant" value={w.id} checked={wariantId === w.id} onchange={() => wybierzWariant(w)} />
            <span>{opisWariantu(w)}<span class="mala"> · oferta {w.oferta}</span></span>
          </label>
        {/each}
        <label class="wariant">
          <input type="radio" name="dlg-sp-wariant" value="" checked={!wariantId} onchange={() => wybierzWariant(null)} />
          <span>{warianty.length ? 'Inny — wpiszę kwoty ręcznie' : 'Brak wariantów w Twoich ofertach tego klienta — wpisz kwoty ręcznie'}</span>
        </label>
      {/if}
    </fieldset>

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
    {#if blad}<p class="blad" role="alert">{blad}</p>{/if}
  </form>
  {#snippet stopka()}
    <button type="button" class="btn btn-ghost" onclick={() => onzamknij({ przywroc: true })}>Anuluj</button>
    <button type="submit" form="dlg-sprzedaz-form" class="btn btn-primary" disabled={trwa}>
      {przenoszenie ? `Przenieś do „${etap?.nazwa ?? 'Wygrany'}"` : trwa ? 'Zapisuję…' : 'Zapisz'}
    </button>
  {/snippet}
</Dialog>

<style>
  .opis { margin: 0 0 .7rem; font-size: .88rem; color: var(--slate-600); line-height: 1.45; }
  .et { display: block; font-size: .8rem; font-weight: 700; color: var(--slate-600); margin-bottom: .3rem; }
  .warianty { border: 0; margin: 0 0 .8rem; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
  .wariant { display: flex; gap: .5rem; align-items: flex-start; font-size: .86rem; color: var(--slate-800); cursor: pointer; }
  .wariant input { margin-top: .2rem; }
  .mala { font-size: .78rem; color: var(--slate-600); }
  .pola { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .6rem .9rem; }
  .z-jednostka { display: flex; align-items: center; gap: .4rem; }
  .pole { flex: 1; min-width: 0; padding: .45rem .6rem; border: 1px solid var(--slate-300); border-radius: 8px; font: inherit; font-size: .9rem; }
  .pole:focus-visible { outline: 2px solid var(--blue-600); border-color: transparent; }
  .pole[aria-invalid='true'] { border-color: var(--red-600); }
  .jednostka { flex: none; font-size: .78rem; color: var(--slate-600); white-space: nowrap; }
  .blad-pola { margin: .25rem 0 0; font-size: .76rem; font-weight: 600; color: #991b1b; }
  .blad { margin: .6rem 0 0; font-size: .8rem; font-weight: 600; color: #991b1b; }
</style>
