<script>
  /**
   * Tablica leadów (Kanban) — składanie całości: pasek, lewy panel zwiniętych
   * etapów, kolumny, prawy panel szczegółów, menu, dialogi i komunikaty.
   *
   * Tu mieszka STAN WIDOKU (menu, dialog, przeciąganie, mobilność); stan danych
   * jest w StanTablicy. Komponenty potomne dostają jedną nić kontekstu zamiast
   * łańcucha propsów.
   *
   * Kluczowe decyzje:
   *  - przycisk „…" i prawy klik wołają te same funkcje (otworzMenu*), a pozycje
   *    menu pochodzą z jednego modelu (model.js);
   *  - preventDefault na contextmenu tylko wtedy, gdy NAPRAWDĘ otwieramy własne
   *    menu — natywne zostaje na linkach, polach, zaznaczonym tekście i przy
   *    Shift (w Firefoksie Shift+prawy klik i tak go wymusza);
   *  - po upuszczeniu na etap wymagający danych (np. powód utraty) pytamy
   *    PRZED zapisem — anulowanie niczego nie zmienia.
   */
  import { onMount, setContext, tick } from 'svelte';
  import { StanTablicy } from './stan.svelte.js';
  import { utworzPrzeciaganie } from './przeciaganie.js';
  import { akcjeEtapu, akcjeLeada, czyMoznaPrzeniesc, komunikatPrzeniesienia, zSeparatorami } from './model.js';
  import Pasek from './Pasek.svelte';
  import Kolumna from './Kolumna.svelte';
  import Zwiniete from './Zwiniete.svelte';
  import Szczegoly from './Szczegoly.svelte';
  import Menu from './Menu.svelte';
  import Powiadomienia from './Powiadomienia.svelte';
  import DialogPrzenies from './DialogPrzenies.svelte';
  import DialogPowodu from './DialogPowodu.svelte';
  import DialogSprzedazy from './DialogSprzedazy.svelte';
  import DialogDzialania from './DialogDzialania.svelte';
  import DialogNotatki from './DialogNotatki.svelte';
  import DialogOpiekuna from './DialogOpiekuna.svelte';
  import DialogArchiwum from './DialogArchiwum.svelte';
  import DialogSortowania from './DialogSortowania.svelte';

  let { dane, api, odUrl, zmienPipeline = () => {}, teraz: zegar = () => new Date() } = $props();

  const stan = new StanTablicy({ dane, api, odUrl, teraz: zegar });

  let teraz = $state(zegar());
  let mobilny = $state(false);
  /** @type {null | { typ: 'lead' | 'etap', id: string, tytul: string, x: number, y: number, xAlt: number, yAlt: number, trigger: HTMLElement | null, klawiatura: boolean }} */
  let menu = $state(null);
  /** @type {null | { typ: string, leadId?: string, etapId?: string, fokusPo?: HTMLElement | null }} */
  let dialog = $state(null);
  let cel = $state(null);
  let przeciagany = $state(null);
  let wskaznik = $state({ x: 0, y: 0 });
  let korzen = $state(null);
  let podgladPoz = $state(null);
  let fokusPoSzczegolach = null;

  // ── dane pomocnicze ────────────────────────────────────────────────────────
  const kartaDo = (id) => stan.znajdz(id)?.karta ?? (stan.otwarty?.lead?.id === id ? stan.otwarty.lead : null);
  const rozwiniete = $derived(stan.etapy.filter((e) => !stan.czyZwiniety(e.id)));
  const zwinieteEtapy = $derived(stan.etapy.filter((e) => stan.czyZwiniety(e.id)));
  const etapMobilny = $derived(stan.etap(stan.etapMobilny) ?? stan.etapy[0]);

  const pozycjeMenu = $derived.by(() => {
    if (!menu) return [];
    if (menu.typ === 'lead') {
      const k = kartaDo(menu.id);
      if (!k) return [];
      return zSeparatorami(akcjeLeada({ karta: k, etap: stan.etap(k.etap_id), plan: stan.plan, zapisWToku: stan.czyZapisWToku(k.id) }));
    }
    const etap = stan.etap(menu.id);
    if (!etap) return [];
    return zSeparatorami(akcjeEtapu({ etap, zwiniety: stan.czyZwiniety(etap.id), pierwszy: stan.etapy[0]?.id === etap.id }));
  });

  // Menu znika razem z rekordem: usunięty, zarchiwizowany albo poza widokiem (K-wytyczne 3.5).
  $effect(() => {
    if (menu?.typ === 'lead' && !kartaDo(menu.id)) menu = null;
  });

  // ── menu ───────────────────────────────────────────────────────────────────
  const kotwica = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4, xAlt: r.right, yAlt: r.top - 4 };
  };

  /** Natywne menu zostaje: Shift, linki, pola formularzy, zaznaczony tekst. */
  function czyNatywne(e) {
    if (e.shiftKey) return true;
    if (e.target.closest?.('a[href], input, textarea, select, [contenteditable="true"]')) return true;
    const zaznaczenie = window.getSelection?.();
    return Boolean(zaznaczenie && !zaznaczenie.isCollapsed && zaznaczenie.toString().trim() && zaznaczenie.containsNode?.(e.target, true));
  }

  function otworzMenuLeada(leadId, trigger) {
    const k = kartaDo(leadId);
    if (!k || !trigger) return;
    if (menu?.typ === 'lead' && menu.id === leadId && menu.trigger === trigger) { zamknijMenu({ przywroc: true }); return; }
    menu = { typ: 'lead', id: leadId, tytul: k.nazwa, ...kotwica(trigger), trigger, klawiatura: true };
  }

  function kontekstKarty(e, karta) {
    if (przeciagany) { e.preventDefault(); return; }
    if (czyNatywne(e)) return;
    e.preventDefault();
    menu = {
      typ: 'lead', id: karta.id, tytul: karta.nazwa,
      x: e.clientX, y: e.clientY, xAlt: e.clientX, yAlt: e.clientY,
      trigger: e.currentTarget.querySelector('.otworz'), klawiatura: false,
    };
  }

  function otworzMenuEtapu(etapId, trigger) {
    const etap = stan.etap(etapId);
    if (!etap || !trigger) return;
    if (menu?.typ === 'etap' && menu.id === etapId && menu.trigger === trigger) { zamknijMenu({ przywroc: true }); return; }
    menu = { typ: 'etap', id: etapId, tytul: `Etap: ${etap.nazwa}`, ...kotwica(trigger), trigger, klawiatura: true };
  }

  function kontekstEtapu(e, etapId) {
    if (przeciagany) { e.preventDefault(); return; }
    if (czyNatywne(e)) return;
    const etap = stan.etap(etapId);
    if (!etap) return;
    e.preventDefault();
    menu = {
      typ: 'etap', id: etapId, tytul: `Etap: ${etap.nazwa}`,
      x: e.clientX, y: e.clientY, xAlt: e.clientX, yAlt: e.clientY,
      trigger: e.currentTarget.querySelector('button[aria-haspopup="menu"]'), klawiatura: false,
    };
  }

  function zamknijMenu({ przywroc }) {
    const trigger = menu?.trigger;
    menu = null;
    if (przywroc && trigger?.isConnected) trigger.focus();
  }

  /** Shift+F10 i klawisz menu kontekstowego: menu dla elementu z fokusem — bez myszy. */
  function klawisz(e) {
    if (!korzen?.contains(e.target)) return;
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    if (e.target.closest?.('input, textarea, select')) return;
    const kartaEl = e.target.closest?.('[data-karta-id]');
    const etapEl = e.target.closest?.('[data-naglowek-etapu]');
    if (kartaEl) {
      e.preventDefault();
      const k = kartaDo(kartaEl.getAttribute('data-karta-id'));
      if (k) menu = { typ: 'lead', id: k.id, tytul: k.nazwa, ...kotwica(e.target), trigger: e.target, klawiatura: true };
    } else if (etapEl) {
      e.preventDefault();
      const etap = stan.etap(etapEl.getAttribute('data-naglowek-etapu'));
      if (etap) menu = { typ: 'etap', id: etap.id, tytul: `Etap: ${etap.nazwa}`, ...kotwica(e.target), trigger: e.target, klawiatura: true };
    }
  }

  async function kopiujLink(leadId) {
    const url = `${window.location.origin}${window.location.pathname}?lead=${encodeURIComponent(leadId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const pole = document.createElement('textarea');
      pole.value = url;
      pole.setAttribute('readonly', '');
      pole.style.position = 'fixed';
      pole.style.opacity = '0';
      document.body.append(pole);
      pole.select();
      try { document.execCommand('copy'); } catch { /* brak schowka — link i tak jest w pasku adresu po otwarciu szczegółów */ }
      pole.remove();
    }
    stan.ogloc('Skopiowano link do leada. Dostęp do niego nadal wymaga zalogowania.');
  }

  async function wybierzZMenu(p) {
    const m = menu;
    menu = null;
    const trigger = m.trigger;
    const dialogi = { przenies: 'przenies', dzialanie: 'dzialanie', notatka: 'notatka', opiekun: 'opiekun', archiwizuj: 'archiwum', sprzedaz: 'sprzedaz' };
    if (m.typ === 'lead') {
      if (p.id === 'otworz') return otworzSzczegoly(m.id, trigger);
      if (dialogi[p.id]) { dialog = { typ: dialogi[p.id], leadId: m.id, fokusPo: trigger }; return; }
      if (p.id === 'link') { await kopiujLink(m.id); trigger?.focus(); return; }
      return;
    }
    if (p.id === 'zwin') {
      stan.zwinEtap(m.id, true);
      await tick();
      korzen?.querySelector(`[data-zw-id="${m.id}"] .rozwin`)?.focus();
    } else if (p.id === 'rozwin') {
      stan.zwinEtap(m.id, false);
      await tick();
      korzen?.querySelector(`[data-kolumna-id="${m.id}"] button[aria-haspopup="menu"]`)?.focus();
    } else if (p.id === 'sortowanie') {
      dialog = { typ: 'sortowanie', etapId: m.id, fokusPo: trigger };
    }
  }

  // ── szczegóły, dialogi, przeniesienia ──────────────────────────────────────
  async function otworzSzczegoly(leadId, element) {
    fokusPoSzczegolach = element ?? null;
    stan.otworzSzczegoly(leadId);
    await tick();
    korzen?.querySelector('[data-szczegoly] h2')?.focus();
  }

  async function zamknijSzczegoly() {
    const id = stan.otwartyId;
    stan.zamknijSzczegoly();
    await tick();
    const cel = fokusPoSzczegolach?.isConnected ? fokusPoSzczegolach : korzen?.querySelector(`[data-karta-id="${id}"] .otworz`);
    cel?.focus();
    fokusPoSzczegolach = null;
  }

  function otworzDialog(d) {
    dialog = { ...d, fokusPo: document.activeElement };
  }

  function zamknijDialog({ przywroc }) {
    const fokus = dialog?.fokusPo;
    dialog = null;
    if (przywroc) tick().then(() => { if (fokus?.isConnected) fokus.focus(); });
  }

  /** Wspólne wejście dla przeciągania, menu i szczegółów. */
  async function przeniesZUi(leadId, etapId, fokusPo) {
    const r = await stan.przenies(leadId, etapId);
    if (r.status === 'potrzebne_dane') {
      const typ = r.pola?.includes('skladka_roczna') ? 'sprzedaz' : 'powod';
      dialog = { typ, leadId, etapId, fokusPo: fokusPo ?? document.activeElement };
    }
    return r;
  }

  function wykonajAkcje(akcja) {
    stan.zamknijToast();
    if (akcja.id === 'cofnij') przeniesZUi(akcja.leadId, akcja.etapId);
    else if (akcja.id === 'otworz') otworzSzczegoly(akcja.leadId, null);
    else if (akcja.id === 'ponow') stan.ponowZapis(akcja.leadId);
  }

  function ustawWidok(w) {
    stan.widok = w;
    if (w === 'lista') for (const e of stan.etapy) if (!stan.kolumny[e.id].zaladowana && !stan.kolumny[e.id].ladowanie) stan.ladujKolumne(e.id);
  }

  function wybierzEtapMobilny(id) {
    stan.etapMobilny = id;
    const kol = stan.kolumny[id];
    if (!kol.zaladowana && !kol.ladowanie) stan.ladujKolumne(id);
  }

  setContext('tablica', {
    stan,
    get teraz() { return teraz; },
    get mobilny() { return mobilny; },
    get cel() { return cel; },
    get menuOtwarteDla() { return menu?.typ === 'lead' ? menu.id : null; },
    get menuEtapuOtwarteDla() { return menu?.typ === 'etap' ? menu.id : null; },
    otworzSzczegoly,
    otworzMenuLeada,
    kontekstKarty,
    otworzMenuEtapu,
    kontekstEtapu,
    przeniesZUi,
    otworzDialog,
    ponowZapis: (id) => stan.ponowZapis(id),
    ustawWidok,
    zmienPipeline,
  });

  // ── przeciąganie ───────────────────────────────────────────────────────────
  async function otworzPodglad(etapId) {
    await stan.otworzPodglad(etapId);
    const el = korzen?.querySelector(`[data-zw-id="${etapId}"]`);
    if (!el || !przeciagany) return;
    const r = el.getBoundingClientRect();
    podgladPoz = { left: r.right + 8, top: Math.max(8, Math.min(r.top, window.innerHeight - 380)) };
  }

  function zakonczPrzeciaganie() {
    przeciagany = null;
    cel = null;
    podgladPoz = null;
    stan.zamknijPodglad();
    stan.wstrzymajOdswiezanie(false);
  }

  $effect(() => {
    if (!korzen) return;
    const kontroler = utworzPrzeciaganie({
      korzen,
      czyMoznaZaczac: () => !mobilny && stan.widok === 'kanban',
      ocen: (leadId, etapId) => {
        const k = stan.znajdz(leadId)?.karta;
        const e = stan.etap(etapId);
        return k && e ? czyMoznaPrzeniesc(k, e, { zapisWToku: stan.czyZapisWToku(leadId) }) : { ok: false, powod: 'Lead nie jest już widoczny.' };
      },
      onStart: (leadId) => {
        menu = null;
        przeciagany = { leadId };
        stan.wstrzymajOdswiezanie(true);
      },
      onCel: (c, w) => { cel = c; wskaznik = w; },
      onRuch: (w) => { wskaznik = w; },
      onUpusc: (leadId, etapId) => {
        zakonczPrzeciaganie();
        przeniesZUi(leadId, etapId);
      },
      onOdmowa: (leadId, etapId, powod) => {
        zakonczPrzeciaganie();
        stan.zglosBlad(powod);
      },
      onAnuluj: (leadId, przyczyna) => {
        zakonczPrzeciaganie();
        stan.ogloc(przyczyna === 'poza' ? 'Upuszczono poza etapem — nic nie zmieniono.' : 'Przeciąganie anulowane — nic nie zmieniono.', { toast: false });
      },
      onPodglad: (etapId) => { otworzPodglad(etapId); },
    });
    return () => kontroler.zniszcz();
  });

  // ── cykl życia ─────────────────────────────────────────────────────────────
  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const aktualizuj = () => { mobilny = mq.matches; };
    aktualizuj();
    mq.addEventListener('change', aktualizuj);
    const zegarId = setInterval(() => { teraz = zegar(); }, 60_000);
    return () => {
      mq.removeEventListener('change', aktualizuj);
      clearInterval(zegarId);
      stan.zniszcz();
    };
  });

  $effect(() => {
    if (mobilny && stan.widok === 'kanban' && etapMobilny) {
      const kol = stan.kolumny[etapMobilny.id];
      if (kol && !kol.zaladowana && !kol.ladowanie && !kol.blad) stan.ladujKolumne(etapMobilny.id);
    }
  });

  const celEtap = $derived(cel ? stan.etap(cel.etapId) : null);
  const kolPodgladu = $derived(stan.podglad ? stan.kolumny[stan.podglad] : null);
  const etapPodgladu = $derived(stan.podglad ? stan.etap(stan.podglad) : null);
</script>

<svelte:window onkeydown={klawisz} />

<div class="tablica" class:mobilny data-tablica bind:this={korzen}>
  <Powiadomienia {stan} onakcja={wykonajAkcje} />
  <Pasek />

  {#if mobilny && stan.widok === 'kanban'}
    <div class="etapy-mobilne" role="group" aria-label="Etapy">
      {#each stan.etapy as e (e.id)}
        <button type="button" aria-pressed={e.id === etapMobilny?.id} onclick={() => wybierzEtapMobilny(e.id)}>
          {e.nazwa} <span class="licznik">{stan.liczniki[e.id]?.ile ?? 0}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="obszar">
    {#if stan.widok === 'kanban' && !mobilny}
      <Zwiniete etapy={zwinieteEtapy} />
    {/if}

    <div class="kolumny" data-przewijanie-poziome data-widok={stan.widok}>
      {#if stan.widok === 'lista'}
        <div class="lista-pion">
          {#each stan.etapy as etap (etap.id)}<Kolumna {etap} uklad="lista" />{/each}
        </div>
      {:else if mobilny}
        {#if etapMobilny}<Kolumna etap={etapMobilny} />{/if}
      {:else}
        {#each rozwiniete as etap (etap.id)}<Kolumna {etap} />{/each}
        {#if rozwiniete.length === 0}
          <p class="puste-etapy">Wszystkie etapy są zwinięte. <button type="button" class="link" onclick={() => stan.rozwinWszystkie()}>Rozwiń wszystkie</button></p>
        {/if}
      {/if}
    </div>

    {#if stan.otwartyId}
      <div class="sz-wrap" class:mobilny>
        <Szczegoly onzamknij={zamknijSzczegoly} />
      </div>
    {/if}
  </div>

  <Menu {menu} pozycje={pozycjeMenu} onwybierz={wybierzZMenu} onzamknij={zamknijMenu} />

  {#if dialog}
    {#key dialog}
      {#if dialog.typ === 'przenies'}<DialogPrzenies {dialog} onzamknij={zamknijDialog} />
      {:else if dialog.typ === 'powod'}<DialogPowodu {dialog} onzamknij={zamknijDialog} />
      {:else if dialog.typ === 'sprzedaz'}<DialogSprzedazy {dialog} onzamknij={zamknijDialog} />
      {:else if dialog.typ === 'dzialanie'}<DialogDzialania {dialog} onzamknij={zamknijDialog} />
      {:else if dialog.typ === 'notatka'}<DialogNotatki {dialog} onzamknij={zamknijDialog} />
      {:else if dialog.typ === 'opiekun'}<DialogOpiekuna {dialog} onzamknij={zamknijDialog} />
      {:else if dialog.typ === 'archiwum'}<DialogArchiwum {dialog} onzamknij={zamknijDialog} />
      {:else if dialog.typ === 'sortowanie'}<DialogSortowania {dialog} onzamknij={zamknijDialog} />
      {/if}
    {/key}
  {/if}

  {#if przeciagany && podgladPoz && etapPodgladu && kolPodgladu}
    <div
      class="podglad"
      class:cel-ok={cel?.etapId === etapPodgladu.id && cel.ok}
      class:cel-blokada={cel?.etapId === etapPodgladu.id && !cel.ok}
      data-podglad
      data-cel-etap={etapPodgladu.id}
      style="left:{podgladPoz.left}px; top:{podgladPoz.top}px"
      aria-hidden="true"
    >
      <p class="tytul">{etapPodgladu.nazwa} · {stan.liczniki[etapPodgladu.id]?.ile ?? kolPodgladu.razem}</p>
      <ul>
        {#each kolPodgladu.karty.slice(0, 6) as k (k.id)}<li>{k.nazwa}</li>{/each}
      </ul>
      {#if kolPodgladu.razem > 6}<p class="wiecej">…i {kolPodgladu.razem - 6} więcej</p>{/if}
      {#if kolPodgladu.karty.length === 0}<p class="wiecej">{kolPodgladu.ladowanie ? 'Ładowanie…' : 'Brak leadów w tym etapie.'}</p>{/if}
      <p class="cel-opis">Upuść tutaj, aby przenieść do: {etapPodgladu.nazwa}</p>
    </div>
  {/if}

  {#if przeciagany && cel && celEtap}
    <div class="plywajaca" class:blokada={!cel.ok} data-cel-podpowiedz style="left:{wskaznik.x + 16}px; top:{wskaznik.y + 20}px" aria-hidden="true">
      {cel.ok ? `Przenieś do: ${celEtap.nazwa}` : `Niedostępne: ${cel.powod}`}
    </div>
  {/if}
</div>

<style>
  .tablica {
    display: flex; flex-direction: column; height: calc(100dvh - 5.6rem); min-height: 34rem;
    --szerokosc-kolumny: 20rem;
  }
  .obszar { flex: 1; min-height: 0; display: flex; gap: .75rem; }
  .kolumny { flex: 1; min-width: 0; display: flex; gap: .875rem; overflow-x: auto; overflow-y: hidden; padding-bottom: .5rem; align-items: stretch; }
  .kolumny[data-widok='lista'] { overflow-y: auto; overflow-x: hidden; display: block; }
  .lista-pion { display: flex; flex-direction: column; gap: .75rem; max-width: 46rem; }
  .puste-etapy { margin: 1rem; font-size: .9rem; color: var(--slate-600); }
  .link { background: none; border: 0; padding: 0; font: inherit; font-weight: 700; color: var(--blue-700); text-decoration: underline; cursor: pointer; }
  .sz-wrap { display: flex; min-height: 0; flex: none; }

  .etapy-mobilne { flex: none; display: flex; gap: .4rem; overflow-x: auto; padding-bottom: .5rem; }
  .etapy-mobilne button {
    flex: none; border: 1px solid var(--slate-300); border-radius: 999px; background: #fff; padding: .4rem .8rem;
    font: inherit; font-size: .85rem; font-weight: 700; color: var(--slate-700); cursor: pointer; white-space: nowrap;
  }
  .etapy-mobilne button[aria-pressed='true'] { background: var(--slate-800); color: #fff; border-color: var(--slate-800); }
  .etapy-mobilne button:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
  .licznik { margin-left: .2rem; font-weight: 800; }

  .tablica.mobilny { height: auto; min-height: 0; }
  .mobilny .obszar { flex-direction: column; }
  .mobilny .kolumny { flex-direction: column; overflow: visible; }
  .mobilny :global(.kolumna) { width: 100%; flex: none; max-height: none; }
  .mobilny :global(.lista-kart) { overflow: visible; }
  .sz-wrap.mobilny { position: fixed; inset: 0; z-index: 1000; background: var(--slate-100); padding: .6rem; overflow-y: auto; }
  .sz-wrap.mobilny :global(.szczegoly) { width: 100%; flex: 1 1 auto; max-height: none; }

  .podglad {
    position: fixed; z-index: 1600; width: 20rem; max-height: 22rem; overflow: hidden; background: #fff;
    border: 2px solid var(--blue-600); border-radius: 12px; padding: .7rem .8rem; box-shadow: 0 14px 32px rgba(15, 23, 42, .3);
  }
  .podglad.cel-ok { background: #dbeafe; }
  .podglad.cel-blokada { border-color: var(--red-600); background: #fee2e2; }
  .podglad .tytul { margin: 0 0 .4rem; font-size: .9rem; font-weight: 800; }
  .podglad ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .25rem; font-size: .84rem; }
  .podglad li { padding: .3rem .5rem; background: var(--slate-100); border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .podglad .wiecej { margin: .3rem 0 0; font-size: .78rem; color: var(--slate-600); }
  .podglad .cel-opis { margin: .5rem 0 0; font-size: .8rem; font-weight: 700; color: var(--blue-700); }
  .plywajaca {
    position: fixed; z-index: 2100; pointer-events: none; max-width: 22rem; padding: .35rem .6rem; border-radius: 8px;
    font-size: .8rem; font-weight: 700; background: var(--slate-800); color: #fff; box-shadow: 0 6px 16px rgba(15, 23, 42, .3);
  }
  .plywajaca.blokada { background: #991b1b; }

  :global(html[data-przeciaganie]), :global(html[data-przeciaganie] *) { cursor: grabbing !important; user-select: none !important; }
</style>
