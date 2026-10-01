import { defineConfig } from '@playwright/test';

/**
 * Testy przeglądarkowe tablicy leadów. Serwer testowy (Postgres + Vite +
 * prawdziwe funkcje serwerowe) startuje w globalSetup — patrz test/leady/serwer.mjs.
 * Jeden worker: wszystkie testy dzielą jedną bazę i resetują ją na wejściu.
 */
export default defineConfig({
  testDir: './test/leady',
  testMatch: '**/*.spec.js',
  globalSetup: './test/leady/global-setup.mjs',
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' },
    viewport: { width: 1440, height: 900 },
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
});
