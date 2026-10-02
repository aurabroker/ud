<script>
  import { goto } from '$app/navigation';
  import { formatKwota } from '$lib/leady/model.js';

  let { data } = $props();
  const st = $derived(data.st);
  const p = $derived(st?.podsumowanie);
  const admin = $derived(st?.rola === 'admin');

  const OKRESY = [
    { id: 'wszystko', nazwa: 'Cały czas' },
    { id: 'miesiac', nazwa: 'Ten miesiąc' },
    { id: 'poprzedni', nazwa: 'Poprzedni miesiąc' },
    { id: 'kwartal', nazwa: 'Ten kwartał' },
    { id: 'rok', nazwa: 'Ten rok' },
  ];
  const RYZYKA = [
    { id: 'okresowa', nazwa: 'Okresowa niezdolność do pracy', jednostka: ' / mies.', opis: 'świadczenie miesięczne' },
    { id: 'trwala', nazwa: 'Trwała niezdolność do pracy', jednostka: '', opis: 'suma ubezpieczenia' },
    { id: 'zgon', nazwa: 'Zgon', jednostka: '', opis: 'suma ubezpieczenia' },
  ];

  const kwota = (n) => (n == null ? '—' : formatKwota(n));
  const sprzedazy = (n) => `${n} ${n === 1 ? 'sprzedaż' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'sprzedaże' : 'sprzedaży'}`;
  const nazwaAgenta = $derived(st?.agent ? (st.agenci?.find((a) => a.id === st.agent)?.nazwa ?? null) : null);

  /** Filtry działają też bez JS (zwykły GET); z JS zmiana pola od razu odświeża widok. */
  function zmien(e) {
    const f = new FormData(e.currentTarget.form);
    const q = new URLSearchParams();
    for (const [k, v] of f) if (v && !(k === 'okres' && v === 'wszystko')) q.set(k, String(v));
    goto(`?${q}`, { keepFocus: true, noScroll: true, replaceState: true });
  }
</script>

<svelte:head><title>Statystyki sprzedaży — Panel</title></svelte:head>

