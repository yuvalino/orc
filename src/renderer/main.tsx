import { createRoot } from 'react-dom/client'
import App from './app/App'
import { AboutWindow } from './app/About'
import './styles/globals.css'
import '@shared/api'

createRoot(document.getElementById('root')!).render(location.hash === '#about' ? <AboutWindow /> : <App />) // the About window loads this page too
