<script>
  /**
   * Menu poleceń (WAI-ARIA: role=menu / menuitem) — jedno dla leada, etapu
   * i zwiniętego etapu. Pozycje przychodzą z model.js, więc przycisk „…"
   * i prawy klik pokazują dokładnie to samo.
   *
   * Klawiatura: ↑/↓ (z zawijaniem), Home/End, Enter/Spacja aktywują, Esc zamyka
   * i oddaje fokus elementowi, dla którego menu otwarto, Tab zamyka bez pułapki
   * fokusu. Mysz: kliknięcie poza menu zamyka. Menu mieści się w oknie —
   * przy krawędzi zmienia kierunek otwarcia.
   */
  import { tick } from 'svelte';

  let { menu, pozycje, onwybierz, onzamknij } = $props();
  let el = $state(null);
  let poz = $state({ x: 0, y: 0, maxWysokosc: null, gotowe: false });
  let aktywny = $state(-1);

  const MARGINES = 8;
  const wiersze = $derived(pozycje.filter((p) => !p.separator));

  // Pozycjonowanie po wyrenderowaniu — dopiero wtedy znamy wymiary menu.
  $effect(() => {
    const m = menu;
    if (!m || !el) return;
    let anulowano = false;
    tick().then(async () => {
      if (anulowano || !el) return;
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = Math.max(rect.height, el.scrollHeight + (el.offsetHeight - el.clientHeight));
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = m.x;
      let y = m.y;
      if (x + w > vw - MARGINES) x = Math.max(MARGINES, (m.xAlt ?? m.x) - w);
      let maxWysokosc = null;
      if (h > vh - 2 * MARGINES) {
        maxWysokosc = vh - 2 * MARGINES;
        y = MARGINES;
      } else if (y + h > vh - MARGINES) {
        y = Math.max(MARGINES, (m.yAlt ?? m.y) - h);
        if (y + h > vh - MARGINES) y = vh - MARGINES - h;
      }
      poz = { x, y, maxWysokosc, gotowe: true };
      aktywny = m.klawiatura ? pierwszyAktywny() : -1;
      // Fokus dopiero, gdy menu jest już widoczne — element z visibility:hidden nie przyjmuje fokusu.
      await tick();
      if (anulowano || !el) return;
      (m.klawiatura && aktywny >= 0 ? el.querySelectorAll('[role="menuitem"]')[aktywny] : el)?.focus({ preventScroll: true });
    });
    return () => { anulowano = true; };
  });

  function pierwszyAktywny() { return wiersze.length ? 0 : -1; }

  function fokusuj(i) {
    if (!wiersze.length) return;
    aktywny = (i + wiersze.length) % wiersze.length;
    el.querySelectorAll('[role="menuitem"]')[aktywny]?.focus({ preventScroll: true });
  }

  /** Aktywna pozycja = ta, która ma fokus (także po fokusie nadanym spoza menu, np. myszą czy kodem). */
  function synchronizujFokus(e) {
    const poz = e.target.closest?.('[role="menuitem"]');
    if (!poz || !el) return;
    const i = [...el.querySelectorAll('[role="menuitem"]')].indexOf(poz);
    if (i >= 0) aktywny = i;
  }

  function klawisz(e) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); fokusuj(aktywny < 0 ? 0 : aktywny + 1); break;
      case 'ArrowUp': e.preventDefault(); fokusuj(aktywny < 0 ? wiersze.length - 1 : aktywny - 1); break;
      case 'Home': e.preventDefault(); fokusuj(0); break;
      case 'End': e.preventDefault(); fokusuj(wiersze.length - 1); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); onzamknij({ przywroc: true }); break;
      case 'Tab': onzamknij({ przywroc: true }); break; // bez preventDefault: fokus idzie dalej
      case 'Enter':
      case ' ': {
        const biezacy = wiersze[aktywny];
        if (!biezacy) break;
        e.preventDefault();
        wybierz(biezacy);
        break;
      }
      default:
        // Skok do pozycji po pierwszej literze.
        if (e.key.length === 1 && /\p{L}/u.test(e.key)) {
          const i = wiersze.findIndex((p, k) => k > aktywny && p.etykieta.toLowerCase().startsWith(e.key.toLowerCase()));
          const j = i >= 0 ? i : wiersze.findIndex((p) => p.etykieta.toLowerCase().startsWith(e.key.toLowerCase()));
          if (j >= 0) fokusuj(j);
        }
    }
  }

  function wybierz(p) {
    if (p.zablokowana) return; // pozycja zostaje widoczna; przyczynę czyta się obok
    onwybierz(p);
  }

  // Kliknięcie poza menu, zmiana rozmiaru, przewijanie — zamykają (menu zostałoby „w powietrzu").
  $effect(() => {
    if (!menu) return;
    const poza = (e) => { if (el && !el.contains(e.target)) onzamknij({ przywroc: false }); };
    const zamknij = () => onzamknij({ przywroc: false });
    // Zdarzenia `scroll` dochodzą z opóźnieniem jednej klatki: przewinięcie tuż PRZED otwarciem
    // menu (np. przeglądarka dowozi element do widoku przy kliknięciu) nie może go od razu zamknąć.
    const otwartoO = performance.now();
    const przewiniecie = () => { if (performance.now() - otwartoO > 200) zamknij(); };
    window.addEventListener('pointerdown', poza, true);
    window.addEventListener('resize', zamknij);
    window.addEventListener('scroll', przewiniecie, true);
    window.addEventListener('blur', zamknij);
    return () => {
      window.removeEventListener('pointerdown', poza, true);
      window.removeEventListener('resize', zamknij);
      window.removeEventListener('scroll', przewiniecie, true);
      window.removeEventListener('blur', zamknij);
    };
  });
