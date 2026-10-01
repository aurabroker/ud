/**
 * baza.js — zapis pomiarów i stanu w D1.
 *
 * Cała logika alertowania opiera się na jednej zasadzie: alarmujemy przy
 * ZMIANIE stanu, nie przy każdym nieudanym pomiarze. Dlatego obok surowych
 * pomiarów trzymamy osobną tabelę `stan` z licznikiem powtórzeń.
 */

/** Ile dni historii zostawiamy. */
export const DNI_HISTORII = 30;

/** Skracamy szczegóły, żeby jeden gadatliwy stack trace nie zapchał bazy. */
const skroc = (t) => (t == null ? null : String(t).slice(0, 500));

export async function zapiszPomiar(db, wynik) {
  await db
    .prepare('INSERT INTO pomiar (sonda, czas, ok, ms, kod, szczegoly) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(wynik.sonda, wynik.czas, wynik.ok ? 1 : 0, wynik.ms ?? null, wynik.kod ?? null, skroc(wynik.szczegoly))
    .run();
}

/**
 * Nanosi wynik na stan sondy i mówi, co się zmieniło.
 *
 * Zwraca `{ przejscie, podRzad }`, gdzie `przejscie` to jedno z:
 *   'awaria'   — sonda właśnie przekroczyła próg nieudanych pomiarów,
 *   'powrot'   — sonda wróciła do działania po zgłoszonej awarii,
 *   null       — nic, o czym warto zawiadamiać.
 *
 * `progAwarii` istnieje po to, żeby pojedyncze mrugnięcie sieci nie budziło
 * nikogo w nocy. Dopiero drugi (domyślnie) nieudany pomiar z rzędu to awaria.
 */
export async function naniesStan(db, wynik, progAwarii = 2) {
  const poprzedni = await db
    .prepare('SELECT ok, pod_rzad, od, zgloszony FROM stan WHERE sonda = ?')
    .bind(wynik.sonda)
    .first();

  const ok = wynik.ok ? 1 : 0;
  const tenSam = poprzedni != null && poprzedni.ok === ok;
  const podRzad = tenSam ? poprzedni.pod_rzad + 1 : 1;
  const od = tenSam ? poprzedni.od : wynik.czas;

  let zgloszony = tenSam ? poprzedni.zgloszony : 0;
  let przejscie = null;

  if (!ok && podRzad >= progAwarii && !zgloszony) {
    przejscie = 'awaria';
    zgloszony = 1;
  } else if (ok && poprzedni != null && poprzedni.ok === 0 && poprzedni.zgloszony) {
    // Powrót zgłaszamy tylko wtedy, gdy zgłosiliśmy awarię. Inaczej adresat
    // dostaje „znowu działa" o czymś, o czym nigdy nie usłyszał.
    przejscie = 'powrot';
    zgloszony = 1;
  }

  await db
    .prepare(
      `INSERT INTO stan (sonda, ok, pod_rzad, od, zgloszony, szczegoly)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(sonda) DO UPDATE SET
         ok = excluded.ok, pod_rzad = excluded.pod_rzad, od = excluded.od,
         zgloszony = excluded.zgloszony, szczegoly = excluded.szczegoly`,
    )
    .bind(wynik.sonda, ok, podRzad, od, zgloszony, skroc(wynik.szczegoly))
    .run();

  return { przejscie, podRzad, od };
}

/** Bieżący stan wszystkich sond. */
export async function stanSond(db) {
  const { results } = await db
    .prepare('SELECT sonda, ok, pod_rzad, od, szczegoly FROM stan ORDER BY sonda')
    .all();
  return results ?? [];
}

/** Dostępność i mediana czasu odpowiedzi w oknie ostatnich N godzin. */
export async function podsumowanie(db, godzin = 24) {
  const od = Date.now() - godzin * 3600_000;
  const { results } = await db
    .prepare(
      `SELECT sonda,
              COUNT(*)                         AS pomiarow,
              SUM(ok)                          AS udanych,
              CAST(AVG(ms) AS INTEGER)         AS srednia_ms,
              MAX(ms)                          AS max_ms
         FROM pomiar
        WHERE czas >= ?
        GROUP BY sonda
        ORDER BY sonda`,
    )
    .bind(od)
    .all();
  return results ?? [];
}

/** Ostatnie niepowodzenia — do strony statusu. */
export async function ostatnieAwarie(db, ile = 20) {
  const { results } = await db
    .prepare('SELECT sonda, czas, kod, szczegoly FROM pomiar WHERE ok = 0 ORDER BY czas DESC LIMIT ?')
    .bind(ile)
    .all();
  return results ?? [];
}

/** Kasuje pomiary starsze niż okno historii. */
export async function posprzataj(db) {
  const granica = Date.now() - DNI_HISTORII * 86_400_000;
  const wynik = await db.prepare('DELETE FROM pomiar WHERE czas < ?').bind(granica).run();
  return wynik.meta?.changes ?? 0;
}
