import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 150_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/omalovankarna/`,
    trace: 'retain-on-failure',
    locale: 'cs-CZ',
  },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'] } },
    // iPhone rozměry a dotyk, ale engine Chromium (WebKit v CI neinstalujeme).
    { name: 'iphone', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
