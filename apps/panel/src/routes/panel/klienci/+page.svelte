<script>
  /**
   * Zakładka „Klienci". Od 20.11.2026 (decyzja właściciela): kolumna
   * „Świadczenie" (miesięczne z okresowej niezdolności, z wniosku), pod
   * plakietką „Akcja" — stan najnowszej wysłanej oferty, bez kolumny „Kontakt"
   * (telefon pod nazwiskiem, e-mail w menu) i menu klienta na lewy klik w
   * wiersz, na prawy klik i na przycisk „⋯".
   *
   * Widok, źródło i kolejność liczy src/lib/klienci/lista.js — ten sam, którego
   * używają strzałki „Poprzedni / Następny klient" na karcie.
   */
  import { dateP, money } from '$lib/format.js';
  import { ETYKIETY_ZRODLA, KLUCZE_ZRODLA } from '$lib/zrodlo.js';
  import { listaWidoku, wWidoku, zapytanieListy } from '$lib/klienci/lista.js';
  import { akcjeKlienta, numerTel } from '$lib/klienci/menu.js';
  import { czyKlikOtwieraMenu, czyNatywneMenu } from '$lib/menuKontekstowe.js';
  import { kopiujDoSchowka } from '$lib/leady/schowek.js';
  import Menu from '$lib/leady/Menu.svelte';

  let { data } = $props();
  let q = $state('');

  const filtry = $derived({ archiwum: data.archiwum, zrodlo: data.zrodlo });
  // Filtry idą dalej: na kartę klienta (strzałki po tej samej liście) i z powrotem.
  const zapytanie = $derived(zapytanieListy(filtry));

  const aktywni = $derived(wWidoku(data.clients, false));
  const archiwalni = $derived(wWidoku(data.clients, true));
  const wBiezacym = $derived(data.archiwum ? archiwalni : aktywni);

  // Filtr źródła (?zrodlo=…) działa w obrębie bieżącego widoku; liczby przy
  // plakietkach też. Przełączenie widoku (Klienci / Archiwum) go zdejmuje.
  /** @type {Record<string, number>} */
  const ileZrodla = $derived(Object.fromEntries(KLUCZE_ZRODLA.map((k) => [k, wBiezacym.filter((/** @type {any} */ c) => c.zrodlo?.klucz === k).length])));
  const lista = $derived(listaWidoku(data.clients, filtry));
  /** @param {string | null} k */
  const adresZrodla = (k) => `/panel/klienci${zapytanieListy({ archiwum: data.archiwum, zrodlo: k })}`;
  /** @type {Record<string, string>} */
  const ZRODLO_KLASA = { ads: 'badge-chosen', agent: 'badge-sent', inne: 'badge-viewed', brak: 'badge-draft' };
  /** @param {{ kampania?: string | null, slowo?: string | null } | undefined} z */
  const tytulZrodla = (z) => [z?.kampania && `Kampania: ${z.kampania}`, z?.slowo && `Słowo kluczowe: ${z.slowo}`].filter(Boolean).join(' · ') || undefined;
  /** @param {number | null | undefined} n */
  const swiadczenie = (n) => (n == null ? '—' : `${money(n)}/mies.`);

  // Samo słowo stanu oferty szuka po STANIE, nie po tekście linijki: „otwarta"
  // jest też w „nieotwarta" i w „nieotwarta (poprzednia wersja otwarta 12.11)",
  // więc zwykłe „zawiera" oddawało oferty nieotwarte jako otwarte.
  const STANY_OFERTY = new Set(['otwarta', 'nieotwarta', 'decyzja']);

  const filtered = $derived(
    lista.filter((c) => {
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      if (STANY_OFERTY.has(s.trim())) return c.oferta?.stan === s.trim();
      return [c.full_name, c.email, c.phone, c.akcja?.etykieta, c.oferta?.etykieta, c.zrodlo?.etykieta, c.zrodlo?.kampania]
        .some((v) => (v || '').toLowerCase().includes(s));
    })
  );

  // ── menu klienta ──────────────────────────────────────────────────────────
  /** @type {null | { typ: 'klient', id: string, tytul: string, x: number, y: number, xAlt: number, yAlt: number, trigger: HTMLElement | null, klawiatura: boolean }} */
  let menu = $state(null);
  let ogloszenie = $state('');
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let ogloszenieCzas;
  const klientMenu = $derived(menu ? data.clients.find((/** @type {any} */ c) => c.id === menu?.id) ?? null : null);
  const pozycjeMenu = $derived(klientMenu ? akcjeKlienta(klientMenu, zapytanie) : []);
  // Menu znika razem z wierszem (np. szukanie go ukryło).
  $effect(() => { if (menu && !klientMenu) menu = null; });

  // Drugi klik w ten sam „⋯" zamyka menu: menu zamyka się już na pointerdown poza
  // sobą (Menu.svelte), więc bez tego klik zaraz by je otworzył z powrotem.
  /** @type {{ trigger: HTMLElement | null | undefined, czas: number } | null} */
  let zamknietoMysza = null;

  /** @param {any} c @param {HTMLElement} przycisk */
  function zPrzycisku(c, przycisk) {
    if (zamknietoMysza?.trigger === przycisk && performance.now() - zamknietoMysza.czas < 400) { zamknietoMysza = null; return; }
    const r = przycisk.getBoundingClientRect();
    menu = { typ: 'klient', id: c.id, tytul: c.full_name || 'Klient', x: r.left, y: r.bottom + 4, xAlt: r.right, yAlt: r.top - 4, trigger: przycisk, klawiatura: true };
  }

  /** Menu w miejscu kursora; Esc oddaje fokus przyciskowi „⋯" tego wiersza. @param {MouseEvent & { currentTarget: HTMLElement }} e @param {any} c */
  function wMiejscuKursora(e, c) {
    menu = {
      typ: 'klient', id: c.id, tytul: c.full_name || 'Klient',
      x: e.clientX, y: e.clientY, xAlt: e.clientX, yAlt: e.clientY,
      trigger: e.currentTarget.querySelector('[data-menu-klienta]'), klawiatura: false,
    };
  }

  /** @param {MouseEvent & { currentTarget: HTMLElement, target: any }} e @param {any} c */
  function klikWiersza(e, c) {
    if (!czyKlikOtwieraMenu(e)) return;
    wMiejscuKursora(e, c);
  }

  /** @param {MouseEvent & { currentTarget: HTMLElement, target: any }} e @param {any} c */
  function kontekstWiersza(e, c) {
    if (czyNatywneMenu(e)) return;
    e.preventDefault();
    wMiejscuKursora(e, c);
  }

  /** @param {{ przywroc: boolean }} p */
  function zamknijMenu({ przywroc }) {
    const trigger = menu?.trigger;
    zamknietoMysza = przywroc ? null : { trigger, czas: performance.now() };
    menu = null;
    if (przywroc && trigger?.isConnected) trigger.focus();
  }

  /** Pozycje z `href` (karta, oferta, tablica, tel:, mailto:) obsługuje sam odnośnik w menu. @param {{ id: string }} p */
  async function wybierz(p) {
    const m = menu;
    menu = null;
    if (!m || p.id !== 'kopiuj-telefon') return;
    const c = data.clients.find((/** @type {any} */ x) => x.id === m.id);
    const numer = String(c?.phone ?? '').trim();
    const ok = numer ? await kopiujDoSchowka(numer) : false;
    ogloszenie = ok ? `Skopiowano telefon: ${numer}` : `Nie udało się skopiować — numer: ${numer}`;
    clearTimeout(ogloszenieCzas);
    ogloszenieCzas = setTimeout(() => { ogloszenie = ''; }, 4000);
    if (m.trigger?.isConnected) m.trigger.focus();
  }
