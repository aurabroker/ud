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
const OPERACJE = ['przenies', 'dzialanie', 'opiekun', 'archiwizuj', 'sprzedaz'];
const POLA_SPRZEDAZY = ['skladka_roczna', 'skladka_mies', 'swiadczenie_okresowa', 'swiadczenie_trwala', 'swiadczenie_zgon'];
export const OKRESY_STATYSTYK = ['wszystko', 'miesiac', 'poprzedni', 'kwartal', 'rok'];

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
 * Dokłada leady z kartoteki klientów (porzucone wnioski od 02.10.2026 nie są
 * leadami). Awaria synchronizacji nie blokuje tablicy — pokazujemy to, co jest,
 * i ostrzeżenie.
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
  /** @type {Record<string, {ile: number, ileWszystkich: number, suma: number, sumaWszystkich: number, skladki: number, skladkiWszystkich: number}>} */
  const wynik = {};
  for (const w of wiersze || []) {
    wynik[w.etap_id] = {
      ile: Number(w.ile),
      ileWszystkich: Number(w.ile_wszystkich),
      suma: Number(w.suma),
      sumaWszystkich: Number(w.suma_wszystkich),
      skladki: Number(w.skladki ?? 0),
      skladkiWszystkich: Number(w.skladki_wszystkich ?? 0),
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
export async function szczegoly(sb, userSb, userId, leadId) {
  if (!jestUuid(leadId)) throw blad(400, 'Nieprawidłowy identyfikator leada.');
  // Widoczność rozstrzyga SQL: agent dostaje null dla cudzego i wolnego leada.
  const s = await rpc(sb, 'ud_lead_szczegoly', { p_lead: leadId, p_user: userId });
  if (!s) throw blad(404, NIEWIDOCZNY);

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

const NIEWIDOCZNY = 'Lead nie istnieje, został zarchiwizowany albo nie jest przypisany do Ciebie.';

/** Kwota z pola tekstowego wariantu („50 000", „50000,00 zł") albo null. */
function kwotaZTekstu(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.toLowerCase().replace(/[\s\u00a0]|zł|pln/g, '').replace(',', '.');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/**
 * Warianty z ofert klienta danego leada — do okna „Wygrany" (wybór sprzedanego
 * wariantu wypełnia kwoty). Oferty i warianty czytamy klientem Z SESJĄ agenta:
 * RLS pokazuje agentowi jego oferty, administratorowi wszystkie. Gdy nic nie
 * widać, agent wpisuje kwoty ręcznie.
 */
export async function warianty(sb, userSb, userId, leadId) {
  return (await wariantyIPolisy(sb, userSb, userId, leadId)).warianty;
}

/** Warianty z ofert i polisy wgrane przy leadzie (do „Odczytaj kwoty z polisy"). */
async function wariantyIPolisy(sb, userSb, userId, leadId) {
  if (!jestUuid(leadId)) throw blad(400, 'Nieprawidłowy identyfikator leada.');
  // Klient leada przez tę samą funkcję co szczegóły: klucz serwisowy idzie
  // wyłącznie przez RPC, a lead spoza widoku (archiwum, cudzy) daje 404 jak wszędzie.
  const s = await rpc(sb, 'ud_lead_szczegoly', { p_lead: leadId, p_user: userId });
  if (!s) throw blad(404, NIEWIDOCZNY);
  const polisy = (s.pliki ?? []).map((f) => ({ id: f.id, nazwa: f.nazwa, created_at: f.created_at }));
  return { warianty: await wariantyKlienta(userSb, s.klient_id), polisy };
}

async function wariantyKlienta(userSb, klientId) {
  if (!klientId || !userSb) return [];
  const lead = { klient_id: klientId };

  const { data: oferty } = await userSb
    .from('ud_offers')
    .select('id, offer_number, name, status, created_at')
    .eq('client_id', lead.klient_id)
    .order('created_at', { ascending: false })
    .limit(10);
  if (!oferty?.length) return [];

  const { data: dokumenty } = await userSb
    .from('ud_offer_documents')
    .select('id, offer_id, insurer_type, product_name, offer_number, premium_total, premium_monthly, distribution_fee, temp_incapacity_covered, temp_monthly_benefit, perm_incapacity_covered, perm_sum_insured, death_covered, parsed_raw')
    .in('offer_id', oferty.map((o) => o.id))
    .order('sort_order', { ascending: true });

  const ofertaPo = new Map(oferty.map((o) => [o.id, o]));
  return (dokumenty || []).map((d) => {
    const o = ofertaPo.get(d.offer_id);
    // Numer dokumentu ubezpieczyciela (LHQ…/1) jest inny dla każdego wariantu;
    // numer oferty panelu (UD/…) wspólny dla wszystkich — tylko na zapas.
    return { id: d.id, ...kwotyZDokumentu(d), numer: d.offer_number || o?.offer_number || o?.name || 'Oferta' };
  });
}

/**
 * Kwoty sprzedaży z dokumentu ubezpieczyciela: wiersz ud_offer_documents albo
 * wynik czytnika PDF (te same nazwy pól — createOfferFromPdfs zapisuje wynik
 * czytnika wprost). Pole bez kwoty albo z zerem → null.
 *
 * Składka BEZ opłaty dystrybucyjnej (decyzja właściciela z 04.10.2026: „opłaty
 * dystrybucyjnej nie doliczaj do składki"). Czytnik zapisuje w premium_total
 * kwotę do zapłaty (Leadenhall: składka 2 760 + opłata 276 = 3 036, 12 rat po
 * 253) — tu wraca 2 760 i 230. Ta sama reguła stoi w SQL (ud_skladka_netto).
 */
export function kwotyZDokumentu(d) {
  const razem = Number(d.premium_total);
  const oplata = Number(d.distribution_fee ?? d.parsed_raw?.distribution_fee);
  const netto = razem > 0 && oplata > 0 && oplata < razem ? razem - oplata : razem;
  const mies = Number(d.premium_monthly);
  const grosze = (x) => Math.round(x * 100) / 100;
  return {
    numer: d.offer_number || '',
    skladka_roczna: kwotaZTekstu(grosze(netto)),
    skladka_mies: mies > 0 && razem > 0 ? kwotaZTekstu(grosze((mies * netto) / razem)) : null,
    swiadczenie_okresowa: d.temp_incapacity_covered === false ? null : kwotaZTekstu(Number(d.temp_monthly_benefit)),
    swiadczenie_trwala: d.perm_incapacity_covered ? kwotaZTekstu(Number(d.perm_sum_insured)) : null,
    swiadczenie_zgon: d.death_covered ? kwotaZTekstu(d.parsed_raw?.death_sum_insured ?? null) : null,
  };
}

// ── Polisy ───────────────────────────────────────────────────────────────────
export const KUBELEK_POLIS = 'ud-polisy';
export const POLISA_MAX_BAJTOW = 10 * 1024 * 1024;

/** Nazwa pliku do wyświetlenia: bez ścieżki i znaków sterujących, do 200 znaków. */
function czystaNazwa(nazwa) {
  const n = String(nazwa ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (n || 'polisa.pdf').slice(0, 200);
}

/**
 * Kwoty z polisy tym samym czytnikiem co oferty (Leadenhall/CEU). Leadenhall
 * szyfruje pliki 4 ostatnimi cyframi PESEL-u — przy odmowie hasła próbujemy
 * ich (`pin()` podaje je serwer: z kartoteki klienta albo z pola formularza).
 * Dokument w innym układzie po prostu nie daje kwot: agent wpisze je ręcznie.
 * `haslo`: null (bez hasła albo pasowało), 'brak' (nie było czego spróbować),
 * 'zle' (4 cyfry nie otworzyły pliku).
 */
async function czytajPolise(bajty, odczytaj, pin) {
  const sprobuj = async (haslo) => {
    try {
      return { dokument: await odczytaj(bajty, haslo) };
    } catch (e) {
      return { haslo: /password/i.test(`${e?.name ?? ''} ${e?.message ?? ''}`) };
    }
  };
  let r = await sprobuj();
  let haslo = null;
  if (r.haslo) {
    const p = String((await pin()) ?? '').replace(/\D/g, '').slice(-4);
    if (p.length === 4) {
      r = await sprobuj(p);
      if (r.haslo) haslo = 'zle';
    } else {
      haslo = 'brak';
    }
  }
  const kwoty = r.dokument ? kwotyZDokumentu(r.dokument) : null;
  return { kwoty: kwoty && POLA_SPRZEDAZY.some((p) => kwoty[p] != null) ? kwoty : null, haslo };
}

/** Komunikat o odczycie kwot; `brakPeselu` mówi, co zrobić, gdy plik ma hasło, a PESEL-u nie ma. */
function komunikatOdczytu(o, { przedrostek = '', brakPeselu }) {
  if (o.kwoty) return `${przedrostek}Kwoty odczytane z pliku — sprawdź je przed zapisem.`;
  if (o.haslo === 'brak') return `${przedrostek}${brakPeselu}`;
  if (o.haslo === 'zle') return `${przedrostek}Plik ma hasło inne niż 4 ostatnie cyfry PESEL-u — wpisz kwoty ręcznie.`;
  return `${przedrostek}Kwot nie udało się odczytać z pliku — wpisz je ręcznie.`;
}

/** 4 ostatnie cyfry PESEL-u klienta z kartoteki — czyta tylko serwer. */
async function pinKlienta(sb, klientId) {
  if (!klientId) return null;
  const { data } = await sb.from('ud_clients').select('pesel').eq('id', klientId).maybeSingle();
  return data?.pesel ?? null;
}

function sprawdzPdf(bajty) {
  if (!(bajty instanceof Uint8Array) || bajty.length === 0) throw blad(400, 'Plik jest pusty.');
  if (bajty.length > POLISA_MAX_BAJTOW) throw blad(413, 'Plik jest za duży — limit to 10 MB.');
  if (!(bajty[0] === 0x25 && bajty[1] === 0x50 && bajty[2] === 0x44 && bajty[3] === 0x46)) {
    throw blad(415, 'To nie jest plik PDF.');
  }
}

/**
 * Polisa do leada: PDF w prywatnym kubełku + wiersz w ud_leady_pliki. Czy
 * użytkownik widzi lead, rozstrzyga SQL — przed zapisem (szczegóły) i przy
 * zapisie wiersza (ud_lead_plik_dodaj; przy odmowie obiekt jest usuwany).
 * `odczytaj(bajty, haslo)` podaje trasa (czytnik PDF), żeby ten plik nie
 * importował niczego spoza Node.
 */
export async function wgrajPolise(sb, userId, leadId, { nazwa, bajty }, { odczytaj } = {}) {
  if (!jestUuid(leadId)) throw blad(400, 'Nieprawidłowy identyfikator leada.');
  sprawdzPdf(bajty);
  await wczytajPlan(sb, userId, null);
  const s = await rpc(sb, 'ud_lead_szczegoly', { p_lead: leadId, p_user: userId });
  if (!s) throw blad(404, NIEWIDOCZNY);

  let odczyt = { kwoty: null, komunikat: 'Polisa zapisana.' };
  if (odczytaj) {
    const o = await czytajPolise(bajty, odczytaj, () => pinKlienta(sb, s.klient_id));
    odczyt = { kwoty: o.kwoty, komunikat: komunikatOdczytu(o, {
      przedrostek: 'Polisa zapisana. ',
      brakPeselu: 'Plik ma hasło, a klient nie ma PESEL-u w kartotece — wpisz kwoty ręcznie.',
    }) };
  }

  const sciezka = `${leadId}/${globalThis.crypto.randomUUID()}.pdf`;
  const kubelek = sb.storage.from(KUBELEK_POLIS);
  const { error: eZapis } = await kubelek.upload(sciezka, bajty, { contentType: 'application/pdf', upsert: false });
  if (eZapis) {
    console.error('[leady] zapis polisy:', eZapis.message || eZapis);
    throw blad(502, 'Nie udało się zapisać pliku. Spróbuj ponownie.', { ponow: true });
  }
  let wynik;
  try {
    wynik = await rpc(sb, 'ud_lead_plik_dodaj', {
      p_lead: leadId, p_user: userId, p_sciezka: sciezka, p_nazwa: czystaNazwa(nazwa), p_rozmiar: bajty.length,
    });
  } catch (e) {
    await kubelek.remove([sciezka]).catch(() => {});
    throw e;
  }
  if (wynik?.status !== 'ok') {
    await kubelek.remove([sciezka]).catch(() => {});
    return wynikZmiany(wynik);
  }
  return { status: 200, body: { status: 'ok', plik: wynik.plik, kwoty: odczyt.kwoty, komunikat: odczyt.komunikat } };
}

/** Adres pobrania pliku leada (podpisany na minutę) — tylko dla kogoś, kto widzi lead. */
export async function adresPliku(sb, userId, plikId) {
  if (!jestUuid(plikId)) throw blad(400, 'Nieprawidłowy identyfikator pliku.');
  const f = await rpc(sb, 'ud_lead_plik', { p_plik: plikId, p_user: userId });
  if (!f) throw blad(404, 'Plik nie istnieje albo nie masz do niego dostępu.');
  const { data, error } = await sb.storage.from(f.bucket).createSignedUrl(f.sciezka, 60, { download: f.nazwa });
  if (error || !data?.signedUrl) {
    console.error('[leady] adres polisy:', error?.message || error);
    throw blad(502, 'Nie udało się przygotować pliku do pobrania.');
  }
  return data.signedUrl;
}

/**
 * Ponowny odczyt kwot z polisy już wgranej przy leadzie — np. sprzedaż
 * zapisana przed 04.10.2026 ze składką z doliczoną opłatą dystrybucyjną.
 * Niczego nie zapisuje: kwoty wracają do okna „Dane sprzedaży" do sprawdzenia.
 */
export async function odczytajWgranaPolise(sb, userId, leadId, plikId, { odczytaj }) {
  if (!jestUuid(leadId) || !jestUuid(plikId)) throw blad(400, 'Nieprawidłowy identyfikator.');
  await wczytajPlan(sb, userId, null);
  const s = await rpc(sb, 'ud_lead_szczegoly', { p_lead: leadId, p_user: userId });
  if (!s) throw blad(404, NIEWIDOCZNY);
  const f = await rpc(sb, 'ud_lead_plik', { p_plik: plikId, p_user: userId });
  if (!f?.sciezka || !f.sciezka.startsWith(`${leadId}/`)) throw blad(404, 'Nie ma takiej polisy przy tym leadzie.');
  const { data, error } = await sb.storage.from(f.bucket).download(f.sciezka);
  if (error || !data) {
    console.error('[leady] odczyt polisy z kubełka:', error?.message || error);
    throw blad(502, 'Nie udało się wczytać pliku polisy. Spróbuj ponownie.', { ponow: true });
  }
  const o = await czytajPolise(new Uint8Array(await data.arrayBuffer()), odczytaj, () => pinKlienta(sb, s.klient_id));
  return { status: 200, body: { status: 'ok', kwoty: o.kwoty, komunikat: komunikatOdczytu(o, {
    brakPeselu: 'Plik ma hasło, a klient nie ma PESEL-u w kartotece — wpisz kwoty ręcznie.',
  }) } };
}

/**
 * „Dodaj polisę" (Statystyki), krok 1: kwoty z pliku, zanim klient istnieje.
 * Niczego nie zapisuje. Hasło (4 ostatnie cyfry PESEL-u) przychodzi z pola
 * formularza, bo kartoteki jeszcze nie ma; plik wgrywa się dopiero po zapisie
 * sprzedaży, tą samą drogą co przy leadzie.
 */
export async function odczytajPoliseNowa(sb, userId, bajty, pin, { odczytaj }) {
  sprawdzPdf(bajty);
  await wczytajPlan(sb, userId, null);
  const o = await czytajPolise(bajty, odczytaj, () => (/^\d{4}$/.test(String(pin ?? '')) ? pin : null));
  return { status: 200, body: { status: 'ok', kwoty: o.kwoty, haslo: o.haslo, komunikat: komunikatOdczytu(o, {
    brakPeselu: 'Plik jest zabezpieczony hasłem — wpisz PESEL klienta (hasłem są 4 ostatnie cyfry), a odczytam go ponownie.',
  }) } };
}

/**
 * „Dodaj polisę", krok 2: klient spoza formularza → kartoteka + lead
 * w „Wygrany" z danymi sprzedaży (ud_lead_polisa_reczna). Kto może dodać komu,
 * rozstrzyga SQL: agent — sobie, administrator — sobie albo wskazanemu agentowi.
 */
export async function dodajPolise(sb, userId, body) {
  if (!body || typeof body !== 'object') throw blad(400, 'Nieprawidłowe żądanie.');
  if (typeof body.idempotencyKey !== 'string' || !KLUCZ.test(body.idempotencyKey)) {
    throw blad(400, 'Brak klucza idempotencji.');
  }
  if (body.agentId != null && !jestUuid(body.agentId)) throw blad(400, 'Nieprawidłowy agent.');
  const tekst = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const k = body.klient && typeof body.klient === 'object' ? body.klient : {};
  const wynik = await rpc(sb, 'ud_lead_polisa_reczna', {
    p_user: userId,
    p_klucz: body.idempotencyKey,
    p_dane: {
      imie_nazwisko: tekst(k.imieNazwisko, 300),
      email: tekst(k.email, 300),
      telefon: tekst(k.telefon, 60),
      pesel: tekst(k.pesel, 30),
      agent_id: body.agentId ?? undefined,
      data_sprzedazy: tekst(body.dataSprzedazy, 20),
      sprzedaz: daneSprzedazy(body.sprzedaz) ?? {},
    },
  });
  return wynikZmiany(wynik);
}

/** GET …/warianty/<id>: warianty z ofert i polisy wgrane przy leadzie. */
export async function odpowiedzWariantow(sb, userSb, userId, leadId) {
  await wczytajPlan(sb, userId, null);
  return { status: 200, body: { status: 'ok', ...(await wariantyIPolisy(sb, userSb, userId, leadId)) } };
}

/** Granice okresu w czasie polskim, jako tekst, który Postgres czyta jako timestamptz. */
export function graniceOkresu(okres, teraz = new Date()) {
  const [r, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit' })
    .format(teraz)
    .split('-')
    .map(Number);
  const poczatek = (rok, mies) => {
    const rr = rok + Math.floor((mies - 1) / 12);
    const mm = ((((mies - 1) % 12) + 12) % 12) + 1;
    return `${rr}-${String(mm).padStart(2, '0')}-01 00:00:00 Europe/Warsaw`;
  };
  if (okres === 'miesiac') return { od: poczatek(r, m), do: poczatek(r, m + 1) };
  if (okres === 'poprzedni') return { od: poczatek(r, m - 1), do: poczatek(r, m) };
  if (okres === 'kwartal') {
    const k = Math.floor((m - 1) / 3) * 3 + 1;
    return { od: poczatek(r, k), do: poczatek(r, k + 3) };
  }
  if (okres === 'rok') return { od: poczatek(r, 1), do: poczatek(r + 1, 1) };
  return { od: null, do: null };
}

/**
 * Statystyki sprzedaży. Kto co widzi, decyduje SQL (agent: tylko swoje,
 * parametr agenta działa wyłącznie u administratora) — tu tylko kształt.
 */
export async function statystyki(sb, userId, parametry) {
  const pobierz = (k) => {
    const v = parametry instanceof URLSearchParams ? parametry.get(k) : parametry?.[k];
    return typeof v === 'string' ? v : '';
  };
  const okres = OKRESY_STATYSTYK.includes(pobierz('okres')) ? pobierz('okres') : 'wszystko';
  const agent = jestUuid(pobierz('agent')) ? pobierz('agent') : null;
  const { od, do: doo } = graniceOkresu(okres);
  const wynik = await rpc(sb, 'ud_leady_statystyki', { p_user: userId, p_od: od, p_do: doo, p_agent: agent });
  if (!wynik) throw blad(403, 'Brak dostępu do statystyk.');
  return { ...wynik, okres };
}

/** Adres wniosku na portalu — link agenta dokłada do niego ?agent=<kod>. */
export const ADRES_WNIOSKU = 'https://utratadochodu.pl/wniosek/';

/**
 * Link agenta do wniosku. Klient, który złoży z niego wniosek, trafia na
 * tablicę jako lead tego agenta: kreator wysyła kod jako affiliateCode,
 * form-submit zapisuje go w ud_clients.affiliate_code_used, a synchronizacja
 * ustawia opiekuna po ud_user_profiles.affiliate_code. Kod nadaje SQL przy
 * pierwszym wywołaniu (ud_agent_kod). Błąd → null: tablica działa bez linku.
 */
export async function linkAgenta(sb, userId) {
  try {
    const { data, error } = await sb.rpc('ud_agent_kod', { p_user: userId });
    if (error || typeof data !== 'string' || !data) return null;
    return `${ADRES_WNIOSKU}?agent=${encodeURIComponent(data)}`;
  } catch {
    return null;
  }
}

/** Pierwsze ładowanie tablicy: plan, liczniki i pierwsza strona każdej rozwiniętej kolumny. */
export async function wczytajTablice(sb, userSb, userId, parametry) {
  const { filtr, sort, aktywny } = filtrZParametrow(parametry);
  // Plan pierwszy: nie-agent dostaje 403, zanim cokolwiek zostanie dopisane.
  const plan = await wczytajPlan(sb, userId, parametry.get?.('pipeline') ?? parametry.pipeline);
  const synchronizacja = await synchronizuj(sb);
  const pipelineId = plan.pipeline.id;
  const zwiniete = new Set(plan.zwiniete);

  const [link, licz, ...strony] = await Promise.all([
    linkAgenta(sb, userId),
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
      otwarty = await szczegoly(sb, userSb, userId, leadParam);
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
    linkAgenta: link,
  };
}

/** GET …/kolumna: kolejna strona kart jednego etapu + świeże liczniki pipeline'u. */
export async function odpowiedzKolumny(sb, userId, parametry) {
  const { filtr, sort } = filtrZParametrow(parametry);
  const plan = await wczytajPlan(sb, userId, parametry.get('pipeline'));
  const [strona, licz] = await Promise.all([
    kolumna(sb, userId, {
      pipelineId: plan.pipeline.id,
      etapId: parametry.get('etap'),
      filtr,
      sort,
      offset: parametry.get('offset'),
      limit: parametry.get('limit') ?? ROZMIAR_STRONY,
    }),
    liczniki(sb, userId, plan.pipeline.id, filtr),
  ]);
  return { status: 200, body: { status: 'ok', ...strona, liczniki: licz } };
}

/** GET …/liczniki. */
export async function odpowiedzLicznikow(sb, userId, parametry) {
  const { filtr } = filtrZParametrow(parametry);
  const plan = await wczytajPlan(sb, userId, parametry.get('pipeline'));
  return { status: 200, body: { status: 'ok', liczniki: await liczniki(sb, userId, plan.pipeline.id, filtr) } };
}

/** GET …/lead/<id>: dostęp sprawdzamy, zanim ktokolwiek dostanie dane po samym identyfikatorze. */
export async function odpowiedzSzczegolow(sb, userSb, userId, leadId) {
  await wczytajPlan(sb, userId, null);
  return { status: 200, body: { status: 'ok', ...(await szczegoly(sb, userSb, userId, leadId)) } };
}

/** Status z funkcji SQL → kod HTTP. */
const HTTP = {
  ok: 200,
  bez_zmiany: 200,
  konflikt: 409,
  klucz_uzyty: 409,
  klient_istnieje: 409,
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

/**
 * Dane sprzedaży z ciała żądania: tylko znane pola, kwota jako liczba albo
 * krótki tekst (SQL ją sprawdza i odrzuca śmieci), wariant jako uuid.
 */
function daneSprzedazy(src) {
  if (!src || typeof src !== 'object') return undefined;
  const wynik = {};
  for (const k of POLA_SPRZEDAZY) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) wynik[k] = v;
    else if (typeof v === 'string' && v.trim()) wynik[k] = v.slice(0, 30);
  }
  if (jestUuid(src.wariant_id)) wynik.wariant_id = src.wariant_id;
  return Object.keys(wynik).length ? wynik : undefined;
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
    const sprzedaz = daneSprzedazy(przejscie?.sprzedaz);
    if (sprzedaz) dane.sprzedaz = sprzedaz;
    return dane;
  }
  if (op === 'sprzedaz') {
    return daneSprzedazy(body.sprzedaz) ?? {};
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
 *     targetStageId, transitionData? { powod_utraty?, sprzedaz? }
 *     | typ, termin, opis | opiekunId | sprzedaz }
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
 * Treść musi być application/json (polisa: application/pdf): żądania o typach
 * „prostych" (formularz, text/plain) mogą przyjść z cudzej strony bez
 * preflightu CORS, te dwa — nie.
 */
export async function przetworz({ user, odczyt = false, typTresci, czytajCialo, wykonaj, oczekiwanyTyp = 'application/json' }) {
  if (!user) {
    return { status: 401, body: { status: 'blad', komunikat: 'Sesja wygasła. Zaloguj się ponownie.', sesja: true } };
  }
  let body;
  if (!odczyt) {
    if (!String(typTresci || '').toLowerCase().startsWith(oczekiwanyTyp)) {
      return { status: 415, body: { status: 'blad', komunikat: `Oczekiwano ${oczekiwanyTyp}.` } };
    }
    try {
      body = await czytajCialo();
    } catch (e) {
      if (e instanceof BladApi) return { status: e.status, body: e.body };
      return { status: 400, body: { status: 'blad', komunikat: 'Nieprawidłowa treść żądania.' } };
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
