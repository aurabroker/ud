<script>
  import { invalidateAll } from '$app/navigation';
  import { formatKwota } from '$lib/leady/model.js';
  import DialogPolisy from '$lib/statystyki/DialogPolisy.svelte';
  import Filtry from '$lib/statystyki/Filtry.svelte';
  import { adresFiltra } from '$lib/statystyki/filtr.js';

  let { data } = $props();
  const st = $derived(data.st);
  const p = $derived(st?.podsumowanie);
  const admin = $derived(st?.rola === 'admin');

  // Nazwy bez „niezdolność do pracy" i „świadczenie miesięczne" (decyzja z 04.10.2026);
  // to, że okresowa jest miesięczna, mówi jednostka przy kwocie.
  const RYZYKA = [
    { id: 'okresowa', nazwa: 'Okresowa', jednostka: ' / mies.', opis: null },
    { id: 'trwala', nazwa: 'Trwała', jednostka: '', opis: 'suma ubezpieczenia' },
    { id: 'zgon', nazwa: 'Zgon', jednostka: '', opis: 'suma ubezpieczenia' },
  ];

  const kwota = (n) => (n == null ? '—' : formatKwota(n));
  const procent = (n) => (n == null ? null : `${String(Number(n)).replace('.', ',')}%`);
  const odmiana = (n, jeden, kilka, wiele) => `${n} ${n === 1 ? jeden : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? kilka : wiele}`;
  const sprzedazy = (n) => odmiana(n, 'sprzedaż', 'sprzedaże', 'sprzedaży');
  const nazwaAgenta = $derived(st?.agent ? (st.agenci?.find((a) => a.id === st.agent)?.nazwa ?? null) : null);
  const maxRoczna = $derived(Math.max(1, ...(st?.wg_agentow ?? []).map((a) => Number(a.skladka_roczna_suma) || 0)));

  const adres = (zmiana) => adresFiltra({ okres: st?.okres, agent: admin ? st?.agent : null }, zmiana);

  let dodawanie = $state(false);
  let dodano = $state(null);
  async function zapisano(w) {
    dodawanie = false;
    dodano = w;
    await invalidateAll();
  }
</script>

<svelte:head><title>Statystyki sprzedaży — Panel</title></svelte:head>

