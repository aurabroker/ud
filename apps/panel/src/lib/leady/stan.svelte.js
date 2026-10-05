/**
 * Stan danych tablicy leadów (Svelte 5, runes) + operacje na leadach.
 *
 * Rozdział: TU jest stan DANYCH (karty, liczniki, plan, szczegóły, zapisy w toku,
 * komunikaty). Stan WIDOKU, który nie jest daną — otwarte menu, dialogi,
 * przeciąganie, przewijanie — żyje w komponentach, żeby odświeżenie danych
 * w tle nie poruszyło celu pod wskaźnikiem ani nie zamknęło menu.
 *
 * Zasady operacji (wytyczne „Kanban CRM", sekcje 2 i 4):
 *  - jedna ścieżka zmiany: wszystko idzie przez api.zmien → ud_lead_zmien;
 *  - przeniesienie jest optymistyczne, reszta (formularze) czeka na serwer;
 *  - na jednym leadzie naraz jedna operacja: kolejną blokujemy z komunikatem;
 *  - ten sam klucz idempotencji przy ponowieniu — także ręcznym;
 *  - zerwana odpowiedź ≠ nieudany zapis: najpierw sprawdzamy stan leada;
 *  - rollback tylko wtedy, gdy nic nowszego nie zastąpiło karty (epoka),
 *    w przeciwnym razie pobieramy stan serwera.
 */
import { BladSieci } from './api.js';
import {
  czyMoznaPrzeniesc,
  indeksWstawienia,
  komunikatPrzeniesienia,
  opisFiltra,
  pasujeDoFiltra,
  wymagaPowodu,
  wymagaSprzedazy,
} from './model.js';

const ROZMIAR_STRONY = 25;
const DEBOUNCE_SZUKANIA_MS = 250;
const TOAST_OK_MS = 9000;
const TOAST_BLAD_MS = 15000;

