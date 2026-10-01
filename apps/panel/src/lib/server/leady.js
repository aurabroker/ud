/**
 * Tablica leadów (Kanban) — warstwa serwerowa.
 *
 * Plik nie importuje niczego ze SvelteKita ($env, $app), żeby dało się go
 * uruchomić w Node na prawdziwych funkcjach SQL (scripts/test-leady-api.mjs).
 * Endpointy w src/routes/panel/leady/ są cienkie: wyciągają sesję, wołają
 * funkcje stąd i zamieniają wynik na odpowiedź HTTP.
 *
 * ZASADY, których pilnuje ten plik:
 *  - Tożsamość wykonawcy pochodzi WYŁĄCZNIE z parametru `userId`, który endpoint
 *    bierze z sesji. Żadne pole ciała żądania nie może jej podmienić.
 *  - Do SQL idą tylko pola z białej listy. Reszta ciała jest ignorowana.
 *  - Walidacja etapu, wersji, uprawnień i pól wymaganych dzieje się w SQL
 *    (ud_lead_zmien) — przeciąganie, menu i szczegóły wołają tę samą funkcję,
 *    więc nie ma ścieżki „na skróty". Tu sprawdzamy tylko kształt żądania.
 *  - Błędy bazy nie wychodzą do przeglądarki surowym komunikatem.
 */

export const SORTOWANIA = ['dzialanie', 'data', 'wartosc'];
export const ROZMIAR_STRONY = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KLUCZ = /^[A-Za-z0-9._:-]{8,80}$/;
const PRODUKTY = ['okresowa', 'trwala', 'zgon', 'nieznany'];
const TERMINY = ['przeterminowane', 'dzisiaj', 'tydzien', 'brak'];
const DZIALANIA = ['telefon', 'email', 'spotkanie', 'inne'];
const OPERACJE = ['przenies', 'dzialanie', 'opiekun', 'archiwizuj'];

/** Błąd, który endpoint zamienia na odpowiedź HTTP bez dalszej obróbki. */
export class BladApi extends Error {
  /** @param {number} status @param {Record<string, unknown>} body */
  constructor(status, body) {
    super(String(body?.komunikat ?? 'Błąd'));
    this.status = status;
    this.body = body;
  }
}

const blad = (status, komunikat, reszta = {}) => new BladApi(status, { status: 'blad', komunikat, ...reszta });
const jestUuid = (x) => typeof x === 'string' && UUID.test(x);

/**
 * Filtr i sortowanie z parametrów adresu. Nieznane albo niepoprawne wartości
 * są pomijane (nie rzucają): stary link nie ma wywalać tablicy.
 * @param {URLSearchParams | Record<string, unknown>} src
 */
export function filtrZParametrow(src) {
  const pobierz = (k) => {
    const v = src instanceof URLSearchParams ? src.get(k) : src?.[k];
    return typeof v === 'string' ? v : '';
  };
  const filtr = {};

  const q = pobierz('q').trim().slice(0, 100);
  if (q) filtr.q = q;

  const opiekun = pobierz('opiekun');
  if (opiekun === 'ja' || opiekun === 'brak' || jestUuid(opiekun)) filtr.opiekun = opiekun;

  const zrodlo = pobierz('zrodlo');
  if (/^[a-z0-9_-]{1,30}$/.test(zrodlo)) filtr.zrodlo = zrodlo;

  const produkt = pobierz('produkt');
  if (PRODUKTY.includes(produkt)) filtr.produkt = produkt;

  const termin = pobierz('termin');
  if (TERMINY.includes(termin)) filtr.termin = termin;

  const sortParam = pobierz('sort');
  return {
    filtr,
    sort: SORTOWANIA.includes(sortParam) ? sortParam : 'dzialanie',
    aktywny: Object.keys(filtr).length > 0,
  };
}

/** Wywołanie funkcji SQL; błąd bazy → BladApi 502 (szczegóły tylko do logu). */
async function rpc(sb, nazwa, args) {
  const { data, error } = await sb.rpc(nazwa, args);
  if (error) {
    console.error('[leady]', nazwa, error.code || '', error.message || error);
    throw blad(502, 'Nie udało się połączyć z bazą. Spróbuj ponownie.', { ponow: true });
  }
  return data;
}

