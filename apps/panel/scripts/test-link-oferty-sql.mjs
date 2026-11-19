/**
 * Ważność linku do oferty (ud_offers.share_expires_at, ud_offer_by_token) —
 * na jednorazowym klastrze Postgresa, z prawdziwej migracji.
 *
 *   node scripts/test-link-oferty-sql.mjs
 *
 * Ładuje atrapę Supabase (lib/pg-tymczasowy.mjs) i supabase/tests/link-oferty-stub.sql
 * (kolumny linku, RLS i uprawnienia jak w produkcji, ud_offer_by_token sprzed zmiany,
 * minimalny kosz ofert), wstawia oferty i kopie w koszu „sprzed migracji”, stosuje obie
 * migracje (…_oferty_wygasanie_linku i …_oferty_waznosc_starych_linkow) dwa razy
 * (idempotencja), potem supabase/tests/link-oferty.sql — asercje PASS/FAIL. Plik testów
 * zawsze kończy się wyjątkiem "TESTY_WYNIK", żeby ten sam plik dało się puścić na
 * produkcji bez śladu.
 *
 * LINK_MIGRACJA=plik.sql podmienia obie migracje (np. pusty plik: testy mają być czerwone).
 * Bez binariów Postgresa kończy się błędem, nie zielonym wynikiem.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { uruchomKlaster, wczytaj, korzen } from './lib/pg-tymczasowy.mjs';

const migracja = process.env.LINK_MIGRACJA
  ? readFileSync(resolve(process.env.LINK_MIGRACJA), 'utf8')
  : readdirSync(join(korzen, 'supabase/migrations'))
      .filter((p) => /_oferty_(wygasanie_linku|waznosc_starych_linkow)\.sql$/.test(p))
      .sort()
      .map((p) => wczytaj(`supabase/migrations/${p}`))
      .join('\n');

let klaster;
try {
  klaster = await uruchomKlaster({ dodatkowe: ['link-oferty-stub.sql'] });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

let wyjscie = 1;
try {
  // Oferty i kopie w koszu sprzed migracji: każda gałąź reguły z …_oferty_waznosc_starych_linkow.
  let r = klaster.psql(`
    insert into public.ud_offers (name, share_token, status, created_at, sent_at, archived_at) values
      ('zz-test-sprzed-kupiona',          'zz-test-s1', 'bought',   now() - interval '120 days', now() - interval '100 days', null),
      ('zz-test-sprzed-odrzucona',        'zz-test-s2', 'rejected', now() - interval '20 days',  now() - interval '10 days',  null),
      ('zz-test-sprzed-archiwum',         'zz-test-s3', 'sent',     now() - interval '20 days',  now() - interval '10 days',  now() - interval '1 day'),
      ('zz-test-sprzed-wyslana-dawno',    'zz-test-s4', 'viewed',   now() - interval '120 days', now() - interval '100 days', null),
      ('zz-test-sprzed-wyslana-niedawno', 'zz-test-s5', 'sent',     now() - interval '40 days',  now() - interval '10 days',  null),
      ('zz-test-sprzed-wybrana',          'zz-test-s6', 'chosen',   now() - interval '30 days',  now() - interval '5 days',   null),
      ('zz-test-sprzed-robocza',          'zz-test-s7', 'draft',    now() - interval '10 days',  null,                        null),
      ('zz-test-sprzed-robocza-stara',    'zz-test-s8', 'draft',    now() - interval '100 days', null,                        null);
    insert into public.ud_offers_kosz (offer_id, oferta) values
      (gen_random_uuid(), jsonb_build_object('name', 'zz-test-kosz-otwarta', 'status', 'sent',
         'sent_at', now() - interval '10 days', 'created_at', now() - interval '20 days', 'archived_at', null)),
      (gen_random_uuid(), jsonb_build_object('name', 'zz-test-kosz-kupiona', 'status', 'bought',
         'sent_at', now() - interval '10 days', 'created_at', now() - interval '20 days')),
      (gen_random_uuid(), jsonb_build_object('name', 'zz-test-kosz-z-terminem', 'status', 'sent',
         'share_expires_at', '2030-01-01T00:00:00+00:00')),
      (gen_random_uuid(), jsonb_build_object('name', 'zz-test-kosz-null', 'status', 'viewed',
         'sent_at', now() - interval '100 days', 'share_expires_at', null));
  `);
  if (r.status !== 0) throw new Error(`oferty sprzed migracji:\n${r.stderr}`);

  for (const przebieg of process.env.LINK_MIGRACJA ? [1] : [1, 2]) {
    r = klaster.psql(migracja);
    if (r.status !== 0) throw new Error(`migracja (przebieg ${przebieg}):\n${r.stderr}`);
  }

  r = klaster.psql(`set testy.lokalnie = on;\n${wczytaj('supabase/tests/link-oferty.sql')}`);
  const linie = `${r.stderr}\n${r.stdout}`.split('\n');
  for (const l of linie) {
    const m = l.match(/NOTICE:\s+(PASS|FAIL) (.*)$/);
    if (m) console.log(`${m[1] === 'PASS' ? '  ok ' : '  ZLE'} ${m[2]}`);
  }
  const wynik = linie.find((l) => l.includes('TESTY_WYNIK'));
  const obce = linie.filter((l) => /ERROR:|FATAL:/.test(l) && !l.includes('TESTY_WYNIK'));
  if (!wynik || obce.length) {
    console.error('\nTesty nie doszły do końca:\n' + (obce.join('\n') || r.stderr));
  } else {
    const m = wynik.match(/pass=(\d+) fail=(\d+)/);
    console.log(`\n${wynik.replace(/^.*TESTY_WYNIK/, 'Wynik:')}`);
    if (m && Number(m[2]) === 0 && Number(m[1]) > 0) wyjscie = 0;
  }
} catch (e) {
  console.error(e.message);
  wyjscie = 2;
} finally {
  klaster.stop();
}
process.exit(wyjscie);
