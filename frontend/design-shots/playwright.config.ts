import { defineConfig } from '@playwright/test';

// Dizayn skrinshotlari (qo'lda ishlatiladi): npx playwright test -c design-shots
// Natija: test-results/design/*.png (commit qilinmaydi). SHOTS=dashboard,profile — faqat shu ekranlar.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 4,
  reporter: 'list',
  outputDir: '../test-results/design-out',
  use: { baseURL: 'http://localhost:4183', serviceWorkers: 'block' },
  webServer: { command: 'npx vite preview --port 4183 --strictPort', url: 'http://localhost:4183', cwd: '..', reuseExistingServer: true, timeout: 60_000 },
});