<div class="naglowek">
  <div>
    <h1>Statystyki sprzedaży</h1>
    <p class="muted">
      {#if !st}&nbsp;
      {:else if admin}{nazwaAgenta ? `Sprzedaże: ${nazwaAgenta}.` : 'Wszyscy agenci.'}
      {:else}Twoje sprzedaże.{/if}
      Sprzedaż to lead w etapie „Wygrany" — także zarchiwizowany. Kwoty pochodzą z danych sprzedaży wpisanych przy wygraniu.
    </p>
  </div>
  <form method="GET" class="filtry">
    <label>
      <span class="label">Okres</span>
      <select name="okres" class="input" value={st?.okres ?? 'wszystko'} onchange={zmien}>
        {#each OKRESY as o (o.id)}<option value={o.id}>{o.nazwa}</option>{/each}
      </select>
    </label>
    {#if admin}
      <label>
        <span class="label">Agent</span>
        <select name="agent" class="input" value={st?.agent ?? ''} onchange={zmien}>
          <option value="">Wszyscy</option>
          {#each st.agenci ?? [] as a (a.id)}<option value={a.id}>{a.nazwa}</option>{/each}
        </select>
      </label>
    {/if}
    <noscript><button class="btn btn-primary">Pokaż</button></noscript>
  </form>
</div>

{#if data.blad}
  <div class="error-box" role="alert">{data.blad}</div>
{:else if st && p}
  <section class="kafle" aria-label="Składki">
    <div class="card kafel">
      <p class="et">Sprzedaże</p>
      <p class="liczba" data-stat="sprzedaze">{p.sprzedaze}</p>
      <p class="muted">{p.z_danymi === p.sprzedaze ? 'wszystkie z kwotami' : `${p.z_danymi} z kwotami — ${p.sprzedaze - p.z_danymi} do uzupełnienia`}</p>
    </div>
    <div class="card kafel">
      <p class="et">Składka roczna — suma</p>
      <p class="liczba" data-stat="roczna">{kwota(p.skladka_roczna_suma)}</p>
      <p class="muted">średnio {kwota(p.skladka_roczna_srednia)} na sprzedaż</p>
    </div>
    <div class="card kafel">
      <p class="et">Składki miesięczne — suma</p>
      <p class="liczba" data-stat="mies-suma">{kwota(p.skladka_mies_suma)}</p>
      <p class="muted">
        {#if p.skladka_mies_wyliczonych}w tym {p.skladka_mies_wyliczonych} wyliczon{p.skladka_mies_wyliczonych === 1 ? 'a' : 'e'} jako 1/12 rocznej{:else}z danych sprzedaży{/if}
      </p>
    </div>
    <div class="card kafel">
      <p class="et">Składka miesięczna — średnia</p>
      <p class="liczba" data-stat="mies-srednia">{kwota(p.skladka_mies_srednia)}</p>
      <p class="muted">na jedną sprzedaż z kwotami</p>
    </div>
  </section>

  <section class="card card-pad" aria-labelledby="st-swiadczenia">
    <h2 id="st-swiadczenia">Wysokość świadczeń w sprzedanych wariantach</h2>
    <div class="przewijanie">
      <table>
        <thead>
          <tr><th scope="col">Ryzyko</th><th scope="col">Sprzedaży z ryzykiem</th><th scope="col">Łącznie</th><th scope="col">Średnio</th></tr>
        </thead>
        <tbody>
          {#each RYZYKA as r (r.id)}
            <tr data-ryzyko={r.id}>
              <th scope="row">{r.nazwa}<span class="muted"> · {r.opis}</span></th>
              <td>{p[r.id].n}</td>
              <td>{p[r.id].n ? `${kwota(p[r.id].suma)}${r.jednostka}` : '—'}</td>
              <td>{p[r.id].n ? `${kwota(p[r.id].srednia)}${r.jednostka}` : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  {#if st.wg_agentow?.length}
    <section class="card card-pad" aria-labelledby="st-agenci">
      <h2 id="st-agenci">Według agentów</h2>
      <div class="przewijanie">
        <table>
          <thead>
            <tr><th scope="col">Agent</th><th scope="col">Sprzedaże</th><th scope="col">Składka roczna — suma</th><th scope="col">Składki mies. — suma</th><th scope="col">Składka mies. — średnia</th></tr>
          </thead>
          <tbody>
            {#each st.wg_agentow as a (a.agent_id ?? 'brak')}
              <tr>
                <th scope="row">
                  {#if a.agent_id}<a href="?agent={a.agent_id}{st.okres !== 'wszystko' ? `&okres=${st.okres}` : ''}">{a.nazwa}</a>{:else}{a.nazwa}{/if}
                </th>
                <td>{a.sprzedaze}{a.z_danymi < a.sprzedaze ? ` (${a.sprzedaze - a.z_danymi} bez kwot)` : ''}</td>
                <td>{kwota(a.skladka_roczna_suma)}</td>
                <td>{kwota(a.skladka_mies_suma)}</td>
                <td>{kwota(a.skladka_mies_srednia)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  {#if st.bez_danych?.length}
    <section class="card card-pad uzupelnij" aria-labelledby="st-bez">
      <h2 id="st-bez">Do uzupełnienia: {sprzedazy(st.bez_danych.length)} bez kwot</h2>
      <p class="muted">Bez składki rocznej sprzedaż liczy się tylko w liczbie sprzedaży. Otwórz lead i wybierz „Uzupełnij dane sprzedaży".</p>
      <ul>
        {#each st.bez_danych as b (b.id)}
          <li>{#if b.archiwum}{b.nazwa} <span class="muted">(zarchiwizowany)</span>{:else}<a href="/panel/leady?lead={b.id}">{b.nazwa}</a>{/if}</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if p.sprzedaze === 0}
    <p class="muted pusto">Brak sprzedaży w wybranym okresie.</p>
  {/if}
{/if}

<style>
  .naglowek { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 1rem; margin-bottom: 1.25rem; }
  h1 { font-size: 1.5rem; }
  .naglowek .muted { max-width: 40rem; margin-top: .25rem; }
  .filtry { display: flex; gap: .75rem; flex-wrap: wrap; align-items: flex-end; }
  .filtry .input { width: auto; min-width: 11rem; }
  .kafle { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .9rem; margin-bottom: 1.1rem; }
  .kafel { padding: 1rem 1.15rem; }
  .et { font-size: .8rem; font-weight: 700; color: var(--slate-600); margin: 0; }
  .liczba { font-size: 1.6rem; font-weight: 800; color: var(--slate-900); margin: .25rem 0 .15rem; font-variant-numeric: tabular-nums; }
  section.card-pad { margin-bottom: 1.1rem; }
  h2 { font-size: 1.05rem; margin: 0 0 .75rem; }
  .przewijanie { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--slate-200); }
  thead th { font-size: .78rem; color: var(--slate-600); font-weight: 700; }
  td { font-variant-numeric: tabular-nums; }
  tbody th { font-weight: 600; }
  .uzupelnij { border-color: #f59e0b; }
  .uzupelnij ul { margin: .5rem 0 0; padding-left: 1.1rem; }
  .pusto { text-align: center; margin: 1.5rem 0; }
  a { color: var(--blue-700); }
</style>
