import { createRoot } from 'react-dom/client'
import App from './app/App'
import './styles/globals.css'
import '@shared/api'

createRoot(document.getElementById('root')!).render(<App />)
