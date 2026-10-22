import { defineConfig, devices } from '@playwright/test';

// Brauzer robot (e2e): tayyor saytni (vite preview) ochib, telefon va kompyuter o'lchamida asosiy ekranlarni
// tekshiradi. Backend so'rovlari testning o'zida soxta javoblar bilan almashtiriladi — internet/server kerak emas.
// E2E_PORT — bir kompyuterda bir nechta nusxa (worktree) parallel sinalganda port to'qnashmasin.
const PORT = Number(process.env.E2E_PORT) || 4173;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'telefon', use: { ...devices['Pixel 7'] } },
    { name: 'kompyuter', use: { viewport: { width: 1366, height: 800 } } },
  ],
  webServer: { command: `npx vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
