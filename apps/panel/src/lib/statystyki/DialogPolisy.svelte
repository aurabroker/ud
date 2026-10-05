<script>
  /**
   * „Dodaj polisę" — sprzedaż klienta, który nie zgłosił się przez formularz
   * (decyzja właściciela z 04.10.2026). Trzy kroki, z czego użytkownik widzi
   * jeden formularz:
   *  1. wybór PDF → serwer czyta kwoty (POST /panel/statystyki/api/odczyt).
   *     Leadenhall szyfruje plik 4 ostatnimi cyframi PESEL-u: idą w nagłówku
   *     x-haslo z pola PESEL; wpisanie PESEL-u po pliku czyta go ponownie.
   *     Składka wraca BEZ opłaty dystrybucyjnej;
   *  2. „Zapisz sprzedaż" → klient do kartoteki + lead w „Wygrany"
   *     (POST /panel/statystyki/api/polisa, z kluczem idempotencji);
   *  3. plik do nowego leada tą samą drogą co na tablicy
   *     (POST /panel/leady/api/polisa/<lead>). Gdy to się nie uda, sprzedaż
   *     już jest — okno zostaje z przyciskiem „Wgraj plik ponownie".
   */
  import { tick } from 'svelte';
  import Dialog from '$lib/leady/Dialog.svelte';
  import { POLA_SPRZEDAZY, daneSprzedazyZFormularza } from '$lib/leady/model.js';
  import { danePolisyZFormularza } from '$lib/polisy/model.js';
  import PolaPolisy from '$lib/leady/PolaPolisy.svelte';

  let { admin = false, agenci = [], ja, onzamknij, onzapisano } = $props();

  const MAX_BAJTOW = 10 * 1024 * 1024;
  const nowyKlucz = () => (globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const naTekst = (n) => (n == null ? '' : String(n).replace('.', ','));
  const dzis = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  let imie = $state('');
  let pesel = $state('');
  let email = $state('');
  let telefon = $state('');
  let data = $state(dzis);
  let agentId = $state(ja ?? '');
  let pola = $state(Object.fromEntries(POLA_SPRZEDAZY.map((p) => [p.id, ''])));
  let numer = $state('');
  let ochronaOd = $state('');
  let ochronaDo = $state('');

  let plik = $state(null);
  let inputPliku = $state(null);
  let czytam = $state(false);
  let odczyt = $state(null);          // { komunikat, haslo }
  let bladPliku = $state('');

  let bledy = $state({});
  let blad = $state('');
  let linkLeada = $state(null);
  let trwa = $state(false);
  let klucz = $state(nowyKlucz());
  let zapisano = $state(null);        // { leadId } — sprzedaż jest, pliku jeszcze nie

  const cyfryPeselu = $derived(pesel.replace(/\D/g, ''));

  async function wyslij(url, opcje) {
    const o = await fetch(url, opcje);
    let body = null;
    try { body = await o.json(); } catch { /* bez treści */ }
    return { status: o.status, body };
  }

  async function wybierz(e) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    plik = f;
    await czytaj();
  }

  async function czytaj() {
    if (!plik) return;
    odczyt = null;
    bladPliku = '';
    if (plik.size > MAX_BAJTOW) { bladPliku = 'Plik jest za duży — limit to 10 MB.'; plik = null; return; }
    czytam = true;
    let r;
    try {
      r = await wyslij('/panel/statystyki/api/odczyt', {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', ...(cyfryPeselu.length === 11 ? { 'x-haslo': cyfryPeselu.slice(-4) } : {}) },
        body: plik,
      });
    } catch {
      czytam = false;
      bladPliku = 'Brak połączenia — nie udało się odczytać pliku. Spróbuj ponownie.';
      return;
    }
    czytam = false;
    if (r.status !== 200 || r.body?.status !== 'ok') {
      bladPliku = r.body?.komunikat ?? 'Nie udało się odczytać pliku.';
      if (r.status === 413 || r.status === 415) plik = null;
      return;
    }
    odczyt = { komunikat: r.body.komunikat, haslo: r.body.haslo ?? null };
    if (r.body.kwoty) {
      for (const p of POLA_SPRZEDAZY) pola[p.id] = naTekst(r.body.kwoty[p.id]);
      bledy = {};
    }
  }

  /** PESEL wpisany po pliku, który chciał hasła — czytamy plik jeszcze raz. */
  function peselZmieniony() {
    if (plik && !czytam && odczyt?.haslo && cyfryPeselu.length === 11) czytaj();
  }

  function sprawdz() {
    const b = {};
    if (imie.trim().replace(/\s+/g, ' ').length < 3) b.imie = 'Podaj imię i nazwisko klienta.';
    if (pesel.trim() && cyfryPeselu.length !== 11) b.pesel = 'PESEL ma 11 cyfr.';
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) b.email = 'Niepoprawny adres e-mail.';
    if (!data || data > dzis) b.data = 'Data sprzedaży nie może być z przyszłości.';
    const { sprzedaz: kwoty, bledne } = daneSprzedazyZFormularza(pola);
    for (const id of bledne) b[id] = 'Wpisz kwotę cyframi, np. 2 760 albo 2760,50 — albo 0, jeśli tego ryzyka nie ma.';
    if (!kwoty.skladka_roczna && !b.skladka_roczna) b.skladka_roczna = 'Składka roczna jest wymagana.';
    const { polisa, bledy: bledyPolisy } = danePolisyZFormularza({ numer, od: ochronaOd, do: ochronaDo });
    return { b: { ...b, ...bledyPolisy }, sprzedaz: { ...kwoty, ...polisa } };
  }

  const POLE_Z_SQL = { imie_nazwisko: 'imie', pesel: 'pesel', email: 'email', telefon: 'telefon', data_sprzedazy: 'data', agent_id: 'agent',
                       polisa_numer: 'polisa_numer', ochrona_od: 'ochrona_od', ochrona_do: 'ochrona_do' };

  async function zapisz(e) {
    e.preventDefault();
    if (zapisano) { await wgrajPlik(zapisano.leadId); return; }
    const { b, sprzedaz } = sprawdz();
    bledy = b;
    linkLeada = null;
    if (Object.keys(b).length) {
      blad = 'Popraw zaznaczone pola.';
      await tick();
      document.getElementById(`dp-${Object.keys(b)[0]}`)?.focus();
      return;
    }
    blad = '';
    trwa = true;
    let r;
    try {
      r = await wyslij('/panel/statystyki/api/polisa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: klucz,
          klient: { imieNazwisko: imie, pesel, email, telefon },
          agentId: admin && agentId ? agentId : undefined,
          dataSprzedazy: data,
          sprzedaz,
        }),
      });
    } catch {
      trwa = false;
      // Ten sam klucz przy ponowieniu: serwer nie założy klienta drugi raz.
      blad = 'Brak połączenia — nie wiadomo, czy sprzedaż się zapisała. Kliknij „Zapisz sprzedaż" jeszcze raz: ta sama sprzedaż nie zapisze się dwa razy.';
      return;
    }
    if (r.status === 200 && r.body?.status === 'ok') {
      klucz = nowyKlucz();
      if (plik) { await wgrajPlik(r.body.lead_id); return; }
      trwa = false;
      onzapisano({ leadId: r.body.lead_id, nazwa: imie.trim().replace(/\s+/g, ' '), plik: false });
      return;
    }
    trwa = false;
    blad = r.body?.komunikat ?? 'Nie udało się zapisać sprzedaży.';
    if (r.status === 401) blad = 'Sesja wygasła. Zaloguj się ponownie.';
    if (r.body?.status === 'klient_istnieje' && r.body.lead_id) linkLeada = `/panel/leady?lead=${r.body.lead_id}`;
    for (const pole of r.body?.pola ?? []) {
      const id = POLE_Z_SQL[pole] ?? pole;
      bledy = { ...bledy, [id]: blad };
    }
    if (r.body?.pola?.length) {
      await tick();
      document.getElementById(`dp-${POLE_Z_SQL[r.body.pola[0]] ?? r.body.pola[0]}`)?.focus();
    }
  }

  async function wgrajPlik(leadId) {
    trwa = true;
    blad = '';
    let r;
    try {
      r = await wyslij(`/panel/leady/api/polisa/${encodeURIComponent(leadId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'x-nazwa-pliku': encodeURIComponent(plik?.name || 'polisa.pdf') },
        body: plik,
      });
    } catch {
      r = { status: 0, body: { komunikat: 'brak połączenia' } };
    }
    trwa = false;
    if (r.status === 200 && r.body?.status === 'ok') {
      onzapisano({ leadId, nazwa: imie.trim().replace(/\s+/g, ' '), plik: true });
      return;
    }
    zapisano = { leadId };
    blad = `Sprzedaż zapisana, ale pliku polisy nie udało się wgrać (${r.body?.komunikat ?? 'błąd serwera'}). Spróbuj ponownie albo wgraj go później w oknie „Zmień dane sprzedaży" tego leada.`;
  }

  const zamknij = () => onzamknij({ zapisano: Boolean(zapisano), leadId: zapisano?.leadId ?? null, nazwa: imie.trim().replace(/\s+/g, ' ') });
</script>

<Dialog otwarty id="dlg-polisa" tytul="Dodaj polisę" szerokosc="44rem" onzamknij={zamknij}>
  <form onsubmit={zapisz} id="dlg-polisa-form" novalidate>
    <p class="opis">Sprzedaż klienta, który nie składał wniosku przez formularz. Klient trafi do kartoteki, a jego lead od razu do etapu „Wygrany"{admin ? '' : ' — jako Twoja sprzedaż'}. Klient nie dostanie żadnego e-maila.</p>

    <fieldset disabled={Boolean(zapisano)}>
      <legend>Klient</legend>
      <div class="siatka">
        <div class="pole-wiersz szerokie">
          <label for="dp-imie" class="et">Imię i nazwisko *</label>
          <input id="dp-imie" class="pole" bind:value={imie} autocomplete="off" aria-required="true"
                 aria-invalid={bledy.imie ? 'true' : undefined} aria-describedby={bledy.imie ? 'dp-imie-blad' : undefined} />
          {#if bledy.imie}<p id="dp-imie-blad" class="blad-pola">{bledy.imie}</p>{/if}
        </div>
        <div class="pole-wiersz">
          <label for="dp-pesel" class="et">PESEL</label>
          <input id="dp-pesel" class="pole" bind:value={pesel} oninput={peselZmieniony} inputmode="numeric" autocomplete="off"
                 aria-invalid={bledy.pesel ? 'true' : undefined} aria-describedby="dp-pesel-opis{bledy.pesel ? ' dp-pesel-blad' : ''}" />
          <p id="dp-pesel-opis" class="mala">4 ostatnie cyfry otwierają PDF polisy Leadenhall.</p>
          {#if bledy.pesel}<p id="dp-pesel-blad" class="blad-pola">{bledy.pesel}</p>{/if}
        </div>
        <div class="pole-wiersz">
          <label for="dp-telefon" class="et">Telefon</label>
          <input id="dp-telefon" class="pole" type="tel" bind:value={telefon} autocomplete="off"
                 aria-invalid={bledy.telefon ? 'true' : undefined} aria-describedby={bledy.telefon ? 'dp-telefon-blad' : undefined} />
          {#if bledy.telefon}<p id="dp-telefon-blad" class="blad-pola">{bledy.telefon}</p>{/if}
        </div>
        <div class="pole-wiersz szerokie">
          <label for="dp-email" class="et">E-mail</label>
          <input id="dp-email" class="pole" type="email" bind:value={email} autocomplete="off"
                 aria-invalid={bledy.email ? 'true' : undefined} aria-describedby={bledy.email ? 'dp-email-blad' : undefined} />
          {#if bledy.email}<p id="dp-email-blad" class="blad-pola">{bledy.email}</p>{/if}
        </div>
      </div>
    </fieldset>

    <fieldset disabled={Boolean(zapisano)}>
      <legend>Polisa (PDF)</legend>
      <div class="plik">
        <button type="button" class="btn btn-ghost" disabled={czytam} onclick={() => inputPliku?.click()}>
          {plik ? 'Wybierz inny plik…' : 'Wybierz plik polisy…'}
        </button>
        <input bind:this={inputPliku} type="file" accept="application/pdf,.pdf" hidden onchange={wybierz} data-plik-polisy />
        {#if plik}<span class="nazwa-pliku" data-wybrana-polisa>{plik.name}</span>{:else}<span class="mala">Nieobowiązkowy — kwoty można wpisać ręcznie.</span>{/if}
      </div>
      {#if czytam}<p class="mala" role="status">Czytam polisę…</p>{/if}
      {#if odczyt}<p class="mala" role="status" data-komunikat-polisy>{odczyt.komunikat}</p>{/if}
      {#if bladPliku}<p class="blad-pola" role="alert">{bladPliku}</p>{/if}
    </fieldset>

    <fieldset disabled={Boolean(zapisano)}>
      <legend>Sprzedaż</legend>
      <div class="siatka">
        <div class="pole-wiersz">
          <label for="dp-data" class="et">Data sprzedaży *</label>
          <input id="dp-data" class="pole" type="date" bind:value={data} max={dzis}
                 aria-invalid={bledy.data ? 'true' : undefined} aria-describedby={bledy.data ? 'dp-data-blad' : undefined} />
          {#if bledy.data}<p id="dp-data-blad" class="blad-pola">{bledy.data}</p>{/if}
        </div>
        {#if admin}
          <div class="pole-wiersz">
            <label for="dp-agent" class="et">Agent (sprzedawca)</label>
            <select id="dp-agent" class="pole" bind:value={agentId}
                    aria-invalid={bledy.agent ? 'true' : undefined} aria-describedby={bledy.agent ? 'dp-agent-blad' : undefined}>
              {#each agenci as a (a.id)}<option value={a.id}>{a.nazwa}{a.id === ja ? ' (Ty)' : ''}</option>{/each}
            </select>
            {#if bledy.agent}<p id="dp-agent-blad" class="blad-pola">{bledy.agent}</p>{/if}
          </div>
        {/if}
      </div>
      <p class="mala zero">Składka bez opłaty dystrybucyjnej. Kwota 0 albo puste pole = tego ryzyka nie ma.</p>
      <div class="siatka">
        {#each POLA_SPRZEDAZY as p (p.id)}
          <div class="pole-wiersz">
            <label for="dp-{p.id}" class="et">{p.nazwa}{p.wymagane ? ' *' : ''}</label>
            <div class="z-jednostka">
              <input id="dp-{p.id}" class="pole" type="text" inputmode="decimal" autocomplete="off" bind:value={pola[p.id]}
                     aria-required={p.wymagane ? 'true' : undefined}
                     aria-invalid={bledy[p.id] ? 'true' : undefined}
                     aria-describedby={bledy[p.id] ? `dp-${p.id}-blad` : undefined} />
              <span class="jednostka" aria-hidden="true">{p.jednostka}</span>
            </div>
            {#if bledy[p.id]}<p id="dp-{p.id}-blad" class="blad-pola">{bledy[p.id]}</p>{/if}
          </div>
        {/each}
      </div>
      <PolaPolisy bind:numer bind:od={ochronaOd} bind:do={ochronaDo} {bledy} prefiks="dp" poczatek={data} />
    </fieldset>

    {#if blad}
      <p class="blad" role="alert">{blad}{#if linkLeada} <a href={linkLeada}>Otwórz lead tego klienta</a>{/if}</p>
    {/if}
  </form>
  {#snippet stopka()}
    <button type="button" class="btn btn-ghost" onclick={zamknij}>{zapisano ? 'Zamknij' : 'Anuluj'}</button>
    <button type="submit" form="dlg-polisa-form" class="btn btn-primary" disabled={trwa || czytam}>
      {trwa ? 'Zapisuję…' : zapisano ? 'Wgraj plik ponownie' : 'Zapisz sprzedaż'}
    </button>
  {/snippet}
</Dialog>

<style>
  .opis { margin: 0 0 .8rem; font-size: .86rem; color: var(--slate-600); line-height: 1.45; }
  fieldset { border: 1px solid var(--slate-200); border-radius: 10px; margin: 0 0 .8rem; padding: .6rem .85rem .8rem; }
  fieldset:disabled { opacity: .6; }
  legend { font-size: .78rem; font-weight: 800; color: var(--slate-700); padding: 0 .3rem; text-transform: uppercase; letter-spacing: .04em; }
  .siatka { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .55rem .9rem; }
  .szerokie { grid-column: 1 / -1; }
  .et { display: block; font-size: .8rem; font-weight: 700; color: var(--slate-600); margin-bottom: .25rem; }
  .pole { width: 100%; min-width: 0; padding: .45rem .6rem; border: 1px solid var(--slate-300); border-radius: 8px; font: inherit; font-size: .9rem; background: #fff; }
  .pole:focus-visible { outline: 2px solid var(--blue-600); border-color: transparent; }
  .pole[aria-invalid='true'] { border-color: var(--red-600); }
  .z-jednostka { display: flex; align-items: center; gap: .4rem; }
  .jednostka { flex: none; font-size: .78rem; color: var(--slate-600); white-space: nowrap; }
  .mala { font-size: .76rem; color: var(--slate-600); margin: .25rem 0 0; }
  .zero { margin: .7rem 0 .45rem; }
  .plik { display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; }
  .nazwa-pliku { font-size: .85rem; font-weight: 600; color: var(--slate-800); word-break: break-all; }
  .blad-pola { margin: .25rem 0 0; font-size: .76rem; font-weight: 600; color: #991b1b; }
  .blad { margin: .2rem 0 0; font-size: .82rem; font-weight: 600; color: #991b1b; }
  a { color: var(--blue-700); }
</style>
