import { createRoot } from 'react-dom/client'
import App from './app/App'
import { AboutWindow } from './app/About'
import { RestartDialog } from './app/RestartDialog'
// Fonts ship with the app: nothing is fetched at run time
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/globals.css'
import '@shared/api'

// Local files, so milliseconds: wait for them rather than re-lay out the text once they swap in
await Promise.all(['400 1em Inter', '500 1em Inter', '600 1em Inter', '400 1em "JetBrains Mono"', '500 1em "JetBrains Mono"'].map((f) => document.fonts.load(f)))
createRoot(document.getElementById('root')!).render(location.hash === '#about' ? <AboutWindow /> : location.hash === '#restart' ? <RestartDialog /> : <App />) // the About and Restart to update windows load this page too
