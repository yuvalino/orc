/** The app version, injected at build time (electron.vite.config.ts) so the headless server can report it without Electron. */
declare const __ORC_VERSION__: string
/** Built as Orc Offline (ORC_OFFLINE=1): orc-server ships inside the app and is sent to hosts over ssh. */
declare const __ORC_OFFLINE__: boolean
declare module '*.sh?raw' { const text: string; export default text }
declare module '*.ps1?raw' { const text: string; export default text }
declare module '*.js?raw' { const text: string; export default text }
