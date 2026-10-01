<script>
  import { enhance } from '$app/forms';
  import { KROKI } from '@ud/wniosek';

  let { data, form } = $props();

  const tytulKroku = Object.fromEntries(KROKI.map((k) => [k.id, k.tytul]));

  function dt(s) {
    return s ? new Date(s).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }

  /** Poniedziałek tygodnia → „28.09 – 04.10". */
  function tydzien(s) {
    const od = new Date(`${s}T00:00:00`);
    const do_ = new Date(od);
    do_.setDate(od.getDate() + 6);
    const f = (d) => d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    return `${f(od)} – ${f(do_)}`;
  }

  const procent = (n, baza) => (baza > 0 ? `${Math.round((n / baza) * 100)}%` : '—');
  const pierwszy = KROKI[0].id;
</script>

<svelte:head><title>Niedokończone wnioski — Panel</title></svelte:head>

<div style="margin-bottom:1rem;">
  <h1 style="font-size:1.5rem;">Niedokończone wnioski</h1>
  <p class="muted">
    Osoby, które zaczęły wniosek, zaznaczyły zgodę na kontakt i go nie wysłały.
    Lista nie zawiera PESEL-u ani ankiety medycznej — tych danych nie zbieramy przed wysłaniem wniosku.
  </p>
</div>

{#if !data.zgodaZatwierdzona}
  <div class="error-box" role="alert" style="margin-bottom:1rem;">
    <strong>Treść zgody czeka na akceptację prawnika.</strong>
    Do tego czasu nie dzwoń i nie pisz do osób z tej listy — dane zbieramy, ale nie używamy ich do kontaktu.
    Przypomnienia e-mailem są wyłączone.
  </div>
{/if}

{#if data.loadError}<div class="error-box">Nie udało się wczytać danych: {data.loadError}</div>{/if}
{#if form?.error}<div class="error-box">{form.error}</div>{/if}

<!-- Lejek ─────────────────────────────────────────────────────────────── -->
<div class="card" style="margin-bottom:1.25rem;">
  <div class="card-pad" style="padding-bottom:.5rem;">
    <h2 style="font-size:1.05rem;">Lejek — gdzie odpadają</h2>
    <p class="muted" style="font-size:.85rem;">
      Ile osób zaliczyło dany krok. Liczymy od pierwszego kroku (kontakt) — kto odpadł jeszcze przed nim,
      nie zostawia śladu. Bez danych osobowych.
    </p>
  </div>

  {#if data.lejek.rzedy.length === 0}
    <div class="card-pad muted" style="text-align:center;padding:1.5rem 1rem;">
      Jeszcze brak danych — lejek zacznie się zapełniać po wdrożeniu kroku „Kontakt".
    </div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Tydzień</th>
          {#each data.lejek.kroki as k}<th style="text-align:right;">{k.tytul}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each data.lejek.rzedy as r}
          <tr>
            <td class="muted" style="white-space:nowrap;">{tydzien(r.tydzien)}</td>
            {#each data.lejek.kroki as k}
              <td style="text-align:right;white-space:nowrap;">
                {r.doszlo[k.id]}
                {#if k.id !== pierwszy}<span class="muted" style="font-size:.78rem;">({procent(r.doszlo[k.id], r.doszlo[pierwszy])})</span>{/if}
              </td>
            {/each}
          </tr>
        {/each}
        <tr style="font-weight:700;">
          <td>Razem</td>
          {#each data.lejek.kroki as k}
            <td style="text-align:right;white-space:nowrap;">
              {data.lejek.razem[k.id]}
              {#if k.id !== pierwszy}<span class="muted" style="font-size:.78rem;font-weight:400;">({procent(data.lejek.razem[k.id], data.lejek.razem[pierwszy])})</span>{/if}
            </td>
          {/each}
        </tr>
      </tbody>
    </table>
    {#if data.lejek.gardlo}
      <p class="card-pad muted" style="font-size:.85rem;margin:0;">
        Największy spadek: z kroku „{tytulKroku[data.lejek.gardlo.z]}" do „{tytulKroku[data.lejek.gardlo.do]}"
        (−{data.lejek.gardlo.spadek}).
      </p>
    {/if}
  {/if}
</div>

<!-- Lista ─────────────────────────────────────────────────────────────── -->
<div class="card">
  {#if data.szkice.length === 0}
    <div class="card-pad muted" style="text-align:center;padding:2.5rem 1rem;">
      Brak niedokończonych wniosków ze zgodą na kontakt.
    </div>
  {:else}
    <table>
      <thead>
        <tr><th>Osoba</th><th>Kontakt</th><th>Ostatni zaliczony krok</th><th>Ostatnia aktywność</th><th>Przypomnienie</th><th></th></tr>
      </thead>
      <tbody>
        {#each data.szkice as s (s.id)}
          <tr>
            <td style="font-weight:600;">{s.imie || '—'}</td>
            <td style="font-size:.85rem;">
              {#if s.email}<a href={`mailto:${s.email}`}>{s.email}</a>{:else}—{/if}<br />
              {#if s.phone}<a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>{s.phone}</a>{/if}
            </td>
            <td>{tytulKroku[s.ostatni_krok] || s.ostatni_krok}</td>
            <td class="muted" style="white-space:nowrap;font-size:.82rem;">{dt(s.updated_at)}</td>
            <td class="muted" style="font-size:.82rem;">
              {s.przypomnienie_wyslane_at ? `wysłano ${dt(s.przypomnienie_wyslane_at)}` : 'nie wysłano'}
            </td>
            <td style="text-align:right;">
              <form method="POST" action="?/obsluzony" use:enhance>
                <input type="hidden" name="id" value={s.id} />
                <button class="btn btn-ghost" style="font-size:.8rem;padding:.25rem .65rem;">Oznacz jako obsłużony</button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
