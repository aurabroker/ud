<script>
  /**
   * Karta leada. Struktura celowo NIE jest jednym <button> z przyciskami w środku:
   * osobny element otwiera szczegóły (nazwa), osobny przycisk „…" otwiera menu,
   * uchwyt jest tylko dla wskaźnika. Sam kolor niczego nie znaczy — każde
   * ostrzeżenie ma tekst i ikonę.
   */
  import { getContext } from 'svelte';
  import { DZIALANIA, etykietaZrodla, kontekstKarty, ostrzezenia, terminTekst, wartoscKarty } from './model.js';

  let { karta, etap, uklad = 'kolumna' } = $props();
  const ctx = getContext('tablica');

  const zapis = $derived(ctx.stan.zapisy[karta.id]);
  const ostrz = $derived(ostrzezenia(karta, etap, ctx.teraz));
  const wartosc = $derived(wartoscKarty(karta));
  const menuOtwarte = $derived(ctx.menuOtwarteDla === karta.id);
  const brakDzialania = $derived(!karta.dzialanie);
  const ikonaDzialania = { telefon: '☎', email: '✉', spotkanie: '◷', inne: '•' };

  function klik(e) {
    // Klik w telefon, przycisk albo pole nie otwiera szczegółów (K02).
    if (e.target.closest('a, button, input, textarea, select, [data-bez-szczegolow]')) return;
    ctx.otworzSzczegoly(karta.id, e.currentTarget.querySelector('.otworz'));
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<!-- Klik w całą kartę i prawy klik to udogodnienia dla myszy. Klawiaturą: przycisk z nazwą (szczegóły) i „…" (menu). -->
<article
  class="karta"
  class:zapis={Boolean(zapis)}
  class:niepewny={zapis?.niepewny}
  class:otwarta={ctx.stan.otwartyId === karta.id}
  class:lista={uklad === 'lista'}
  data-karta-id={karta.id}
  data-etap-id={karta.etap_id}
  aria-busy={zapis ? 'true' : undefined}
  onclick={klik}
  oncontextmenu={(e) => ctx.kontekstKarty(e, karta)}
>
  <div class="gora">
    {#if !ctx.mobilny}
      <span class="uchwyt" data-uchwyt aria-hidden="true" title="Przeciągnij, aby zmienić etap">⋮⋮</span>
    {/if}
    <button type="button" class="otworz" onclick={(e) => ctx.otworzSzczegoly(karta.id, e.currentTarget)} title={karta.nazwa}>
      <span class="nazwa">{karta.nazwa}</span>
      <span class="sr-only"> — otwórz szczegóły</span>
    </button>
    <button
      type="button"
      class="menu-btn"
      aria-label="Akcje leada {karta.nazwa}"
      aria-haspopup="menu"
      aria-expanded={menuOtwarte}
      onclick={(e) => ctx.otworzMenuLeada(karta.id, e.currentTarget)}
    >…</button>
  </div>

  <p class="kontekst">{kontekstKarty(karta)}</p>
  {#if wartosc}<p class="wartosc">{wartosc}</p>{/if}

  {#if karta.dzialanie || etap?.rodzaj === 'otwarty' || !etap || karta.powod_utraty}
  <p class="dzialanie" class:brak={brakDzialania}>
    {#if karta.dzialanie}
      <span class="ikona" aria-hidden="true">{ikonaDzialania[karta.dzialanie.typ] ?? '•'}</span>
      <span class="dz-typ">{DZIALANIA[karta.dzialanie.typ] ?? 'Działanie'}</span>
      <span class="dz-termin">{terminTekst(karta.dzialanie.termin, ctx.teraz)}</span>
      {#if karta.dzialanie.opis}<span class="dz-opis">· {karta.dzialanie.opis}</span>{/if}
    {:else if etap?.rodzaj === 'otwarty' || !etap}
      <span class="ikona" aria-hidden="true">○</span> Brak zaplanowanego działania
    {:else if karta.powod_utraty}
      <span class="dz-opis">Powód utraty: {karta.powod_utraty}</span>
    {/if}
  </p>
  {/if}

  {#if ostrz.length}
    <ul class="ostrzezenia" aria-label="Ostrzeżenia">
      {#each ostrz as o (o.id)}
        {#if !(o.id === 'brak_dzialania')}
          <li class="o-{o.waga}" data-ostrzezenie={o.id}><span class="ikona" aria-hidden="true">{o.ikona}</span> {o.tekst}</li>
        {/if}
      {/each}
    </ul>
  {/if}

  <footer class="stopka">
    <span class="opiekun" class:brak={!karta.opiekun_id} title="Opiekun">
      {karta.opiekun_nazwa ?? 'Bez opiekuna'}
    </span>
    <span class="zrodlo">{etykietaZrodla(karta.zrodlo)}</span>
    {#if karta.telefon}
      <a class="tel" href="tel:{String(karta.telefon).replace(/[^\d+]/g, '')}" aria-label="Zadzwoń do {karta.nazwa}: {karta.telefon}">{karta.telefon}</a>
    {/if}
  </footer>

  {#if zapis}
    <div class="stan-zapisu" data-stan-zapisu={zapis.niepewny ? 'niepewny' : 'trwa'}>
      <span>{zapis.opis}</span>
      {#if zapis.niepewny}
        <button type="button" class="ponow" onclick={() => ctx.ponowZapis(karta.id)}>Spróbuj ponownie</button>
      {/if}
    </div>
  {/if}
</article>

<style>
  .karta {
    position: relative; background: #fff; border: 1px solid var(--slate-300); border-radius: 10px;
    padding: .75rem; box-shadow: 0 1px 2px rgba(15, 23, 42, .06); cursor: grab;
    display: flex; flex-direction: column; gap: .35rem; transition: box-shadow .15s ease, border-color .15s ease;
  }
  .karta:hover { border-color: var(--slate-400); box-shadow: 0 2px 6px rgba(15, 23, 42, .12); }
  .karta.otwarta { border-color: var(--blue-600); box-shadow: 0 0 0 2px rgba(37, 99, 235, .25); }
  .karta.zapis { opacity: .78; }
  .karta.niepewny { border-color: var(--amber-500); border-style: dashed; }
  /* Miejsce, z którego wzięto kartę: pusta rama zamiast karty (placeholder). */
  .karta:global([data-przeciagana]) { opacity: .35; border-style: dashed; box-shadow: none; }
  .karta.lista { cursor: default; }

  .gora { display: flex; align-items: flex-start; gap: .3rem; }
  .uchwyt { flex: none; color: var(--slate-400); font-size: .9rem; line-height: 1.25; letter-spacing: -.12em; cursor: grab; user-select: none; touch-action: none; padding: .1rem .15rem; }
  .otworz {
    flex: 1; min-width: 0; text-align: left; background: transparent; border: 0; padding: 0; font: inherit; cursor: pointer;
    font-weight: 700; font-size: .95rem; color: var(--slate-900);
  }
  .otworz:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; border-radius: 4px; }
  .nazwa { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .menu-btn {
    flex: none; width: 1.9rem; height: 1.9rem; border: 1px solid transparent; border-radius: 7px; background: transparent;
    color: var(--slate-600); font-size: 1.2rem; line-height: 1; cursor: pointer; font-weight: 800;
  }
  .menu-btn:hover, .menu-btn[aria-expanded='true'] { background: var(--slate-100); border-color: var(--slate-200); }
  .menu-btn:focus-visible { outline: 2px solid var(--blue-600); }

  .kontekst { margin: 0; font-size: .8rem; color: var(--slate-600); }
  .wartosc { margin: 0; font-size: .82rem; font-weight: 600; color: var(--slate-800); }
  .dzialanie { margin: 0; font-size: .85rem; font-weight: 600; color: var(--slate-800); display: flex; flex-wrap: wrap; gap: .3rem; align-items: baseline; }
  .dzialanie.brak { color: var(--slate-600); font-weight: 500; }
  .dz-termin { color: var(--slate-900); }
  .dz-opis { font-weight: 400; color: var(--slate-600); }
  .ikona { display: inline-block; width: 1.1em; text-align: center; }

  .ostrzezenia { list-style: none; margin: .1rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .2rem; }
  .ostrzezenia li { font-size: .76rem; font-weight: 600; padding: .15rem .45rem; border-radius: 6px; width: fit-content; }
  .o-blad { background: #fee2e2; color: #991b1b; }
  .o-uwaga { background: #fef3c7; color: #92400e; }
  .o-info { background: var(--slate-100); color: var(--slate-600); }

  .stopka { display: flex; flex-wrap: wrap; align-items: center; gap: .15rem .6rem; font-size: .76rem; color: var(--slate-600); margin-top: .1rem; }
  .opiekun { font-weight: 600; color: var(--slate-700); }
  .opiekun.brak { font-weight: 500; font-style: italic; color: var(--slate-500); }
  .tel { color: var(--blue-700); text-decoration: none; font-weight: 600; }
  .tel:hover { text-decoration: underline; }

  .stan-zapisu {
    margin-top: .2rem; padding: .3rem .5rem; border-radius: 6px; font-size: .76rem; font-weight: 600;
    background: var(--slate-100); color: var(--slate-700); display: flex; justify-content: space-between; align-items: center; gap: .5rem;
  }
  .niepewny .stan-zapisu { background: #fef3c7; color: #92400e; }
  .ponow { border: 1px solid #92400e; background: #fff; color: #92400e; border-radius: 6px; padding: .15rem .5rem; font-size: .74rem; font-weight: 700; cursor: pointer; }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

  @media (prefers-reduced-motion: reduce) { .karta { transition: none; } }
</style>
