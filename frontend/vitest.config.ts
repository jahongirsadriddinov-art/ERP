import { defineConfig } from 'vitest/config';

// Birlik testlari faqat src/ ichida; e2e/ (Playwright brauzer robot) alohida — `npm run test:e2e`.
export default defineConfig({
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
