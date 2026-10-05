/**
 * Strona testowa: prawdziwa strona /panel/statystyki albo /panel/polisy
 * (?strona=polisy), z oknem „Dodaj polisę", na serwerze testowym.
 * ?u=ula|adm|olek — użytkownik z nagłówka x-test-user, dokładany do każdego
 * fetch (w panelu robi to ciasteczko sesji).
 */
import { mount } from 'svelte';
import '/src/routes/app.css';
import Harness from './StatystykiHarness.svelte';
import Statystyki from '/src/routes/panel/statystyki/+page.svelte';
import Polisy from '/src/routes/panel/polisy/+page.svelte';

const parametry = new URLSearchParams(location.search);
const uzytkownik = parametry.get('u') ?? 'ula';
const strona = parametry.get('strona') === 'polisy' ? 'polisy' : 'statystyki';
const oryginalny = window.fetch.bind(window);
window.fetch = (url, opcje = {}) => oryginalny(url, { ...opcje, headers: { ...(opcje.headers ?? {}), 'x-test-user': uzytkownik } });

const pobierz = async () => (await fetch(`/__test/${strona}-dane?${parametry}`)).json();
mount(Harness, {
  target: document.getElementById('app'),
  props: { Strona: strona === 'polisy' ? Polisy : Statystyki, poczatkowe: await pobierz(), pobierz },
});
document.documentElement.setAttribute('data-gotowe', '');
