<script>
  import { invalidateAll } from '$app/navigation';
  import { formatKwota } from '$lib/leady/model.js';
  import { STATUSY, SORTY, dataPL, doCsv, dzienPL, pasujeStatus, pasujeSzukanie, sortuj, statusPolisy, sumy } from '$lib/polisy/model.js';
  import DialogPolisy from '$lib/statystyki/DialogPolisy.svelte';
  import Filtry from '$lib/statystyki/Filtry.svelte';

  let { data } = $props();
  const w = $derived(data.w);
  const admin = $derived(w?.rola === 'admin');
  const dzis = $derived(w?.dzis ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date()));

  let filtrStatusu = $state('wszystkie');
  let szukaj = $state('');
  let sort = $state('sprzedano');
  let kierunek = $state(null);

  const zStatusem = $derived((w?.polisy ?? []).map((p) => ({ ...p, status: statusPolisy(p, dzis) })));
  const liczniki = $derived(Object.fromEntries(STATUSY.map((s) => [s.id, zStatusem.filter((p) => pasujeStatus(p.status, s.id)).length])));
  const widoczne = $derived(sortuj(zStatusem.filter((p) => pasujeStatus(p.status, filtrStatusu) && pasujeSzukanie(p, szukaj)), sort, kierunek ?? undefined));
  const suma = $derived(sumy(widoczne));
  const nazwaAgenta = $derived(w?.agent ? (w.agenci?.find((a) => a.id === w.agent)?.nazwa ?? null) : null);

  const kwota = (n) => (n == null ? '—' : formatKwota(n));
  const procent = (n) => (n == null ? null : `${String(Number(n)).replace('.', ',')}%`);
  const polis = (n) => `${n} ${n === 1 ? 'polisa' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'polisy' : 'polis'}`;

  function ustawSort(klucz) {
    if (sort === klucz) kierunek = (kierunek ?? SORTY[klucz].domyslnie) === 'rosnaco' ? 'malejaco' : 'rosnaco';
    else { sort = klucz; kierunek = null; }
  }
  const ariaSort = (klucz) => (sort !== klucz ? 'none' : (kierunek ?? SORTY[klucz].domyslnie) === 'rosnaco' ? 'ascending' : 'descending');

  function pobierzCsv() {
    const tresc = doCsv(widoczne, { admin, dzis });
    const url = URL.createObjectURL(new Blob([tresc], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `polisy-${dzis}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let dodawanie = $state(false);
  let dodano = $state(null);
  async function zapisano(wynik) {
    dodawanie = false;
    dodano = wynik;
    await invalidateAll();
  }
</script>

<svelte:head><title>Wykaz polis — Panel</title></svelte:head>

<div class="naglowek">
  <div class="tytul">
    <h1>Wykaz polis</h1>
    <p class="muted">
      {#if !w}&nbsp;
      {:else if admin}{nazwaAgenta ? `Polisy: ${nazwaAgenta}.` : 'Wszyscy agenci.'}
      {:else}Twoje polisy.{/if}
      Polisa to sprzedaż z tablicy leadów (etap „Wygrany") — także zarchiwizowana. Składki bez opłaty dystrybucyjnej.
    </p>
  </div>
  {#if w}
    <div class="akcje">
      <button type="button" class="btn btn-ghost" onclick={pobierzCsv} disabled={!widoczne.length} data-csv>Pobierz CSV</button>
      <button type="button" class="btn btn-primary" onclick={() => { dodano = null; dodawanie = true; }} data-dodaj-polise>+ Dodaj polisę</button>
    </div>
  {/if}
</div>

{#if w}
  <Filtry okres={w.okres} agent={w.agent} agenci={w.agenci} {admin} />
{/if}

{#if dodano}
  <div class="ok-box" role="status" data-dodano>
    Dodano sprzedaż: <a href="/panel/leady?lead={dodano.leadId}">{dodano.nazwa}</a>{dodano.plik ? ' (z polisą)' : dodano.bezPliku ? ' — plik polisy nie został wgrany' : ''}.
  </div>
{/if}

{#if data.blad}
  <div class="error-box" role="alert">{data.blad}</div>
{:else if w}
  <div class="narzedzia">
    <div class="statusy" role="group" aria-label="Status polisy">
      {#each STATUSY as s (s.id)}
        <button type="button" class="chip" class:wlaczony={filtrStatusu === s.id} aria-pressed={filtrStatusu === s.id}
                onclick={() => (filtrStatusu = s.id)} data-status-filtr={s.id}>
          {s.nazwa} <span class="ile">{liczniki[s.id]}</span>
        </button>
      {/each}
    </div>
    <label class="szukaj">
      <span class="sr-only">Szukaj klienta albo numeru polisy</span>
      <input class="input" type="search" placeholder="Szukaj: klient, numer polisy" bind:value={szukaj} />
    </label>
  </div>

  <section class="podsumowanie" aria-label="Podsumowanie wykazu" data-podsumowanie>
    <div><span class="et">Polisy</span><strong data-suma="liczba">{suma.liczba}</strong></div>
    <div><span class="et">Składki miesięczne</span><strong data-suma="mies">{kwota(suma.mies)}</strong>
      {#if suma.wyliczonych}<span class="pod">w tym {suma.wyliczonych} jako 1/12 rocznej</span>{/if}</div>
    <div><span class="et">Składki roczne</span><strong data-suma="roczna">{kwota(suma.roczna)}</strong></div>
    <div><span class="et">{admin ? 'Prowizja' : 'Twoja prowizja'}</span><strong data-suma="prowizja">{kwota(suma.prowizja)}</strong></div>
  </section>

  {#if widoczne.length}
    <div class="card tabela">
      <div class="przewijanie">
        <table>
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort('klient')}><button type="button" class="sort" onclick={() => ustawSort('klient')}>Klient</button></th>
              <th scope="col">Numer polisy</th>
              <th scope="col" aria-sort={ariaSort('ochrona_do')}><button type="button" class="sort" onclick={() => ustawSort('ochrona_do')}>Ochrona</button></th>
              <th scope="col" aria-sort={ariaSort('sprzedano')}><button type="button" class="sort" onclick={() => ustawSort('sprzedano')}>Data sprzedaży</button></th>
              <th scope="col" class="liczb" aria-sort={ariaSort('skladka_mies')}><button type="button" class="sort" onclick={() => ustawSort('skladka_mies')}>Składka mies.</button></th>
              <th scope="col" class="liczb">Składka roczna</th>
              <th scope="col" class="liczb">Prowizja</th>
              {#if admin}<th scope="col">Agent</th>{/if}
              <th scope="col"><span class="sr-only">Plik polisy</span></th>
            </tr>
          </thead>
          <tbody>
            {#each widoczne as p (p.lead_id)}
              <tr data-polisa-wiersz={p.lead_id} class:wygasla={p.status.id === 'wygasla'}>
                <th scope="row">
                  {#if p.archiwum}{p.klient} <span class="muted">(zarchiwizowany)</span>
                  {:else}<a href="/panel/leady?lead={p.lead_id}">{p.klient}</a>{/if}
                </th>
                <td>{#if p.numer}{p.numer}{:else}<span class="brak">brak numeru</span>{/if}</td>
                <td class="ochrona">
                  {#if p.ochrona_od || p.ochrona_do}<span class="daty">{dataPL(p.ochrona_od)} – {dataPL(p.ochrona_do)}</span>{/if}
                  <span class="status s-{p.status.id}" data-status={p.status.id}>{p.status.etykieta}</span>
                </td>
                <td>{dataPL(dzienPL(p.sprzedano))}</td>
                <td class="liczb">
                  {#if p.skladka_mies != null}{p.mies_wyliczona ? '≈ ' : ''}{kwota(p.skladka_mies)}{:else}<span class="brak">—</span>{/if}
                </td>
                <td class="liczb">{kwota(p.skladka_roczna)}</td>
                <td class="liczb" title={p.stawka != null ? `${procent(p.stawka)} składki rocznej` : 'Agent nie ma ustawionej stawki'}>{p.prowizja != null ? kwota(p.prowizja) : '—'}</td>
                {#if admin}<td>{p.agent ?? 'Bez opiekuna'}</td>{/if}
                <td>{#if p.plik}<a href="/panel/leady/api/plik/{p.plik}" target="_blank" rel="noopener" class="pdf" aria-label="Plik polisy: {p.klient}">PDF</a>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if suma.wyliczonych}<p class="muted przypis">≈ składka miesięczna wyliczona jako 1/12 rocznej — raty bywają droższe.</p>{/if}
    </div>
  {:else}
    <p class="muted pusto">{(w.polisy ?? []).length ? 'Żadna polisa nie pasuje do filtrów.' : 'Brak polis w wybranym okresie.'}</p>
  {/if}

  {#if liczniki.bez_dat && filtrStatusu !== 'bez_dat'}
    <p class="muted uwaga">
      {polis(liczniki.bez_dat)} bez dat ochrony — bez nich wykaz nie pokaże, kiedy wygasają.
      Uzupełnij je w oknie „Zmień dane sprzedaży" przy leadzie.
    </p>
  {/if}
{/if}

{#if dodawanie}
  <DialogPolisy admin={admin} agenci={w?.agenci ?? []} ja={data.ja}
    onzamknij={async ({ zapisano: jest, leadId, nazwa }) => { dodawanie = false; if (jest) { dodano = { leadId, nazwa, plik: false, bezPliku: true }; await invalidateAll(); } }}
    onzapisano={zapisano} />
{/if}

<style>
  .naglowek { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
  h1 { font-size: 1.55rem; letter-spacing: -.01em; }
  .tytul .muted { max-width: 44rem; margin-top: .3rem; }
  .akcje { display: flex; gap: .5rem; flex-wrap: wrap; }
  .akcje .btn-ghost { background: #fff; }

  .narzedzia { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .6rem 1rem; margin-bottom: .9rem; }
  .statusy { display: flex; flex-wrap: wrap; gap: .4rem; }
  .chip { border: 1px solid var(--slate-300); background: #fff; color: var(--slate-700); border-radius: 999px; padding: .35rem .75rem;
          font: inherit; font-size: .82rem; font-weight: 600; cursor: pointer; }
  .chip:hover { border-color: var(--slate-400); }
  .chip.wlaczony { background: var(--slate-800); border-color: var(--slate-800); color: #fff; }
  .chip:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
  .ile { display: inline-block; min-width: 1.4em; margin-left: .2rem; padding: 0 .35rem; border-radius: 999px; background: var(--slate-100);
         color: var(--slate-700); font-size: .74rem; text-align: center; }
  .chip.wlaczony .ile { background: rgba(255, 255, 255, .2); color: #fff; }
  .szukaj .input { min-width: 16rem; background: #fff; }

  .podsumowanie { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .7rem; margin-bottom: 1rem; }
  .podsumowanie > div { background: #fff; border: 1px solid var(--slate-300); border-radius: 10px; padding: .65rem .9rem; display: flex; flex-direction: column; }
  .podsumowanie .et { font-size: .72rem; font-weight: 800; color: var(--slate-600); text-transform: uppercase; letter-spacing: .05em; }
  .podsumowanie strong { font-size: 1.25rem; font-weight: 800; color: var(--slate-900); font-variant-numeric: tabular-nums; margin-top: .15rem; }
  .podsumowanie .pod { font-size: .76rem; color: var(--slate-600); }

  .tabela { padding: .4rem .6rem .6rem; margin-bottom: 1rem; }
  /* position: relative trzyma ukryte podpisy (.sr-only) w obrębie przewijanej tabeli — bez tego
     na telefonie rozpychały stronę w bok. */
  .przewijanie { overflow-x: auto; position: relative; }
  .szukaj { position: relative; }
  table { width: 100%; border-collapse: collapse; font-size: .88rem; }
  th, td { text-align: left; padding: .55rem .55rem; border-bottom: 1px solid var(--slate-200); vertical-align: top; }
  thead th { font-size: .72rem; color: var(--slate-600); font-weight: 700; border-bottom: 2px solid var(--slate-300); white-space: nowrap; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--slate-50); }
  tbody th { font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--slate-800); font-size: .88rem; }
  tr.wygasla th, tr.wygasla td { color: var(--slate-500); }
  .liczb { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sort { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer; }
  .sort:hover { color: var(--slate-900); text-decoration: underline; }
  .sort:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
  th[aria-sort='ascending'] .sort::after { content: ' ▲'; font-size: .6rem; }
  th[aria-sort='descending'] .sort::after { content: ' ▼'; font-size: .6rem; }
  .ochrona { white-space: nowrap; }
  .daty { display: block; font-variant-numeric: tabular-nums; }
  .status { display: inline-block; margin-top: .2rem; font-size: .72rem; font-weight: 700; padding: .1rem .5rem; border-radius: 999px; }
  .s-aktywna { background: #dcfce7; color: #166534; }
  .s-wygasa { background: #fef3c7; color: #92400e; }
  .s-wygasla { background: var(--slate-200); color: var(--slate-700); }
  .s-przyszla { background: #dbeafe; color: var(--blue-700); }
  .s-bez_dat { background: #fee2e2; color: var(--red-700); }
  .brak { color: var(--slate-500); font-style: italic; }
  .pdf { font-size: .75rem; font-weight: 800; text-decoration: none; border: 1px solid var(--slate-300); border-radius: 6px; padding: .1rem .4rem; }
  .przypis { margin: .5rem .3rem 0; font-size: .78rem; }
  .pusto { text-align: center; margin: 1.5rem 0; }
  .uwaga { margin: .2rem 0 1rem; }
  .sr-only { position: absolute; top: 0; left: 0; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  a { color: var(--blue-700); }
  @media (max-width: 40rem) {
    .szukaj, .szukaj .input { width: 100%; min-width: 0; }
  }
</style>