</script>

{#if menu}
  <div
    bind:this={el}
    class="menu"
    role="menu"
    aria-label={menu.tytul}
    tabindex="-1"
    data-menu
    data-menu-typ={menu.typ}
    data-menu-id={menu.id}
    style:left="{poz.x}px"
    style:top="{poz.y}px"
    style:max-height={poz.maxWysokosc ? `${poz.maxWysokosc}px` : undefined}
    style:visibility={poz.gotowe ? 'visible' : 'hidden'}
    onkeydown={klawisz}
    onfocusin={synchronizujFokus}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <div class="opis" role="presentation">{menu.tytul}</div>
    {#each pozycje as p, i (p.separator ? `s${i}` : p.id)}
      {#if p.separator}
        <div class="separator" role="separator"></div>
      {:else}
        {@const indeks = wiersze.indexOf(p)}
        {#if p.href && !p.zablokowana}
          <a
            class="poz"
            role="menuitem"
            tabindex="-1"
            href={p.href}
            data-akcja={p.id}
            class:aktywna={aktywny === indeks}
            onpointermove={() => { if (aktywny !== indeks) fokusuj(indeks); }}
            onclick={() => onzamknij({ przywroc: false })}
          >{p.etykieta}</a>
        {:else}
          <button
            type="button"
            class="poz"
            role="menuitem"
            tabindex="-1"
            data-akcja={p.id}
            aria-disabled={p.zablokowana ? 'true' : undefined}
            aria-describedby={p.zablokowana ? `menu-powod-${p.id}` : undefined}
            class:zablokowana={Boolean(p.zablokowana)}
            class:aktywna={aktywny === indeks}
            onpointermove={() => { if (aktywny !== indeks) fokusuj(indeks); }}
            onclick={() => wybierz(p)}
          >
            {p.etykieta}
            {#if p.zablokowana}<span class="powod" id="menu-powod-{p.id}" aria-hidden="true">{p.zablokowana}</span>{/if}
          </button>
        {/if}
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed; z-index: 1500; min-width: 14.5rem; max-width: 20rem; overflow-y: auto;
    background: #fff; border: 1px solid var(--slate-300); border-radius: 10px;
    box-shadow: 0 12px 30px rgba(15, 23, 42, .22); padding: .3rem; outline: none;
  }
  .opis {
    font-size: .74rem; font-weight: 700; color: var(--slate-500); padding: .35rem .6rem .3rem;
    max-width: 18rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    border-bottom: 1px solid var(--slate-100); margin-bottom: .2rem;
  }
  .separator { height: 1px; background: var(--slate-100); margin: .25rem 0; }
  .poz {
    display: block; width: 100%; text-align: left; background: transparent; border: 0; border-radius: 7px;
    padding: .5rem .6rem; font: inherit; font-size: .88rem; color: var(--slate-800); cursor: pointer; text-decoration: none;
  }
  .poz:hover, .poz:focus-visible, .poz.aktywna { background: var(--slate-100); outline: none; }
  .poz:focus-visible { box-shadow: inset 0 0 0 2px var(--blue-600); }
  .poz.zablokowana { color: var(--slate-500); cursor: not-allowed; }
  .powod { display: block; font-size: .74rem; color: var(--slate-500); margin-top: .1rem; line-height: 1.3; }
</style>
