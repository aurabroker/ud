/** Typy pakietu @ud/zawody. Pisane ręcznie — źródło jest w JS, nie w TS. */

export type Forma =
  | 'mianownik' | 'dopelniacz' | 'celownik' | 'biernik'
  | 'narzednik' | 'miejscownik' | 'mnoga' | 'mnogaDop';

export type Odmiana = Record<Forma, string>;

export interface Ryzyko {
  tytul: string;
  opis: string;
}

export interface Zawod {
  slug: string;
  nazwa: string;
  kategoria: string;
  /** Maksymalne świadczenie dzienne w złotych. */
  swiadczenieDzienne: number | null;
  /** Co dostaje osoba w tym zawodzie bez polisy — zdanie z llms.txt. */
  bezUbezpieczenia: string | null;
  ryzyka: Ryzyko[];
  odmiana: Odmiana;
  rodzaj: 'm' | 'z';
  /** Poprzedni adres, jeśli slug się zmienił — do przekierowania 301. */
  staryAdres?: string;
  /** Zawód wycofany z serwisu — nie generujemy dla niego podstrony. */
  wycofany?: true;
  /** Dokąd kieruje 301 z adresu wycofanego zawodu. */
  przekierowanieNa?: string;
}

export interface Kategoria {
  nazwa: string;
  liczba: number;
  /** Zarazem adres `/zawody/<slug>/` i nazwa pliku zdjęcia kategorii. */
  slug: string;
}

export const ZAWODY: Zawod[];
export const WYCOFANE: Zawod[];

export function zawod(slug: string): Zawod | null;
export function slugi(): string[];
export function kategorie(): Kategoria[];
export function wKategorii(nazwa: string): Zawod[];
export function pokrewne(slug: string, ile?: number): Zawod[];
export function slugKategorii(nazwa: string): string;
export function przekierowania(): { z: string; na: string }[];

export function odmien(nazwa: string, forma: Forma): string;
export function odmiana(nazwa: string): Odmiana;
export function rodzaj(nazwa: string): 'm' | 'z';
export const FORMY: readonly Forma[];
export const MESKI: 'm';
export const ZENSKI: 'z';

/* ── Treści redakcyjne ────────────────────────────────────────────────────
 * Osobny plik danych, bo tekst zmienia się niezależnie od parametrów zawodu
 * i nie ma po co przebudowywać jednego przy edycji drugiego.
 */

export interface Pytanie {
  pytanie: string;
  odpowiedz: string;
}

export interface Tresc {
  /** Akapit otwierający — pierwsze zdanie trafia też do llms.txt. */
  wstep: string;
  /** Skąd bierze się dochód w tym zawodzie i jak się go dokumentuje. */
  dochod: string;
  /** Co się dzieje, gdy praca się zatrzyma. */
  przerwa: string;
  ryzyka: Ryzyko[];
  pytania: Pytanie[];
}

export const TRESCI: Record<string, Tresc>;

export function tresc(slug: string): Tresc | null;

/** Ile zawodów ma już własną treść — mierzone w teście pokrycia. */
export function pokrycieTresci(slugi: string[]): {
  napisane: number;
  wszystkie: number;
  brakujace: string[];
};
