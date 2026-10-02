<script>
  /**
   * Prawy panel szczegółów. Otwiera się obok tablicy (nie zamiast niej), więc
   * filtry, kolejność i pozycje przewijania zostają. Etap zmienia się tym samym
   * poleceniem co przeciągnięciem i menu — przez ctx.przeniesZUi.
   */
  import { getContext } from 'svelte';
  import { DZIALANIA, POLA_SPRZEDAZY, dataGodzina, dataKrotka, dniWEtapie, etykietaZrodla, formatKwota, kontekstKarty, kwotaZTekstu, terminTekst, wartoscKarty } from './model.js';

  let { onzamknij } = $props();
  const ctx = getContext('tablica');
  const stan = ctx.stan;

  const s = $derived(stan.otwarty);
  const lead = $derived(s?.lead ?? null);
  const etap = $derived(lead ? stan.etap(lead.etap_id) : null);
  const zapis = $derived(lead ? stan.zapisy[lead.id] : null);

  let tekstNotatki = $state('');
  let blokadaNotatki = $state(false);
  let bladNotatki = $state('');
  let kluczNotatki = $state(null);

  const nowyKlucz = () => (globalThis.crypto?.randomUUID?.() ?? `n-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  async function dodajNotatke(e) {
    e.preventDefault();
    const tresc = tekstNotatki.trim();
    if (!tresc || !lead) return;
    blokadaNotatki = true;
    bladNotatki = '';
    kluczNotatki ??= nowyKlucz();
    const r = await stan.dodajNotatke(lead.id, tresc, kluczNotatki);
    blokadaNotatki = false;
    if (r.ok) {
      tekstNotatki = '';
      kluczNotatki = null;
    } else {
      bladNotatki = r.komunikat;
      // Błąd sieci: ten sam klucz przy ponowieniu. Odmowa serwera: nowa próba = nowa intencja.
      if (r.status !== 'siec') kluczNotatki = null;
    }
  }

  const etykietyHistorii = {
    etap: (h) => `${h.z_etap ?? '?'} → ${h.do_etap ?? '?'}${h.dane?.powod_utraty ? ` (powód: ${h.dane.powod_utraty})` : ''}`,
    dzialanie: () => 'zmieniono następne działanie',
    opiekun: () => 'zmieniono opiekuna',
    archiwum: () => 'zarchiwizowano',
    notatka: () => 'dodano notatkę',
    przepieto: () => 'wniosek ukończony — lead przypisany do klienta',
    sprzedaz: (h) => `zmieniono dane sprzedaży${h.dane?.sprzedaz?.skladka_roczna != null ? ` (składka ${formatKwota(h.dane.sprzedaz.skladka_roczna)} / rok)` : ''}`,
  };
</script>

<aside
  class="szczegoly"
  aria-labelledby="sz-tytul"
  tabindex="-1"
  data-szczegoly
>
  <header class="gora">
    <h2 id="sz-tytul" tabindex="-1">{lead?.nazwa ?? 'Szczegóły leada'}</h2>
    <button type="button" class="zamknij" aria-label="Zamknij szczegóły" onclick={onzamknij}>✕</button>
  </header>

  {#if stan.otwartyStan === 'nie_istnieje'}
    <p class="komunikat" role="status">Ten lead nie istnieje albo został zarchiwizowany.</p>
  {:else if stan.otwartyStan === 'blad'}
    <p class="komunikat blad" role="alert">Nie udało się wczytać szczegółów. <button type="button" class="link" onclick={() => stan.otworzSzczegoly(stan.otwartyId)}>Spróbuj ponownie</button></p>
  {:else if lead}
    {#if stan.otwartyStan === 'laduje'}<p class="komunikat" role="status">Ładowanie szczegółów…</p>{/if}

    <p class="podtytul">{kontekstKarty(lead)}</p>

    <section aria-label="Proces">
      <div class="pole-wiersz">
        <label for="sz-etap">Etap</label>
        <select
          id="sz-etap"
          class="pole"
          value={lead.etap_id}
          disabled={Boolean(zapis)}
          onchange={async (e) => {
            const cel = e.currentTarget.value;
            const el = e.currentTarget;
            await ctx.przeniesZUi(lead.id, cel);
            // Odmowa albo anulowany formularz: pole ma pokazywać prawdziwy etap.
            queueMicrotask(() => { el.value = stan.otwarty?.lead?.etap_id ?? lead.etap_id; });
          }}
        >
          {#each stan.etapy as e (e.id)}<option value={e.id}>{e.nazwa}</option>{/each}
        </select>
      </div>
      {#if zapis}<p class="zapis" data-stan-zapisu>{zapis.opis}</p>{/if}
      {#if lead.powod_utraty}<p class="wiersz"><span class="et">Powód utraty</span> {lead.powod_utraty}</p>{/if}
      <p class="wiersz"><span class="et">W etapie od</span> {dataKrotka(lead.etap_od)} ({dniWEtapie(lead, ctx.teraz)} dn.)</p>
    </section>

    {#if etap?.rodzaj === 'wygrany'}
      <section aria-label="Sprzedaż" data-sprzedaz>
        <h3>Sprzedaż</h3>
        {#if lead.sprzedaz?.skladka_roczna != null}
          {#each POLA_SPRZEDAZY as p (p.id)}
            {#if lead.sprzedaz[p.id] != null}
              <p class="wiersz"><span class="et">{p.nazwa}</span> {formatKwota(lead.sprzedaz[p.id])}{p.jednostka.startsWith('zł /') ? p.jednostka.slice(2) : ''}</p>
            {/if}
          {/each}
        {:else}
          <p class="uwaga">Brak danych sprzedaży — bez nich ta sprzedaż nie liczy się w statystykach składek.</p>
        {/if}
        <p class="wiersz">
          <button type="button" class="link" onclick={() => ctx.otworzDialog({ typ: 'sprzedaz', leadId: lead.id })}>
            {lead.sprzedaz?.skladka_roczna != null ? 'Zmień dane sprzedaży…' : 'Uzupełnij dane sprzedaży…'}
          </button>
        </p>
      </section>
    {/if}

    <section aria-label="Obsługa">
      <p class="wiersz">
        <span class="et">Opiekun</span>
        <span data-opiekun>{lead.opiekun_nazwa ?? 'Bez opiekuna'}{lead.opiekun_admin ? ' (administrator)' : ''}</span>
        <button type="button" class="link" onclick={() => ctx.otworzDialog({ typ: 'opiekun', leadId: lead.id })}>Zmień…</button>
      </p>
      <p class="wiersz">
        <span class="et">Następne działanie</span>
        {#if lead.dzialanie}
          <span data-dzialanie>{DZIALANIA[lead.dzialanie.typ]} · {terminTekst(lead.dzialanie.termin, ctx.teraz)}{lead.dzialanie.opis ? ` · ${lead.dzialanie.opis}` : ''}</span>
        {:else}
          <span data-dzialanie>Brak zaplanowanego działania</span>
        {/if}
        <button type="button" class="link" onclick={() => ctx.otworzDialog({ typ: 'dzialanie', leadId: lead.id })}>
          {lead.dzialanie ? 'Zmień…' : 'Zaplanuj…'}
        </button>
      </p>
    </section>

    <section aria-label="Kontakt i zgłoszenie">
      <h3>Kontakt</h3>
      {#if s?.telefon}<p class="wiersz"><span class="et">Telefon</span> <a href="tel:{String(s.telefon).replace(/[^\d+]/g, '')}">{s.telefon}</a></p>{/if}
      {#if s?.email}<p class="wiersz"><span class="et">E-mail</span> <a href="mailto:{s.email}">{s.email}</a></p>{/if}
      {#if s?.kontakt?.zawod}<p class="wiersz"><span class="et">Zawód</span> {s.kontakt.zawod}</p>{/if}
      {#if s?.kontakt?.forma_zatrudnienia}<p class="wiersz"><span class="et">Forma zatrudnienia</span> {s.kontakt.forma_zatrudnienia}</p>{/if}
      <p class="wiersz"><span class="et">Źródło</span> {etykietaZrodla(lead.zrodlo)}</p>
      <p class="wiersz"><span class="et">Zgłoszono</span> {dataGodzina(lead.zgloszono)}</p>
      {#if wartoscKarty(lead)}<p class="wiersz"><span class="et">Wnioskowane świadczenie</span> {wartoscKarty(lead)}</p>{/if}
      {#if s?.kontakt?.kwoty}
        <p class="wiersz">
          <span class="et">Wnioskowane sumy</span>
          <span>
            {#if s.kontakt.kwoty.okresowa}okresowa {formatKwota(kwotaZTekstu(s.kontakt.kwoty.okresowa)) || s.kontakt.kwoty.okresowa} / mies.{/if}
            {#if s.kontakt.kwoty.trwala}· trwała {formatKwota(kwotaZTekstu(s.kontakt.kwoty.trwala)) || s.kontakt.kwoty.trwala}{/if}
            {#if s.kontakt.kwoty.zgon}· zgon {formatKwota(kwotaZTekstu(s.kontakt.kwoty.zgon)) || s.kontakt.kwoty.zgon}{/if}
          </span>
        </p>
      {/if}
      {#if lead.dane_do}
        <p class="uwaga" data-dane-do>
          To porzucony wniosek. Dane kontaktowe usuniemy automatycznie {dataKrotka(lead.dane_do)} — razem z notatkami i historią tego leada. Cofnięcie zgody w mailu usuwa je od razu.
        </p>
      {/if}
      {#if s?.klient_id}<p class="wiersz"><a href="/panel/klienci/{s.klient_id}">Karta klienta →</a></p>{/if}
    </section>

    {#if s?.oferty?.length}
      <section aria-label="Oferty">
        <h3>Oferty</h3>
        <ul class="lista">
          {#each s.oferty as o (o.id)}
            <li><a href="/panel/offer/{o.id}">{o.offer_number ?? 'Oferta'}</a> <span class="mala">{o.status}{o.archived_at ? ' (archiwum)' : ''}</span></li>
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-label="Notatki">
      <h3>Notatki</h3>
      <form onsubmit={dodajNotatke} class="formularz-notatki">
        <label class="sr-only" for="sz-notatka">Nowa notatka</label>
        <textarea id="sz-notatka" class="pole" rows="3" maxlength="2000" placeholder="Dodaj notatkę…" bind:value={tekstNotatki} disabled={blokadaNotatki}></textarea>
        {#if bladNotatki}<p class="blad-pole" role="alert">{bladNotatki}</p>{/if}
        <button type="submit" class="btn btn-primary maly" disabled={blokadaNotatki || !tekstNotatki.trim()}>{blokadaNotatki ? 'Zapisuję…' : 'Dodaj notatkę'}</button>
      </form>
      {#if s?.notatki?.length}
        <ul class="lista notatki" data-notatki>
          {#each s.notatki as n (n.id)}
            <li>
              <p class="tresc">{n.tresc}</p>
              <p class="mala">{n.autor_nazwa ?? 'Agent'} · {dataGodzina(n.created_at)}</p>
            </li>
          {/each}
        </ul>
      {:else if stan.otwartyStan === 'gotowe'}
        <p class="mala">Brak notatek.</p>
      {/if}
    </section>

    <section aria-label="Historia">
      <h3>Historia</h3>
      {#if s?.historia?.length}
        <ul class="lista historia" data-historia>
          {#each s.historia as h (h.id)}
            <li>
              <span class="mala">{dataGodzina(h.created_at)}{h.wykonawca_nazwa ? ` · ${h.wykonawca_nazwa}` : ''}</span>
              <span>{(etykietyHistorii[h.typ] ?? (() => h.typ))(h)}</span>
            </li>
          {/each}
        </ul>
      {:else if stan.otwartyStan === 'gotowe'}
        <p class="mala">Brak wpisów.</p>
      {/if}
    </section>

    <footer class="stopka">
      <button type="button" class="btn btn-ghost maly" onclick={() => ctx.otworzDialog({ typ: 'archiwum', leadId: lead.id })} disabled={Boolean(zapis)}>Archiwizuj…</button>
    </footer>
  {/if}
</aside>

<style>
  .szczegoly {
    flex: 0 0 28.5rem; width: 28.5rem; max-width: 100%; overflow-y: auto; background: #fff;
    border: 1px solid var(--slate-300); border-radius: 12px; padding: .9rem 1rem 1.2rem; outline: none;
    box-shadow: 0 1px 3px rgba(15, 23, 42, .08);
  }
  .gora { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; }
  h2 { font-size: 1.15rem; font-weight: 800; color: var(--slate-900); overflow-wrap: anywhere; outline: none; }
  h3 { font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--slate-500); margin: 0 0 .4rem; }
  .zamknij { flex: none; width: 2rem; height: 2rem; border: 1px solid var(--slate-200); border-radius: 8px; background: #fff; cursor: pointer; font-size: 1rem; color: var(--slate-600); }
  .zamknij:hover { background: var(--slate-100); }
  .zamknij:focus-visible { outline: 2px solid var(--blue-600); }
  .podtytul { margin: .1rem 0 .7rem; font-size: .85rem; color: var(--slate-600); }
  section { border-top: 1px solid var(--slate-100); padding: .7rem 0; }
  .pole-wiersz { display: flex; align-items: center; gap: .6rem; margin-bottom: .35rem; }
  .pole-wiersz label { font-size: .8rem; font-weight: 700; color: var(--slate-600); min-width: 3rem; }
  .pole { width: 100%; padding: .45rem .6rem; border: 1px solid var(--slate-300); border-radius: 8px; font: inherit; font-size: .88rem; background: #fff; }
  .pole:focus-visible { outline: 2px solid var(--blue-600); border-color: transparent; }
  .wiersz { margin: .25rem 0; font-size: .86rem; display: flex; flex-wrap: wrap; gap: .1rem .5rem; align-items: baseline; }
  .et { font-size: .74rem; font-weight: 700; color: var(--slate-500); min-width: 8.5rem; }
  .zapis { font-size: .78rem; font-weight: 600; color: var(--slate-600); margin: .1rem 0 .3rem; }
  .uwaga { margin: .5rem 0 0; padding: .5rem .65rem; border-radius: 8px; background: #fef3c7; color: #92400e; font-size: .8rem; font-weight: 600; line-height: 1.4; }
  .komunikat { margin: .6rem 0; padding: .6rem .75rem; border-radius: 8px; background: var(--slate-100); font-size: .86rem; }
  .komunikat.blad { background: #fee2e2; color: #991b1b; }
  .link { background: none; border: 0; padding: 0; font: inherit; font-size: .82rem; font-weight: 700; color: var(--blue-700); text-decoration: underline; cursor: pointer; }
  .link:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
  .lista { list-style: none; margin: .3rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; font-size: .84rem; }
  .historia li { display: flex; flex-direction: column; }
  .notatki .tresc { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .mala { margin: 0; font-size: .74rem; color: var(--slate-500); }
  .formularz-notatki { display: flex; flex-direction: column; gap: .4rem; }
  .blad-pole { margin: 0; font-size: .8rem; color: #991b1b; font-weight: 600; }
  .maly { padding: .4rem .8rem; font-size: .82rem; align-self: flex-start; }
  .stopka { border-top: 1px solid var(--slate-100); padding-top: .8rem; }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
