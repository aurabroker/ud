/**
 * Granice wniosku, które strona podaje słowami.
 *
 * Liczby stoją w `@ud/wniosek` (kreator) i w funkcji `form-submit` (decyzja
 * właściciela z 12.10.2026, CLAUDE.md „Granice wniosku"). Strona bierze je
 * stąd, żeby nie obiecywać innej liczby niż ta, którą formularz przepuści.
 *
 * Osobny plik, a nie symulacja.ts: tamten test kalibratora ładuje jako
 * samodzielny moduł, więc nie może on importować niczego poza kalibracja.json.
 */
import { RYZYKA } from '@ud/wniosek/schemat';

/** Najwyższe świadczenie miesięczne (okresowa niezdolność) — 50 000 zł, podawane publicznie od 21.10.2026. */
export const SWIADCZENIE_MAX: number =
  RYZYKA.find((r: { klucz: string }) => r.klucz === 'riskTempIncapacity')!.max;
