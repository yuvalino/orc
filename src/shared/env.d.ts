/** The app version, injected at build time (electron.vite.config.ts) so the headless server can report it without Electron. */
declare const __ORC_VERSION__: string
declare module '*.sh?raw' { const text: string; export default text }
declare module '*.ps1?raw' { const text: string; export default text }
