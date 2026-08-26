/**
 * healthSurvey.js — ankieta medyczna wymagana, gdy suma ubezpieczenia dla
 * „Trwałej niezdolności" przekracza 1 000 000 zł.
 * Każde pytanie: odpowiedź TAK/NIE; przy TAK wymagane są szczegóły.
 * `col` = istniejąca kolumna boolean w ud_clients (jeśli jest); reszta trafia do form_data.
 */

export const HEALTH_SURVEY_THRESHOLD = 1_000_000;

export const HEALTH_SURVEY_GROUPS = [
  {
    title: 'Informacje ogólne',
    items: [
      { key: 'weight_change', col: 'weight_change', label: 'Zmiana wagi ciała ponad 5 kg w ciągu ostatniego roku (niezwiązana z ciążą/porodem)' },
      { key: 'takes_meds', col: 'takes_meds', label: 'Przyjmowanie na stałe leków przepisanych przez lekarza' },
      { key: 'pending_diagnosis', col: 'pending_diagnosis', label: 'Aktualnie prowadzona jest diagnostyka, trwa oczekiwanie na wyniki badań, zabieg lub rozważane jest zasięgnięcie porady lekarskiej ze względu na aktualnie odczuwane objawy chorobowe' },
      { key: 'disability_congenital', col: 'disability_congenital', label: 'Czy występują u Pana/Pani trwałe ograniczenie sprawności lub wady wrodzone?' },
      { key: 'smoker', col: 'smoker', label: 'Czy pali Pan/Pani papierosy lub inne wyroby tytoniowe?' }
    ]
  },
  {
    title: 'Zdarzenia medyczne',
    items: [
      { key: 'event_hospitalization', col: 'event_hospitalization', label: 'Miała miejsce hospitalizacja' },
      { key: 'event_sick_leave_30', col: 'event_sick_leave_30', label: 'Otrzymano zwolnienie lekarskie dłuższe niż 30 dni' },
      { key: 'event_further_diagnosis', col: 'event_further_diagnosis', label: 'Odbyto konsultacje lub wykonano badania diagnostyczne, po przeprowadzeniu których lekarz zalecił dalszą diagnostykę lub leczenie' }
    ]
  },
  {
    title: 'Choroby i układy',
    items: [
      { key: 'med_heart', col: 'med_heart', label: 'Układ sercowo-naczyniowy' },
      { key: 'med_neuro', col: 'med_neuro', label: 'Układ nerwowy, wzrok, słuch' },
      { key: 'med_thyroid', label: 'Tarczyca' },
      { key: 'med_urinary', label: 'Układ moczowy' },
      { key: 'med_stomach', col: 'med_stomach', label: 'Układ pokarmowy' },
      { key: 'med_locomotor', col: 'med_bones', label: 'Układ ruchu, dna moczanowa' },
      { key: 'med_respiratory', label: 'Układ oddechowy' },
      { key: 'med_oncology', label: 'Choroby onkologiczne, guzy, narośla' },
      { key: 'med_spine_degenerative', label: 'Choroba zwyrodnieniowa kręgosłupa lub stawów, zapalenie stawów lub jakikolwiek inny proces zwyrodnieniowy dotyczący kręgosłupa, stawów, kości, mięśni, ścięgien lub wiązadeł. Objawy/dolegliwości bólowe ze strony kręgosłupa lub stawów' },
      { key: 'med_allergy', label: 'Alergia (inna niż katar sienny)' },
      { key: 'med_diabetes', col: 'med_diabetes', label: 'Cukrzyca' },
      { key: 'med_other', label: 'Inna, niewymieniona wcześniej choroba' }
    ]
  }
];

/** Płaska lista pozycji ankiety. */
export const HEALTH_SURVEY_ITEMS = HEALTH_SURVEY_GROUPS.flatMap((g) => g.items);

/** Kolumny boolean pokryte przez ankietę (chowamy je z sekcji „Dane zdrowotne"). */
export const HEALTH_SURVEY_COLS = HEALTH_SURVEY_ITEMS.filter((i) => i.col).map((i) => i.col);

/** "1 500 000 zł" / "1500000,00" -> 1500000 | null */
export function parseSum(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/\s| /g, '').replace(/zł|PLN/gi, '').replace(',', '.');
  const m = cleaned.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Czy ankieta jest wymagana dla podanej sumy „trwałej niezdolności". */
export function surveyRequired(permSumRaw) {
  const n = parseSum(permSumRaw);
  return n != null && n > HEALTH_SURVEY_THRESHOLD;
}
