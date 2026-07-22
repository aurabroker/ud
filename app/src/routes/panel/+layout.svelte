<script>
  let { data, children } = $props();
  const name = data.profile?.full_name || data.user?.email || 'Agent';
  const role = data.profile?.role || 'user';
</script>

<header class="header">
  <a href="/panel" style="color:#fff;text-decoration:none;" class="logo">Utrata<span>Dochodu</span></a>
  <div style="display:flex;align-items:center;gap:1rem;">
    <div style="text-align:right;line-height:1.2;">
      <div style="font-size:.85rem;font-weight:600;">{name}</div>
      <div style="font-size:.72rem;color:var(--slate-400);">{role}</div>
    </div>
    <form method="POST" action="/logout"><button class="btn btn-ghost" style="color:#fff;border-color:#475569;">Wyloguj</button></form>
  </div>
</header>

<main class="container">
  {@render children()}
</main>
