/**
 * Tablica leadów — czysta logika widoku (bez DOM-u i bez Svelte).
 *
 * Tu siedzi wszystko, co da się policzyć z samych danych: ostrzeżenia na karcie,
 * etykiety, to, które pozycje menu są dostępne i dlaczego niektóre są zablokowane,
 * oraz kolejność optymistycznie wstawianych kart. Przycisk „…" i prawy klik
 * czytają ten sam model (akcjeLeada / akcjeEtapu), więc nie mogą się rozjechać.
 *
 * Uprawnienia pokazane tu są WYŁĄCZNIE podpowiedzią dla interfejsu. Prawdziwą
 * decyzję podejmuje funkcja SQL ud_lead_zmien — ta sama przy przeciąganiu,
 * w menu i w szczegółach.
 */

export const ZRODLA = {
  form: 'Wniosek z formularza',
  direct: 'Dodany w panelu',
  szkic: 'Porzucony wniosek',
};

export const PRODUKTY = {
  okresowa: 'Okresowa niezdolność',
  trwala: 'Trwała niezdolność',
  zgon: 'Zgon / inwalidztwo',
};

export const DZIALANIA = {
  telefon: 'Telefon',
  email: 'E-mail',
  spotkanie: 'Spotkanie',
  inne: 'Inne',
};

export const SORTOWANIA = [
  { id: 'dzialanie', nazwa: 'Najbliższe działanie' },
  { id: 'data', nazwa: 'Najnowsze zgłoszenia' },
  { id: 'wartosc', nazwa: 'Wartość malejąco' },
];

export const TERMINY = [
  { id: 'przeterminowane', nazwa: 'Przeterminowane' },
  { id: 'dzisiaj', nazwa: 'Dziś' },
  { id: 'tydzien', nazwa: 'Najbliższe 7 dni' },
  { id: 'brak', nazwa: 'Brak zaplanowanego działania' },
];

/** Ile dni w jednym etapie to już „długo". Parametr startowy z wytycznych, do korekty po pierwszych tygodniach. */
export const DNI_DLUGO_W_ETAPIE = 7;
/** Ile dni przed usunięciem danych szkicu karta zaczyna to wyraźnie sygnalizować. */
export const DNI_OSTRZEZENIA_RETENCJI = 7;
/** Liczba kroków kreatora wniosku (do „krok 2 z 5"). */
export const KROKOW_WNIOSKU = 5;

const DZIEN_MS = 24 * 60 * 60 * 1000;
const STREFA = 'Europe/Warsaw';

/** Dzień kalendarzowy w strefie serwisu (tej samej, której używa filtr w SQL). */
const dzienWarszawa = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: STREFA });

