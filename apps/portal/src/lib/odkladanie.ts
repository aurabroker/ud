/**
 * odkladanie.ts — „wolę odkładać sam": ile trwa uzbieranie świadczenia.
 *
 * Pomysł właściciela z 21.10.2026: klientka uznała 250 zł składki za dużo
 * i chciała tyle odkładać, przy świadczeniu 10 000 zł miesięcznie. Odkładając
 * 250 zł, równowartość JEDNEGO miesiąca świadczenia zbiera się 40 miesięcy.
 *
 * Uczciwie wobec odkładania: odłożone pieniądze zostają u klienta, a składka
 * nie wraca, jeśli nic się nie stanie — strona mówi to przy wyniku. Odsetki
 * ustawia się suwakiem (domyślnie 0, bez inflacji). Przy jednym–dwóch
 * miesiącach świadczenia odsetki zmieniają wynik o kilka procent (250 zł na
 * 10 000 zł: 40 miesięcy bez odsetek, 38 przy 4% rocznie); dlatego nie
 * pokazujemy „ile lat na całe 24 miesiące świadczenia" — tam wynik bez
 * odsetek wychodzi ponad dwa razy dłuższy (80 lat wobec 36 przy 4% rocznie)
 * i to założenie, a nie rachunek, decydowałoby o liczbie na ekranie.
 */
import { liczebnik } from '@ud/zawody/liczebnik';

/** Zakres suwaka „ile odkładasz miesięcznie". */
export const ZAKRES_ODKLADANIA = { min: 50, max: 2000, krok: 10 } as const;
/** Najniższe świadczenie na suwaku; najwyższe przychodzi z granicy wniosku (granice.ts). */
export const SWIADCZENIE_MIN = 2000;
/** Krok 100 zł: świadczenie z kalkulatora (80% dochodu, dochód co 500 zł) to wielokrotność 400. */
export const SWIADCZENIE_KROK = 100;
/** Oprocentowanie oszczędności rocznie, po podatku — w procentach. */
export const ZAKRES_PROCENTU = { min: 0, max: 8, krok: 0.5 } as const;

/** Przykład właściciela — wartości startowe symulatora. */
export const PRZYKLAD = { odkladam: 250, swiadczenie: 10000 } as const;

/** Dni w miesiącu przy przeliczaniu świadczenia na dni niezdolności. */
const DNI_W_MIESIACU = 30;

/**
 * Ile pełnych miesięcy odkładania `wplata` (na koniec miesiąca) daje `cel`,
 * przy oprocentowaniu rocznym `procentRocznie` (w %, kapitalizacja miesięczna).
 * Zwraca Infinity, gdy wpłata nie jest dodatnia.
 */
export function miesiaceDoKwoty(cel: number, wplata: number, procentRocznie = 0): number {
  if (!(wplata > 0) || !Number.isFinite(wplata)) return Infinity;
  if (!(cel > 0)) return 0;
  const i = procentRocznie / 100 / 12;
  if (!(i > 0)) return Math.ceil(cel / wplata - 1e-9);
  // Wartość przyszła renty: P·((1+i)^n − 1)/i ≥ cel.
  return Math.ceil(Math.log(1 + (cel * i) / wplata) / Math.log(1 + i) - 1e-9);
}

/** Ile odłożysz przez `miesiace`, przy tej samej wpłacie i oprocentowaniu. */
export function odlozone(wplata: number, miesiace: number, procentRocznie = 0): number {
  const i = procentRocznie / 100 / 12;
  if (!(i > 0)) return wplata * miesiace;
  return (wplata * ((1 + i) ** miesiace - 1)) / i;
}

/** Na ile dni niezdolności starczy `kwota` przy świadczeniu miesięcznym (dni pełne). */
export function dniSwiadczenia(kwota: number, swiadczenieMies: number): number {
  if (!(swiadczenieMies > 0)) return 0;
  return Math.floor(kwota / (swiadczenieMies / DNI_W_MIESIACU) + 1e-9);
}

/**
 * „9 dni", „1,5 miesiąca", „12 miesięcy" — ile świadczenia jest wart `kwota`,
 * w dopełniaczu („równowartość …"). Poniżej miesiąca w dniach, od miesiąca
 * w miesiącach z jednym miejscem po przecinku (ułamek bierze dopełniacz
 * liczby pojedynczej: „2,5 miesiąca").
 */
export function rownowartoscSlownie(kwota: number, swiadczenieMies: number): string {
  const dni = dniSwiadczenia(kwota, swiadczenieMies);
  if (dni < 1) return 'mniej niż 1 dnia';
  if (dni < DNI_W_MIESIACU) return liczebnik(dni, ['dnia', 'dni', 'dni']);
  const miesiace = Math.floor((kwota / swiadczenieMies) * 10 + 1e-9) / 10;
  if (Number.isInteger(miesiace)) return liczebnik(miesiace, ['miesiąca', 'miesięcy', 'miesięcy']);
  return `${String(miesiace).replace('.', ',')} miesiąca`;
}

/** „3 lata i 4 miesiące", „1 rok", „5 miesięcy". */
export function czasSlownie(miesiace: number): string {
  if (!Number.isFinite(miesiace)) return 'nigdy';
  const lata = Math.floor(miesiace / 12);
  const reszta = miesiace % 12;
  const czesci: string[] = [];
  if (lata > 0) czesci.push(liczebnik(lata, ['rok', 'lata', 'lat']));
  if (reszta > 0 || lata === 0) czesci.push(liczebnik(reszta, ['miesiąc', 'miesiące', 'miesięcy']));
  return czesci.join(' i ');
}

/**
 * Liczba z zakresu, zaokrąglona do kroku; puste pole i śmieci z adresu →
 * wartość domyślna. Przy kwotach w pełnych złotych (krok ≥ 1) kropka albo
 * przecinek przed trzema cyframi to separator tysięcy: „1.500" to 1 500 zł,
 * nie półtorej złotówki przycięte do minimum.
 */
export function wZakresie(v: unknown, min: number, max: number, krok: number, domyslna: number): number {
  let tekst = typeof v === 'number' ? '' : String(v ?? '').replace(/\s/g, '');
  if (krok >= 1) tekst = tekst.replace(/[.,](?=\d{3}(?!\d))/g, '');
  tekst = tekst.replace(',', '.');
  if (typeof v !== 'number' && tekst === '') return domyslna;
  const n = typeof v === 'number' ? v : Number(tekst);
  if (!Number.isFinite(n)) return domyslna;
  const naKroku = Math.round(n / krok) * krok;
  return Math.min(max, Math.max(min, Number(naKroku.toFixed(2))));
}
