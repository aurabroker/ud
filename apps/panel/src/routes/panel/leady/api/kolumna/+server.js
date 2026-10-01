import { obsluz } from '$lib/server/leady-http.js';
import { filtrZParametrow, kolumna, liczniki, wczytajPlan } from '$lib/server/leady.js';

/** Kolejna strona kart jednego etapu + świeże liczniki całego pipeline'u. */
export const GET = (zdarzenie) =>
  obsluz(
    zdarzenie,
    async ({ sb, userId, url }) => {
      const { filtr, sort } = filtrZParametrow(url.searchParams);
      const plan = await wczytajPlan(sb, userId, url.searchParams.get('pipeline'));
      const etapId = url.searchParams.get('etap');
      const [strona, licz] = await Promise.all([
        kolumna(sb, userId, {
          pipelineId: plan.pipeline.id,
          etapId,
          filtr,
          sort,
          offset: url.searchParams.get('offset'),
        }),
        liczniki(sb, userId, plan.pipeline.id, filtr),
      ]);
      return { status: 200, body: { status: 'ok', ...strona, liczniki: licz } };
    },
    { odczyt: true },
  );