export function formatKwota(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(Number(n))} zł`;
}

export function etykietaZrodla(zrodlo) {
  return ZRODLA[zrodlo] ?? zrodlo ?? '';
}

/** „Okresowa niezdolność + Trwała niezdolność" albo opis szkicu. */
export function kontekstKarty(karta) {
  if (karta.rodzaj === 'szkic') {
    return karta.krok_nr ? `Niedokończony wniosek — zaliczono krok ${karta.krok_nr} z ${KROKOW_WNIOSKU}` : 'Niedokończony wniosek';
  }
  const produkty = (karta.produkty ?? []).map((p) => PRODUKTY[p]).filter(Boolean);
  return produkty.length ? produkty.join(' + ') : 'Zakres ochrony nieokreślony';
}

/** Kwota na karcie z jednoznacznym znaczeniem (patrz widok ud_leady_baza). */
export function wartoscKarty(karta) {
  return karta.wartosc == null ? null : `Świadczenie ${formatKwota(karta.wartosc)} / mies.`;
}

/**
 * „dziś 14:30", „jutro 10:00", „wczoraj 09:15", „5 paź 10:00". Bez czasu, gdy
 * jest północ (termin wpisany bez godziny nie ma udawać precyzji).
 */
export function terminTekst(iso, teraz = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dzis = dzienWarszawa(teraz);
  const roznica = Math.round((Date.parse(dzienWarszawa(d)) - Date.parse(dzis)) / DZIEN_MS);
  const dzien =
    roznica === 0 ? 'dziś'
    : roznica === 1 ? 'jutro'
    : roznica === -1 ? 'wczoraj'
    : d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: Math.abs(roznica) > 180 ? 'numeric' : undefined, timeZone: STREFA });
  const godzina = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: STREFA });
  return godzina === '00:00' ? dzien : `${dzien} ${godzina}`;
}

export function dataKrotka(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: STREFA });
}

export function dataGodzina(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: STREFA,
  });
}

export function dniWEtapie(karta, teraz = new Date()) {
  if (!karta.etap_od) return 0;
  return Math.max(0, Math.floor((new Date(teraz).getTime() - new Date(karta.etap_od).getTime()) / DZIEN_MS));
}

const liczbaDni = (n) => `${n} ${n === 1 ? 'dzień' : 'dni'}`;

/**
 * Ostrzeżenia z tekstem (sam kolor nie wystarcza). Kolejność = ważność.
 * Etap zamykający (Wygrany/Przegrany) nie ostrzega o braku działania ani
 * opiekuna: sprawa jest skończona.
 * @returns {{ id: string, tekst: string, ikona: string, waga: 'blad' | 'uwaga' | 'info' }[]}
 */
export function ostrzezenia(karta, etap, teraz = new Date()) {
  const wynik = [];
  const otwarty = (etap?.rodzaj ?? 'otwarty') === 'otwarty';

  if (otwarty) {
    const dz = karta.dzialanie;
    if (dz?.termin && new Date(dz.termin).getTime() < new Date(teraz).getTime()) {
      wynik.push({ id: 'przeterminowane', tekst: `Przeterminowane: ${DZIALANIA[dz.typ] ?? 'działanie'} ${terminTekst(dz.termin, teraz)}`, ikona: '⚠', waga: 'blad' });
    }
    if (!dz) wynik.push({ id: 'brak_dzialania', tekst: 'Brak zaplanowanego działania', ikona: '○', waga: 'uwaga' });
    if (!karta.opiekun_id) wynik.push({ id: 'brak_opiekuna', tekst: 'Brak opiekuna', ikona: '○', waga: 'uwaga' });
    const dni = dniWEtapie(karta, teraz);
    if (dni >= DNI_DLUGO_W_ETAPIE) wynik.push({ id: 'dlugo_w_etapie', tekst: `W etapie od ${liczbaDni(dni)}`, ikona: '⏱', waga: 'uwaga' });
  }

  if (karta.dane_do) {
    const zostalo = Math.ceil((new Date(karta.dane_do).getTime() - new Date(teraz).getTime()) / DZIEN_MS);
    wynik.push({
      id: 'dane_do',
      tekst: `Dane z formularza usuniemy ${dataKrotka(karta.dane_do)}`,
      ikona: '🗑',
      waga: zostalo <= DNI_OSTRZEZENIA_RETENCJI ? 'uwaga' : 'info',
    });
  }
  return wynik;
}

/**
 * Czy karta nadal spełnia aktywny filtr — do komunikatu „lead znika z widoku,
 * bo przestał pasować". Wyszukiwania tekstowego nie oceniamy (karta nie niesie
 * e-maila, więc nie umiemy tego rozstrzygnąć): przy `q` uznajemy, że pasuje.
 */
export function pasujeDoFiltra(karta, filtr, uzytkownikId, teraz = new Date()) {
  if (filtr.opiekun) {
    if (filtr.opiekun === 'ja' && karta.opiekun_id !== uzytkownikId) return false;
    if (filtr.opiekun === 'brak' && karta.opiekun_id) return false;
    if (filtr.opiekun !== 'ja' && filtr.opiekun !== 'brak' && karta.opiekun_id !== filtr.opiekun) return false;
  }
  if (filtr.zrodlo && karta.zrodlo !== filtr.zrodlo) return false;
  if (filtr.produkt) {
    const p = karta.produkty ?? [];
    if (filtr.produkt === 'nieznany' ? p.length > 0 : !p.includes(filtr.produkt)) return false;
  }
  if (filtr.termin) {
    const t = karta.dzialanie?.termin ? new Date(karta.dzialanie.termin) : null;
    const now = new Date(teraz);
    if (filtr.termin === 'brak' && t) return false;
    if (filtr.termin !== 'brak' && !t) return false;
    if (t) {
      if (filtr.termin === 'przeterminowane' && !(t < now)) return false;
      if (filtr.termin === 'dzisiaj' && dzienWarszawa(t) !== dzienWarszawa(now)) return false;
      if (filtr.termin === 'tydzien' && !(t >= now && t < new Date(now.getTime() + 7 * DZIEN_MS))) return false;
    }
  }
  return true;
}

/** Które pola filtra opisują, dlaczego lead zniknął z widoku („opiekun: Ja"). */
export function opisFiltra(filtr, plan) {
  const czesci = [];
  if (filtr.q) czesci.push(`szukane: „${filtr.q}"`);
  if (filtr.opiekun) {
    const nazwa =
      filtr.opiekun === 'ja' ? 'ja'
      : filtr.opiekun === 'brak' ? 'bez opiekuna'
      : plan?.agenci?.find((a) => a.id === filtr.opiekun)?.nazwa ?? 'wybrana osoba';
    czesci.push(`opiekun: ${nazwa}`);
  }
  if (filtr.zrodlo) czesci.push(`źródło: ${etykietaZrodla(filtr.zrodlo)}`);
  if (filtr.produkt) czesci.push(`zakres: ${filtr.produkt === 'nieznany' ? 'nieokreślony' : PRODUKTY[filtr.produkt] ?? filtr.produkt}`);
  if (filtr.termin) czesci.push(`działanie: ${TERMINY.find((t) => t.id === filtr.termin)?.nazwa ?? filtr.termin}`);
  return czesci.join(', ');
}

