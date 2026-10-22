/**
 * Liczebnik z rzeczownikiem w poprawnej formie: 1 zawód, 2 zawody, 5 zawodów,
 * 12 zawodów, 22 zawody. „43 zawodów" stało na stronie kategorii.
 *
 * Bez importów — używają go też wyspy Svelte w przeglądarce
 * (`@ud/zawody/liczebnik`), a `index.js` ciągnie za sobą cały zawody.json.
 * @param {number} n
 * @param {[string, string, string]} formy  [1, 2–4, 5+]
 */
export function liczebnik(n, [jeden, kilka, wiele]) {
  const forma = n === 1 ? jeden
    : (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) ? kilka
    : wiele;
  return `${n} ${forma}`;
}