</script>

<svelte:head><title>Klienci — Panel</title></svelte:head>

<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:1rem;">
  <div>
    <h1 style="font-size:1.5rem;">Klienci</h1>
    <p class="muted">
      {lista.length} {data.archiwum ? 'w archiwum' : 'klientów'} · nazwisko otwiera kartę, klik w wiersz — menu
    </p>
  </div>
  <div class="szukaj">
    <input class="input" style="max-width:280px;" placeholder="Szukaj: nazwisko, email, telefon, akcja…" bind:value={q} />
    <a class="btn btn-primary" href="/panel/klienci/nowy" style="white-space:nowrap;">+ Dodaj klienta</a>
  </div>
</div>

<nav class="widoki" aria-label="Widok listy klientów">
  <a href="/panel/klienci" data-widok="aktywni" aria-current={data.archiwum ? undefined : 'page'}>Klienci <span class="ile">{aktywni.length}</span></a>
  <a href="/panel/klienci?widok=archiwum" data-widok="archiwum" aria-current={data.archiwum ? 'page' : undefined}>Archiwum <span class="ile">{archiwalni.length}</span></a>
</nav>

<nav class="zrodla" aria-label="Filtr źródła">
  <span class="muted zrodla-et">Źródło:</span>
  <a href={adresZrodla(null)} data-zrodlo-filtr="wszystkie" aria-current={data.zrodlo ? undefined : 'page'}>Wszystkie <span class="ile">{wBiezacym.length}</span></a>
  {#each KLUCZE_ZRODLA as k (k)}
    <a href={adresZrodla(k)} data-zrodlo-filtr={k} aria-current={data.zrodlo === k ? 'page' : undefined}>{ETYKIETY_ZRODLA[k]} <span class="ile">{ileZrodla[k]}</span></a>
  {/each}
</nav>

<div class="card">
  {#if filtered.length === 0}
    <div class="card-pad muted" style="text-align:center;padding:2.5rem 1rem;">
      {data.archiwum && !q.trim() && !data.zrodlo ? 'Archiwum jest puste — trafiają tu klienci, których lead zarchiwizowano na tablicy.'
        : data.zrodlo && !q.trim() ? `Brak klientów ze źródłem „${ETYKIETY_ZRODLA[data.zrodlo]}".` : 'Brak klientów.'}
    </div>
  {:else}
    <div class="tabela">
      <table>
        <thead><tr><th>Klient</th><th>Świadczenie</th><th>Akcja</th><th>Źródło</th><th>Przypisany do</th><th>Dodano</th></tr></thead>
        <tbody>
          {#each filtered as c (c.id)}
            <!-- Klik w wiersz to skrót myszy (i palca); z klawiatury to samo menu otwiera przycisk „⋯" w pierwszej komórce. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <tr class="wiersz" data-klient-id={c.id} class:menu-otwarte={menu?.id === c.id}
                onclick={(e) => klikWiersza(e, c)} oncontextmenu={(e) => kontekstWiersza(e, c)}>
              <td>
                <div class="klient">
                  <div class="klient-dane">
                    <a class="nazwa-klienta" href="/panel/klienci/{c.id}{zapytanie}">{c.full_name || '—'}</a>
                    {#if c.phone}
                      {@const tel = numerTel(c.phone)}
                      {#if tel}<a class="tel" href="tel:{tel}" data-telefon>{c.phone}</a>{:else}<span class="tel" data-telefon>{c.phone}</span>{/if}
                    {/if}
                  </div>
                  <button type="button" class="menu-klienta" data-menu-klienta aria-haspopup="menu"
                          aria-expanded={menu?.id === c.id ? 'true' : 'false'} aria-label="Menu klienta: {c.full_name || 'Klient'}"
                          onclick={(e) => zPrzycisku(c, e.currentTarget)}>⋯</button>
                </div>
              </td>
              <td class="swiadczenie" data-swiadczenie={c.swiadczenie ?? ''}>{swiadczenie(c.swiadczenie)}</td>
              <td>
                <div data-akcja={c.akcja.id}>
                  {#if c.akcja.link}
                    <a class="badge {c.akcja.klasa} akcja" href={c.akcja.link} title={c.akcja.tytul ?? 'Otwórz lead na tablicy'}>{c.akcja.etykieta}</a>
                  {:else if c.akcja.klasa}
                    <span class="badge {c.akcja.klasa}" title={c.akcja.tytul ?? undefined}>{c.akcja.etykieta}</span>
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </div>
                {#if c.oferta}
                  <div class="muted oferta-stan" data-oferta={c.oferta.stan} title={c.oferta.tytul}>{c.oferta.etykieta}</div>
                {/if}
              </td>
              <td data-zrodlo={c.zrodlo?.klucz ?? 'brak'}>
                <span class="badge {ZRODLO_KLASA[c.zrodlo?.klucz] ?? 'badge-draft'} zrodlo" title={tytulZrodla(c.zrodlo)}>{c.zrodlo?.etykieta ?? 'Brak danych'}</span>
                {#if c.zrodlo?.kampania}<div class="muted kampania">{c.zrodlo.kampania}</div>{/if}
              </td>
              <td>
                {#if c.owner_name}
                  <span class="badge badge-sent">{c.owner_name}</span>
                {:else}
                  <span class="badge badge-draft">samodzielnie</span>
                {/if}
              </td>
              <td class="muted">{dateP(c.created_at)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Region na żywo stoi w drzewie dostępności ZAWSZE (sr-only, nie display:none):
     region, który pojawia się razem ze swoim tekstem, czytniki ekranu często
     przemilczają. Widoczny dymek obok jest dla oczu i czytnik go pomija. -->
<p class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-ogloszenie>{ogloszenie}</p>
{#if ogloszenie}<div class="ogloszenie" aria-hidden="true" data-ogloszenie-widok>{ogloszenie}</div>{/if}

<Menu {menu} pozycje={pozycjeMenu} onwybierz={wybierz} onzamknij={zamknijMenu} />

<style>
  .szukaj { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  /* Tabela przewija się w karcie, nie cała strona (telefon 390 px). */
  .tabela { overflow-x: auto; }
  .wiersz { cursor: pointer; }
  .wiersz:hover td, .wiersz.menu-otwarte td { background: var(--slate-50); }
  .klient { display: flex; align-items: flex-start; justify-content: space-between; gap: .4rem; min-width: 11rem; }
  .klient-dane { display: flex; flex-direction: column; gap: .1rem; }
  .nazwa-klienta { font-weight: 600; }
  .tel { font-size: .8rem; color: var(--slate-500); text-decoration: none; white-space: nowrap; }
  a.tel:hover { text-decoration: underline; color: var(--slate-700); }
  .menu-klienta { flex: none; border: 1px solid transparent; background: transparent; border-radius: 6px; cursor: pointer;
    font-size: 1.05rem; line-height: 1; padding: .2rem .45rem; color: var(--slate-600); }
  .menu-klienta:hover, .menu-klienta[aria-expanded='true'] { background: var(--slate-200); color: var(--slate-900); }
  .menu-klienta:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 1px; }
  .swiadczenie { white-space: nowrap; font-weight: 600; }
  .oferta-stan { font-size: .78rem; margin-top: .25rem; max-width: 17rem; line-height: 1.3; }
  .akcja { text-decoration: none; white-space: nowrap; }
  .akcja:hover { text-decoration: underline; }
  .akcja:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
  .widoki { display: flex; gap: .25rem; margin-bottom: .75rem; border-bottom: 1px solid var(--slate-200); flex-wrap: wrap; }
  .widoki a { padding: .45rem .8rem; text-decoration: none; color: var(--slate-600); font-weight: 600; font-size: .9rem;
    border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .widoki a:hover { color: var(--slate-900); }
  .widoki a[aria-current='page'] { color: var(--blue-700); border-bottom-color: var(--blue-600); }
  .widoki a:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
  .zrodla { display: flex; gap: .35rem; align-items: center; flex-wrap: wrap; margin-bottom: .75rem; font-size: .85rem; }
  .zrodla-et { margin-right: .15rem; }
  .zrodla a { padding: .25rem .65rem; border: 1px solid var(--slate-300); border-radius: 999px; text-decoration: none;
    color: var(--slate-700); font-weight: 600; background: #fff; }
  .zrodla a:hover { border-color: var(--slate-500); color: var(--slate-900); }
  .zrodla a[aria-current='page'] { background: var(--blue-600); border-color: var(--blue-600); color: #fff; }
  .zrodla a[aria-current='page'] .ile { background: rgba(255, 255, 255, .25); }
  .zrodla a:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
  .zrodlo { white-space: nowrap; }
  .kampania { font-size: .78rem; margin-top: .15rem; max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ile { display: inline-block; min-width: 1.4em; padding: 0 .35em; margin-left: .25rem; border-radius: 999px;
    background: var(--slate-200); font-size: .78rem; text-align: center; }
  .ogloszenie { position: fixed; left: 50%; bottom: 1.25rem; transform: translateX(-50%); z-index: 1600; margin: 0;
    background: var(--slate-800); color: #fff; border-radius: 8px; padding: .55rem .9rem; font-size: .88rem;
    max-width: calc(100vw - 2rem); }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
