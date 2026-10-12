/**
 * Strona testowa: montuje prawdziwy komponent Tablica z prawdziwym klientem API
 * na serwerze testowym. Parametry adresu: ?u=ula|adm|olek|ines|brak (użytkownik
 * z nagłówka x-test-user) oraz zwykłe parametry tablicy (q, opiekun, lead…).
 * Dane początkowe pobiera z /__test/tablica — odpowiednik funkcji load trasy.
 */
import { mount } from 'svelte';
import '/src/routes/app.css';
import { utworzApi } from '$lib/leady/api.js';
import Tablica from '$lib/leady/Tablica.svelte';

const parametry = new URLSearchParams(location.search);
const uzytkownik = parametry.get('u') ?? 'ula';
const naglowki = { 'x-test-user': uzytkownik };

const odpowiedz = await fetch(`/__test/tablica?${parametry}`, { headers: naglowki });
const dane = await odpowiedz.json();

if (!odpowiedz.ok) {
  document.getElementById('app').textContent = `Błąd ${odpowiedz.status}: ${dane.komunikat}`;
} else {
  window.__zadania = [];
  const api = utworzApi({ naglowki, opoznienia: [30, 60] });
  mount(Tablica, {
    target: document.getElementById('app'),
    props: {
      dane,
      api,
      odUrl: ({ filtr, sort, lead }) => {
        const p = new URLSearchParams();
        p.set('u', uzytkownik);
        for (const [k, v] of Object.entries(filtr)) if (v) p.set(k, String(v));
        if (sort && sort !== 'dzialanie') p.set('sort', sort);
        if (lead) p.set('lead', lead);
        history.replaceState(null, '', `?${p}`);
      },
    },
  });
  document.documentElement.setAttribute('data-gotowe', '');
}
