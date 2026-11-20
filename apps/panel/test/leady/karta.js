/**
 * Strona testowa: prawdziwa karta klienta (/panel/klienci/[id]/+page.svelte)
 * z danymi z tej samej funkcji co jej load (kartaKlienta). ?u= — użytkownik,
 * ?nazwa= — klient z fixture, ?widok= / ?zrodlo= — filtry listy.
 *
 * window.__pokazKlienta(nazwa) podmienia `data` bez tworzenia strony od nowa —
 * tak SvelteKit przechodzi strzałką „Następny klient" (zmienia się tylko
 * parametr trasy, komponent zostaje).
 */
import { mount } from 'svelte';
import '/src/routes/app.css';
import Harness from './StatystykiHarness.svelte';
import Karta from '/src/routes/panel/klienci/[id]/+page.svelte';

const parametry = new URLSearchParams(location.search);
const uzytkownik = parametry.get('u') ?? 'adm';
let nazwa = parametry.get('nazwa') ?? '';
const pobierz = async () => {
  const p = new URLSearchParams(parametry);
  p.set('nazwa', nazwa);
  return (await fetch(`/__test/karta-dane?${p}`, { headers: { 'x-test-user': uzytkownik } })).json();
};
window.__pokazKlienta = async (n) => { nazwa = n; await window.__invalidateAll(); };
mount(Harness, { target: document.getElementById('app'), props: { Strona: Karta, poczatkowe: await pobierz(), pobierz } });
document.documentElement.setAttribute('data-gotowe', '');
