/** Typy pakietu @ud/wniosek. */

export type Zatrudnienie = 'b2b' | 'uop' | 'zlecenie';
export type IdKroku = 'dane' | 'zakres' | 'zdrowie' | 'zgody';

export interface Opcja { wartosc: string; etykieta: string }
export interface Pytanie { klucz: string; etykieta: string }

export interface Ryzyko {
  klucz: string;
  poleSumy: string;
  etykieta: string;
  rodzaj: string;
  podpowiedz: string;
}

export interface Klauzula {
  klucz: string;
  etykieta: string;
  kwoty: number[];
  naDzien?: boolean;
  naTydzien?: boolean;
}

export interface PozycjaAnkiety { key: string; col?: string; label: string }
export interface GrupaAnkiety { title: string; items: PozycjaAnkiety[] }

export type Dane = Record<string, unknown>;
export type Bledy = Record<string, string>;

export const LIMIT_DOCHODU: Record<Zatrudnienie, number>;
export const FORMY_ZATRUDNIENIA: Opcja[];
export const FORMY_OPODATKOWANIA: Opcja[];
export const PYTANIA_MEDYCZNE: Pytanie[];
export const AKTYWNOSCI_RYZYKOWNE: Pytanie[];
export const RYZYKA: Ryzyko[];
export const KLAUZULE_NW: Klauzula[];
export const KROKI: { id: IdKroku; tytul: string }[];
export const POLA_LOGICZNE: string[];
export const HEALTH_SURVEY_THRESHOLD: number;
export const HEALTH_SURVEY_GROUPS: GrupaAnkiety[];
export const HEALTH_SURVEY_ITEMS: PozycjaAnkiety[];
export const HEALTH_SURVEY_COLS: string[];

export function pesekPoprawny(pesel: unknown): boolean;
export function dataZPesel(pesel: unknown): Date | null;
export function wiekZPesel(pesel: unknown, dzis?: Date): number | null;
export function telefonPoprawny(tel: unknown): boolean;
export function emailPoprawny(email: unknown): boolean;
export function sprawdzKrok(krok: IdKroku, dane: Dane): Bledy;
export function ankietaRozszerzona(dane: Dane): boolean;
export function surveyRequired(suma: unknown): boolean;
export function parseSum(raw: unknown): number | null;
export function doWysylki(dane: Dane): Record<string, unknown>;
