/**
 * Strona testowa: prawdziwa zakładka /panel/klienci (+page.svelte) w
 * przeglądarce, z danymi z tej samej funkcji co jej load (listaKlientow na
 * bazie testowej). ?u=adm|ula|olek — użytkownik z nagłówka x-test-user;
 * ?widok= i ?zrodlo= — filtry listy jak w adresie panelu.
 *
 * Routera SvelteKita tu nie ma: odnośniki (karta klienta, tablica) prowadzą
 * zwykłą nawigacją przeglądarki — test przechwytuje je przez page.route.
 */
import { mount } from 'svelte';
import '/src/routes/app.css';
import Klienci from '/src/routes/panel/klienci/+page.svelte';

const parametry = new URLSearchParams(location.search);
const uzytkownik = parametry.get('u') ?? 'adm';
const odpowiedz = await fetch(`/__test/klienci-dane?${parametry}`, { headers: { 'x-test-user': uzytkownik } });
mount(Klienci, { target: document.getElementById('app'), props: { data: await odpowiedz.json() } });
document.documentElement.setAttribute('data-gotowe', '');
