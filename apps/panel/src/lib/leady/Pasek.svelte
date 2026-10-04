<script>
  /**
   * Pasek górny: pipeline, wyszukiwarka (z opóźnieniem 250 ms), filtry
   * (opiekun, źródło, zakres, termin działania), sortowanie, „Dodaj lead"
   * i przełącznik Kanban / Lista. Filtry mieszkają w adresie strony, więc
   * odświeżenie i skopiowany link niosą ten sam widok.
   */
  import { getContext } from 'svelte';
  import { PRODUKTY, SORTOWANIA, TERMINY, ZRODLA, opisFiltra } from './model.js';
  import { kopiujDoSchowka } from './schowek.js';

  const ctx = getContext('tablica');
  const stan = ctx.stan;

  /** Link agenta do wniosku: klient, który złoży z niego wniosek, trafia do niego jako lead. */
  async function kopiujLinkAgenta() {
    const ok = await kopiujDoSchowka(stan.linkAgenta);
    stan.ogloc(ok
      ? 'Skopiowano Twój link do wniosku. Klient, który złoży z niego wniosek, trafi na Twoją tablicę.'
      : `Nie udało się skopiować. Twój link: ${stan.linkAgenta}`);
  }
  const opisAktywnych = $derived(opisFiltra(stan.filtr, stan.plan));
</script>

