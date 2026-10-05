<script>
  /**
   * Filtry Statystyk i wykazu polis: okres (po dacie sprzedaży) i — tylko dla
   * administratora — agent. Bez JS działają jako zwykłe odnośniki i GET;
   * z JS wybór agenta od razu odświeża widok. Kto co widzi, i tak decyduje SQL.
   */
  import { goto } from '$app/navigation';
  import { adresFiltra } from './filtr.js';

  let { okres = 'wszystko', agent = null, agenci = [], admin = false, children } = $props();

  const OKRESY = [
    { id: 'wszystko', nazwa: 'Cały czas' },
    { id: 'miesiac', nazwa: 'Ten miesiąc' },
    { id: 'poprzedni', nazwa: 'Poprzedni miesiąc' },
    { id: 'kwartal', nazwa: 'Ten kwartał' },
    { id: 'rok', nazwa: 'Ten rok' },
  ];

  const stan = $derived({ okres, agent: admin ? agent : null });

  function zmienAgenta(e) {
    goto(adresFiltra(stan, { agent: e.currentTarget.value || null }), { keepFocus: true, noScroll: true, replaceState: true });
  }
</script>

<form method="GET" class="filtry">
  <input type="hidden" name="okres" value={okres ?? 'wszystko'} />
  <nav class="okresy" aria-label="Okres">
    {#each OKRESY as o (o.id)}
      <a href={adresFiltra(stan, { okres: o.id })} aria-current={(okres ?? 'wszystko') === o.id ? 'page' : undefined}
         data-sveltekit-noscroll data-sveltekit-replacestate data-sveltekit-keepfocus>{o.nazwa}</a>
    {/each}
  </nav>
  {@render children?.()}
  {#if admin}
    <label class="agent">
      <span class="label">Agent</span>
      <select name="agent" class="input" value={agent ?? ''} onchange={zmienAgenta}>
        <option value="">Wszyscy</option>
        {#each agenci ?? [] as a (a.id)}<option value={a.id}>{a.nazwa}</option>{/each}
      </select>
    </label>
    <noscript><button class="btn btn-ghost">Pokaż</button></noscript>
  {/if}
</form>

<style>
  .filtry { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: .75rem 1rem; margin-bottom: 1.1rem; }
  .okresy { display: inline-flex; flex-wrap: wrap; gap: .25rem; padding: .25rem; background: #fff; border: 1px solid var(--slate-300); border-radius: 10px; }
  .okresy a { padding: .4rem .75rem; border-radius: 7px; font-size: .84rem; font-weight: 600; color: var(--slate-600); text-decoration: none; }
  .okresy a:hover { background: var(--slate-100); color: var(--slate-900); }
  .okresy a[aria-current='page'] { background: var(--slate-800); color: #fff; }
  .okresy a:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 1px; }
  .agent { display: flex; flex-direction: column; }
  .agent .input { width: auto; min-width: 13rem; background: #fff; }
  @media (max-width: 40rem) { .okresy { width: 100%; } }
</style>
