import { defineConfig, devices } from '@playwright/test';

// Asosiy e2e to'plami, lekin ALOHIDA portda (4184) — bir mashinada boshqa nusxa (worktree) 4173'da
// o'z preview serverini ishlatayotgan bo'lsa, testlar adashib o'sha (boshqa) build'ni tekshirmasin.
// Ishlatish: npx playwright test -c design-shots/e2e-isolated.config.ts
export default defineConfig({
  testDir: '../e2e',
  timeout: 30_000,
  workers: 3,
  reporter: 'list',
  outputDir: '../test-results/e2e-isolated',
  use: { baseURL: 'http://localhost:4184', trace: 'retain-on-failure' },
  projects: [
    { name: 'telefon', use: { ...devices['Pixel 7'] } },
    { name: 'kompyuter', use: { viewport: { width: 1366, height: 800 } } },
  ],
  webServer: { command: 'npx vite preview --port 4184 --strictPort', cwd: '..', url: 'http://localhost:4184', reuseExistingServer: false, timeout: 60_000 },
});
