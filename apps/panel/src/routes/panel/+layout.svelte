<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { APP_VERSION } from '$lib/version.js';
  let { data, children } = $props();

  /**
   * Ile kontaktów czeka na liście „Niedokończone" (porzucony wniosek ze zgodą,
   * nieoznaczony jako „Obsłużony"). Dopóki > 0, zakładka miga na czerwono.
   * Liczba przychodzi z load (każda nawigacja) i z odpytywania co minutę —
   * nowy kontakt ma być widać bez przeładowania strony.
   */
  let niedokonczoneOdpytane = $state(null);
  const niedokonczone = $derived(niedokonczoneOdpytane ?? data.niedokonczone ?? 0);
  $effect(() => { data.niedokonczone; niedokonczoneOdpytane = null; });

  onMount(() => {
    const odpytaj = async () => {
      try {
        const r = await fetch('/panel/api/niedokonczone', { headers: { accept: 'application/json' } });
        if (r.ok) {
          const { ile } = await r.json();
          if (typeof ile === 'number') niedokonczoneOdpytane = ile;
        }
      } catch { /* sieć — spróbujemy za minutę */ }
    };
    const id = setInterval(odpytaj, 60_000);
    return () => clearInterval(id);
  });

  const kontaktow = (n) => `${n} ${n === 1 ? 'kontakt czeka' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'kontakty czekają' : 'kontaktów czeka'}`;
  const name = data.profile?.full_name || data.user?.email || 'Agent';
  const role = data.profile?.role || 'user';
  const isAdmin = role === 'admin';

  const tabs = [
    { href: '/panel/leady', label: 'Leady' },
    { href: '/panel/statystyki', label: 'Statystyki' },
    { href: '/panel/klienci', label: 'Klienci' },
    { href: '/panel/niedokonczone', label: 'Niedokończone', alarm: true },
    { href: '/panel', label: 'Oferty', exact: true },
    { href: '/panel/owu', label: 'Biblioteka OWU' },
    { href: '/panel/logi', label: 'Wysyłki' },
    ...(isAdmin ? [{ href: '/panel/admin', label: 'Panel Admina' }] : []),
    ...(isAdmin ? [{ href: '/panel/ustawienia', label: 'Ustawienia' }] : [])
  ];

  function active(tab) {
    const p = $page.url.pathname;
    if (tab.exact) return p === tab.href;
    return p === tab.href || p.startsWith(tab.href + '/');
  }
</script>

<header class="header">
  <div style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;">
    <a href="/panel" style="color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:.45rem;" class="logo">
      <span style="display:inline-flex;width:28px;height:28px;background:#38bdf8;color:#0f172a;border-radius:7px;align-items:center;justify-content:center;font-weight:900;font-size:1.05rem;">U</span>
      Utrata<span>Dochodu</span>
    </a>
    <nav style="display:flex;gap:.25rem;flex-wrap:wrap;">
      {#each tabs as tab}
        {@const alarm = tab.alarm && niedokonczone > 0}
        <a href={tab.href}
          class:alarm
          data-zakladka={tab.href}
          aria-label={alarm ? `${tab.label} — ${kontaktow(niedokonczone)}` : undefined}
          style="color:{active(tab) || alarm ? '#fff' : '#94a3b8'};text-decoration:none;font-size:.9rem;font-weight:{active(tab) || alarm ? '700' : '500'};padding:.4rem .7rem;border-radius:7px;background:{active(tab) ? 'rgba(255,255,255,.12)' : 'transparent'};">
          {tab.label}{#if alarm}<span class="licznik-alarmu" aria-hidden="true">{niedokonczone}</span>{/if}
        </a>
      {/each}
    </nav>
  </div>
  <div style="display:flex;align-items:center;gap:1rem;">
    <div style="text-align:right;line-height:1.2;">
      <div style="font-size:.85rem;font-weight:600;">{name}</div>
      <div style="font-size:.72rem;color:var(--slate-400);">{role} · <span title="Wersja aplikacji">{APP_VERSION}</span></div>
    </div>
    <form method="POST" action="/logout"><button class="btn btn-ghost" style="color:#fff;border-color:#475569;">Wyloguj</button></form>
  </div>
</header>

<main class="container">
  {@render children()}
</main>

<style>
  /*
   * Zakładka „Niedokończone" miga, dopóki na liście czeka kontakt. Biały tekst na
   * #dc2626 ma 4,8:1. Kto ma w systemie ograniczone animacje, widzi stałą czerwień.
   */
  a.alarm { animation: alarm-niedokonczone 1.2s ease-in-out infinite; }
  @keyframes alarm-niedokonczone {
    0%, 100% { background: #dc2626; }
    50% { background: #7f1d1d; }
  }
  .licznik-alarmu {
    display: inline-block; margin-left: .35rem; min-width: 1.25rem; padding: 0 .35rem; border-radius: 999px;
    background: #fff; color: #991b1b; font-size: .72rem; font-weight: 800; text-align: center; line-height: 1.25rem;
  }
  @media (prefers-reduced-motion: reduce) {
    a.alarm { animation: none; background: #dc2626 !important; }
  }
</style>
