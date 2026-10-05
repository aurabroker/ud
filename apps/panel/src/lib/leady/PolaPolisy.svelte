<script>
  /**
   * Numer polisy i okres ochrony — w oknie „Dane sprzedaży" i „Dodaj polisę".
   * Wgrany PDF polisy wpisuje je sam (src/lib/pdf/polisa.js: „Polisa nr …",
   * „Okres ubezpieczenia … - …"); czego czytnik nie znajdzie, agent przepisuje
   * z polisy — dat nie zgadujemy. „Rok ochrony" to tylko skrót dla typowej
   * polisy rocznej — wypełnia koniec, nic nie zapisuje sam z siebie.
   * Data sprzedaży to dzień przed początkiem ochrony (05.10.2026) — ustawia ją
   * baza; tu tylko podpowiedź (`pokazSprzedaz`), bo okno „Dodaj polisę" ma
   * własne pole daty sprzedaży.
   */
  import { dataPL, dataSprzedazyZOchrony, rokOchrony } from '$lib/polisy/model.js';

  let { numer = $bindable(''), od = $bindable(''), do: doo = $bindable(''), bledy = {}, prefiks, poczatek = '', pokazSprzedaz = true } = $props();
  const sprzedaz = $derived(dataSprzedazyZOchrony(od));

  function rok() {
    if (!od) od = poczatek || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
    doo = rokOchrony(od) ?? '';
  }
</script>

<div class="polisa-pola" data-pola-polisy>
  <div class="pole-wiersz numer">
    <label for="{prefiks}-polisa_numer" class="et">Numer polisy</label>
    <input id="{prefiks}-polisa_numer" class="pole" bind:value={numer} autocomplete="off" maxlength="60"
           aria-invalid={bledy.polisa_numer ? 'true' : undefined}
           aria-describedby={bledy.polisa_numer ? `${prefiks}-polisa_numer-blad` : undefined} />
    {#if bledy.polisa_numer}<p id="{prefiks}-polisa_numer-blad" class="blad-pola">{bledy.polisa_numer}</p>{/if}
  </div>
  <div class="pole-wiersz">
    <label for="{prefiks}-ochrona_od" class="et">Ochrona od</label>
    <input id="{prefiks}-ochrona_od" class="pole" type="date" bind:value={od}
           aria-invalid={bledy.ochrona_od ? 'true' : undefined}
           aria-describedby={bledy.ochrona_od ? `${prefiks}-ochrona_od-blad` : undefined} />
    {#if bledy.ochrona_od}<p id="{prefiks}-ochrona_od-blad" class="blad-pola">{bledy.ochrona_od}</p>{/if}
  </div>
  <div class="pole-wiersz">
    <label for="{prefiks}-ochrona_do" class="et">Ochrona do</label>
    <input id="{prefiks}-ochrona_do" class="pole" type="date" bind:value={doo} min={od || undefined}
           aria-invalid={bledy.ochrona_do ? 'true' : undefined}
           aria-describedby={bledy.ochrona_do ? `${prefiks}-ochrona_do-blad` : undefined} />
    {#if bledy.ochrona_do}<p id="{prefiks}-ochrona_do-blad" class="blad-pola">{bledy.ochrona_do}</p>{/if}
  </div>
  <p class="mala podpowiedz">
    Wgrany PDF polisy wpisuje numer i daty sam — inaczej przepisz je z polisy.
    <button type="button" class="link" onclick={rok} data-rok-ochrony>Ochrona na rok{od ? ` od ${od.split('-').reverse().join('.')}` : ''}</button>
  </p>
  {#if pokazSprzedaz && sprzedaz}
    <p class="mala podpowiedz" data-data-sprzedazy>Data sprzedaży: <strong>{dataPL(sprzedaz)}</strong> — dzień przed początkiem ochrony.</p>
  {/if}
</div>

<style>
  .polisa-pola { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .55rem .9rem; margin-top: .7rem; }
  .numer { grid-column: 1 / -1; }
  .et { display: block; font-size: .8rem; font-weight: 700; color: var(--slate-600); margin-bottom: .25rem; }
  .pole { width: 100%; min-width: 0; padding: .45rem .6rem; border: 1px solid var(--slate-300); border-radius: 8px; font: inherit; font-size: .9rem; background: #fff; }
  .pole:focus-visible { outline: 2px solid var(--blue-600); border-color: transparent; }
  .pole[aria-invalid='true'] { border-color: var(--red-600); }
  .blad-pola { margin: .25rem 0 0; font-size: .76rem; font-weight: 600; color: #991b1b; }
  .mala { font-size: .76rem; color: var(--slate-600); margin: 0; }
  .podpowiedz { grid-column: 1 / -1; }
  .link { background: none; border: 0; padding: 0; font: inherit; font-size: .78rem; font-weight: 700; color: var(--blue-700); text-decoration: underline; cursor: pointer; }
  .link:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
</style>
