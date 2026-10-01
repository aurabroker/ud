<script>
  /**
   * Kolumna etapu: stały nagłówek (nazwa, licznik, suma, zwiń, „…"), osobne
   * przewijanie listy kart, cała kolumna jest celem upuszczenia — także pusta.
   * Licznik i suma pochodzą z serwera dla CAŁEGO zbioru po filtrze, nie z kart
   * załadowanych do przeglądarki.
   */
  import { getContext } from 'svelte';
  import { formatKwota } from './model.js';
  import Karta from './Karta.svelte';

  let { etap, uklad = 'kolumna' } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;

  const kol = $derived(stan.kolumny[etap.id]);
  const licznik = $derived(stan.liczniki[etap.id] ?? { ile: kol.karty.length, ileWszystkich: kol.karty.length, suma: 0, sumaWszystkich: 0 });
  const filtr = $derived(stan.czyFiltrAktywny());
  const cel = $derived(ctx.cel?.etapId === etap.id ? ctx.cel : null);
  const licznikTekst = $derived(filtr ? `${licznik.ile} z ${licznik.ileWszystkich}` : String(licznik.ile));
  const ileSlowo = $derived(licznik.ile === 1 ? 'lead' : 'leadów');
  const menuOtwarte = $derived(ctx.menuEtapuOtwarteDla === etap.id);
  const sumaTekst = $derived(filtr ? licznik.suma : licznik.sumaWszystkich);
  const maWiecej = $derived(kol.karty.length < kol.razem);
</script>

