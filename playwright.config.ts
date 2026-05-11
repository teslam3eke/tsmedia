import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? '5173')
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT} --strictPort`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
