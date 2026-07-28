<script>
  import { enhance } from '$app/forms';
  import { dateP } from '$lib/format.js';
  let { data, form } = $props();
  let showNew = $state(false);
  let pwFor = $state(null); // id usera, dla którego zmieniamy hasło
</script>

<svelte:head><title>Panel Admina — Panel</title></svelte:head>

<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
  <div>
    <h1 style="font-size:1.5rem;">Panel Admina</h1>
    <p class="muted">Zarządzanie użytkownikami ({data.users.length})</p>
  </div>
  <button class="btn btn-primary" onclick={() => (showNew = !showNew)}>{showNew ? 'Anuluj' : '+ Nowy użytkownik'}</button>
</div>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}
{#if form?.ok}<div class="ok-box">Zapisano.</div>{/if}

{#if showNew}
  <div class="card card-pad" style="margin-bottom:1.25rem;">
    <h3 style="font-size:1rem;margin-bottom:1rem;">Nowy użytkownik</h3>
    <form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update(); showNew = false; }}>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <div class="field"><label class="label" for="n_email">Email</label>
          <input class="input" id="n_email" name="email" type="email" required /></div>
        <div class="field"><label class="label" for="n_name">Imię i nazwisko</label>
          <input class="input" id="n_name" name="fullName" /></div>
        <div class="field"><label class="label" for="n_pass">Hasło (min. 6)</label>
          <input class="input" id="n_pass" name="password" type="text" required /></div>
        <div class="field"><label class="label" for="n_role">Rola</label>
          <select class="input" id="n_role" name="role"><option value="user">user</option><option value="admin">admin</option></select></div>
      </div>
      <button class="btn btn-primary" type="submit">Utwórz</button>
    </form>
  </div>
{/if}

<div class="card">
  <table>
    <thead><tr><th>Użytkownik</th><th>Email</th><th>Rola</th><th>Aktywny</th><th>Dodano</th><th></th></tr></thead>
    <tbody>
      {#each data.users as u}
        <tr style={u.active ? '' : 'opacity:.55;'}>
          <td style="font-weight:600;">{u.full_name || '—'}</td>
          <td class="muted">{u.email || '—'}</td>
          <td>
            <form method="POST" action="?/update" use:enhance style="display:inline;">
              <input type="hidden" name="id" value={u.id} />
              <select class="input" name="role" style="padding:.3rem .5rem;font-size:.82rem;width:auto;" onchange={(e) => e.target.form.requestSubmit()}>
                <option value="user" selected={u.role !== 'admin'}>user</option>
                <option value="admin" selected={u.role === 'admin'}>admin</option>
              </select>
            </form>
          </td>
          <td>
            <form method="POST" action="?/update" use:enhance style="display:inline;">
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="active" value={(!u.active).toString()} />
              <button class="btn btn-ghost" style="padding:.25rem .6rem;font-size:.78rem;">{u.active ? 'Wyłącz' : 'Włącz'}</button>
            </form>
          </td>
          <td class="muted">{dateP(u.created_at)}</td>
          <td style="text-align:right;">
            {#if pwFor === u.id}
              <form method="POST" action="?/setPassword" use:enhance={() => async ({ update }) => { await update(); pwFor = null; }} style="display:inline-flex;gap:.3rem;">
                <input type="hidden" name="id" value={u.id} />
                <input class="input" name="password" placeholder="nowe hasło" style="padding:.25rem .5rem;font-size:.8rem;width:120px;" />
                <button class="btn btn-primary" style="padding:.25rem .6rem;font-size:.78rem;">OK</button>
              </form>
            {:else}
              <button class="btn btn-ghost" style="padding:.25rem .6rem;font-size:.78rem;" onclick={() => (pwFor = u.id)}>Zmień hasło</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
