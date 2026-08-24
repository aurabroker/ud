/* Warstwa bazy (Cloudflare D1).

   D1, nie KV, z prostego powodu: darmowy KV ma limit 1000 zapisów na dobę,
   a sprawdzanie co minutę to 1440 zapisów na samo jedno sprawdzenie.
   D1 daje 100 000 zapisów dziennie — mieści się z zapasem.
*/

const DNI_HISTORII = 30;

export async function wczytajStan(db, id) {
  const w = await db.prepare('SELECT * FROM stan WHERE id = ?').bind(id).first();
  if (!w) return null;
  return {
    status: w.status,
    odKiedy: w.od_kiedy,
    pod: w.pod,
    ostatniAlert: w.ostatni_alert,
    smsWyslany: !!w.sms_wyslany,
  };
}

export function zapiszStan(db, id, stan, wynik, teraz) {
  return db.prepare(`
    INSERT INTO stan (id, status, od_kiedy, pod, ostatni_alert, sms_wyslany,
                      ostatni_wynik, ostatnie_ms, ostatnie_sprawdzenie)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    ON CONFLICT(id) DO UPDATE SET
      status = ?2, od_kiedy = ?3, pod = ?4, ostatni_alert = ?5, sms_wyslany = ?6,
      ostatni_wynik = ?7, ostatnie_ms = ?8, ostatnie_sprawdzenie = ?9
  `).bind(
    id, stan.status, stan.odKiedy, stan.pod, stan.ostatniAlert, stan.smsWyslany ? 1 : 0,
    wynik.ok ? (wynik.opis || 'OK') : wynik.blad, wynik.ms || 0, teraz.toISOString(),
  );
}

export function dopiszHistorie(db, id, wynik, teraz) {
  return db.prepare('INSERT INTO historia (id, czas, ok, ms, blad) VALUES (?, ?, ?, ?, ?)')
    .bind(id, teraz.toISOString(), wynik.ok ? 1 : 0, wynik.ms || 0, wynik.ok ? null : String(wynik.blad || '').slice(0, 300));
}

export function zapiszZdarzenie(db, rodzaj, sprawdzenie, tresc, teraz) {
  return db.prepare('INSERT INTO zdarzenia (czas, rodzaj, sprawdzenie, tresc) VALUES (?, ?, ?, ?)')
    .bind(teraz.toISOString(), rodzaj, sprawdzenie, String(tresc).slice(0, 2000));
}

export function sprzatanie(db, teraz) {
  const granica = new Date(teraz.getTime() - DNI_HISTORII * 86400000).toISOString();
  return [
    db.prepare('DELETE FROM historia WHERE czas < ?').bind(granica),
    db.prepare('DELETE FROM zdarzenia WHERE czas < ?').bind(granica),
  ];
}

export async function podsumowanie(db, ids) {
  const stany = await db.prepare('SELECT * FROM stan').all();
  const doba = new Date(Date.now() - 86400000).toISOString();
  const staty = await db.prepare(`
    SELECT id,
           COUNT(*) AS razem,
           SUM(ok)  AS udane,
           AVG(ms)  AS sredniMs
    FROM historia WHERE czas >= ? GROUP BY id
  `).bind(doba).all();
  const ostatnie = await db.prepare(`
    SELECT id, czas, ok, ms, blad FROM historia
    WHERE czas >= ? ORDER BY czas DESC LIMIT 600
  `).bind(doba).all();

  const wgId = {};
  for (const s of (stany.results || [])) wgId[s.id] = { stan: s, historia: [] };
  for (const s of (staty.results || [])) if (wgId[s.id]) wgId[s.id].staty = s;
  for (const h of (ostatnie.results || [])) if (wgId[h.id]) wgId[h.id].historia.push(h);
  return wgId;
}

export async function ostatnieZdarzenia(db, ile = 20) {
  const r = await db.prepare('SELECT * FROM zdarzenia ORDER BY czas DESC LIMIT ?').bind(ile).all();
  return r.results || [];
}
