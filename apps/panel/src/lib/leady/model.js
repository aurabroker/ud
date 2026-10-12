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
  manual: 'Dodany w panelu',
  polisa: 'Polisa dodana w panelu',
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

/**
 * Ile dni lead może stać w jednym otwartym etapie, zanim karta zrobi się
 * czerwona (decyzja właściciela z 02.10.2026: „dłużej niż 5 dni"). W pierwszej
 * kolumnie karta idzie od zieleni (dzień 0) przez żółć i pomarańcz do czerwieni.
 * Licznik zeruje tylko przeniesienie do innego etapu — notatka ani zaplanowany
 * telefon nie zmieniają tego, że lead stoi w miejscu.
 */
export const DNI_DLUGO_W_ETAPIE = 5;
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

/** Kwota z pola tekstowego jak w SQL (ud_kwota): „8 000,50 zł" → 8000.5, cokolwiek innego → null. */
export function kwotaZTekstu(tekst) {
  const n = String(tekst ?? '').toLowerCase().replace(/(\s|\u00a0|zł|pln)/g, '').replace(',', '.');
  return /^[0-9]{1,9}(\.[0-9]{1,2})?$/.test(n) ? Number(n) : null;
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

/**
 * Kwota na karcie z jednoznacznym znaczeniem. W „Wygrany" liczy się składka
 * sprzedanego wariantu; wszędzie indziej — miesięczne świadczenie z wniosku.
 */
export function wartoscKarty(karta, etap = null) {
  if (etap?.rodzaj === 'wygrany') {
    const sk = karta.sprzedaz?.skladka_roczna;
    return sk == null ? 'Brak danych sprzedaży' : `Składka ${formatKwota(sk)} / rok`;
  }
  return karta.wartosc == null ? null : `Świadczenie ${formatKwota(karta.wartosc)} / mies.`;
}

/**
 * Opiekun pokazywany na karcie. Administratora nie pokazujemy (decyzja
 * właściciela z 02.10.2026) — w szczegółach i w filtrze nadal jest.
 * null = nic nie pokazuj.
 */
export function opiekunNaKarcie(karta) {
  if (karta.opiekun_admin) return null;
  return karta.opiekun_nazwa ?? 'Bez opiekuna';
}

/**
 * „Wiek" karty w otwartym etapie, do koloru i napisu „3 dni w etapie".
 * Etap zamknięty (Wygrany / Przegrany) — null: sprawa skończona, nic nie świeci.
 *   poziom 0–5  pierwsza kolumna: od zieleni (0) przez żółć do ciemnego pomarańczu (5)
 *   czerwony    ponad DNI_DLUGO_W_ETAPIE dni — w KAŻDEJ otwartej kolumnie
 */
export function wiekKarty(karta, etap, pierwszy = false, teraz = new Date()) {
  if ((etap?.rodzaj ?? 'otwarty') !== 'otwarty') return null;
  const dni = dniWEtapie(karta, teraz);
  const czerwony = dni > DNI_DLUGO_W_ETAPIE;
  return {
    dni,
    czerwony,
    poziom: pierwszy && !czerwony ? Math.min(dni, DNI_DLUGO_W_ETAPIE) : null,
    tekst: dni === 0 ? 'Dziś w etapie' : `${liczbaDni(dni)} w etapie`,
  };
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

const liczbaDni = (n) => `${n} ${n === 1 ? 'dzień' : 'dni'}`;

export function dniWEtapie(karta, teraz = new Date()) {
  if (!karta.etap_od) return 0;
  return Math.max(0, Math.floor((new Date(teraz).getTime() - new Date(karta.etap_od).getTime()) / DZIEN_MS));
}

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
    // Czas w etapie nie jest tu ostrzeżeniem: karta ma stały napis „N dni w etapie"
    // i kolor (wiekKarty), więc drugi komunikat o tym samym byłby szumem.
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
export const wymagaSprzedazy = (etap) => (etap?.wymagane_pola ?? []).includes('skladka_roczna');

/** Pola danych sprzedaży — kolejność jak w formularzu „Wygrany". */
export const POLA_SPRZEDAZY = [
  { id: 'skladka_roczna', nazwa: 'Składka roczna', jednostka: 'zł / rok', wymagane: true },
  { id: 'skladka_mies', nazwa: 'Składka miesięczna', jednostka: 'zł / mies.' },
  { id: 'swiadczenie_okresowa', nazwa: 'Świadczenie — okresowa niezdolność', jednostka: 'zł / mies.' },
  { id: 'swiadczenie_trwala', nazwa: 'Suma — trwała niezdolność', jednostka: 'zł' },
  { id: 'swiadczenie_zgon', nazwa: 'Suma — zgon', jednostka: 'zł' },
];

/**
 * Dane sprzedaży z formularza → to, co idzie do serwera i na kartę
 * optymistycznie. Kwoty jak w SQL („3 036,00 zł" → 3036); puste pole = brak.
 * `bledne` = pola z czymś, czego nie da się odczytać jako kwoty.
 */
export function daneSprzedazyZFormularza(pola, wariantId = null) {
  const sprzedaz = {};
  const bledne = [];
  for (const { id } of POLA_SPRZEDAZY) {
    const t = String(pola[id] ?? '').trim();
    if (!t) continue;
    const n = kwotaZTekstu(t);
    // Zero = „tego ryzyka nie ma" (np. sprzedana sama okresowa niezdolność) —
    // jak puste pole, nie błąd. Składkę roczną > 0 wymaga osobno okno i SQL.
    if (n == null) bledne.push(id);
    else if (n > 0) sprzedaz[id] = n;
  }
  if (wariantId) sprzedaz.wariant_id = wariantId;
  return { sprzedaz, bledne };
}

/**
 * Czy bieżący użytkownik może zmienić opiekuna leada — podpowiedź dla UI.
 * Od 02.10.2026 opiekuna przydziela wyłącznie administrator: agent widzi tylko
 * swoje leady, więc nie ma czego przejmować, a zwolnić własnego nie może.
 */
export function mozeZmienicOpiekuna(plan, karta) {
  if (plan.rola === 'admin') return { ok: true };
  return { ok: false, powod: 'Opiekuna przydziela administrator.' };
}

/** Opcje do okna „Zmień opiekuna" (tylko administrator). */
export function opcjeOpiekuna(plan, karta) {
  if (plan.rola !== 'admin') return [];
  const ja = plan.uzytkownik.id;
  return [{ id: null, nazwa: 'Bez opiekuna' },
          ...plan.agenci.map((a) => ({ id: a.id, nazwa: a.id === ja ? `${a.nazwa} (ja)` : a.nazwa }))];
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
  if (etap?.rodzaj === 'wygrany') {
    // Obok notatki: to też obsługa sprawy, nie zmiana procesu.
    pozycje.splice(pozycje.findIndex((p) => p.id === 'notatka') + 1, 0, {
      id: 'sprzedaz', etykieta: karta.sprzedaz?.skladka_roczna != null ? 'Dane sprzedaży…' : 'Uzupełnij dane sprzedaży…',
      grupa: 'obsluga', zablokowana: w_toku,
    });
  }
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
