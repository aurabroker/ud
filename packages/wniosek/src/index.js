/**
 * @ud/wniosek — wspólna definicja wniosku ubezpieczeniowego.
 *
 * Portal zbiera po tym schemacie dane, panel po tym samym je wyświetla i wycenia.
 * Nazwy pól są celowo takie same jak w starym formularzu — pod nimi siedzą
 * kolumny w ud_clients i parser ofert, których przeprowadzka nie rusza.
 */
export * from './schemat.js';
export {
  HEALTH_SURVEY_GROUPS,
  HEALTH_SURVEY_ITEMS,
  HEALTH_SURVEY_COLS,
  parseSum,
} from './ankieta.js';
