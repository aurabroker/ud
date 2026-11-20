/** Typy pakietu @ud/wniosek. */

export type Zatrudnienie = 'b2b' | 'uop' | 'zlecenie';
export type IdKroku = 'kontakt' | 'dane' | 'zakres' | 'zdrowie' | 'zgody';

export interface Opcja { wartosc: string; etykieta: string }
export interface Pytanie { klucz: string; etykieta: string }

export interface Ryzyko {
  klucz: string;
  poleSumy: string;
  etykieta: string;
  rodzaj: string;
  podpowiedz: string;
  /** Ryzyko, bez którego polisy nie ma — kreator trzyma je zaznaczone. */
  podstawowe?: boolean;
  /** Najwyższa suma (zł; przy okresowej — miesięcznie). Ta sama liczba stoi w form-submit. */
  max: number;
}

export interface Granica { min: number; max: number; jednostka: string; komunikat: string }

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
/** Waga i wzrost: pole nieobowiązkowe, ale wpisane musi się mieścić w granicach. */
export const GRANICE_CIALA: { weight: Granica; height: Granica };
export const KLAUZULE_NW: Klauzula[];
export const KROKI: { id: IdKroku; tytul: string; opis: string }[];
/** Zgoda na kontakt w sprawie niedokończonego wniosku (wersja + dokładna treść). */
export const ZGODA_KONTAKT: { wersja: string; tresc: string };
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
/** Liczba kroków słowami, z odmianą: „pięć kroków”. */
export function krokiSlownie(n?: number): string;
export function doWysylki(dane: Dane): Record<string, unknown>;
/** Kod agenta z linku /wniosek/?agent=<kod> → { affiliateCode } albo {}. */
export function zLinkuAgenta(search: string): { affiliateCode?: string };

/** Parametr źródła wizyty z białej listy (adres strony → form_data.zrodlo). */
export type ParametrZrodla =
  | 'gclid' | 'gbraid' | 'wbraid'
  | 'gad_source' | 'gad_campaignid'
  | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_term' | 'utm_content';

/** Kształt `ud_clients.form_data.zrodlo`. Identyfikator kliknięcia tylko przy zgodzie na marketing. */
export interface ZrodloWizyty {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gad_source?: string;
  gad_campaignid?: string;
  /** W adresie był poprawny gclid, gbraid, wbraid albo gad_source. */
  platne: boolean;
  zgoda_marketing: boolean;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
}

/** Biała lista, w stałej kolejności. */
export const PARAMETRY_ZRODLA: readonly ParametrZrodla[];
export const IDENTYFIKATORY_KLIKNIECIA: readonly ('gclid' | 'gbraid' | 'wbraid')[];
export const PARAMETRY_PLATNE: readonly ('gclid' | 'gbraid' | 'wbraid' | 'gad_source')[];
/** Czy wartość (po trim) przechodzi regułę danego parametru; spoza białej listy — false. */
export function wartoscZrodlaPoprawna(klucz: string, wartosc: unknown): boolean;
/** Poprawne parametry z białej listy jako pary [klucz, wartość], pierwsze wystąpienie. Nie rzuca. */
export function parametryZrodla(search: unknown): [ParametrZrodla, string][];
/** `{ zrodlo }` do wniosku albo `{}` bez parametrów. Nie rzuca. */
export function zrodloZAdresu(search: unknown, zgodaMarketing: unknown): { zrodlo?: ZrodloWizyty };
