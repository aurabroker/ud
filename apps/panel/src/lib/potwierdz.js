/**
 * potwierdz.js — pytanie „na pewno?" przed wysłaniem formularza z use:enhance.
 *
 *   <form method="POST" action="?/delete" use:enhance={potwierdz('Usunąć?')}>
 *
 * NIE używaj `onsubmit={(e) => { if (!confirm(…)) e.preventDefault(); }}` przy
 * use:enhance. SvelteKit (forms.js, handle_submit) nie patrzy na
 * defaultPrevented — formularz idzie mimo „Anuluj". Tak 13.10.2026 poszła do
 * usunięcia oferta UD/2026/CE/00034, a tak samo działały „Usuń OWU", „Usuń
 * logo" i „Odśwież wszystkie". Jedyna droga zatrzymania to `cancel()`
 * w funkcji przekazanej do use:enhance.
 *
 * @param {string} tresc pytanie w okienku przeglądarki
 * @param {(arg: any) => any} [dalej] funkcja jak zwykły argument use:enhance
 *   (wołana dopiero po „OK"); bez niej — domyślne zachowanie enhance
 */
export function potwierdz(tresc, dalej) {
  return (arg) => {
    if (!globalThis.confirm(tresc)) {
      arg.cancel();
      return;
    }
    return dalej ? dalej(arg) : undefined;
  };
}