/** Komparator zgodny z kolejnością z SQL — do optymistycznego wstawienia karty. */
export function porownajKarty(sort) {
  const id = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (sort === 'wartosc') {
    return (a, b) => {
      if ((a.wartosc == null) !== (b.wartosc == null)) return a.wartosc == null ? 1 : -1;
      return (b.wartosc ?? 0) - (a.wartosc ?? 0) || id(a, b);
    };
  }
  if (sort === 'data') {
    return (a, b) => new Date(b.zgloszono).getTime() - new Date(a.zgloszono).getTime() || id(a, b);
  }
  return (a, b) => {
    const ta = a.dzialanie?.termin ? new Date(a.dzialanie.termin).getTime() : null;
    const tb = b.dzialanie?.termin ? new Date(b.dzialanie.termin).getTime() : null;
    if ((ta == null) !== (tb == null)) return ta == null ? 1 : -1;
    return (ta ?? 0) - (tb ?? 0) || id(a, b);
  };
}

/** Pozycja, na którą trafia karta w już posortowanej liście (komparator jak wyżej). */
export function indeksWstawienia(karty, karta, sort) {
  const cmp = porownajKarty(sort);
  let i = 0;
  while (i < karty.length && cmp(karty[i], karta) <= 0) i++;
  return i;
}

/** „Anna Kowalska: Nowy → Kontakt". */
export const komunikatPrzeniesienia = (nazwa, z, doEtapu) => `${nazwa}: ${z} → ${doEtapu}`;

/**
 * Czy lead można upuścić / przenieść na ten etap. `powod` wyjaśnia blokadę
 * (pokazywany przy celu przeciągania i w menu).
 */
export function czyMoznaPrzeniesc(karta, etap, { zapisWToku = false } = {}) {
  if (zapisWToku) return { ok: false, powod: 'Trwa zapis tego leada — poczekaj chwilę.' };
  if (karta.etap_id === etap.id) return { ok: false, powod: `Lead jest już w etapie „${etap.nazwa}".` };
  return { ok: true };
}

/** Czy etap wymaga danych, które trzeba zebrać PRZED zapisem. */
export const wymagaPowodu = (etap) => (etap?.wymagane_pola ?? []).includes('powod_utraty');

/**
 * Czy bieżący użytkownik może zmienić opiekuna leada — podpowiedź dla UI.
 * Administrator: kogokolwiek. Agent: przejąć wolny lead albo zwolnić własny.
 */
export function mozeZmienicOpiekuna(plan, karta) {
  if (plan.rola === 'admin') return { ok: true };
  const ja = plan.uzytkownik.id;
  if (!karta.opiekun_id || karta.opiekun_id === ja) return { ok: true };
  return { ok: false, powod: `Opiekunem jest ${karta.opiekun_nazwa ?? 'inna osoba'}. Zmienić go może administrator.` };
}

