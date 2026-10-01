import { obsluz } from '$lib/server/leady-http.js';
import { filtrZParametrow, liczniki, wczytajPlan } from '$lib/server/leady.js';

export const GET = (zdarzenie) =>
  obsluz(
    zdarzenie,
    async ({ sb, userId, url }) => {
      const { filtr } = filtrZParametrow(url.searchParams);
      const plan = await wczytajPlan(sb, userId, url.searchParams.get('pipeline'));
      return { status: 200, body: { status: 'ok', liczniki: await liczniki(sb, userId, plan.pipeline.id, filtr) } };
    },
    { odczyt: true },
  );
