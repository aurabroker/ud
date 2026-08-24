/* Monitor aplikacji UtrataDochodu — Cloudflare Worker.

   scheduled() — co minutę sprawdza to, co akurat wypada wg interwału,
                 zapisuje wynik i wysyła alerty przy zmianie stanu.
   fetch()     — status page, API i endpoint, do którego awaria.js na stronie
                 może raportować błędy prawdziwych użytkowników.
*/

import { aktywne, SPRAWDZENIA } from './checks.js';
import { wykonaj } from './runner.js';
import { decyduj, trescAlertu, wyslij } from './alerts.js';
import * as store from './store.js';
import { stronaHtml } from './page.js';

export async function przebieg(env, teraz, tylkoId = null) {
  const minuta = Math.floor(teraz.getTime() / 60000);
  const doWykonania = aktywne().filter(d =>
    tylkoId ? d.id === tylkoId : minuta % (d.interwal || 1) === 0);

  const zapisy = [];
  const raport = [];

  for (const def of doWykonania) {
    const wynik = await wykonaj(def, fetch, env);
    const stanPrzed = await store.wczytajStan(env.DB, def.id);
    const { stan, akcje } = decyduj(def, stanPrzed, wynik, teraz);

    zapisy.push(store.zapiszStan(env.DB, def.id, stan, wynik, teraz));
    zapisy.push(store.dopiszHistorie(env.DB, def.id, wynik, teraz));

    for (const akcja of akcje) {
      const tresci = trescAlertu(def, wynik, akcja.rodzaj, stanPrzed, teraz);
      const wyslane = await wyslij(env, akcja.kanaly, tresci);
      const bledy = wyslane.filter(w => w.blad);
      zapisy.push(store.zapiszZdarzenie(
        env.DB, akcja.rodzaj, def.id,
        `${tresci.temat}${bledy.length ? ` [PROBLEM Z WYSYŁKĄ: ${bledy.map(b => b.kanal + ': ' + b.blad).join(', ')}]` : ''}`,
        teraz));
    }
    raport.push({ id: def.id, ok: wynik.ok, ms: wynik.ms, blad: wynik.blad, akcje: akcje.map(a => a.rodzaj) });
  }

  /* sprzątanie raz na dobę, o 3:07 — poza szczytem */
  if (teraz.getUTCHours() === 3 && teraz.getUTCMinutes() === 7) zapisy.push(...store.sprzatanie(env.DB, teraz));

  if (zapisy.length) await env.DB.batch(zapisy);
  return raport;
}

const json = (dane, status = 200, naglowki = {}) =>
  new Response(JSON.stringify(dane, null, 2), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...naglowki },
  });

function autoryzowany(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-token');
  return !!env.STATUS_TOKEN && token === env.STATUS_TOKEN;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(przebieg(env, new Date(event.scheduledTime)));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* Endpoint dla zewnętrznego monitora — żeby ktoś pilnował pilnującego. */
    if (url.pathname === '/zdrowie') return new Response('ok', { status: 200 });

    /* Raporty z awaria.js — błędy prawdziwych użytkowników. */
    if (url.pathname === '/zglos-blad') {
      const cors = {
        'Access-Control-Allow-Origin': env.DOZWOLONE_ZRODLO || 'https://utratadochodu.pl',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ blad: 'tylko POST' }, 405, cors);
      try {
        const dane = await request.json();
        await store.zapiszZdarzenie(
          env.DB, 'blad-uzytkownika', String(dane.kod || 'NIEZNANY').slice(0, 60),
          `${String(dane.szczegoly || '').slice(0, 500)} | ${String(dane.strona || '').slice(0, 200)}`,
          new Date()).run();
        return json({ ok: true }, 200, cors);
      } catch (e) {
        return json({ blad: 'niepoprawne dane' }, 400, cors);
      }
    }

    if (!autoryzowany(request, env) && env.STATUS_PAGE_PUBLIC !== 'true') {
      return new Response('Brak dostępu. Dodaj ?token=…', { status: 401 });
    }

    if (url.pathname === '/api/stan') {
      const dane = await store.podsumowanie(env.DB);
      return json({ sprawdzenia: SPRAWDZENIA.map(d => ({ ...d, dane: dane[d.id] || null })) });
    }

    /* Wymuszenie przebiegu — przydatne po wdrożeniu i przy diagnostyce. */
    if (url.pathname === '/uruchom') {
      if (!autoryzowany(request, env)) return new Response('Wymagany token', { status: 401 });
      const raport = await przebieg(env, new Date(), url.searchParams.get('id'));
      return json({ wykonano: raport.length, raport });
    }

    /* Test kanałów alertowych — czy e-mail i SMS naprawdę dochodzą. */
    if (url.pathname === '/test-alert') {
      if (!autoryzowany(request, env)) return new Response('Wymagany token', { status: 401 });
      const wynik = await wyslij(env, ['email', 'sms'], {
        temat: '[TEST] Monitor UtrataDochodu',
        tekst: 'To jest testowa wiadomość z monitora. Jeśli ją widzisz, kanał e-mail działa.',
        sms: 'TEST: monitor UtrataDochodu dziala. Kanal SMS sprawny.',
      });
      return json({ wynik });
    }

    const [dane, zdarzenia] = await Promise.all([
      store.podsumowanie(env.DB),
      store.ostatnieZdarzenia(env.DB, 20),
    ]);
    return new Response(stronaHtml(aktywne(), dane, zdarzenia), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
};