/** Opcje do okna „Zmień opiekuna". */
export function opcjeOpiekuna(plan, karta) {
  const ja = plan.uzytkownik.id;
  const baza = [{ id: null, nazwa: 'Bez opiekuna' }];
  if (plan.rola === 'admin') {
    return [...baza, ...plan.agenci.map((a) => ({ id: a.id, nazwa: a.id === ja ? `${a.nazwa} (ja)` : a.nazwa }))];
  }
  const opcje = [{ id: ja, nazwa: `${plan.uzytkownik.nazwa} (ja)` }];
  return [...baza, ...opcje].filter((o) => (o.id === null ? karta.opiekun_id === ja : !karta.opiekun_id || karta.opiekun_id === ja));
}

/**
 * Pozycje menu leada. Jeden model dla przycisku „…" i prawego przycisku myszy.
 * `zablokowana` = tekst przyczyny; pozycja zostaje widoczna, ale nieaktywna.
 * Brak pozycji = użytkownik w ogóle nie ma tej operacji.
 * @returns {{ id: string, etykieta: string, grupa: string, zablokowana?: string, href?: string }[]}
 */
export function akcjeLeada({ karta, etap, plan, zapisWToku = false }) {
  const zamkniety = (etap?.rodzaj ?? 'otwarty') !== 'otwarty';
  const w_toku = zapisWToku ? 'Trwa zapis tego leada — poczekaj chwilę.' : undefined;
  const opiekun = mozeZmienicOpiekuna(plan, karta);

  const pozycje = [
    { id: 'otworz', etykieta: 'Otwórz szczegóły', grupa: 'podglad' },
    { id: 'przenies', etykieta: 'Przenieś do…', grupa: 'proces', zablokowana: w_toku },
    {
      id: 'dzialanie', etykieta: 'Zaplanuj działanie…', grupa: 'obsluga',
      zablokowana: w_toku ?? (zamkniety ? 'Sprawa jest zamknięta — działań już się nie planuje.' : undefined),
    },
    { id: 'notatka', etykieta: 'Dodaj notatkę…', grupa: 'obsluga' },
    {
      id: 'opiekun', etykieta: 'Zmień opiekuna…', grupa: 'przypisanie',
      zablokowana: w_toku ?? (opiekun.ok ? undefined : opiekun.powod),
    },
  ];
  if (karta.telefon) pozycje.push({ id: 'zadzwon', etykieta: `Zadzwoń: ${karta.telefon}`, grupa: 'kontakt', href: `tel:${String(karta.telefon).replace(/[^\d+]/g, '')}` });
  pozycje.push(
    { id: 'link', etykieta: 'Kopiuj link do leada', grupa: 'udostepnianie' },
    { id: 'archiwizuj', etykieta: 'Archiwizuj…', grupa: 'porzadkowanie', zablokowana: w_toku },
  );
  return pozycje;
}

/** Pozycje menu etapu (nagłówek kolumny i pozycja w lewym panelu). */
export function akcjeEtapu({ etap, zwiniety, pierwszy }) {
  const pozycje = [];
  if (pierwszy) pozycje.push({ id: 'dodaj', etykieta: 'Dodaj lead (nowy klient)', grupa: 'proces', href: '/panel/klienci/nowy' });
  pozycje.push(
    { id: zwiniety ? 'rozwin' : 'zwin', etykieta: zwiniety ? 'Rozwiń etap' : 'Zwiń etap', grupa: 'widok' },
    { id: 'sortowanie', etykieta: 'Sortowanie…', grupa: 'widok', zablokowana: zwiniety ? 'Rozwiń etap, żeby zmienić sortowanie.' : undefined },
  );
  return pozycje;
}

/** Grupy menu rozdzielamy separatorami — zwraca płaską listę z wpisami { separator: true }. */
export function zSeparatorami(pozycje) {
  const wynik = [];
  let poprzednia = null;
  for (const p of pozycje) {
    if (poprzednia && p.grupa !== poprzednia) wynik.push({ separator: true });
    wynik.push(p);
    poprzednia = p.grupa;
  }
  return wynik;
}

/** Identyfikatory do aria i do testów — jedno miejsce, żeby nie zgadywać przedrostków. */
export const idMenuLeada = (id) => `menu-lead-${id}`;