/** Plan tablicy agenta albo 403, gdy to nie jest aktywny agent. */
export async function wczytajPlan(sb, userId, pipelineId) {
  const plan = await rpc(sb, 'ud_leady_plan', {
    p_user: userId,
    p_pipeline: jestUuid(pipelineId) ? pipelineId : null,
  });
  if (!plan) throw blad(403, 'Brak dostępu do tablicy leadów.');
  return plan;
}

/**
 * Dokłada leady z kartoteki i szkiców. Awaria synchronizacji nie blokuje
 * tablicy — pokazujemy to, co jest, i ostrzeżenie.
 */
export async function synchronizuj(sb) {
  try {
    const { error } = await sb.rpc('ud_leady_synchronizuj');
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[leady] synchronizacja:', e?.message || e);
    return false;
  }
}

export async function liczniki(sb, userId, pipelineId, filtr) {
  const wiersze = await rpc(sb, 'ud_leady_liczniki', { p_pipeline: pipelineId, p_filtr: filtr, p_user: userId });
  /** @type {Record<string, {ile: number, ileWszystkich: number, suma: number, sumaWszystkich: number}>} */
  const wynik = {};
  for (const w of wiersze || []) {
    wynik[w.etap_id] = {
      ile: Number(w.ile),
      ileWszystkich: Number(w.ile_wszystkich),
      suma: Number(w.suma),
      sumaWszystkich: Number(w.suma_wszystkich),
    };
  }
  return wynik;
}

export async function kolumna(sb, userId, { pipelineId, etapId, filtr, sort, offset = 0, limit = ROZMIAR_STRONY }) {
  if (!jestUuid(etapId)) throw blad(400, 'Nieprawidłowy etap.');
  const wynik = await rpc(sb, 'ud_leady_kolumna', {
    p_pipeline: pipelineId,
    p_etap: etapId,
    p_filtr: filtr,
    p_sort: SORTOWANIA.includes(sort) ? sort : 'dzialanie',
    p_limit: Math.min(Math.max(Number(limit) || ROZMIAR_STRONY, 1), 100),
    p_offset: Math.max(Number(offset) || 0, 0),
    p_user: userId,
  });
  return { karty: wynik?.karty ?? [], razem: Number(wynik?.razem ?? 0) };
}

/**
 * Szczegóły leada + jego oferty. Oferty czytamy klientem Z SESJĄ agenta, nie
 * serwisowym: panel ma już swoje reguły dostępu do ofert i tablica leadów nie
 * jest drogą na skróty do cudzych.
 */
export async function szczegoly(sb, userSb, leadId) {
  if (!jestUuid(leadId)) throw blad(400, 'Nieprawidłowy identyfikator leada.');
  const s = await rpc(sb, 'ud_lead_szczegoly', { p_lead: leadId });
  if (!s) throw blad(404, 'Lead nie istnieje albo został zarchiwizowany.');

  let oferty = [];
  if (s.klient_id && userSb) {
    const { data } = await userSb
      .from('ud_offers')
      .select('id, offer_number, status, created_at, archived_at')
      .eq('client_id', s.klient_id)
      .order('created_at', { ascending: false })
      .limit(5);
    oferty = data || [];
  }
  return { ...s, oferty };
}

