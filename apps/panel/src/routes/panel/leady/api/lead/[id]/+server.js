import { obsluz } from '$lib/server/leady-http.js';
import { odpowiedzSzczegolow } from '$lib/server/leady.js';

export const GET = (zdarzenie) =>
  obsluz(
    zdarzenie,
    ({ sb, userSb, userId }) => odpowiedzSzczegolow(sb, userSb, userId, zdarzenie.params.id),
    { odczyt: true },
  );
