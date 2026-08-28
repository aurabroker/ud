import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atrapaD1, podmienFetch, odpowiedz } from './pomocnicze.js';
import { przebieg, zbudujSondy } from '../src/index.js';
import { html, trwanie } from '../src/strona.js';
import { stanSond, podsumowanie, ostatnieAwarie } from '../src/baza.js';

/** Środowisko bez kluczy — sondy wymagające sekretów mają się nie pojawić. */
const envBaza = () => ({ DB: atrapaD1(), URL_PORTALU: 'https://p', URL_SUPABASE: 'https://s' });

test('sondy wymagające sekretów nie powstają bez tych sekretów', () => {
  const bez = zbudujSondy({}).map((s) => s.nazwa);
  assert.ok(!bez.some((n) => n.includes('RLS')), 'brak klucza anon = brak sond RLS');
  assert.ok(!bez.some((n) => n.includes('cisza')), 'brak service_role = brak sondy ciszy');
  assert.ok(!bez.some((n) => n.includes('OWU')), 'brak id dokumentu = brak sondy pobierania');

  const z = zbudujSondy({ KLUCZ_ANON: 'a', KLUCZ_SERWISOWY: 's', ID_DOKUMENTU_TESTOWEGO: 'x' })
    .map((s) => s.nazwa);
  assert.ok(z.some((n) => n.includes('RLS')));
  assert.ok(z.some((n) => n.includes('cisza')));
  assert.ok(z.some((n) => n.includes('OWU')));
});

test('przebieg zapisuje pomiar dla każdej sondy', async () => {
  const env = envBaza();
  const przywroc = podmienFetch(async () => odpowiedz('Ubezpieczenie utraty dochodu Sitemap # UtrataDochodu.pl <sitemapindex wniosek'));
  try {
    const wynik = await przebieg(env);
    assert.equal(wynik.sond, env.DB._pomiary.length);
    assert.ok(wynik.sond >= 8, 'zestaw podstawowy to co najmniej osiem sond');
  } finally { przywroc(); }
});

test('pierwsza runda awarii nie wysyła alertów, druga wysyła', async () => {
  const env = envBaza();
  const wyslane = [];
  env.ALERT_WEBHOOK = 'https://webhook.example';

  const przywroc = podmienFetch(async (url, opcje) => {
    if (String(url).startsWith('https://webhook.example')) {
      wyslane.push(JSON.parse(opcje.body));
      return odpowiedz({ ok: true });
    }
    return odpowiedz('padło', { status: 503 });
  });

  try {
    const pierwsza = await przebieg(env);
    assert.equal(pierwsza.alertow, 0, 'jedno mrugnięcie nie budzi nikogo');

    const druga = await przebieg(env);
    assert.ok(druga.alertow > 0, 'druga runda potwierdza awarię');
    assert.equal(wyslane.length, druga.alertow);
    assert.match(wyslane[0].text, /🔴/);
  } finally { przywroc(); }
});

test('strona statusu pokazuje awarię i nie wpuszcza HTML-a z komunikatu błędu', async () => {
  const env = envBaza();
  const przywroc = podmienFetch(async () =>
    odpowiedz('<script>alert(1)</script>', { status: 500 }));
  try {
    await przebieg(env);
    await przebieg(env);
  } finally { przywroc(); }

  const [stan, sumy, awarie] = await Promise.all([
    stanSond(env.DB), podsumowanie(env.DB, 24), ostatnieAwarie(env.DB, 20),
  ]);
  const strona = html({ stan, podsumowanie: sumy, awarie, okno: 24 });

  assert.match(strona, /Wykryto awarię/);
  assert.match(strona, /noindex/, 'strona statusu nie ma trafiać do wyszukiwarki');
  assert.ok(!strona.includes('<script>alert(1)</script>'), 'treść z monitorowanej strony musi być zescapowana');
});

test('strona statusu bez żadnych pomiarów nie wywraca się', () => {
  const strona = html({ stan: [], podsumowanie: [], awarie: [], okno: 24 });
  assert.match(strona, /monitor jeszcze nie wystartował/);
});

test('czas trwania czyta się po ludzku', () => {
  const teraz = Date.now();
  assert.equal(trwanie(teraz - 5 * 60_000, teraz), '5 min');
  assert.equal(trwanie(teraz - 190 * 60_000, teraz), '3 godz. 10 min');
  assert.equal(trwanie(teraz - 50 * 3600_000, teraz), '2 dni 2 godz.');
});