<div class="pasek" role="group" aria-label="Narzędzia tablicy leadów">
  <div class="wiersz">
    {#if stan.plan.pipelines.length > 1}
      <label class="sr-only" for="pasek-pipeline">Pipeline</label>
      <select id="pasek-pipeline" class="pole" value={stan.plan.pipeline.id} onchange={(e) => ctx.zmienPipeline(e.currentTarget.value)}>
        {#each stan.plan.pipelines as p (p.id)}<option value={p.id}>{p.nazwa}</option>{/each}
      </select>
    {:else}
      <strong class="pipeline">{stan.plan.pipeline.nazwa}</strong>
    {/if}

    <div class="szukaj">
      <label class="sr-only" for="pasek-szukaj">Szukaj leada</label>
      <input
        id="pasek-szukaj"
        class="pole"
        type="search"
        placeholder="Szukaj: imię, e-mail, telefon…"
        autocomplete="off"
        value={stan.szukanie}
        oninput={(e) => stan.szukaj(e.currentTarget.value)}
      />
    </div>

    <div class="przelacznik" role="group" aria-label="Widok">
      <button type="button" aria-pressed={stan.widok === 'kanban'} onclick={() => ctx.ustawWidok('kanban')}>Kanban</button>
      <button type="button" aria-pressed={stan.widok === 'lista'} onclick={() => ctx.ustawWidok('lista')}>Lista</button>
    </div>

    <div class="akcje">
      {#if stan.linkAgenta}
        <button type="button" class="btn btn-ghost" onclick={kopiujLinkAgenta} title={stan.linkAgenta} data-link-agenta={stan.linkAgenta}>
          Mój link do wniosku
        </button>
      {/if}
      <a class="btn btn-primary dodaj" href="/panel/klienci/nowy" title="Nowy klient trafia do etapu Nowy">+ Dodaj lead</a>
    </div>
  </div>

  <div class="wiersz filtry">
    <!-- Agent widzi tylko swoje leady (02.10.2026), więc filtr opiekuna ma sens wyłącznie u administratora. -->
    {#if stan.plan.rola === 'admin'}
      <label class="f">Opiekun
        <select class="pole" value={stan.filtr.opiekun ?? ''} onchange={(e) => stan.ustawFiltr({ opiekun: e.currentTarget.value })}>
          <option value="">Wszyscy</option>
          <option value="ja">Ja</option>
          <option value="brak">Bez opiekuna</option>
          {#each stan.plan.agenci as a (a.id)}<option value={a.id}>{a.nazwa}</option>{/each}
        </select>
      </label>
    {/if}
    <label class="f">Źródło
      <select class="pole" value={stan.filtr.zrodlo ?? ''} onchange={(e) => stan.ustawFiltr({ zrodlo: e.currentTarget.value })}>
        <option value="">Wszystkie</option>
        {#each Object.entries(ZRODLA).filter(([k]) => k !== 'szkic') as [k, n] (k)}<option value={k}>{n}</option>{/each}
      </select>
    </label>
    <label class="f">Zakres ochrony
      <select class="pole" value={stan.filtr.produkt ?? ''} onchange={(e) => stan.ustawFiltr({ produkt: e.currentTarget.value })}>
        <option value="">Wszystkie</option>
        {#each Object.entries(PRODUKTY) as [k, n] (k)}<option value={k}>{n}</option>{/each}
        <option value="nieznany">Nieokreślony</option>
      </select>
    </label>
    <label class="f">Następne działanie
      <select class="pole" value={stan.filtr.termin ?? ''} onchange={(e) => stan.ustawFiltr({ termin: e.currentTarget.value })}>
        <option value="">Dowolne</option>
        {#each TERMINY as t (t.id)}<option value={t.id}>{t.nazwa}</option>{/each}
      </select>
    </label>
    <label class="f">Sortuj
      <select class="pole" value={stan.sort} onchange={(e) => stan.ustawSort(e.currentTarget.value)}>
        {#each SORTOWANIA as s (s.id)}<option value={s.id}>{s.nazwa}</option>{/each}
      </select>
    </label>

    <div class="akcje">
      {#if stan.czyFiltrAktywny()}
        <button type="button" class="btn btn-ghost maly" onclick={() => stan.wyczyscFiltry()}>Wyczyść filtry</button>
      {/if}
      {#if stan.zwiniete.length && stan.widok === 'kanban'}
        <button type="button" class="btn btn-ghost maly" onclick={() => stan.rozwinWszystkie()}>Rozwiń wszystkie</button>
      {/if}
      <button type="button" class="btn btn-ghost maly" onclick={() => stan.odswiezWidok()} disabled={stan.ladowanie}>
        {stan.ladowanie ? 'Odświeżam…' : 'Odśwież'}
      </button>
    </div>
  </div>

  {#if stan.czyFiltrAktywny()}
    <p class="aktywne" data-aktywne-filtry>Aktywne filtry: {opisAktywnych}. Liczniki i sumy dotyczą całego przefiltrowanego zbioru.</p>
  {/if}
</div>

<style>
  .pasek { flex: none; display: flex; flex-direction: column; gap: .5rem; padding: 0 0 .6rem; }
  .wiersz { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .filtry { align-items: flex-end; }
  .pipeline { font-size: 1.15rem; color: var(--slate-900); margin-right: .25rem; }
  .szukaj { flex: 1 1 14rem; min-width: 12rem; max-width: 26rem; }
  .pole {
    width: 100%; padding: .45rem .6rem; border: 1px solid var(--slate-300); border-radius: 8px; background: #fff;
    font: inherit; font-size: .85rem; color: var(--slate-800);
  }
  .pole:focus-visible { outline: 2px solid var(--blue-600); border-color: transparent; }
  .f { display: flex; flex-direction: column; gap: .15rem; font-size: .72rem; font-weight: 700; color: var(--slate-600); min-width: 9rem; flex: 0 1 12rem; }
  .f .pole { width: 100%; }
  .przelacznik { display: inline-flex; border: 1px solid var(--slate-300); border-radius: 8px; overflow: hidden; background: #fff; }
  .przelacznik button { border: 0; background: transparent; padding: .45rem .8rem; font: inherit; font-size: .85rem; font-weight: 700; color: var(--slate-600); cursor: pointer; }
  .przelacznik button[aria-pressed='true'] { background: var(--slate-800); color: #fff; }
  .przelacznik button:focus-visible { outline: 2px solid var(--blue-600); outline-offset: -2px; }
  .akcje { margin-left: auto; display: flex; gap: .5rem; flex-wrap: wrap; }
  .akcje > * { white-space: nowrap; }
  .akcje { display: flex; gap: .4rem; margin-left: auto; flex-wrap: wrap; }
  .maly { padding: .4rem .75rem; font-size: .8rem; }
  .aktywne { margin: 0; font-size: .78rem; color: var(--slate-600); }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