/** Pierwsze ładowanie tablicy: plan, liczniki i pierwsza strona każdej rozwiniętej kolumny. */
export async function wczytajTablice(sb, userSb, userId, parametry) {
  const { filtr, sort, aktywny } = filtrZParametrow(parametry);
  // Plan pierwszy: nie-agent dostaje 403, zanim cokolwiek zostanie dopisane.
  const plan = await wczytajPlan(sb, userId, parametry.get?.('pipeline') ?? parametry.pipeline);
  const synchronizacja = await synchronizuj(sb);
  const pipelineId = plan.pipeline.id;
  const zwiniete = new Set(plan.zwiniete);

  const [licz, ...strony] = await Promise.all([
    liczniki(sb, userId, pipelineId, filtr),
    ...plan.etapy
      .filter((e) => !zwiniete.has(e.id))
      .map((e) => kolumna(sb, userId, { pipelineId, etapId: e.id, filtr, sort }).then((k) => [e.id, k])),
  ]);

  const leadParam = parametry.get?.('lead') ?? parametry.lead;
  let otwarty = null;
  let otwartyBrak = false;
  if (jestUuid(leadParam)) {
    try {
      otwarty = await szczegoly(sb, userSb, leadParam);
    } catch (e) {
      if (e instanceof BladApi && e.status === 404) otwartyBrak = true;
      else throw e;
    }
  }

  return {
    plan,
    filtr,
    sort,
    filtrAktywny: aktywny,
    liczniki: licz,
    kolumny: Object.fromEntries(strony),
    synchronizacja,
    otwarty,
    otwartyBrak,
  };
}

/** Status z funkcji SQL → kod HTTP. */
const HTTP = {
  ok: 200,
  bez_zmiany: 200,
  konflikt: 409,
  klucz_uzyty: 409,
  brak_leada: 404,
  brak_uprawnien: 403,
  niedozwolony: 422,
  brak_danych: 422,
  bledne_dane: 400,
};

function wynikZmiany(wynik) {
  const status = HTTP[wynik?.status];
  if (!status) {
    console.error('[leady] nieznany wynik funkcji SQL', wynik);
    throw blad(500, 'Nieoczekiwany wynik zapisu.');
  }
  return { status, body: wynik };
}

/** Przeniesienie wymaga etapu docelowego; reszta operacji ma własne pola. */
function daneOperacji(op, body) {
  const tekst = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  if (op === 'przenies') {
    const dane = { etap_id: body.targetStageId };
    const przejscie = body.transitionData;
    if (przejscie && typeof przejscie === 'object' && typeof przejscie.powod_utraty === 'string') {
      dane.powod_utraty = przejscie.powod_utraty.slice(0, 400);
    }
    return dane;
  }
  if (op === 'dzialanie') {
    return { typ: tekst(body.typ, 20), termin: tekst(body.termin, 40), opis: tekst(body.opis, 400) };
  }
  if (op === 'opiekun') {
    return { opiekun_id: body.opiekunId === null ? null : tekst(body.opiekunId, 40) };
  }
  return {};
}

/**
 * Jedna ścieżka zmiany stanu leada. Kontrakt (MoveLeadCommand + pozostałe operacje):
 *   { op = 'przenies', leadId, expectedVersion, idempotencyKey,
 *     targetStageId, transitionData? | typ, termin, opis | opiekunId }
 */
export async function zmien(sb, userId, body) {
  if (!body || typeof body !== 'object') throw blad(400, 'Nieprawidłowe żądanie.');
  const op = body.op ?? 'przenies';
  if (!OPERACJE.includes(op)) throw blad(400, 'Nieznana operacja.');
  if (!jestUuid(body.leadId)) throw blad(400, 'Nieprawidłowy identyfikator leada.');
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) throw blad(400, 'Brak wersji leada.');
  if (typeof body.idempotencyKey !== 'string' || !KLUCZ.test(body.idempotencyKey)) {
    throw blad(400, 'Brak klucza idempotencji.');
  }
  if (op === 'przenies' && !jestUuid(body.targetStageId)) throw blad(400, 'Nieprawidłowy etap docelowy.');
  if (op === 'dzialanie' && body.typ != null && !DZIALANIA.includes(body.typ)) throw blad(400, 'Nieznany rodzaj działania.');
  if (op === 'opiekun' && body.opiekunId != null && !jestUuid(body.opiekunId)) throw blad(400, 'Nieprawidłowy opiekun.');

  const wynik = await rpc(sb, 'ud_lead_zmien', {
    p_op: op,
    p_lead: body.leadId,
    p_wersja: body.expectedVersion,
    p_klucz: body.idempotencyKey,
    p_user: userId,
    p_dane: daneOperacji(op, body),
  });
  return wynikZmiany(wynik);
}

