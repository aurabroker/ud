/**
 * Ważność linku do oferty (ud_offers.share_expires_at, ud_offer_by_token) —
 * na jednorazowym klastrze Postgresa, z prawdziwej migracji.
 *
 *   node scripts/test-link-oferty-sql.mjs
 *
 * Ładuje atrapę Supabase (lib/pg-tymczasowy.mjs) i supabase/tests/link-oferty-stub.sql
 * (kolumny linku, RLS i uprawnienia jak w produkcji, ud_offer_by_token sprzed zmiany),
 * wstawia ofertę „sprzed migracji”, stosuje migrację dwa razy (idempotencja), potem
 * supabase/tests/link-oferty.sql — asercje PASS/FAIL. Plik testów zawsze kończy się
 * wyjątkiem "TESTY_WYNIK", żeby ten sam plik dało się puścić na produkcji bez śladu.
 *
 * LINK_MIGRACJA=plik.sql podmienia migrację (np. pusty plik: testy mają być czerwone).
 * Bez binariów Postgresa kończy się błędem, nie zielonym wynikiem.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { uruchomKlaster, wczytaj, korzen } from './lib/pg-tymczasowy.mjs';

const migracja = process.env.LINK_MIGRACJA
  ? readFileSync(resolve(process.env.LINK_MIGRACJA), 'utf8')
  : readdirSync(join(korzen, 'supabase/migrations'))
      .filter((p) => /_oferty_wygasanie_linku\.sql$/.test(p))
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
  let r = klaster.psql(
    "insert into public.ud_offers (name, share_token, status) values ('zz-test-sprzed-migracji', 'zz-test-stary-link', 'sent');"
  );
  if (r.status !== 0) throw new Error(`oferta sprzed migracji:\n${r.stderr}`);

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
