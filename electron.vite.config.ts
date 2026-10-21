import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }

const shared = { '@shared': resolve('src/shared') }
/** The edition: ORC_OFFLINE=1 builds Orc Offline, which carries every host's orc-server and sends it over ssh (see remote.ts). */
const edition = { __ORC_VERSION__: JSON.stringify(version), __ORC_OFFLINE__: JSON.stringify(process.env.ORC_OFFLINE === '1') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    define: edition,
    // The desktop shell and the headless server share one bundle set; the server is a second entry.
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'orc-server': resolve('src/server/cli.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    define: edition, // shown in About Orc (version and edition)
    resolve: { alias: { '@': resolve('src/renderer'), ...shared } }
  }
})
