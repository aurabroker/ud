<script>
  /**
   * „Ustawienia" (decyzja właściciela z 05.10.2026): Wysyłki, Panel Admina
   * i ustawienia systemu pod jedną pozycją w nagłówku, obok nazwy konta.
   * Strony zostają pod dawnymi adresami (zakładki, odnośniki w mailach,
   * formularze) — łączy je ten pasek. Agent widzi tylko Wysyłki, więc pasek
   * z jedną pozycją się nie pokazuje.
   */
  import { page } from '$app/stores';
  import { sekcjeUstawien, wSekcji } from '$lib/ustawienia.js';

  const sekcje = $derived(sekcjeUstawien($page.data?.profile?.role === 'admin'));
  const aktywna = (s) => wSekcji($page.url.pathname, s);
</script>

{#if sekcje.length > 1}
  <nav class="sekcje" aria-label="Ustawienia" data-ustawienia-nav>
    {#each sekcje as s (s.href)}
      <a href={s.href} class:aktywna={aktywna(s)} aria-current={aktywna(s) ? 'page' : undefined}>{s.label}</a>
    {/each}
  </nav>
{/if}

<style>
  .sekcje { display: flex; flex-wrap: wrap; gap: .3rem; margin: 0 0 1.1rem; padding: .3rem; border-radius: 10px;
            background: #fff; border: 1px solid var(--slate-300); width: fit-content; max-width: 100%; }
  a { padding: .4rem .85rem; border-radius: 7px; font-size: .88rem; font-weight: 600; color: var(--slate-600); text-decoration: none; }
  a:hover { background: var(--slate-100); color: var(--slate-900); }
  a.aktywna { background: var(--slate-800); color: #fff; }
  a:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
</style>