const losowyKlucz = () => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export class StanTablicy {
  /** @type {any} */ plan = $state();
  filtr = $state({});
  sort = $state('dzialanie');
  /** Sortowanie ustawione dla pojedynczej kolumny (menu etapu → „Sortowanie…"). */
  sortKolumn = $state({});
  /** Tekst w polu wyszukiwania (filtr.q dostaje go po 250 ms). */
  szukanie = $state('');
  liczniki = $state({});
  kolumny = $state({});
  zwiniete = $state([]);
  podglad = $state(null);
  widok = $state('kanban');
  etapMobilny = $state(null);

  otwartyId = $state(null);
  otwarty = $state(null);
  /** 'brak' | 'laduje' | 'gotowe' | 'nie_istnieje' | 'blad' */
  otwartyStan = $state('brak');

  /** leadId → { opis, niepewny?, body? } — operacje w toku. */
  zapisy = $state({});

  status = $state('');
  alert = $state('');
  toast = $state(null);
  sesjaWygasla = $state(false);
  synchronizacja = $state(true);
  /** Link agenta do wniosku (/wniosek/?agent=<kod>); null, gdy kodu nie ma. */
  linkAgenta = $state(null);
  ladowanie = $state(false);

  #api;
  #odUrl;
  #teraz;
  #klucz;
  #zadania = new Map();
  #licznikZadan = 0;
  #zadanieLiczniki = 0;
  #acLiczniki = null;
  #zadanieSzczegoly = 0;
  #epoki = new Map();
  #kolejkaZwijania = Promise.resolve();
  #debounce = null;
  #timerToastu = null;
  #odswiezPoZapisach = false;
  #wstrzymaj = false;

  /**
   * @param {{ dane: any, api: any, odUrl?: (stan: any) => void, teraz?: () => Date, klucz?: () => string }} opcje
   */
  constructor({ dane, api, odUrl, teraz = () => new Date(), klucz = losowyKlucz }) {
    this.#api = api;
    this.#odUrl = odUrl;
    this.#teraz = teraz;
    this.#klucz = klucz;

    this.plan = dane.plan;
    this.filtr = { ...dane.filtr };
    this.szukanie = dane.filtr?.q ?? '';
    this.sort = dane.sort;
    this.liczniki = dane.liczniki;
    this.zwiniete = [...dane.plan.zwiniete];
    this.synchronizacja = dane.synchronizacja !== false;
    this.linkAgenta = dane.linkAgenta ?? null;
    this.etapMobilny = dane.plan.etapy.find((e) => !dane.plan.zwiniete.includes(e.id))?.id ?? dane.plan.etapy[0]?.id ?? null;

    for (const e of dane.plan.etapy) {
      const k = dane.kolumny?.[e.id];
      this.kolumny[e.id] = {
        karty: k ? [...k.karty] : [],
        razem: k ? k.razem : (dane.liczniki[e.id]?.ile ?? 0),
        ladowanie: false,
        blad: null,
        zaladowana: Boolean(k),
      };
    }

    if (dane.otwarty) {
      this.otwartyId = dane.otwarty.lead.id;
      this.otwarty = dane.otwarty;
      this.otwartyStan = 'gotowe';
    } else if (dane.otwartyBrak) {
      this.otwartyStan = 'nie_istnieje';
      this.alert = 'Lead z tego linku nie istnieje albo został zarchiwizowany.';
    }
    if (!this.synchronizacja) {
      this.alert = 'Nie udało się dopisać najnowszych leadów z kartoteki. Pokazuję te, które już są.';
    }
  }

  // ── odczyty ────────────────────────────────────────────────────────────────
  get pipelineId() { return this.plan.pipeline.id; }
  get etapy() { return this.plan.etapy; }
  etap(id) { return this.plan.etapy.find((e) => e.id === id); }
  czyZwiniety(id) { return this.zwiniete.includes(id); }
  sortDla(etapId) { return this.sortKolumn[etapId] ?? this.sort; }
  czyFiltrAktywny() { return Object.keys(this.filtr).length > 0; }
  czyZapisWToku(leadId) { return Boolean(this.zapisy[leadId]); }
  teraz() { return this.#teraz(); }

  /** @returns {{ etapId: string, indeks: number, karta: any } | null} */
  znajdz(leadId) {
    for (const [etapId, kol] of Object.entries(this.kolumny)) {
      const indeks = kol.karty.findIndex((k) => k.id === leadId);
      if (indeks >= 0) return { etapId, indeks, karta: kol.karty[indeks] };
    }
    return null;
  }

  /** Karta do operacji: z kolumny albo — gdy lead jest tylko w szczegółach — stamtąd. */
  #kartaDo(leadId) {
    const z = this.znajdz(leadId);
    if (z) return z.karta;
    return this.otwarty?.lead?.id === leadId ? this.otwarty.lead : null;
  }

  #epoka(leadId) { return this.#epoki.get(leadId) ?? 0; }
  #podbijEpoke(leadId) { this.#epoki.set(leadId, this.#epoka(leadId) + 1); }

  // ── komunikaty ─────────────────────────────────────────────────────────────
  ogloc(tekst, { toast = true, akcja = null } = {}) {
    // Czyszczenie przed ustawieniem: powtórzony, identyczny komunikat też zostanie odczytany.
    this.status = '';
    setTimeout(() => { this.status = tekst; }, 30);
    if (toast) this.#pokazToast({ tekst, typ: 'ok', akcja });
  }

  zglosBlad(tekst, { akcja = null } = {}) {
    this.alert = '';
    setTimeout(() => { this.alert = tekst; }, 30);
    this.#pokazToast({ tekst, typ: 'blad', akcja });
  }

  zamknijToast() {
    clearTimeout(this.#timerToastu);
    this.toast = null;
  }

  #pokazToast(toast) {
    clearTimeout(this.#timerToastu);
    this.toast = { id: this.#klucz(), ...toast };
    this.#timerToastu = setTimeout(() => { this.toast = null; }, toast.typ === 'blad' ? TOAST_BLAD_MS : TOAST_OK_MS);
  }

  // ── adres ──────────────────────────────────────────────────────────────────
  #powiadomUrl() {
    this.#odUrl?.({ filtr: { ...this.filtr }, sort: this.sort, lead: this.otwartyId });
  }

  // ── ładowanie kolumn i liczników ───────────────────────────────────────────
  async ladujKolumne(etapId, { dolacz = false, limit = ROZMIAR_STRONY } = {}) {
    const kol = this.kolumny[etapId];
    if (!kol) return;
    this.#zadania.get(etapId)?.ac.abort();
    const ac = new AbortController();
    const nr = ++this.#licznikZadan;
    this.#zadania.set(etapId, { nr, ac });
    kol.ladowanie = true;
    kol.blad = null;
    try {
      const { status, body } = await this.#api.kolumna(
        { etap: etapId, filtr: this.filtr, sort: this.sortDla(etapId), offset: dolacz ? kol.karty.length : 0, limit, pipeline: this.pipelineId },
        ac.signal,
      );
      if (this.#zadania.get(etapId)?.nr !== nr) return; // nowsze żądanie wyprzedziło to
      if (status !== 200) {
        if (status === 401) this.sesjaWygasla = true;
        kol.blad = body?.komunikat ?? 'Nie udało się wczytać kart.';
        return;
      }
      if (dolacz) {
        const znane = new Set(kol.karty.map((k) => k.id));
        for (const k of body.karty) if (!znane.has(k.id)) kol.karty.push(k);
      } else {
        kol.karty = body.karty;
      }
      kol.razem = body.razem;
      kol.zaladowana = true;
      if (body.liczniki && !this.#zapisyWToku()) this.liczniki = body.liczniki;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      kol.blad = 'Nie udało się wczytać kart. Sprawdź połączenie.';
    } finally {
      if (this.#zadania.get(etapId)?.nr === nr) kol.ladowanie = false;
    }
  }

  wiecej(etapId) { return this.ladujKolumne(etapId, { dolacz: true }); }

  #zapisyWToku() { return Object.keys(this.zapisy).length > 0; }

  async odswiezLiczniki() {
    if (this.#zapisyWToku() || this.#wstrzymaj) { this.#odswiezPoZapisach = true; return; }
    this.#acLiczniki?.abort();
    const ac = new AbortController();
    this.#acLiczniki = ac;
    const nr = ++this.#zadanieLiczniki;
    try {
      const { status, body } = await this.#api.liczniki({ filtr: this.filtr, sort: this.sort, pipeline: this.pipelineId }, ac.signal);
      if (nr !== this.#zadanieLiczniki || this.#zapisyWToku()) return;
      if (status === 200) this.liczniki = body.liczniki;
    } catch (e) {
      if (e?.name !== 'AbortError') console.warn('[leady] liczniki', e);
    }
  }

  /** Po zmianie filtra/sortowania: liczniki + pierwsza strona każdej rozwiniętej kolumny. */
  async odswiezWidok() {
    this.ladowanie = true;
    for (const z of this.#zadania.values()) z.ac.abort();
    const rozwiniete = this.etapy.filter((e) => !this.czyZwiniety(e.id));
    for (const e of this.etapy) {
      const kol = this.kolumny[e.id];
      if (this.czyZwiniety(e.id)) { kol.karty = []; kol.zaladowana = false; }
    }
    try {
      await Promise.all([this.odswiezLiczniki(), ...rozwiniete.map((e) => this.ladujKolumne(e.id))]);
    } finally {
      this.ladowanie = false;
    }
  }

  /**
   * Odświeżenie w tle. WSTRZYMYWANE na czas przeciągania (stabilne cele): wynik
   * czeka i zostanie zastosowany po wznowieniu.
   */
  wstrzymajOdswiezanie(wstrzymaj) {
    this.#wstrzymaj = wstrzymaj;
    if (!wstrzymaj && this.#odswiezPoZapisach && !this.#zapisyWToku()) {
      this.#odswiezPoZapisach = false;
      this.odswiezLiczniki();
    }
  }

  // ── filtry i sortowanie ────────────────────────────────────────────────────
  ustawFiltr(zmiana) {
    const nowy = { ...this.filtr };
    for (const [k, v] of Object.entries(zmiana)) {
      if (v === '' || v == null) delete nowy[k]; else nowy[k] = v;
    }
    this.filtr = nowy;
    this.#powiadomUrl();
    return this.odswiezWidok();
  }

  wyczyscFiltry() {
    clearTimeout(this.#debounce);
    this.szukanie = '';
    this.filtr = {};
    this.#powiadomUrl();
    return this.odswiezWidok();
  }

  /** Wyszukiwanie z opóźnieniem ~250 ms; stare odpowiedzi odrzuca numer żądania w ladujKolumne. */
  szukaj(tekst) {
    this.szukanie = tekst;
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => this.ustawFiltr({ q: tekst.trim() }), DEBOUNCE_SZUKANIA_MS);
  }

  ustawSort(sort) {
    this.sort = sort;
    this.sortKolumn = {};
    this.#powiadomUrl();
    return this.odswiezWidok();
  }

  ustawSortKolumny(etapId, sort) {
    this.sortKolumn = { ...this.sortKolumn, [etapId]: sort };
    return this.ladujKolumne(etapId);
  }

  // ── zwijanie (osobisty widok) ──────────────────────────────────────────────
  zwinEtap(etapId, zwin = true) {
    if (zwin === this.czyZwiniety(etapId)) return;
    this.zwiniete = zwin ? [...this.zwiniete, etapId] : this.zwiniete.filter((x) => x !== etapId);
    if (this.podglad === etapId) this.podglad = null;
    if (!zwin && !this.kolumny[etapId].zaladowana) this.ladujKolumne(etapId);
    if (zwin && this.etapMobilny === etapId) {
      this.etapMobilny = this.etapy.find((e) => !this.czyZwiniety(e.id))?.id ?? etapId;
    }
    this.ogloc(`Etap „${this.etap(etapId).nazwa}" ${zwin ? 'zwinięty' : 'rozwinięty'}.`, { toast: false });
    this.#zapiszZwiniecie({ pipelineId: this.pipelineId, etapId, zwin });
  }

  rozwinWszystkie() {
    if (this.zwiniete.length === 0) return;
    this.zwiniete = [];
    this.podglad = null;
    for (const e of this.etapy) if (!this.kolumny[e.id].zaladowana) this.ladujKolumne(e.id);
    this.ogloc('Wszystkie etapy rozwinięte.', { toast: false });
    this.#zapiszZwiniecie({ pipelineId: this.pipelineId, etapId: null, zwin: false });
  }

  /** Zapis po kolei: dwa szybkie kliknięcia nie mogą dojść na serwer w odwrotnej kolejności. */
  #zapiszZwiniecie(tresc) {
    this.#kolejkaZwijania = this.#kolejkaZwijania.then(async () => {
      try {
        const { status } = await this.#api.zwin(tresc);
        if (status !== 200) this.zglosBlad('Nie udało się zapamiętać układu etapów. Zmiana działa do odświeżenia strony.');
      } catch {
        this.zglosBlad('Nie udało się zapamiętać układu etapów. Zmiana działa do odświeżenia strony.');
      }
    });
    return this.#kolejkaZwijania;
  }

  /** Czeka na zapisy widoku (testy i „odśwież po zapisie"). */
  zapisWidokuGotowy() { return this.#kolejkaZwijania; }

  async otworzPodglad(etapId) {
    this.podglad = etapId;
    if (!this.kolumny[etapId].zaladowana) await this.ladujKolumne(etapId);
  }
  zamknijPodglad() { this.podglad = null; }

  // ── szczegóły ──────────────────────────────────────────────────────────────
  async otworzSzczegoly(leadId) {
    this.otwartyId = leadId;
    this.otwartyStan = 'laduje';
    const z = this.znajdz(leadId);
    this.otwarty = z ? { lead: z.karta, notatki: [], historia: [], oferty: [], kontakt: {}, email: null, telefon: z.karta.telefon, czesciowe: true } : null;
    this.#powiadomUrl();
    await this.#wczytajSzczegoly(leadId);
  }

  async #wczytajSzczegoly(leadId) {
    const nr = ++this.#zadanieSzczegoly;
    try {
      const { status, body } = await this.#api.lead(leadId);
      if (nr !== this.#zadanieSzczegoly || this.otwartyId !== leadId) return;
      if (status === 200) {
        this.otwarty = body;
        this.otwartyStan = 'gotowe';
        // Karta w kolumnie ma pochodzić z tej samej wersji, którą widać w panelu.
        this.#zastosujKanoniczna(body.lead, { cicho: true });
      } else if (status === 404) {
        this.otwarty = null;
        this.otwartyStan = 'nie_istnieje';
      } else {
        if (status === 401) this.sesjaWygasla = true;
        this.otwartyStan = 'blad';
      }
    } catch (e) {
      if (nr === this.#zadanieSzczegoly && this.otwartyId === leadId) this.otwartyStan = 'blad';
    }
  }

  zamknijSzczegoly() {
    this.otwartyId = null;
    this.otwarty = null;
    this.otwartyStan = 'brak';
    this.#zadanieSzczegoly++;
    this.#powiadomUrl();
  }

  // ── umieszczanie kart w kolumnach ──────────────────────────────────────────
  #usunZKolumn(leadId) {
    for (const kol of Object.values(this.kolumny)) {
      const i = kol.karty.findIndex((k) => k.id === leadId);
      if (i >= 0) { kol.karty.splice(i, 1); kol.razem = Math.max(0, kol.razem - 1); }
    }
  }

  #umiesc(karta) {
    this.#usunZKolumn(karta.id);
    const kol = this.kolumny[karta.etap_id];
    if (!kol) return;
    if (kol.zaladowana && !this.czyZwiniety(karta.etap_id)) {
      kol.karty.splice(indeksWstawienia(kol.karty, karta, this.sortDla(karta.etap_id)), 0, karta);
      kol.razem += 1;
    }
  }

  /**
   * Przesuwa liczniki o jedną kartę (optymistycznie); prawdę przynosi odswiezLiczniki().
   * Składki: ta, którą karta wnosi do etapu docelowego, i ta, którą zabiera ze źródłowego.
   */
  #przesunLiczniki(zEtapId, doEtapId, wartosc, { skladkaZ = 0, skladkaDo = 0 } = {}) {
    const w = Number(wartosc ?? 0);
    const nowe = { ...this.liczniki };
    const zmien = (id, d, sk) => {
      const l = nowe[id];
      if (!l) return;
      nowe[id] = {
        ...l,
        ile: Math.max(0, l.ile + d), ileWszystkich: Math.max(0, l.ileWszystkich + d),
        suma: l.suma + d * w, sumaWszystkich: l.sumaWszystkich + d * w,
        skladki: (l.skladki ?? 0) + d * sk, skladkiWszystkich: (l.skladkiWszystkich ?? 0) + d * sk,
      };
    };
    if (zEtapId) zmien(zEtapId, -1, Number(skladkaZ ?? 0));
    if (doEtapId) zmien(doEtapId, +1, Number(skladkaDo ?? 0));
    this.liczniki = nowe;
  }

  /**
   * Przyjmuje kanoniczny stan leada z serwera. Zwraca 'widoczny' albo 'ukryty'
   * (lead przestał pasować do aktywnego filtra).
   */
  #zastosujKanoniczna(lead, { cicho = false } = {}) {
    this.#podbijEpoke(lead.id);
    if (this.otwarty?.lead?.id === lead.id) this.otwarty = { ...this.otwarty, lead };
    if (!pasujeDoFiltra(lead, this.filtr, this.plan.uzytkownik.id, this.#teraz())) {
      this.#usunZKolumn(lead.id);
      return 'ukryty';
    }
    if (!cicho || this.znajdz(lead.id)) this.#umiesc(lead);
    return 'widoczny';
  }

  /** Lead zniknął (archiwum, cofnięta zgoda, usunięcie kartoteki). */
  #usunLead(leadId) {
    this.#usunZKolumn(leadId);
    this.#podbijEpoke(leadId);
    if (this.otwartyId === leadId) this.zamknijSzczegoly();
  }

  // ── operacje ───────────────────────────────────────────────────────────────
  /**
   * Przeniesienie leada na etap. Optymistyczne. Zwraca { status }:
   *   'ok' | 'bez_zmiany' | 'zablokowany' | 'potrzebne_dane' (pola) | statusy serwera.
   * 'potrzebne_dane' = etap wymaga pól (powód utraty, składka roczna), NIC nie
   * zmieniono — wołający zbiera dane i woła ponownie z `dane`
   * ({ powod_utraty } albo { sprzedaz: { skladka_roczna, …, wariant_id? } }).
   */
  async przenies(leadId, etapId, { dane = null } = {}) {
    const z = this.znajdz(leadId);
    const cel = this.etap(etapId);
    if (!z || !cel) return { status: 'brak' };

    const ocena = czyMoznaPrzeniesc(z.karta, cel, { zapisWToku: this.czyZapisWToku(leadId) });
    if (!ocena.ok) {
      this.zglosBlad(ocena.powod);
      return { status: 'zablokowany', powod: ocena.powod };
    }
    const powod = typeof dane?.powod_utraty === 'string' ? dane.powod_utraty.trim() : '';
    if (wymagaPowodu(cel) && powod.length < 3) return { status: 'potrzebne_dane', pola: ['powod_utraty'] };
    const sprzedaz = cel.rodzaj === 'wygrany' && dane?.sprzedaz && typeof dane.sprzedaz === 'object' ? dane.sprzedaz : null;
    if (wymagaSprzedazy(cel) && !(Number(sprzedaz?.skladka_roczna) > 0)) return { status: 'potrzebne_dane', pola: ['skladka_roczna'] };

    const zEtap = this.etap(z.karta.etap_id);
    const snapshot = { karta: $state.snapshot(z.karta), etapId: z.etapId, epoka: this.#epoka(leadId), zEtap };
    this.zapisy[leadId] = { opis: `Przenoszę do: ${cel.nazwa}` };

    const optymistyczna = {
      ...snapshot.karta,
      etap_id: cel.id,
      etap_od: this.#teraz().toISOString(),
      powod_utraty: cel.rodzaj === 'przegrany' ? powod : null,
      dzialanie: cel.rodzaj === 'otwarty' ? snapshot.karta.dzialanie : null,
      sprzedaz: sprzedaz ? { ...sprzedaz } : null,
    };
    this.#umiesc(optymistyczna);
    this.#przesunLiczniki(z.etapId, cel.id, snapshot.karta.wartosc,
      { skladkaZ: snapshot.karta.sprzedaz?.skladka_roczna, skladkaDo: sprzedaz?.skladka_roczna });

    const body = {
      op: 'przenies',
      leadId,
      targetStageId: cel.id,
      expectedVersion: snapshot.karta.wersja,
      idempotencyKey: this.#klucz(),
      ...(wymagaPowodu(cel) || sprzedaz
        ? { transitionData: { ...(wymagaPowodu(cel) ? { powod_utraty: powod } : {}), ...(sprzedaz ? { sprzedaz } : {}) } }
        : {}),
    };
    const opis = (lead) => ({
      tekst: komunikatPrzeniesienia(lead.nazwa, zEtap?.nazwa ?? '?', cel.nazwa),
      akcja: { id: 'cofnij', etykieta: 'Cofnij', leadId, etapId: snapshot.karta.etap_id },
    });
    return this.#wykonaj(leadId, snapshot, body, opis, { optymistyczna: true });
  }

  /** Zaplanowanie albo wyczyszczenie następnego działania (typ = null). Czeka na serwer. */
  zaplanujDzialanie(leadId, { typ, termin, opis }, klucz) {
    return this.#zmienZFormularza(leadId, { op: 'dzialanie', typ: typ ?? null, termin: termin ?? null, opis: opis ?? null }, klucz,
      (lead) => ({ tekst: lead.dzialanie ? `${lead.nazwa}: zaplanowano działanie.` : `${lead.nazwa}: usunięto zaplanowane działanie.` }));
  }

  zmienOpiekuna(leadId, opiekunId, klucz) {
    return this.#zmienZFormularza(leadId, { op: 'opiekun', opiekunId }, klucz,
      (lead) => ({ tekst: lead.opiekun_nazwa ? `${lead.nazwa}: opiekun — ${lead.opiekun_nazwa}.` : `${lead.nazwa}: zdjęto opiekuna.` }));
  }

  /** Dane sprzedaży leada w „Wygrany" (uzupełnienie albo poprawka). Czeka na serwer. */
  zapiszSprzedaz(leadId, sprzedaz, klucz) {
    return this.#zmienZFormularza(leadId, { op: 'sprzedaz', sprzedaz }, klucz,
      (lead) => ({ tekst: `${lead.nazwa}: zapisano dane sprzedaży.` }));
  }

  /**
   * Warianty z ofert klienta (do wyboru sprzedanego) i polisy wgrane przy
   * leadzie (do ponownego odczytu kwot). Błąd = puste listy: zostaje wpisanie ręczne.
   */
  async warianty(leadId) {
    try {
      const { status, body } = await this.#api.warianty(leadId);
      return status === 200 ? { warianty: body.warianty ?? [], polisy: body.polisy ?? [] } : { warianty: [], polisy: [] };
    } catch {
      return { warianty: [], polisy: [] };
    }
  }

  /** Kwoty, numer i okres ochrony z polisy wgranej wcześniej przy leadzie. Wynik: { ok, kwoty?, polisa?, komunikat }. */
  async odczytajPolise(leadId, plikId) {
    let odp;
    try {
      odp = await this.#api.odczytPolisy(leadId, plikId);
    } catch {
      return { ok: false, komunikat: 'Brak połączenia — spróbuj ponownie.' };
    }
    const { status, body } = odp;
    if (status !== 200 || body?.status !== 'ok') {
      if (status === 401) this.alert = 'Sesja wygasła. Zaloguj się ponownie.';
      return { ok: false, komunikat: body?.komunikat ?? 'Nie udało się odczytać polisy.' };
    }
    return { ok: true, kwoty: body.kwoty ?? null, polisa: body.polisa ?? null, komunikat: body.komunikat ?? '' };
  }

  /**
   * Polisa (PDF) do leada. Wynik: { ok, plik?, kwoty?, polisa?, komunikat }. Bez
   * ponawiania — po zerwanym połączeniu nie wiadomo, czy plik doszedł, więc
   * mówimy to wprost, a agent sprawdza w szczegółach.
   */
  async wgrajPolise(leadId, plik) {
    let odp;
    try {
      odp = await this.#api.polisa(leadId, plik);
    } catch {
      return { ok: false, komunikat: 'Połączenie zerwane — nie wiadomo, czy plik doszedł. Sprawdź listę polis w szczegółach leada.' };
    }
    const { status, body } = odp;
    if (status !== 200 || body?.status !== 'ok') {
      if (status === 401) this.alert = 'Sesja wygasła. Zaloguj się ponownie.';
      return { ok: false, komunikat: body?.komunikat ?? 'Nie udało się wgrać pliku.' };
    }
    if (this.otwarty?.lead?.id === leadId) {
      this.otwarty = { ...this.otwarty, pliki: [body.plik, ...(this.otwarty.pliki ?? [])] };
    }
    return { ok: true, plik: body.plik, kwoty: body.kwoty ?? null, polisa: body.polisa ?? null, komunikat: body.komunikat ?? 'Polisa zapisana.' };
  }

  archiwizuj(leadId, klucz) {
    return this.#zmienZFormularza(leadId, { op: 'archiwizuj' }, klucz,
      () => ({ tekst: 'Lead zarchiwizowany. Dane klienta zostają w kartotece.' }));
  }

  async #zmienZFormularza(leadId, tresc, klucz, opis) {
    const karta = this.#kartaDo(leadId);
    if (!karta) return { ok: false, status: 'brak', komunikat: 'Nie znaleziono leada.' };
    if (this.czyZapisWToku(leadId)) {
      const komunikat = 'Trwa zapis tego leada. Poczekaj chwilę.';
      return { ok: false, status: 'zablokowany', komunikat };
    }
    const snapshot = { karta: $state.snapshot(karta), etapId: karta.etap_id, epoka: this.#epoka(leadId) };
    this.zapisy[leadId] = { opis: 'Zapisuję…' };
    const body = { leadId, expectedVersion: karta.wersja, idempotencyKey: klucz ?? this.#klucz(), ...tresc };
    return this.#wykonaj(leadId, snapshot, body, opis, { optymistyczna: false });
  }

  /** Notatka: bez wersji, ale z kluczem — ponowienie po zerwaniu sieci nie dubluje wpisu. */
  async dodajNotatke(leadId, tresc, klucz) {
    let odp;
    try {
      odp = await this.#api.notatka({ leadId, idempotencyKey: klucz ?? this.#klucz(), tresc });
    } catch (e) {
      if (e instanceof BladSieci) {
        return { ok: false, status: 'siec', komunikat: 'Brak połączenia — nie wiemy, czy notatka została zapisana. Możesz ponowić: ta sama notatka nie zapisze się dwa razy.' };
      }
      throw e;
    }
    const { status, body } = odp;
    if (status === 200) {
      if (this.otwartyId === leadId) await this.#wczytajSzczegoly(leadId);
      this.ogloc('Notatka dodana.', { toast: true });
      return { ok: true, status: 'ok', notatka: body.notatka };
    }
    if (status === 401) this.sesjaWygasla = true;
    if (status === 404) this.#usunLead(leadId);
    return { ok: false, status: body?.status ?? 'blad', komunikat: body?.komunikat ?? 'Nie udało się zapisać notatki.' };
  }

  /** Wspólny wykonawca: wysyła, obsługuje każdy możliwy wynik i sprząta po sobie. */
  async #wykonaj(leadId, snapshot, body, opis, { optymistyczna }) {
    this.zapisy[leadId] = { ...this.zapisy[leadId], body };
    let odp;
    try {
      odp = await this.#api.zmien(body);
    } catch (e) {
      if (e instanceof BladSieci) return this.#uzgodnij(leadId, snapshot, body, opis, { optymistyczna });
      this.#cofnijOptymistyczna(leadId, snapshot, optymistyczna);
      this.#zakoncz(leadId);
      throw e;
    }
    return this.#obsluzOdpowiedz(leadId, snapshot, body, odp, opis, { optymistyczna });
  }

  /**
   * Odpowiedź zginęła. Nie zakładamy, że zapis się nie odbył: pytamy o stan
   * leada. Wersja wyższa od oczekiwanej = zapis przeszedł.
   */
  async #uzgodnij(leadId, snapshot, body, opis, { optymistyczna }) {
    this.zapisy[leadId] = { ...this.zapisy[leadId], opis: 'Sprawdzam, czy zapis się udał…' };
    let odp;
    try {
      odp = await this.#api.lead(leadId);
    } catch {
      // Dalej nie wiemy. Karta zostaje oznaczona, a użytkownik dostaje „spróbuj ponownie"
      // (to samo żądanie, ten sam klucz — serwer nie wykona go drugi raz).
      this.zapisy[leadId] = { opis: 'Stan nieznany', niepewny: true, body };
      this.zglosBlad('Brak połączenia — nie wiemy, czy zmiana została zapisana. Sprawdź połączenie i spróbuj ponownie: ta sama operacja nie wykona się dwa razy.',
        { akcja: { id: 'ponow', etykieta: 'Spróbuj ponownie', leadId } });
      this.#zapisyPrzeszlyWNiepewnosc.set(leadId, { snapshot, opis, optymistyczna });
      return { ok: false, status: 'niepewny' };
    }

    if (odp.status === 404) {
      this.#usunLead(leadId);
      this.#zakoncz(leadId);
      this.zglosBlad('Ten lead nie jest już widoczny (mógł zostać zarchiwizowany).');
      return { ok: false, status: 'brak_leada' };
    }
    if (odp.status === 200 && odp.body.lead.wersja > snapshot.karta.wersja) {
      this.#zastosujKanoniczna(odp.body.lead);
      this.#zakoncz(leadId);
      const o = opis?.(odp.body.lead);
      if (o) this.ogloc(`${o.tekst} (potwierdzono po ponowieniu)`, { akcja: o.akcja });
      this.#odswiezSzczegolyJesliOtwarte(leadId);
      return { ok: true, status: 'ok', potwierdzonePoPonowieniu: true };
    }
    // Wersja bez zmian: zapis nie przeszedł.
    this.#cofnijOptymistyczna(leadId, snapshot, optymistyczna);
    this.#zakoncz(leadId);
    this.zglosBlad('Nie udało się zapisać zmiany. Spróbuj ponownie.');
    return { ok: false, status: 'nie_zapisano' };
  }

  #zapisyPrzeszlyWNiepewnosc = new Map();

  /** Ręczne „Spróbuj ponownie" po niepewnym wyniku — to samo żądanie, ten sam klucz. */
  async ponowZapis(leadId) {
    const zapis = this.zapisy[leadId];
    const ctx = this.#zapisyPrzeszlyWNiepewnosc.get(leadId);
    if (!zapis?.niepewny || !ctx) return { ok: false, status: 'brak' };
    this.#zapisyPrzeszlyWNiepewnosc.delete(leadId);
    this.zapisy[leadId] = { opis: 'Ponawiam zapis…', body: zapis.body };
    return this.#wykonaj(leadId, ctx.snapshot, zapis.body, ctx.opis, { optymistyczna: ctx.optymistyczna });
  }

  async #obsluzOdpowiedz(leadId, snapshot, body, { status, body: wynik }, opis, { optymistyczna }) {
    const kod = wynik?.status;

    if (status === 200 && (kod === 'ok' || kod === 'bez_zmiany')) {
      this.#zakoncz(leadId);
      if (wynik.zarchiwizowano || (!wynik.lead && kod === 'ok')) {
        this.#usunLead(leadId);
        this.ogloc(opis?.({ nazwa: snapshot.karta.nazwa })?.tekst ?? 'Lead zarchiwizowany.');
        this.odswiezLiczniki();
        return { ok: true, status: 'ok' };
      }
      const widocznosc = this.#zastosujKanoniczna(wynik.lead);
      this.#odswiezSzczegolyJesliOtwarte(leadId);
      if (kod === 'ok') {
        const o = opis?.(wynik.lead);
        if (widocznosc === 'ukryty') {
          this.ogloc(`${o?.tekst ?? wynik.lead.nazwa} — lead nie pasuje już do filtrów (${opisFiltra(this.filtr, this.plan)}).`,
            { akcja: { id: 'otworz', etykieta: 'Otwórz szczegóły', leadId } });
        } else if (o) {
          this.ogloc(o.tekst, { akcja: o.akcja ?? null });
        }
      }
      this.odswiezLiczniki();
      return { ok: true, status: kod, lead: wynik.lead };
    }

    // Wszystko poniżej to odmowa albo błąd: optymistyczną zmianę trzeba wycofać.
    if (kod === 'konflikt') {
      this.#zakoncz(leadId);
      if (wynik.lead) this.#zastosujKanoniczna(wynik.lead); else this.#usunLead(leadId);
      this.zglosBlad(`${snapshot.karta.nazwa}: ktoś zmienił ten lead przed Tobą. Pokazuję aktualny stan — sprawdź go i spróbuj ponownie.`);
      this.odswiezLiczniki();
      this.#odswiezSzczegolyJesliOtwarte(leadId);
      return { ok: false, status: 'konflikt', komunikat: wynik.komunikat };
    }
    if (kod === 'brak_leada' || status === 404) {
      this.#zakoncz(leadId);
      this.#usunLead(leadId);
      this.zglosBlad('Ten lead nie istnieje albo został zarchiwizowany.');
      this.odswiezLiczniki();
      return { ok: false, status: 'brak_leada', komunikat: wynik?.komunikat };
    }
    if (status === 401) {
      this.#cofnijOptymistyczna(leadId, snapshot, optymistyczna);
      this.#zakoncz(leadId);
      this.sesjaWygasla = true;
      this.zglosBlad('Sesja wygasła. Zaloguj się ponownie — zmiana nie została zapisana.');
      return { ok: false, status: 'sesja' };
    }
    if (kod === 'brak_danych') {
      this.#cofnijOptymistyczna(leadId, snapshot, optymistyczna);
      this.#zakoncz(leadId);
      return { ok: false, status: 'potrzebne_dane', pola: wynik.pola ?? [], komunikat: wynik.komunikat };
    }

    this.#cofnijOptymistyczna(leadId, snapshot, optymistyczna);
    this.#zakoncz(leadId);
    const komunikat = wynik?.komunikat ?? 'Nie udało się zapisać zmiany.';
    this.zglosBlad(`${snapshot.karta.nazwa}: ${komunikat}`);
    return { ok: false, status: kod ?? 'blad', komunikat };
  }

  /**
   * Rollback optymistycznej zmiany — tylko jeśli od jej wykonania nic nowszego
   * nie zastąpiło karty (epoka bez zmian). W przeciwnym razie karta już jest
   * świeższa niż snapshot, więc zamiast przywracać, pobieramy stan serwera.
   */
  #cofnijOptymistyczna(leadId, snapshot, optymistyczna) {
    if (!optymistyczna) return;
    if (this.#epoka(leadId) === snapshot.epoka) {
      const biezaca = this.znajdz(leadId);
      this.#umiesc(snapshot.karta);
      this.#przesunLiczniki(biezaca?.etapId ?? null, snapshot.etapId, snapshot.karta.wartosc,
        { skladkaZ: biezaca?.karta?.sprzedaz?.skladka_roczna, skladkaDo: snapshot.karta.sprzedaz?.skladka_roczna });
    } else {
      this.#odswiezLead(leadId);
    }
  }

  async #odswiezLead(leadId) {
    try {
      const { status, body } = await this.#api.lead(leadId);
      if (status === 200) this.#zastosujKanoniczna(body.lead);
      else if (status === 404) this.#usunLead(leadId);
    } catch { /* odświeży się przy następnej akcji */ }
  }

  #odswiezSzczegolyJesliOtwarte(leadId) {
    if (this.otwartyId === leadId) this.#wczytajSzczegoly(leadId);
  }

  #zakoncz(leadId) {
    delete this.zapisy[leadId];
    this.#zapisyPrzeszlyWNiepewnosc.delete(leadId);
    if (!this.#zapisyWToku() && this.#odswiezPoZapisach && !this.#wstrzymaj) {
      this.#odswiezPoZapisach = false;
      this.odswiezLiczniki();
    }
  }

  /** Zwalnia timery (przy odmontowaniu komponentu). */
  zniszcz() {
    clearTimeout(this.#debounce);
    clearTimeout(this.#timerToastu);
    for (const z of this.#zadania.values()) z.ac.abort();
    this.#acLiczniki?.abort();
  }
}
