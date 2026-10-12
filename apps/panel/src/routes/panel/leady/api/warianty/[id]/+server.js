import { obsluz } from '$lib/server/leady-http.js';
import { odpowiedzWariantow } from '$lib/server/leady.js';

export const GET = (zdarzenie) =>
  obsluz(
    zdarzenie,
    ({ sb, userSb, userId }) => odpowiedzWariantow(sb, userSb, userId, zdarzenie.params.id),
    { odczyt: true },
  );
