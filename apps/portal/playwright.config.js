import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Chromium sandboksa. `/opt/pw-browsers/chromium` to stałe dowiązanie do
 * wersji z obrazu; numer w katalogu zmienia się z obrazem (08.11.2026 nowy
 * miał 1243 zamiast 1194 i 115 testów padło na „executable doesn't exist").
 * Bez żadnego z nich Playwright bierze własną przeglądarkę.
 */
const CHROMIUM = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((sciezka) => existsSync(sciezka));

/**
 * Testy jeżdżą po zbudowanym katalogu dist, nie po serwerze deweloperskim.
 * To jest ta sama zawartość, którą dostanie użytkownik — dev server potrafi
 * zamaskować błąd, który pojawia się dopiero po zbudowaniu.
 */
export default defineConfig({
  testDir: './test',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    ...(CHROMIUM ? { launchOptions: { executablePath: CHROMIUM } } : {}),
  },
  webServer: {
    command: 'npx --yes http-server dist -p 4321 -s --silent',
    url: 'http://127.0.0.1:4321/wniosek/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
