import { startuj } from './serwer.mjs';

export default async function globalSetup() {
  const serwer = await startuj();
  process.env.LEADY_URL = serwer.url;
  return async () => { await serwer.zatrzymaj(); };
}
