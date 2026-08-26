import { defineConfig } from '@playwright/test';

/**
 * Testy jeżdżą po zbudowanym katalogu dist, nie po serwerze deweloperskim.
 * To jest ta sama zawartość, którą dostanie użytkownik — dev server potrafi
 * zamaskować błąd, który pojawia się dopiero po zbudowaniu.
 */
export default defineConfig({
  testDir: './test',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    launchOptions: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' },
  },
  webServer: {
    command: 'npx --yes http-server dist -p 4321 -s --silent',
    url: 'http://127.0.0.1:4321/wniosek/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