<div class="naglowek">
  <div class="tytul">
    <h1>Statystyki sprzedaży</h1>
    <p class="muted">
      {#if !st}&nbsp;
      {:else if admin}{nazwaAgenta ? `Sprzedaże: ${nazwaAgenta}.` : 'Wszyscy agenci.'}
      {:else}Twoje sprzedaże.{/if}
      Sprzedaż to lead w etapie „Wygrany" — także zarchiwizowany. Składki bez opłaty dystrybucyjnej.
    </p>
  </div>
  {#if st}
    <button type="button" class="btn btn-primary" onclick={() => { dodano = null; dodawanie = true; }} data-dodaj-polise>+ Dodaj polisę</button>
  {/if}
</div>

{#if st}
  <Filtry okres={st.okres} agent={st.agent} agenci={st.agenci} {admin} />
{/if}

{#if dodano}
  <div class="ok-box" role="status" data-dodano>
    Dodano sprzedaż: <a href="/panel/leady?lead={dodano.leadId}">{dodano.nazwa}</a>{dodano.plik ? ' (z polisą)' : dodano.bezPliku ? ' — plik polisy nie został wgrany' : ''}.
  </div>
{/if}

{#if data.blad}
  <div class="error-box" role="alert">{data.blad}</div>
{:else if st && p}
  <section class="kafle" aria-label="Podsumowanie">
    <div class="kafel k-sprzedaze">
      <p class="et">Sprzedaże</p>
      <p class="liczba" data-stat="sprzedaze">{p.sprzedaze}</p>
      <p class="pod">{p.z_danymi === p.sprzedaze ? 'wszystkie z kwotami' : `${p.z_danymi} z kwotami — ${p.sprzedaze - p.z_danymi} do uzupełnienia`}</p>
    </div>
    <div class="kafel k-roczna">
      <p class="et">Składka roczna</p>
      <p class="liczba" data-stat="roczna">{kwota(p.skladka_roczna_suma)}</p>
      <p class="pod">średnio {kwota(p.skladka_roczna_srednia)} na sprzedaż</p>
    </div>
    <div class="kafel k-mies">
      <p class="et">Składki miesięczne</p>
      <p class="liczba" data-stat="mies-suma">{kwota(p.skladka_mies_suma)}</p>
      <p class="pod">
        średnio <span data-stat="mies-srednia">{kwota(p.skladka_mies_srednia)}</span>{#if p.skladka_mies_wyliczonych}{` · w tym ${p.skladka_mies_wyliczonych} wyliczon${p.skladka_mies_wyliczonych === 1 ? 'a' : 'e'} jako 1/12 rocznej`}{/if}
      </p>
    </div>
    <div class="kafel k-prowizja">
      <p class="et">{admin ? 'Prowizja' : 'Twoja prowizja'}</p>
      <p class="liczba" data-stat="prowizja">{kwota(p.prowizja_suma)}</p>
      <p class="pod" data-stawka>
        {#if st.stawka != null}{procent(st.stawka)} składki rocznej{:else if admin && !st.agent}według stawek agentów{:else}stawka nieustawiona{/if}
      </p>
      {#if p.bez_stawki}
        <p class="uwaga-mala" data-bez-stawki>
          {sprzedazy(p.bez_stawki)} bez stawki — {admin ? 'ustaw ją w Panelu Admina' : 'stawkę ustawia administrator'}.
        </p>
      {/if}
    </div>
  </section>

  {#if st.wg_agentow?.length}
    <section class="card blok" aria-labelledby="st-agenci">
      <h2 id="st-agenci">Według agentów</h2>
      <div class="przewijanie">
        <table>
          <thead>
            <tr>
              <th scope="col">Agent</th><th scope="col" class="liczb">Sprzedaże</th><th scope="col" class="liczb">Składka roczna</th>
              <th scope="col" class="liczb">Składki mies.</th><th scope="col" class="liczb">Stawka</th><th scope="col" class="liczb">Prowizja</th>
            </tr>
          </thead>
          <tbody>
            {#each st.wg_agentow as a (a.agent_id ?? 'brak')}
              <tr data-agent={a.agent_id ?? 'brak'}>
                <th scope="row">
                  {#if a.agent_id}<a href={adres({ agent: a.agent_id })}>{a.nazwa}</a>{:else}{a.nazwa}{/if}
                  <span class="pasek" aria-hidden="true"><span style:width="{Math.round((Number(a.skladka_roczna_suma) || 0) / maxRoczna * 100)}%"></span></span>
                </th>
                <td class="liczb">{a.sprzedaze}{a.z_danymi < a.sprzedaze ? ` (${a.sprzedaze - a.z_danymi} bez kwot)` : ''}</td>
                <td class="liczb">{kwota(a.skladka_roczna_suma)}</td>
                <td class="liczb">{kwota(a.skladka_mies_suma)}</td>
                <td class="liczb">{procent(a.stawka) ?? '—'}</td>
                <td class="liczb">{a.prowizja_suma > 0 || a.stawka != null ? kwota(a.prowizja_suma) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <section class="card blok" aria-labelledby="st-swiadczenia">
    <h2 id="st-swiadczenia">Świadczenia w sprzedanych wariantach</h2>
    <div class="przewijanie">
      <table>
        <thead>
          <tr><th scope="col">Ryzyko</th><th scope="col" class="liczb">Sprzedaży z ryzykiem</th><th scope="col" class="liczb">Łącznie</th><th scope="col" class="liczb">Średnio</th></tr>
        </thead>
        <tbody>
          {#each RYZYKA as r (r.id)}
            <tr data-ryzyko={r.id}>
              <th scope="row">{r.nazwa}{#if r.opis}<span class="muted">{` · ${r.opis}`}</span>{/if}</th>
              <td class="liczb">{p[r.id].n}</td>
              <td class="liczb">{p[r.id].n ? `${kwota(p[r.id].suma)}${r.jednostka}` : '—'}</td>
              <td class="liczb">{p[r.id].n ? `${kwota(p[r.id].srednia)}${r.jednostka}` : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  {#if st.bez_danych?.length}
    <section class="card blok uzupelnij" aria-labelledby="st-bez">
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

{#if dodawanie}
  <DialogPolisy admin={admin} agenci={st?.agenci ?? []} ja={data.ja}
    onzamknij={async ({ zapisano: jest, leadId, nazwa }) => { dodawanie = false; if (jest) { dodano = { leadId, nazwa, plik: false, bezPliku: true }; await invalidateAll(); } }}
    onzapisano={zapisano} />
{/if}

<style>
  .naglowek { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
  h1 { font-size: 1.55rem; letter-spacing: -.01em; }
  .tytul .muted { max-width: 44rem; margin-top: .3rem; }


  .kafle { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .9rem; margin-bottom: 1.1rem; }
  .kafel { position: relative; background: #fff; border: 1px solid var(--slate-300); border-radius: 12px; padding: 1rem 1.15rem 1rem 1.35rem;
           box-shadow: 0 1px 3px rgba(0, 0, 0, .06); overflow: hidden; }
  .kafel::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 5px; background: var(--akcent, var(--slate-400)); }
  .k-sprzedaze { --akcent: var(--slate-700); }
  .k-roczna { --akcent: var(--blue-600); }
  .k-mies { --akcent: var(--sky-400); }
  .k-prowizja { --akcent: var(--green-600); background: linear-gradient(180deg, #f0fdf4 0%, #fff 70%); }
  .et { font-size: .74rem; font-weight: 800; color: var(--slate-600); margin: 0; text-transform: uppercase; letter-spacing: .05em; }
  .liczba { font-size: 1.75rem; font-weight: 800; color: var(--slate-900); margin: .3rem 0 .2rem; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .pod { margin: 0; font-size: .82rem; color: var(--slate-600); }
  .uwaga-mala { margin: .4rem 0 0; font-size: .78rem; font-weight: 600; color: #92400e; }

  .blok { padding: 1.1rem 1.35rem 1.25rem; margin-bottom: 1.1rem; }
  h2 { font-size: 1.02rem; margin: 0 0 .7rem; }
  .przewijanie { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .55rem .6rem; border-bottom: 1px solid var(--slate-200); }
  thead th { font-size: .72rem; color: var(--slate-600); font-weight: 700; border-bottom: 2px solid var(--slate-300); }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--slate-50); }
  td, .liczb { font-variant-numeric: tabular-nums; }
  .liczb { text-align: right; white-space: nowrap; }
  tbody th { font-weight: 600; font-size: .9rem; text-transform: none; letter-spacing: 0; color: var(--slate-800); white-space: nowrap; }
  .pasek { display: block; height: 4px; margin-top: .35rem; background: var(--slate-100); border-radius: 4px; max-width: 12rem; }
  .pasek span { display: block; height: 100%; background: var(--blue-600); border-radius: 4px; }
  .uzupelnij { border-color: var(--amber-500); }
  .uzupelnij ul { margin: .5rem 0 0; padding-left: 1.1rem; }
  .pusto { text-align: center; margin: 1.5rem 0; }
  a { color: var(--blue-700); }
  @media (max-width: 40rem) {
    .liczba { font-size: 1.45rem; }
  }
</style>
