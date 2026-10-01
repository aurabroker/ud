import { obsluz } from '$lib/server/leady-http.js';
import { szczegoly, wczytajPlan } from '$lib/server/leady.js';

export const GET = (zdarzenie) =>
  obsluz(
    zdarzenie,
    async ({ sb, userSb, userId }) => {
      // Dostęp sprawdzamy zanim ktokolwiek dostanie dane po samym identyfikatorze.
      await wczytajPlan(sb, userId, null);
      return { status: 200, body: { status: 'ok', ...(await szczegoly(sb, userSb, zdarzenie.params.id)) } };
    },
    { odczyt: true },
  );
