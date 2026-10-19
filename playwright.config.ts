import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  timeout: 20_000,
  workers: 1,
  reporter: 'list',
  expect: { timeout: 8_000 }
})