<section
  class="kolumna"
  class:lista={uklad === 'lista'}
  class:cel-ok={cel?.ok}
  class:cel-blokada={cel && !cel.ok}
  data-kolumna-id={etap.id}
  data-etap-klucz={etap.klucz}
  data-cel-etap={etap.id}
  aria-labelledby="kol-{etap.id}-nazwa"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- Prawy klik to skrót do menu „…" z tego samego nagłówka (przycisk niżej) — nie jedyna droga do funkcji. -->
  <header class="naglowek" data-naglowek-etapu={etap.id} oncontextmenu={(e) => ctx.kontekstEtapu(e, etap.id)}>
    <div class="wiersz">
      <h2 id="kol-{etap.id}-nazwa">{etap.nazwa}</h2>
      <span class="licznik" data-licznik aria-label="{licznikTekst} {ileSlowo}{filtr ? ' po filtrze' : ''}">{licznikTekst}</span>
      <span class="przyciski">
        {#if uklad === 'kolumna' && !ctx.mobilny}
          <button type="button" class="ikona" aria-label="Zwiń etap {etap.nazwa}" title="Zwiń etap" onclick={() => stan.zwinEtap(etap.id, true)}>⇤</button>
        {/if}
        <button
          type="button"
          class="ikona"
          aria-label="Akcje etapu {etap.nazwa}"
          aria-haspopup="menu"
          aria-expanded={menuOtwarte}
          onclick={(e) => ctx.otworzMenuEtapu(etap.id, e.currentTarget)}
        >…</button>
      </span>
    </div>
    <p class="suma" title="Suma miesięcznych świadczeń z okresowej niezdolności do pracy — {filtr ? 'dla leadów spełniających filtr' : 'wszystkich leadów w etapie'}, w złotych miesięcznie">
      Σ świadczeń{filtr ? ' (po filtrze)' : ''}: {formatKwota(sumaTekst) || '0 zł'} / mies.
    </p>
  </header>

  <div class="lista-kart" data-przewijanie-kolumny>
    {#if kol.blad}
      <p class="blad" role="alert">{kol.blad} <button type="button" class="link" onclick={() => stan.ladujKolumne(etap.id)}>Spróbuj ponownie</button></p>
    {/if}

    {#if kol.karty.length}
      <ul aria-label="Leady w etapie {etap.nazwa}">
        {#each kol.karty as karta (karta.id)}
          <li><Karta {karta} {etap} {uklad} /></li>
        {/each}
      </ul>
    {:else if kol.ladowanie}
      <p class="pusta" role="status">Ładowanie…</p>
    {:else if !kol.blad}
      <p class="pusta">
        {#if filtr && licznik.ileWszystkich > 0}Brak leadów spełniających filtr ({licznik.ileWszystkich} w etapie bez filtra).
        {:else}Brak leadów w tym etapie.{/if}
      </p>
    {/if}

    {#if maWiecej}
      <button type="button" class="wiecej" onclick={() => stan.wiecej(etap.id)} disabled={kol.ladowanie}>
        {kol.ladowanie ? 'Ładowanie…' : `Pokaż więcej (${kol.karty.length} z ${kol.razem})`}
      </button>
    {/if}
  </div>

  {#if cel}
    <div class="cel-opis" aria-hidden="true">
      {cel.ok ? `Upuść, aby przenieść do: ${etap.nazwa}` : `Niedostępne: ${cel.powod}`}
    </div>
  {/if}
</section>

<style>
  .kolumna {
    position: relative; flex: 0 0 var(--szerokosc-kolumny, 20rem); width: var(--szerokosc-kolumny, 20rem);
    display: flex; flex-direction: column; min-height: 0; max-height: 100%;
    background: var(--slate-200); border: 2px solid transparent; border-radius: 12px;
    transition: border-color .12s ease, background-color .12s ease;
  }
  .kolumna.lista { flex: none; width: 100%; max-height: none; }
  .kolumna.cel-ok { border-color: var(--blue-600); background: #dbeafe; }
  .kolumna.cel-blokada { border-color: var(--red-600); background: #fee2e2; }

  .naglowek { flex: none; padding: .65rem .75rem .45rem; }
  .wiersz { display: flex; align-items: center; gap: .5rem; }
  h2 { font-size: .95rem; font-weight: 800; color: var(--slate-800); flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .licznik {
    flex: none; font-size: .78rem; font-weight: 700; color: var(--slate-700); background: #fff;
    border: 1px solid var(--slate-300); border-radius: 999px; padding: .05rem .5rem;
  }
  .przyciski { margin-left: auto; display: inline-flex; gap: .15rem; }
  .ikona {
    width: 1.8rem; height: 1.8rem; border: 1px solid transparent; border-radius: 7px; background: transparent;
    color: var(--slate-600); font-size: 1.1rem; line-height: 1; cursor: pointer; font-weight: 800;
  }
  .ikona:hover, .ikona[aria-expanded='true'] { background: #fff; border-color: var(--slate-300); }
  .ikona:focus-visible { outline: 2px solid var(--blue-600); }
  .suma { margin: .15rem 0 0; font-size: .72rem; color: var(--slate-600); }

  .lista-kart { flex: 1; min-height: 5rem; overflow-y: auto; padding: 0 .5rem .6rem; overscroll-behavior: contain; }
  .kolumna.lista .lista-kart { overflow: visible; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
  .pusta { margin: .5rem .25rem; font-size: .82rem; color: var(--slate-600); text-align: center; border: 2px dashed var(--slate-300); border-radius: 10px; padding: 1.2rem .6rem; }
  .blad { margin: .25rem; padding: .5rem; font-size: .8rem; color: #991b1b; background: #fee2e2; border-radius: 8px; }
  .link { background: none; border: 0; padding: 0; font: inherit; font-weight: 700; color: var(--blue-700); text-decoration: underline; cursor: pointer; }
  .wiecej {
    width: 100%; margin-top: .5rem; padding: .5rem; border: 1px solid var(--slate-300); border-radius: 8px; background: #fff;
    font: inherit; font-size: .82rem; font-weight: 700; color: var(--slate-700); cursor: pointer;
  }
  .wiecej:hover:not(:disabled) { background: var(--slate-50); }
  .cel-opis {
    position: absolute; left: .5rem; right: .5rem; bottom: .5rem; padding: .45rem .6rem; border-radius: 8px;
    font-size: .8rem; font-weight: 700; text-align: center; pointer-events: none; background: #fff; box-shadow: 0 4px 12px rgba(15, 23, 42, .18);
  }
  .cel-ok .cel-opis { color: var(--blue-700); }
  .cel-blokada .cel-opis { color: #991b1b; }

  @media (prefers-reduced-motion: reduce) { .kolumna { transition: none; } }
</style>
