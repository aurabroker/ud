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
  /** Nazwa pliku zdjęcia kategorii, np. „medycyna.jpg". */
  obraz: string;
  /** Maksymalne świadczenie dzienne w złotych. */
  swiadczenieDzienne: number | null;
  /** Co dostaje osoba w tym zawodzie bez polisy — zdanie z llms.txt. */
  bezUbezpieczenia: string | null;
  ryzyka: Ryzyko[];
  odmiana: Odmiana;
  rodzaj: 'm' | 'z';
  /** Poprzedni adres, jeśli slug się zmienił — do przekierowania 301. */
  staryAdres?: string;
}

export interface Kategoria {
  nazwa: string;
  liczba: number;
  slug: string;
}

export const ZAWODY: Zawod[];

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