export async function notatka(sb, userId, body) {
  if (!body || typeof body !== 'object') throw blad(400, 'Nieprawidłowe żądanie.');
  if (!jestUuid(body.leadId)) throw blad(400, 'Nieprawidłowy identyfikator leada.');
  if (typeof body.idempotencyKey !== 'string' || !KLUCZ.test(body.idempotencyKey)) {
    throw blad(400, 'Brak klucza idempotencji.');
  }
  if (typeof body.tresc !== 'string') throw blad(400, 'Brak treści notatki.');
  const wynik = await rpc(sb, 'ud_lead_notatka', {
    p_lead: body.leadId,
    p_klucz: body.idempotencyKey,
    p_user: userId,
    p_tresc: body.tresc.slice(0, 2100),
  });
  return wynikZmiany(wynik);
}

/** Osobisty stan zwinięcia. etapId = null i zwin = false → rozwiń wszystkie. */
export async function zwin(sb, userId, body) {
  if (!body || typeof body !== 'object') throw blad(400, 'Nieprawidłowe żądanie.');
  if (!jestUuid(body.pipelineId)) throw blad(400, 'Nieprawidłowy pipeline.');
  if (body.etapId != null && !jestUuid(body.etapId)) throw blad(400, 'Nieprawidłowy etap.');
  if (typeof body.zwin !== 'boolean') throw blad(400, 'Brak pola „zwin".');
  if (body.zwin && body.etapId == null) throw blad(400, 'Podaj etap do zwinięcia.');

  const { data, error } = await sb.rpc('ud_leady_zwin', {
    p_user: userId,
    p_pipeline: body.pipelineId,
    p_etap: body.etapId ?? null,
    p_zwin: body.zwin,
  });
  if (error) {
    // 42501: nie agent; 22023: etap spoza pipeline'u. Obie to błąd żądania, nie bazy.
    if (error.code === '42501') throw blad(403, 'Brak dostępu do tablicy leadów.');
    if (error.code === '22023') throw blad(422, 'Ten etap nie należy do tego pipeline\'u.');
    console.error('[leady] zwin', error.code || '', error.message || error);
    throw blad(502, 'Nie udało się zapisać widoku. Spróbuj ponownie.', { ponow: true });
  }
  return { status: 200, body: { status: 'ok', zwiniete: data ?? [] } };
}

/**
 * Wspólna obsługa żądania dla wszystkich endpointów tablicy: sesja → typ treści
 * → wykonanie → odpowiedź. Zwraca { status, body }; adapter w
 * leady-http.js zamienia to na Response. Osobno od SvelteKita, żeby dało się to
 * przetestować w Node.
 *
 * Treść musi być application/json: żądania o typach „prostych" (formularz,
 * text/plain) mogą przyjść z cudzej strony bez preflightu CORS, JSON — nie.
 */
export async function przetworz({ user, odczyt = false, typTresci, czytajCialo, wykonaj }) {
  if (!user) {
    return { status: 401, body: { status: 'blad', komunikat: 'Sesja wygasła. Zaloguj się ponownie.', sesja: true } };
  }
  let body;
  if (!odczyt) {
    if (!String(typTresci || '').toLowerCase().startsWith('application/json')) {
      return { status: 415, body: { status: 'blad', komunikat: 'Oczekiwano application/json.' } };
    }
    try {
      body = await czytajCialo();
    } catch {
      return { status: 400, body: { status: 'blad', komunikat: 'Nieprawidłowy JSON.' } };
    }
  }
  try {
    return await wykonaj({ userId: user.id, body });
  } catch (e) {
    if (e instanceof BladApi) return { status: e.status, body: e.body };
    console.error('[leady] nieoczekiwany błąd:', e?.message || e);
    return { status: 500, body: { status: 'blad', komunikat: 'Nieoczekiwany błąd. Spróbuj ponownie.', ponow: true } };
  }
}
