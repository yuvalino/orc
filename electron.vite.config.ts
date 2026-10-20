import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    define: { __ORC_VERSION__: JSON.stringify(version) },
    // The desktop shell and the headless server share one bundle set; the server is a second entry.
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'orc-server': resolve('src/server/cli.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    define: { __ORC_VERSION__: JSON.stringify(version) }, // shown in About Orc
    resolve: { alias: { '@': resolve('src/renderer'), ...shared } }
  }
})
