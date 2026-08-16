<script>
  import { page } from '$app/stores';
  import { APP_VERSION } from '$lib/version.js';
  let { data, children } = $props();
  const name = data.profile?.full_name || data.user?.email || 'Agent';
  const role = data.profile?.role || 'user';
  const isAdmin = role === 'admin';

  const tabs = [
    { href: '/panel/klienci', label: 'Klienci' },
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
        <a href={tab.href}
          style="color:{active(tab) ? '#fff' : '#94a3b8'};text-decoration:none;font-size:.9rem;font-weight:{active(tab) ? '700' : '500'};padding:.4rem .7rem;border-radius:7px;background:{active(tab) ? 'rgba(255,255,255,.12)' : 'transparent'};">
          {tab.label}
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
